import { staticValues } from "../../static-values";
import { UtilsLog } from "../../utils/utils-log";
import { Stoppable } from "../utils/stoppable";
import { AttributeParser } from "./attribute-parser";
import { Template } from "./template/template";
import { VirtualNode, VirtualParentNode } from "./virtual-dom/virtual-node";
import { VirtualNodeParser } from "./virtual-dom/virtual-node-parser";
import { VirtualNodeRenderer } from "./virtual-dom/virtual-node-renderer";

const randomHostContextReplacementString = 'ownkpvxugsyazllonppejzbrturjgeqgkmwzqmycghzmlyawnxgfilehatkhebfttjyusazpejznezjaerwbtegfbuqhiqqcrkma';

//#region Decorators
let browserSupportHostContext = false;
{
  try {
    const dummyStyleSheet = new CSSStyleSheet();
    dummyStyleSheet.insertRule(`:host-context(div) {display: block;}`);
    browserSupportHostContext = dummyStyleSheet.cssRules.length > 0;
  } catch (e) {
    browserSupportHostContext = false;
  }
}
let nextComponentId = 0;
const componentConfigSymbol = Symbol('ComponentConfig');
const htmlElementSymbol = Symbol('HtmlElement');
const cssComponentHostIdAttrPrefix = `${staticValues.code}-host`;
const cssComponentIdAttrPrefix = `${staticValues.code}-cid`;
function adjustCssSelector(selector: string, componentId: string): string {
  selector = selector.trim();
  const hostContextPrefix = browserSupportHostContext ? ':host-context(' : `:is(${randomHostContextReplacementString}`;
  if (selector.toLowerCase().startsWith(hostContextPrefix)) {
    const rule = selector.substring(hostContextPrefix.length);
    let remainingOpenBrackets = 1; // already omitted one
    let ruleIndex = 0;
    for (; ruleIndex < rule.length && remainingOpenBrackets > 0; ruleIndex++) {
      switch (rule[ruleIndex]) {
        case '(': {
          remainingOpenBrackets++;
        }
        case ')': {
          remainingOpenBrackets--;
        }
      }
    }
    if (remainingOpenBrackets === 0) {
      selector = [
        rule.substring(0, ruleIndex-1),
        adjustCssSelector(rule.substring(ruleIndex), componentId),
      ].join(' ');
      UtilsLog.debug('host context compound selector', rule.substring(0, ruleIndex-1), 'result:', selector);
    }
  } else if (selector.toLowerCase().startsWith(':host')) {
    let parts = [`[${cssComponentHostIdAttrPrefix}-${componentId}]`];
    if (selector[5] === ' ') {
      parts.push(' ');
    }
    parts.push(adjustCssSelector(selector.substring(5), componentId));
    selector = parts.join('');
  } else {
    // TODO this doesnt cover selectors like :is(span, div)
    selector = selector
      .split(' ')
      .map(part => `${part}[${cssComponentIdAttrPrefix}-${componentId}]`)
      .join(' ');
  }

  UtilsLog.debug('selector result', selector);
  return selector;
}

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
  html?: string; // TODO
  style?: string; // TODO
}
interface ComponentConfigInternal extends ComponentConfig {
  componentId: string;
  parsedHtml?: VirtualNode & VirtualParentNode;
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
      ...config as ComponentConfig,
      componentId: String(nextComponentId++),
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
      const dummyStyleSheet = new CSSStyleSheet();
      let sheetFriendlyStyle = internalConfig.style;
      if (!browserSupportHostContext) {
        // Not all browsers (firefox) support :host-context() https://developer.mozilla.org/en-US/docs/Web/CSS/:host-context
        // But all browsers do support :is() https://developer.mozilla.org/en-US/docs/Web/CSS/:is
        sheetFriendlyStyle = sheetFriendlyStyle.replace(/:host-context\(/ig, `:is(${randomHostContextReplacementString}`);
        UtilsLog.debug('sheetFriendlyStyle', sheetFriendlyStyle)
      }
      // @ts-ignore
      dummyStyleSheet.replaceSync(sheetFriendlyStyle);

      const rules: string[] = [];
      for (let i = 0; i < dummyStyleSheet.cssRules.length; i++) {
        const cssRule = dummyStyleSheet.cssRules[i];
        let ruleString = cssRule.cssText;
        if (cssRule instanceof CSSStyleRule) {
          const modifiedSelectors: string[] = [];

          // TODO this doesnt cover selectors like :is(span, div)
          for (let selector of cssRule.selectorText.split(',')) {
            modifiedSelectors.push(adjustCssSelector(selector, internalConfig.componentId));
          }

          ruleString = modifiedSelectors.join(',') + ' ' + cssRule.cssText.substring(cssRule.cssText.indexOf('{'));
        }
        rules.push(ruleString);
      }
      const styleElement = document.createElement('style');
      styleElement.id = staticValues.code + '-element-' + internalConfig.componentId;
      styleElement.innerHTML = rules.join('\n');
      
      document.head.appendChild(styleElement);
    }
  };
}
Component.isComponentElement = (element: any): element is ComponentElement => {
  return element instanceof ComponentElement;
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
export interface OutputConfig {
  eventName?: string;
  /* default: false */
  bubbels?: boolean;
}
interface OutputConfigInternal {
  eventName: string;
  bubbels: boolean;
}
export function Output(config?: string | OutputConfig) {
  return function (targetPrototype: any, propertyKey: string, descriptor?: PropertyDescriptor) {
    const configInternal: OutputConfigInternal = {
      eventName: propertyKey,
      bubbels: false,
    }
    if (typeof config === 'string') {
      configInternal.eventName = config;
    } else {
      if (config.eventName != null) {
        configInternal.eventName = config.eventName;
      }
      if (config.bubbels != null) {
        configInternal.bubbels = config.bubbels;
      }
    }
    const setFunction = function (this: {[htmlElementSymbol]: ComponentElement}, value: any): void {
      this[htmlElementSymbol].dispatchEvent(new CustomEvent(configInternal.eventName, {detail: value, cancelable: false, bubbles: configInternal.bubbels}));
    };
    if (descriptor) {
      descriptor.set = setFunction;
    } else {
      Reflect.defineProperty(targetPrototype, propertyKey, {
        set: setFunction,
      })
    }
  };
}
//#endregion

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

  private getComponentConfig(): ComponentConfigInternal {
    return this.#controller.constructor.prototype[componentConfigSymbol];
  }

  private getAttributeConfigs(): AttributeConfigsInternal {
    return this.#controller.constructor.prototype[attributeConfigSymbol];
  }

  private getEventConfigs(): EventConfigsInternal {
    return this.#controller.constructor.prototype[eventConfigSymbol];
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
    this.setAttribute(name, AttributeParser.serialize(newValue));
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
        this.#controller[config.propertyKey] = normalizedValue;
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
      this.generateHtml();
    }
  }

  /**
   * Invoked each time the custom element is appended into a document-connected element.
   * This will happen each time the node is moved, and may happen before the element's contents have been fully parsed. 
   */
  public connectedCallback(): void {
    this.setAttribute(`${cssComponentHostIdAttrPrefix}-${this.getComponentConfig().componentId}`, '');
    if (typeof this.#controller['onInit'] === 'function') {
      this.#controller['onInit']();
    }
    this.innerHTML = ``;
    this.generateHtml().then(() => {
      this.registerEventListeners();
    });
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
        this.addEventListener(config.eventName, listener);
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
  private async generateHtml(): Promise<void> {
    if (this.template === undefined) {
      const parsedHtml = this.getComponentConfig().parsedHtml;
      if (!parsedHtml) {
        this.template = null;
      } else {
        this.template = new Template(parsedHtml, this.#controller);
        const node = await VirtualNodeRenderer.renderDom(this.template.render());
        this.append(node);
      }
    } else if (this.template !== null) {
      await VirtualNodeRenderer.renderDom(this.template.render({force: true}), true);
    }
  }

}