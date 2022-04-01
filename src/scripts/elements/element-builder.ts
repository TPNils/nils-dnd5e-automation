import { buffer } from "../lib/decorator/buffer";
import { Stoppable } from "../lib/utils/stoppable";
import { provider } from "../provider/provider";

interface DynamicElementConfig {
  selector: string;
  inits: OnInit<object>[];
  watchingAttributes: {[key: string]: ((value: string) => any)};
  onAttributeChanges: OnAttributeChange<any>[];
  callbacks: DynamicElementCallback[];
}

type PermissionCheckResult = 'can-run-local' | 'can-run-as-gm' | 'prevent-action';
interface DynamicElementCallback {
  readonly id: string;
  readonly eventName: string;
  readonly filterSelector?: string
  readonly serializers: Array<(event: SerializerArgs<Event>) => any>;
  readonly dataEnrichers: Array<(data: any) => any>;
  readonly permissionCheck?: (data: any) => Promise<PermissionCheckResult> | PermissionCheckResult;
  readonly execute: (data: any) => void;
}

interface SerializerArgs<E extends Event> {
  event: E;
  element: HTMLElement
}

type ExecuteResponse = {success: true;} | {success: false; errorMessage: string, stackTrace?: string[], errorType: 'warn' | 'error'}
function isExecuteResponse(value: any): value is ExecuteResponse {
  if (typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  if (value.success === true) {
    return true;
  }
  if (value.errorType === 'error' || value.errorType === 'warn') {
    return true;
  }
  return false;
}
async function executeIfAllowed(callback: DynamicElementCallback, serializedData: any): Promise<ExecuteResponse> {
  try {
    let enrichedData = deepClone(serializedData);
    for (const enricher of callback.dataEnrichers) {
      enrichedData = {...enrichedData, ...await enricher(serializedData)};
    }
    if (!callback.permissionCheck || game.user.isGM) {
      callback.execute(enrichedData);
      return {success: true};
    }
  
    const permissionResponse = await callback.permissionCheck(enrichedData);
    if (permissionResponse === 'can-run-local') {
      callback.execute(enrichedData);
      return {success: true};
    } else if (permissionResponse === 'can-run-as-gm' && callback.serializers.length > 0) {
      // When no serializers are provided, only allow local runs
      return provider.getSocket().then(socket => socket.executeAsGM(callback.id, serializedData));
    } else {
      return {success: false, errorType: 'warn', errorMessage: `Missing permission for action ${callback.id}. Data: ${JSON.stringify(enrichedData)}`};
    }
  } catch (err) {
    if (err instanceof Error) {
      return {
        success: false,
        errorMessage: err.message,
        stackTrace: err.stack.split('\n'),
        errorType: 'error'
      }
    } else if (isExecuteResponse(err)) {
      return err;
    } else {
      return {
        success: false,
        errorMessage: String(err),
        errorType: 'error'
      }
    }
  }
}

class DynamicElement extends HTMLElement {
  protected config: DynamicElementConfig;
  
  private readonly baseCallbackContext: BaseCallbackContext<object>;
  constructor() {
    super();
    this.baseCallbackContext = {
      element: this,
      attributes: {},
      addStoppable: (...stoppables: Stoppable[]) => this.unregisters.push(...stoppables),
    }
  }

  /**
   * Invoked each time one of the custom element's attributes is added, removed, or changed. Which attributes to notice change for is specified in a static get 
   */
  @buffer()
  public async attributeChangedCallback(args: Array<[string, string, string]>): Promise<void> {
    const changes: AttributeChange<any> = {};
    for (const attribute of Object.keys(this.config.watchingAttributes)) {
      changes[attribute] = {
        changed: false,
        currentValue: this.attributes[attribute],
        oldValue: this.attributes[attribute],
      }
    }
    for (const [name, oldValue, newValue] of args) {
      this.baseCallbackContext.attributes[name] = await this.config.watchingAttributes[name](newValue);
      changes[name].currentValue = this.baseCallbackContext.attributes[name];
    }
    let anyChanged = false;
    for (const attribute of Object.keys(this.config.watchingAttributes)) {
      changes[attribute].changed = changes[attribute].oldValue !== changes[attribute].currentValue;
      if (changes[attribute].changed) {
        anyChanged = true;
      }
    }
    if (!anyChanged) {
      return;
    }
    for (const onAttributeChange of this.config.onAttributeChanges) {
      await onAttributeChange({...this.baseCallbackContext, changes: changes});
    }
  }

  /**
   * Invoked each time the custom element is appended into a document-connected element.
   * This will happen each time the node is moved, and may happen before the element's contents have been fully parsed. 
   */
  private unregisters: Stoppable[] = [];
  public async connectedCallback(): Promise<void> {
    // Since attributeChangedCallback is async, ensure the most up-to-date values are available
    for (const attribute of Object.keys(this.config.watchingAttributes)) {
      this.baseCallbackContext.attributes[attribute] = await this.config.watchingAttributes[attribute](this.getAttribute(attribute));
    }
    this.registerEventListeners();
    for (const init of this.config.inits) {
      await init(this.baseCallbackContext);
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
        if (callback.filterSelector && event.target instanceof HTMLElement) {
          const items = Array.from(this.querySelectorAll(callback.filterSelector));
          if (!items.includes(event.target)) {
            return;
          }
        }
        const serializerArgs: SerializerArgs<Event> = {
          event: event,
          element: this,
        }
        let serializedData = serializerArgs;
        if (callback.serializers.length > 0) {
          serializedData = callback.serializers[0](serializerArgs);
          for (let i = 1; i < callback.serializers.length; i++) {
            serializedData = {...serializedData, ...callback.serializers[i](serializerArgs)}
          }
        }
        const response = await executeIfAllowed(callback, serializedData);
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
      this.unregisters.push({stop: () => this.removeEventListener(callback.eventName, listener)});
    }
  }

  private unregisterEventListeners() {
    for (const unregister of this.unregisters) {
      unregister.stop();
    }
    this.unregisters = [];
  }

}

export class ElementCallbackBuilder<E extends string = string, C extends Event = Event, S = SerializerArgs<C>> {

  private eventName: E;
  constructor(
  ){}
  /**
   * <b>Required</b>
   * 
   * @param eventName the name of the event you wish to listen to
   * @returns this
   */
  public setEvent<K extends keyof HTMLElementEventMap>(eventName: K): ElementCallbackBuilder<K, HTMLElementEventMap[K], S extends SerializerArgs<C> ? SerializerArgs<HTMLElementEventMap[K]> : S>;
  public setEvent(eventName: E): ElementCallbackBuilder<E, Event, S>
  public setEvent(eventName: E): ElementCallbackBuilder<string, Event, any> {
    if (this.eventName != null) {
      throw new Error(`Once set, can't change the event name`);
    }
    this.eventName = eventName;
    return this;
  }

  private serializerFuncs: Array<(args: SerializerArgs<C>) => any> = [];
  /**
   * <b>Optional*</b>
   * <p>At least 1 serializer would be required if you wish to enable 'can-run-as-gm' from the permission support</p>
   * The serializer should gather all the data of _this_ instance and transform it into
   * input data which can be processed in the _global_ context
   * The return values of all serializers will be combined, passed to the enrichers and then passed to the permission check and execute.
   * The serialized data should contain the minimum data and use lookups to records.
   * 
   * Also see enricher
   * 
   * @param serializerFunc function to transform the event to input data
   * @returns this
   */
  public addSerializer<T extends object>(serializerFunc: (args: SerializerArgs<C>) => T): ElementCallbackBuilder<E, C, T extends Event ? S : T & S> {
    this.serializerFuncs.push(serializerFunc);
    return this as ElementCallbackBuilder<E, C, any>;
  }

  private enricherFuncs: Array<(serializedData: S) => any> = [];
  /**
   * <b>Optional</b>
   * The serialized data cotnains the bare minimum.
   * To help the permission check and execute,
   * 
   * @param enricher function which return data which should be extended to the serialized data
   * @returns this
   */
  public addEnricher<T extends object>(enricher: (serializedData: S) => T | Promise<T>): ElementCallbackBuilder<E, C, T & S> {
    this.enricherFuncs.push(enricher);
    return this as ElementCallbackBuilder<E, C, any>;
  }

  private filterSelector: string;
  public setFilter(selector: string): this {
    if (selector && !selector.toLowerCase().startsWith(':scope')) {
      selector = ':scope ' + selector;
    }
    this.filterSelector = selector;
    return this;
  }

  private permissionCheckFunc: (data: S) => Promise<PermissionCheckResult> | PermissionCheckResult;
  /**
   * <b>Optional</b>
   * Validate if the user is allowed to execute this action
   * 
   * @param permissionCheckFunc function which will do the permission check
   * @returns this
   */
  public setPermissionCheck(permissionCheckFunc: (data: S) => Promise<PermissionCheckResult> | PermissionCheckResult): this {
    this.permissionCheckFunc = permissionCheckFunc;
    return this;
  }

  private executeFunc: (event: S) => void;
  /**
   * <b>Required</b>
   * The global execution function
   * 
   * @param executeFunc the fucntion which will execute the serialized event
   * @returns this
   */
  public setExecute(executeFunc: (event: S) => void): this {
    this.executeFunc = executeFunc;
    return this;
  }

  public toConfig(): Omit<DynamicElementCallback, 'id'> {
    return {
      eventName: this.eventName,
      filterSelector: this.filterSelector,
      dataEnrichers: this.enricherFuncs,
      serializers: this.serializerFuncs,
      permissionCheck: this.permissionCheckFunc,
      execute: this.executeFunc,
    }
  }
}

type AttributeChange<T> = {
  [P in keyof T]: {
    changed: boolean;
    currentValue?: T[P];
    oldValue?: T[P];
  };
};
export interface BaseCallbackContext<T> {
  readonly element: HTMLElement;
  readonly attributes: Readonly<Partial<T>>;
  addStoppable(...stoppables: Stoppable[]): void;
}
export type OnInit<T> = (context: BaseCallbackContext<T>) => unknown | Promise<unknown>;
export type OnAttributeChange<T> = (context: BaseCallbackContext<T> & {changes: AttributeChange<T>}) => unknown | Promise<unknown>;

const defaultAttributeTypes = {
  string: (value: string) => {
    if (value === '') {
      return null;
    }
    return value;
  },
  number: (value: string) => {
    if (/^[0-9]+$/.test(value)) {
      return Number(value);
    }
    return null;
  },
  boolean: (value: string) => {
    if (value == null) {
      return false;
    }
    if (value === '') {
      return true;
    }
    if (value.toLowerCase() === 'false') {
      return false;
    }
    return Boolean(value);
  },
  json: (value: string) => {
    if (value === '') {
      return null;
    }
    return JSON.parse(value);
  },
}

type AttributeTypes = typeof defaultAttributeTypes;

export class ElementBuilder<INPUT extends object = {}> {

  private onInits: OnInit<INPUT>[] = [];
  public addOnInit(onInit: OnInit<INPUT>): this {
    this.onInits.push(onInit);
    return this;
  }

  private onAttributeChanges: OnAttributeChange<INPUT>[] = [];
  public addOnAttributeChange(onAttributeChange: OnAttributeChange<INPUT>): this {
    this.onAttributeChanges.push(onAttributeChange);
    return this;
  }

  private listenerBuilders: ElementCallbackBuilder[] = [];
  public addListener(listenerBuilder: ElementCallbackBuilder): this {
    this.listenerBuilders.push(listenerBuilder);
    return this;
  }

  private attributes: {[key: string]: (value: string) => any} = {};
  public listenForAttribute<K extends string, T extends keyof AttributeTypes>(name: K, type: T): ElementBuilder<INPUT & {[k in K]: ReturnType<AttributeTypes[T]>}>
  public listenForAttribute<K extends string, R>(name: K, transformer: ((value: string) => R | Promise<R>)): ElementBuilder<INPUT & {[k in K]: R}>
  public listenForAttribute<K extends string, T extends keyof AttributeTypes, R>(name: K, type: T | ((value: string) => R | Promise<R>)): ElementBuilder<INPUT & {[k in K]: (ReturnType<AttributeTypes[T]> | R)}> {
    if (typeof type === 'string') {
      this.attributes[name] = defaultAttributeTypes[type];
    } else {
      this.attributes[name] = type;
    }
    return this as ElementBuilder<any>;
  }

  public build(selector: string): typeof HTMLElement {
    // TODO validate
    const config: DynamicElementConfig = {
      selector: selector,
      inits: this.onInits,
      watchingAttributes: this.attributes,
      onAttributeChanges: this.onAttributeChanges,
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
      
      public static get observedAttributes() {
        return Object.keys(config.watchingAttributes);
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