import { staticValues } from "../../static-values";
import { UtilsLog } from "../../utils/utils-log";
import { Stoppable } from "../utils/stoppable";
import { Template } from "./template/template";
import { VirtualNode, VirtualParentNode } from "./virtual-dom/virtual-node";
import { VirtualNodeParser } from "./virtual-dom/virtual-node-parser";
import { VirtualNodeRenderer } from "./virtual-dom/virtual-node-renderer";

//#region Decorators
let nextComponentId = 0;
const componentConfigSymbol = Symbol('ComponentConfig');
const htmlElementSymbol = Symbol('HtmlElement');
const cssComponentHostIdAttrPrefix = `${staticValues.code}-host`;
const cssComponentIdAttrPrefix = `${staticValues.code}-cid`;

const componentInstanceProxyHandler: ProxyHandler<{[htmlElementSymbol]: ComponentElement}> = {
  set: (target: {[htmlElementSymbol]: ComponentElement}, field: string | symbol, value: any, receiver: any): boolean => {
    const allowed = Reflect.set(target, field, value, receiver);
    if (allowed) {
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
      // @ts-ignore
      dummyStyleSheet.replaceSync(internalConfig.style)

      const rules: string[] = [];
      for (let i = 0; i < dummyStyleSheet.cssRules.length; i++) {
        const cssRule = dummyStyleSheet.cssRules[i];
        let ruleString = cssRule.cssText;
        if (cssRule instanceof CSSStyleRule) {
          const modifiedSelectors: string[] = [];

          for (let selector of cssRule.selectorText.split(',')) {
            if (selector.toLowerCase().startsWith(':host')) {
              selector = selector.replace(/^:host/i, `[${cssComponentHostIdAttrPrefix}-${internalConfig.componentId}]`);
            } else {
              selector = selector
                .split(' ')
                .map(part => `${part}[${cssComponentIdAttrPrefix}-${internalConfig.componentId}]`)
                .join(' ');
            }
            modifiedSelectors.push(selector);
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

const attributeConfigSymbol = Symbol('AttributeConfigs');
export interface AttributeConfig {
  name: string;
}
interface AttributeConfigInternal {
  attribute: string;
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
//#endregion

class ComponentElement extends HTMLElement {
  protected controller: object;

  private getComponentConfig(): ComponentConfigInternal {
    return this.controller.constructor.prototype[componentConfigSymbol];
  }

  private getAttributeConfigs(): AttributeConfigsInternal {
    return this.controller.constructor.prototype[attributeConfigSymbol];
  }

  private getEventConfigs(): EventConfigsInternal {
    return this.controller.constructor.prototype[eventConfigSymbol];
  }

  /**
   * Invoked each time one of the custom element's attributes is added, removed, or changed. Which attributes to notice change for is specified in a static get 
   */
  public attributeChangedCallback(name: string, oldValue: string, newValue: string): void {
    if (newValue !== oldValue) {
      const attrConfigs = this.getAttributeConfigs();
      if (attrConfigs.byAttribute[name]) {
        for (const config of attrConfigs.byAttribute[name]) {
          // TODO support functions?
          this.controller[config.propertyKey] = newValue;
        }
      }
    }
  }

  /**
   * Mark this element as changed
   */
  public onChange(): void {
    this.generateHtml();
  }

  /**
   * Invoked each time the custom element is appended into a document-connected element.
   * This will happen each time the node is moved, and may happen before the element's contents have been fully parsed. 
   */
  public connectedCallback(): void {
    this.setAttribute(`${cssComponentHostIdAttrPrefix}-${this.getComponentConfig().componentId}`, '');
    if (typeof this.controller['onInit'] === 'function') {
      this.controller['onInit']();
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
          this.controller[config.propertyKey](event);
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
        this.template = new Template(parsedHtml, this.controller);
        const node = await VirtualNodeRenderer.renderDom(this.template.render());
        this.append(node);
      }
    } else if (this.template !== null) {
      this.template.setContext(this.controller);
      const node = await VirtualNodeRenderer.renderDom(this.template.render());
    }
  }

}