import { AnyNodeData } from "../../../../types/html-data";
import { ValueProvider } from "../../provider/value-provider";
import { staticValues } from "../../static-values";
import { Stoppable } from "../utils/stoppable";
import { AttributeParser } from "./attribute-parser";
import { Template } from "./template/template";
import { rerenderQueue } from "./virtual-dom/render-queue";
import { VirtualAttributeNode, VirtualNode, VirtualParentNode } from "./virtual-dom/virtual-node";
import { VirtualNodeParser } from "./virtual-dom/virtual-node-parser";
import { VirtualNodeRenderer } from "./virtual-dom/virtual-node-renderer";

//#region Decorators
const componentConfigSymbol = Symbol('ComponentConfig');
const htmlElementSymbol = Symbol('HtmlElement');
const cssHostIdAttrPrefix = `${staticValues.code}-hid`;
const cssComponentIdAttrPrefix = `${staticValues.code}-cid`;

const componentInstanceProxyHandler: ProxyHandler<{[htmlElementSymbol]: ComponentElement}> = {
  set: (target: {[htmlElementSymbol]: ComponentElement}, field: string | symbol, value: any, receiver: any): boolean => {
    const allowed = Reflect.set(target, field, value, receiver);
    if (allowed && field !== htmlElementSymbol) {
      target[htmlElementSymbol]?.onChange();
    }
    return allowed;
  }
}
export interface ComponentConfig {
  tag: string;
  html?: string | AnyNodeData[];
  style?: string;
}
interface ComponentConfigInternal extends ComponentConfig {
  componentId: string;
  parsedHtml?: VirtualNode & VirtualParentNode;
  hasHtmlSlots: boolean;
}
export function Component(config: ComponentConfig | string) {
  if (typeof config === 'string') {
    config = {tag: config};
  }

  if (!config.tag.includes('-')) {
    throw new Error(`custom components need to have a dash included in their name
    https://html.spec.whatwg.org/multipage/custom-elements.html#valid-custom-element-name`)
  }

  return function<T extends { new (...args: any[]): {} }>(constructor: T) {
    const internalConfig: ComponentConfigInternal = {
      componentId: (config as any).componentId, // Should be provided by the compiler
      ...config as ComponentConfig,
      hasHtmlSlots: false,
    }

    internalConfig.tag = internalConfig.tag.toLowerCase();

    if (internalConfig.html) {
      internalConfig.parsedHtml = VirtualNodeParser.parse(internalConfig.html);
      // Mark all child nodes to be a part of this template
      let pending: Array<VirtualNode> = [internalConfig.parsedHtml];
      while (pending.length > 0) {
        const processing = pending;
        pending = [];
        for (const process of processing) {
          if (process.nodeName === 'SLOT') {
            internalConfig.hasHtmlSlots = true;
          }
          if (process.isAttributeNode()) {
            process.setAttribute(`${cssComponentIdAttrPrefix}-${internalConfig.componentId}`)
          }
          if (process.isParentNode()) {
            for (const child of process.childNodes) {
              pending.push(child);
            }
          }
        }
      }
    }

    if (constructor.prototype[attributeConfigSymbol] == null) {
      constructor.prototype[attributeConfigSymbol] = {
        byAttribute: {},
        byProperty: {},
      };
    }
    if (constructor.prototype[eventConfigSymbol] == null) {
      constructor.prototype[eventConfigSymbol] = {
        byEventName: {},
        byProperty: {},
      };
    }
    if (constructor.prototype[outputConfigSymbol] == null) {
      constructor.prototype[outputConfigSymbol] = {
        byEventName: {},
        byProperty: {},
      };
    }
    constructor.prototype[componentConfigSymbol] = internalConfig;
    
    // @Attribute gets called before @Component
    //  Tested in Firefox
    const attrConfigs: AttributeConfigsInternal = constructor.prototype[attributeConfigSymbol];
    const listenForAttribute: string[] = [];
    if (attrConfigs?.byAttribute) {
      for (const attr in attrConfigs.byAttribute) {
        listenForAttribute.push(attr);
      }
    }

    const element = class extends ComponentElement {
      constructor() {
        super()
        this.controller = new Proxy(new constructor(), componentInstanceProxyHandler);
      }
      
      public static get observedAttributes() {
        return listenForAttribute;
      }
    };

    customElements.define(internalConfig.tag, element);
    if (internalConfig.style) {
      const styleElement = document.createElement('style');
      styleElement.id = staticValues.code + '-element-' + internalConfig.componentId;
      styleElement.innerHTML = internalConfig.style;
      
      document.head.appendChild(styleElement);
    }
  };
}
Component.isComponentElement = (element: any): element is ComponentElement => {
  return element instanceof ComponentElement;
}
Component.getTag = (constructor: ConstructorOf<any>): string | null => {
  return (constructor.prototype[componentConfigSymbol] as ComponentConfigInternal)?.tag;
}

