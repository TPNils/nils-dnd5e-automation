import { IUnregisterTrigger } from "../lib/db/dml-trigger";
import { provider } from "../provider/provider";

interface DynamicElementConfig {
  selector: string;
  inits: OnInit[];
  callbacks: DynamicElementCallback[];
}

type PermissionCheckResult = 'can-run-local' | 'can-run-as-gm' | 'prevent-action';
interface DynamicElementCallback {
  readonly id: string;
  readonly eventName: string;
  readonly filterSelector?: string
  readonly serializer: (event: Event) => any;
  readonly permissionCheck?: (data: any) => Promise<PermissionCheckResult> | PermissionCheckResult;
  readonly execute: (data: any) => void;
}

type ExecuteResponse = {success: true;} | {success: false; errorMessage: string, stackTrace?: string[], errorType: 'warn' | 'error'}
async function executeIfAllowed(callback: DynamicElementCallback, data: any): Promise<ExecuteResponse> {
  try {
    if (!callback.permissionCheck || game.user.isGM) {
      callback.execute(data);
      return {success: true};
    }
  
    const permissionResponse = await callback.permissionCheck(data);
    if (permissionResponse === 'can-run-local') {
      callback.execute(data);
      return {success: true};
    } else if (permissionResponse === 'can-run-as-gm') {
      return provider.getSocket().then(socket => socket.executeAsGM(callback.id, data));
    } else {
      return {success: false, errorType: 'warn', errorMessage: `Missing permission for action ${callback.id}. Data: ${JSON.stringify(data)}`};
    }
  } catch (err) {
    return {
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
      stackTrace: err instanceof Error ? err.stack.split('\n') : undefined,
      errorType: 'error'
    }
  }
}

class DynamicElement extends HTMLElement {
  protected config: DynamicElementConfig;

  /**
   * Invoked each time one of the custom element's attributes is added, removed, or changed. Which attributes to notice change for is specified in a static get 
   */
  public attributeChangedCallback(name: string, oldValue: string, newValue: string): void {
    // TODO data binding
  }

  /**
   * Invoked each time the custom element is appended into a document-connected element.
   * This will happen each time the node is moved, and may happen before the element's contents have been fully parsed. 
   */
  private unregisters: IUnregisterTrigger[] = [];
  public connectedCallback(): void {
    this.registerEventListeners();
    for (const init of this.config.inits) {
      init({element: this});
    }
  }

  /**
   * Invoked each time the custom element is disconnected from the document's DOM.
   */
  public disconnectedCallback(): void {
    this.unregisterEventListeners();
  }

  /**
   * Invoked each time the custom element is moved to a new document.
   */
  public adoptedCallback(): void {
  }

  private registerEventListeners() {
    for (const callback of this.config.callbacks) {
      const listener: EventListenerOrEventListenerObject = async event => {
        const response = await executeIfAllowed(callback, callback.serializer(event));
        if (response.success === false) {
          if (response.errorType === 'warn') {
            console.warn(response);
            ui.notifications.warn(response.errorMessage);
          }
          if (response.errorType === 'error') {
            console.error(response);
            ui.notifications.error(response.errorMessage);
          }
        }
      }
      this.addEventListener(callback.eventName, listener);
      this.unregisters.push({unregister: () => this.removeEventListener(callback.eventName, listener)});
    }
  }

  private unregisterEventListeners() {
    for (const unregister of this.unregisters) {
      unregister.unregister();
    }
    this.unregisters = [];
  }

}

export class ElementCallbackBuilder<E extends string = string, C extends Event = Event, S = any> {
  constructor(
    private readonly eventBuilder: ElementBuilder,
  ){}

  private eventName: E;
  /**
   * @param eventName the name of the event you wish to listen to
   * @returns this
   */
  public event<K extends keyof HTMLElementEventMap>(eventName: K): ElementCallbackBuilder<K, HTMLElementEventMap[K], S>;
  public event(eventName: E): ElementCallbackBuilder<string, Event, S> {
    if (this.serializerFunc) {
      throw new Error(`Can't change the event name after the serializer has been set`);
    }
    if (this.executeFunc) {
      throw new Error(`Can't change the event name after the execute has been set`);
    }
    this.eventName = eventName;
    return this;
  }

  private serializerFunc: (event: Event) => S;
  /**
   * The serilizer should gather all the data of _this_ instance and transform it into
   * input data which can be processed in the _global_ context
   * 
   * @param serializerFunc function to transform the event to input data
   * @returns this
   */
  public serializer<T>(serializerFunc: (event: C) => T): ElementCallbackBuilder<E, C, T> {
    if (this.executeFunc) {
      throw new Error(`Can't change the serializer after the execute has been set`);
    }
    const builder: ElementCallbackBuilder<E, C, any> = this;
    builder.serializerFunc = serializerFunc;
    return builder;
  }

  private filterSelector: string;
  public filter(selector: string): this {
    this.filterSelector = selector;
    return this;
  }

  private permissionCheckFunc: (data: S) => Promise<PermissionCheckResult> | PermissionCheckResult;
  /**
   * Validate if the user is allowed to execute this action
   * 
   * @param permissionCheckFunc function which will do the permission check
   * @returns this
   */
  public permissionCheck(permissionCheckFunc: (data: S) => Promise<PermissionCheckResult> | PermissionCheckResult): this {
    this.permissionCheckFunc = permissionCheckFunc;
    return this;
  }

  private executeFunc: (event: S) => void;
  /**
   * The global execution function
   * 
   * @param executeFunc the fucntion which will execute the serialized event
   * @returns this
   */
  public execute(executeFunc: (event: S) => void): this {
    this.executeFunc = executeFunc;
    return this;
  }

  public finish(): ElementBuilder {
    return this.eventBuilder;
  }

  public toConfig(): Omit<DynamicElementCallback, 'id'> {
    return {
      eventName: this.eventName,
      filterSelector: this.filterSelector,
      serializer: this.serializerFunc,
      permissionCheck: this.permissionCheckFunc,
      execute: this.executeFunc,
    }
  }
}

export type OnInit = (args: {element: HTMLElement}) => void | Promise<void>;

export class ElementBuilder {

  private onInits: OnInit[] = [];
  public init(onInit: OnInit): this {
    this.onInits.push(onInit);
    return this;
  }

  private listenerBuilders: ElementCallbackBuilder[] = [];
  public addListener(): ElementCallbackBuilder {
    const listenerBuilder = new ElementCallbackBuilder(this);
    this.listenerBuilders.push(listenerBuilder);
    return listenerBuilder;
  }

  public build(selector: string): typeof HTMLElement {
    // TODO validate
    const config: DynamicElementConfig = {
      selector: selector,
      inits: this.onInits,
      callbacks: [],
    }

    let callbackId = 0;
    for (const listenerBuilder of this.listenerBuilders) {
      config.callbacks.push({
        ...listenerBuilder.toConfig(),
        id: `${config.selector}.${callbackId++}`,
      });
    }
    const element = class extends DynamicElement {
      constructor() {
        super()
        this.config = config;
      }
    };
    customElements.define(config.selector, element);
    provider.getSocket().then(socket => {
      for (let i = 0; i < config.callbacks.length; i++) {
        const callback = config.callbacks[i];
        socket.register(`${callback.id}`, async serializedData => {
          return await executeIfAllowed(callback, serializedData)
        });
      }
    });

    return element;
  }

}