const attributeConfigSymbol = Symbol('AttributeConfigs');
export interface AttributeConfig {
  name: string;
  dataType?: 'string' | 'number' | 'boolean' | 'object';
}
interface AttributeConfigInternal {
  attribute: string;
  dataType?: AttributeConfig['dataType'];
  propertyKey: string;
  descriptor?: PropertyDescriptor;
}
interface AttributeConfigsInternal {
  byAttribute: {[attr: string]: AttributeConfigInternal[]};
  byProperty: {[prop: string]: AttributeConfigInternal[]};
}
export function Attribute(config?: AttributeConfig | string) {
  if (typeof config === 'string') {
    config = {name: config};
  }
  return function (targetPrototype: any, propertyKey: string, descriptor?: PropertyDescriptor) {
    if (targetPrototype[attributeConfigSymbol] == null) {
      targetPrototype[attributeConfigSymbol] = {
        byAttribute: {},
        byProperty: {},
      };
    }
    if (config == null) {
      config = {name: propertyKey};
    }
    const internalConfig: AttributeConfigInternal = {
      attribute: (config as AttributeConfig).name,
      dataType: (config as AttributeConfig).dataType ?? 'string',
      propertyKey: propertyKey,
      descriptor: descriptor,
    }
    if (targetPrototype[attributeConfigSymbol].byAttribute[internalConfig.attribute] == null) {
      targetPrototype[attributeConfigSymbol].byAttribute[internalConfig.attribute] = [];
    }
    targetPrototype[attributeConfigSymbol].byAttribute[internalConfig.attribute].push(internalConfig);
    
    if (targetPrototype[attributeConfigSymbol].byProperty[internalConfig.propertyKey] == null) {
      targetPrototype[attributeConfigSymbol].byProperty[internalConfig.propertyKey] = [];
    }
    targetPrototype[attributeConfigSymbol].byProperty[internalConfig.propertyKey].push(internalConfig);
  };
}

const asyncAttributeSymbol = Symbol('valueProvider');
export function AsyncAttribute(config?: AttributeConfig | string) {
  return function (target: any, propertyKey: string, descriptor?: PropertyDescriptor) {
    const getFunction = function (this: {[htmlElementSymbol]: ComponentElement}) {
      if (!this[asyncAttributeSymbol]) {
        this[asyncAttributeSymbol] = {};
      }
      if (!this[asyncAttributeSymbol][propertyKey]) {
        this[asyncAttributeSymbol][propertyKey] = new ValueProvider();
      }
      return this[asyncAttributeSymbol][propertyKey];
    };
    const setFunction = function(this: {[htmlElementSymbol]: ComponentElement}, arg: any) {
      if (!this[asyncAttributeSymbol]) {
        this[asyncAttributeSymbol] = {};
      }
      if (!this[asyncAttributeSymbol][propertyKey]) {
        if (arg instanceof ValueProvider) {
          // Allow to set the initial value
          this[asyncAttributeSymbol][propertyKey] = arg;
          return;
        } else {
          this[asyncAttributeSymbol][propertyKey] = new ValueProvider();
        }
      }
      this[asyncAttributeSymbol][propertyKey].set(arg);
    };

    if (descriptor) {
      if (descriptor.set || descriptor.get) {
        throw new Error(`AsyncAttribute is not compatible with getter & setters. Ref: ${target?.constructor?.name}.${propertyKey}`)
      }
      descriptor.get = getFunction;
      descriptor.set = setFunction;
    } else {
      Reflect.defineProperty(target, propertyKey, {
        get: getFunction,
        set: setFunction,
      })
    }
    
    return Attribute(config)(target, propertyKey, descriptor);
  };
}

const eventConfigSymbol = Symbol('EventConfig');
export interface EventConfig {
  name: string;
}
interface EventConfigInternal {
  eventName: string;
  propertyKey: string;
  descriptor: PropertyDescriptor;
}
interface EventConfigsInternal {
  byEventName: {[attr: string]: EventConfigInternal[]};
  byProperty: {[prop: string]: EventConfigInternal[]};
}
export function BindEvent(config: EventConfig | string) {
  if (typeof config === 'string') {
    config = {name: config};
  }
  return function (targetPrototype: any, propertyKey: string, descriptor: PropertyDescriptor) {
    if (targetPrototype[eventConfigSymbol] == null) {
      targetPrototype[eventConfigSymbol] = {
        byEventName: {},
        byProperty: {},
      };
    }
    const internalConfig: EventConfigInternal = {
      eventName: (config as EventConfig).name,
      propertyKey: propertyKey,
      descriptor: descriptor,
    }
    if (targetPrototype[eventConfigSymbol].byEventName[internalConfig.eventName] == null) {
      targetPrototype[eventConfigSymbol].byEventName[internalConfig.eventName] = [];
    }
    targetPrototype[eventConfigSymbol].byEventName[internalConfig.eventName].push(internalConfig);
    
    if (targetPrototype[eventConfigSymbol].byProperty[internalConfig.propertyKey] == null) {
      targetPrototype[eventConfigSymbol].byProperty[internalConfig.propertyKey] = [];
    }
    targetPrototype[eventConfigSymbol].byProperty[internalConfig.propertyKey].push(internalConfig);
  };
}

const fromAttrChangeSymbol = Symbol('fromAttrChange');
const outputConfigSymbol = Symbol('OutputConfig');
export interface OutputConfig {
  eventName?: string;
  /* default: false */
  bubbles?: boolean;
  /* default: false. Won't emit if the last emit was the same. If it's a function, return true of the values are the same */
  deduplicate?: boolean | ((oldValue: any, newValue: any) => boolean);
}
interface OutputConfigInternal {
  eventName: OutputConfig['eventName'];
  bubbles: OutputConfig['bubbles'];
  deduplicate: OutputConfig['deduplicate'];
}
interface OutputConfigsInternal {
  byEventName: {[attr: string]: OutputConfigInternal[]};
  byProperty: {[prop: string]: OutputConfigInternal[]};
}
export function Output(config?: string | OutputConfig) {
  return function (targetPrototype: any, propertyKey: string, descriptor?: PropertyDescriptor) {
    if (targetPrototype[outputConfigSymbol] == null) {
      targetPrototype[outputConfigSymbol] = {
        byEventName: {},
        byProperty: {},
      };
    }
    const internalConfig: OutputConfigInternal = {
      eventName: propertyKey,
      bubbles: false,
      deduplicate: false,
    }

    // Add to configs list
    if (targetPrototype[outputConfigSymbol].byEventName[internalConfig.eventName] == null) {
      targetPrototype[outputConfigSymbol].byEventName[internalConfig.eventName] = [];
    }
    targetPrototype[outputConfigSymbol].byEventName[internalConfig.eventName].push(internalConfig);
    
    if (targetPrototype[outputConfigSymbol].byProperty[propertyKey] == null) {
      targetPrototype[outputConfigSymbol].byProperty[propertyKey] = [];
    }
    targetPrototype[outputConfigSymbol].byProperty[propertyKey].push(internalConfig);

    // Apply output emitters
    if (typeof config === 'string') {
      internalConfig.eventName = config;
    } else {
      if (config.eventName != null) {
        internalConfig.eventName = config.eventName;
      }
      if (config.bubbles != null) {
        internalConfig.bubbles = config.bubbles;
      }
      if (config.deduplicate != null) {
        internalConfig.deduplicate = config.deduplicate;
      }
    }
    let dataStore = Symbol(`@Output-${internalConfig.eventName}`);
    const setFunction = function (this: {[htmlElementSymbol]: ComponentElement}, value: any, disable?: any): void {
      if (!this[dataStore]) {
        this[dataStore] = {
          hasEmit: false,
        }
      }
      if (this[dataStore].hasEmit && internalConfig.deduplicate) {
        if (typeof internalConfig.deduplicate === 'function' && internalConfig.deduplicate(this[dataStore].lastEmitValue, value)) {
          return;
        } else if (this[dataStore].lastEmitValue === value) {
          return;
        }
      }
      this[dataStore].hasEmit = true;
      this[dataStore].lastEmitValue = value;
      if (disable === fromAttrChangeSymbol) {
        return;
      }

      if (this[htmlElementSymbol] == null) {
        // htmlElement is init after the constructor has finished
        return;
      }
      
      if (value instanceof Event) {
        this[htmlElementSymbol].dispatchEvent(new (value.constructor as ConstructorOf<Event>)(internalConfig.eventName.toLowerCase(), value));
      } else {
        this[htmlElementSymbol].dispatchEvent(new CustomEvent(internalConfig.eventName.toLowerCase(), {detail: value, cancelable: false, bubbles: internalConfig.bubbles}));
      }
    };
    if (descriptor) {
      if (descriptor.set) {
        const originalSet = descriptor.set;
        descriptor.set = function(this: {[htmlElementSymbol]: ComponentElement}, ...args: any[]) {
          originalSet.call(this, ...args);
          setFunction.call(this, ...args);
        };
      } else {
        descriptor.get = function (this: {[htmlElementSymbol]: ComponentElement}): void {
          return this[dataStore]?.lastEmitValue;
        };
        descriptor.set = setFunction;
      }
    } else {
      Reflect.defineProperty(targetPrototype, propertyKey, {
        get: function (this: {[htmlElementSymbol]: ComponentElement}): void {
          return this[dataStore]?.lastEmitValue;
        },
        set: setFunction,
      })
    }
  };
}
//#endregion

export interface OnInit {
  onInit(args: OnInitParam): void | any;
}

export interface OnInitParam {
  html: ComponentElement,
  markChanged: () => void;
  addStoppable(...stoppable: Stoppable[]): void;
}

const deepUpdateOptions = {deepUpdate: true};
const deepSyncUpdateOptions: {sync: true, deepUpdate: true} = {sync: true, deepUpdate: true};

export class ComponentElement extends HTMLElement {
  #controller: object
  protected get controller(): object {
    return this.#controller;
  }
  protected set controller(value: object) {
    if (this.#controller) {
      delete this.#controller[htmlElementSymbol];
    }
    this.#controller = value;
    this.#controller[htmlElementSymbol] = this;
  }

  public getHostAttribute(): string {
    return `${cssHostIdAttrPrefix}-${this.getComponentConfig().componentId}`;
  }

  private getComponentConfig(): ComponentConfigInternal {
    return this.#controller.constructor.prototype[componentConfigSymbol];
  }

  private getAttributeConfigs(): AttributeConfigsInternal {
    return this.#controller.constructor.prototype[attributeConfigSymbol];
  }

  private getEventConfigs(): EventConfigsInternal {
    return this.#controller.constructor.prototype[eventConfigSymbol];
  }

  private getOutputConfigs(): OutputConfigsInternal {
    return this.#controller.constructor.prototype[outputConfigSymbol];
  }

  /**
   * Invoked each time one of the custom element's attributes is added, removed, or changed. Which attributes to notice change for is specified in a static get 
   */
  private skipAttrCallback = false;
  public attributeChangedCallback(name: string, oldValue: string, newValue: string): void {
    if (this.skipAttrCallback) {
      return;
    }
    if (newValue !== oldValue) {
      this.setControllerFromAttribute(name, newValue);
    }
  }

  public setInput(name: string, newValue: any) {
    if (this.setControllerFromAttribute(name, newValue)) {
      this.skipAttrCallback = true;
    }
    if (this.hasAttribute(name) || !this.skipAttrCallback) {
      // If the attribute was set, reflect changes to it
      // If the attribute is not an @Attribute, also reflect changes to it
      // If attribute was not set, keep it all internal
      // This aligns a bit (not 100%) with the best practices https://web.dev/custom-elements-best-practices/
      //   and tweaked by my opinion
      if (newValue === false) {
        // disabled="false" is still disabled => don't set false attributes
        this.removeAttribute(name);
      } else {
        this.setAttribute(name, AttributeParser.serialize(newValue));
      }
    }
    this.skipAttrCallback = false;
  }

  /**
   * @returns if the controller is listening to changes of that attribute
   */
  private setControllerFromAttribute(name: string, value: any): boolean {
    name = name.toLowerCase();
    const attrConfigs = this.getAttributeConfigs();
    if (attrConfigs.byAttribute[name]) {
      for (const config of attrConfigs.byAttribute[name]) {
        let normalizedValue = value;
        switch (config.dataType) {
          case 'string': {
            normalizedValue = AttributeParser.parseString(normalizedValue);
            break;
          }
          case 'number': {
            normalizedValue = AttributeParser.parseNumber(normalizedValue);
            break;
          }
          case 'boolean': {
            normalizedValue = AttributeParser.parseBoolean(normalizedValue);
            break;
          }
          case 'object': {
            normalizedValue = AttributeParser.parseObject(normalizedValue);
            break;
          }
        }
        if (this.getOutputConfigs().byProperty[config.propertyKey]) {
          const descriptor = Reflect.getOwnPropertyDescriptor(Reflect.getPrototypeOf(this.#controller), config.propertyKey);
          descriptor.set.call(this.#controller, normalizedValue, fromAttrChangeSymbol);
          //this.#controller[config.propertyKey] = normalizedValue;
        } else {
          this.#controller[config.propertyKey] = normalizedValue;
        }
      }
      return true;
    }
    return false;
  }

  /**
   * Mark this element as changed
   */
  public onChange(): void {
    if (this.isConnected) {
      this.generateHtmlQueue();
    }
  }

  /**
   * Invoked each time the custom element is appended into a document-connected element.
   * This will happen each time the node is moved, and may happen before the element's contents have been fully parsed. 
   */
  public connectedCallback(): void {
    this.readAllAttributes();
    const hostAttr = this.getHostAttribute();
    if (!this.hasAttribute(hostAttr)) {
      this.setAttribute(hostAttr, '');
    }

    if (this.getComponentConfig().hasHtmlSlots) {
      // Create an observer instance linked to the callback function
      const observer = new MutationObserver((mutationList) => {
        for (const mutation of mutationList) {
          switch (mutation.type) {
            case 'childList': {
              for (let i = 0; i < mutation.addedNodes.length; i++) {
                const node = mutation.addedNodes.item(i);
                if (node instanceof HTMLElement && (node.hasAttribute('slot') || node.hasAttribute('data-slot'))) {
                  this.applySlots();
                  return;
                }
              }
              for (let i = 0; i < mutation.removedNodes.length; i++) {
                const node = mutation.removedNodes.item(i);
                if (node instanceof HTMLElement && (node.hasAttribute('slot') || node.hasAttribute('data-slot'))) {
                  this.applySlots();
                  return;
                }
              }
              break;
            }
            case 'attributes': {
              this.applySlots();
              return;
            }
          }
        }
      });

      // Start observing the target node for configured mutations
      observer.observe(this, { childList: true, subtree: true, attributeFilter: ['data-slot', 'slot'] });

      // Later, you can stop observing
      this.unregisters.push({stop: () => observer.disconnect()})
    }

    this.generateHtmlQueue().then(() => {
      this.registerEventListeners();
      if (ComponentElement.isOnInit(this.#controller)) {
        this.#controller.onInit({
          html: this,
          markChanged: () => this.generateHtmlQueue(),
          addStoppable: (...stoppable: Stoppable[]) => {
            this.unregisters.push(...stoppable);
          }
        });
      }
    });
  }

  /**
   * attributeChangedCallback is only called when it's part of the dom
   * Read attributes on init
   * https://web.dev/custom-elements-best-practices/
   */
  private readAllAttributes(): void {
    for (const attr of this.getAttributeNames()) {
      this.setControllerFromAttribute(attr, this.getAttribute(attr));
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

  private listenersRegistered = false;
  private unregisters: Stoppable[] = [];
  private registerEventListeners() {
    if (this.listenersRegistered) {
      return;
    }
    this.listenersRegistered = true;
    const eventConfigs = this.getEventConfigs();
    for (const configs of Object.values(eventConfigs.byEventName)) {
      for (const config of configs) {
        const listener: EventListenerOrEventListenerObject = event => {
          this.#controller[config.propertyKey](event);
        }
        if (config.eventName.toLowerCase().startsWith('window:')) {
          window.addEventListener(config.eventName.substring(7), listener);
        } else if (config.eventName.toLowerCase().startsWith('document:')) {
          document.addEventListener(config.eventName.substring(9), listener);
        } else if (config.eventName.toLowerCase().startsWith('body:')) {
          document.addEventListener(config.eventName.substring(5), listener);
        } else {
          this.addEventListener(config.eventName, listener);
        }
        this.unregisters.push({stop: () => this.removeEventListener(config.eventName, listener)});
      }
    }
  }

  private unregisterEventListeners() {
    for (const unregister of this.unregisters) {
      unregister.stop();
    }
    this.unregisters = [];
    this.listenersRegistered = false;
  }

  private template: Template;
  private templateRenderResult: VirtualNode & VirtualParentNode;
  private generateHtmlExec = async (): Promise<void> =>  {
    if (this.template === undefined) {
      const parsedHtml = this.getComponentConfig().parsedHtml;
      if (!parsedHtml) {
        this.template = null;
      } else {
        this.template = new Template(this.nodeName, parsedHtml, this.#controller);
        this.templateRenderResult = this.template.render({sync: true});
        const rootNodes = VirtualNodeRenderer.renderDom(this.templateRenderResult, deepSyncUpdateOptions);
        this.findSlots();
        this.applySlots();
        this.setInnerNode(rootNodes);
      }
    } else if (this.template !== null) {
      this.templateRenderResult = await this.template.render({force: true});
      const rootNodes = await VirtualNodeRenderer.renderDom(this.templateRenderResult, deepUpdateOptions);
      this.findSlots();
      this.applySlots();
      this.setInnerNode(rootNodes);
    }
  }

  private setInnerNode(rootNodes: Node[]) {
    if (rootNodes.length === 0) {
      return;
    }

    if (rootNodes[0].parentNode !== this) {
      if (rootNodes[0].parentNode != null) {
        rootNodes[0].parentNode.removeChild(rootNodes[0]);
      }
      this.prepend(rootNodes[0]);
    }

    for (let i = 1; i < rootNodes.length; i++) {
      const node = rootNodes[i];
      if (node.parentNode != null) {
        node.parentNode.removeChild(node);
      }
      (rootNodes[i-1] as ChildNode).after(rootNodes[i]);
    }

  }

  private generateHtmlQueue(): Promise<void> {
    return rerenderQueue.add(this.generateHtmlExec);
  }
  
  private elementsBySlotName = new Map<string, Array<VirtualNode & VirtualAttributeNode>>();
  private findSlots(): void {
    if (!this.getComponentConfig().hasHtmlSlots || !this.template) {
      return;
    }
    const deleteKeys = new Set<string>();
    for (const slotName of this.elementsBySlotName.keys()) {
      const filteredNodes = [];
      for (const node of this.elementsBySlotName.get(slotName)) {
        if (this.templateRenderResult.contains(node)) {
          filteredNodes.push(node);
        }
      }
      if (filteredNodes.length === 0) {
        deleteKeys.add(slotName);
      } else {
        this.elementsBySlotName.set(slotName, filteredNodes);
      }
    }
    for (const slotName of deleteKeys) {
      this.elementsBySlotName.delete(slotName);
    }
    let pending: Array<VirtualNode> = [this.templateRenderResult];
    while (pending.length > 0) {
      const processing = pending;
      pending = [];
      for (const process of processing) {
        if (process.isAttributeNode() && process.nodeName === 'SLOT') {
          let slotName = AttributeParser.parseString(process.getAttribute('name'));
          if (slotName == null) {
            slotName = '';
          }

          if (!this.elementsBySlotName.has(slotName)) {
            this.elementsBySlotName.set(slotName, []);
          }
          if (!this.elementsBySlotName.get(slotName).includes(process)) {
            this.elementsBySlotName.get(slotName).push(process);
          }
        }
        if (process.isParentNode()) {
          for (const child of process.childNodes) {
            pending.push(child);
          }
        }
      }
    }
  }

  private slotsToReplacements = new Map<string, {placeholder: Comment; elements: Array<Element>;}>();
  private applySlots(): void {
    if (!this.getComponentConfig().hasHtmlSlots || !this.template) {
      return;
    }
    const componentId = this.getComponentConfig().componentId;

    const replacementElementsBySlotName = new Map<string, Array<Element>>();
    for (const slotName of this.elementsBySlotName.keys()) {
      replacementElementsBySlotName.set(slotName, Array.from(this.querySelectorAll(`:scope > [slot="${slotName}"]:not([${cssComponentIdAttrPrefix}-${componentId}]), :scope > [data-slot="${slotName}"]:not([${cssComponentIdAttrPrefix}-${componentId}])`)));
    }
    
    // Check if the target slots still match
    for (const slotName of this.slotsToReplacements.keys()) {
      const filteredElements: Element[] = [];
      for (const elem of this.slotsToReplacements.get(slotName).elements) {
        const slotAttr = elem.getAttribute('slot') ?? elem.getAttribute('data-slot');
        if (slotAttr === slotName && this.elementsBySlotName.has(slotName)) {
          filteredElements.push(elem);
        } else {
          if (!replacementElementsBySlotName.has(slotAttr)) {
            replacementElementsBySlotName.set(slotAttr, []);
          }
          replacementElementsBySlotName.get(slotAttr).push(elem);
        }
      }
      this.slotsToReplacements.get(slotName).elements = filteredElements;
    }

    // Apply replacements to slots or restore slots if no replacements found
    for (const slotName of this.elementsBySlotName.keys()) {
      const slots = this.elementsBySlotName.get(slotName).filter(elem => VirtualNodeRenderer.getState(elem)?.domNode != null);
      if (slots.length > 0) {
        // Only support unique slot names so we can move the replacement element
        const slotElement = VirtualNodeRenderer.getState(slots[0]).domNode as HTMLSlotElement;
        let newReplaceElements = replacementElementsBySlotName.get(slotName);
        if (!this.slotsToReplacements.has(slotName) && newReplaceElements.length > 0) {
          const placeholder = document.createComment(`slot placeholder`);
          slotElement.parentElement.insertBefore(placeholder, slotElement);
          this.slotsToReplacements.set(slotName, {
            placeholder: placeholder,
            elements: newReplaceElements,
          });
        } else if (this.slotsToReplacements.has(slotName)) {
          const replacements = this.slotsToReplacements.get(slotName);
          // Verify if these elements still exist
          replacements.elements = replacements.elements.filter(elem => this.contains(elem));
          newReplaceElements = newReplaceElements.filter(elem => !replacements.elements.includes(elem));
          for (const elem of newReplaceElements) {
            replacements.elements.push(elem);
          }
        }

        let referenceInsertBeforeNode: Node = this.slotsToReplacements.get(slotName)?.placeholder ?? slotElement;
        for (let i = newReplaceElements.length - 1; i >= 0; i--) {
          newReplaceElements[i].remove()
          referenceInsertBeforeNode.parentElement.insertBefore(newReplaceElements[i], referenceInsertBeforeNode);
        }
        const isSlotInDom = this.contains(slotElement);
        if (isSlotInDom && newReplaceElements.length > 0 && this.slotsToReplacements.get(slotName).elements.length > 0) {
          slotElement.parentElement.removeChild(slotElement);
        } else if (!isSlotInDom && this.slotsToReplacements.has(slotName) && this.slotsToReplacements.get(slotName).elements.length === 0) {
          const replacements = this.slotsToReplacements.get(slotName);
          replacements.placeholder.parentElement.insertBefore(slotElement, replacements.placeholder);
          replacements.placeholder.remove();
          this.slotsToReplacements.delete(slotName);
        }
      }
    }

    // Handle replacements for non-supported slots
    for (const slotName of replacementElementsBySlotName.keys()) {
      const slots = this.elementsBySlotName.get(slotName)?.filter(elem => VirtualNodeRenderer.getState(elem)?.domNode != null);
      if (!slots?.length) {
        for (const elem of replacementElementsBySlotName.get(slotName)) {
          if (elem.parentElement !== this) {
            // Move element back to it's original position
            elem.remove();
            this.appendChild(elem);
          }
        }
      }
    }
  }

  private static isOnInit(value: any): value is OnInit {
    return typeof value === 'object' && typeof value.onInit === 'function';
  }

}