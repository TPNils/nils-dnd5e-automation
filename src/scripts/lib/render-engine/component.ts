import { staticValues } from "../../static-values";
import { UtilsLog } from "../../utils/utils-log";
import { Stoppable } from "../utils/stoppable";
import { AttributeParser } from "./attribute-parser";

//#region Decorators
let nextComponentId = 0;
const componentConfigSymbol = Symbol('ComponentConfig');
const htmlElementSymbol = Symbol('HtmlElement');
const cssComponentHostIdAttrPrefix = `${staticValues.code}-host`;
const cssComponentIdAttrPrefix = `${staticValues.code}-cid`;
const fieldTemplateBindRegex = /{{((?:this\.)?[a-zA-Z_$]+.*?)}}/gm;

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
  fieldsInHtml: string[];
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
      fieldsInHtml: [],
    }
    internalConfig.tag = internalConfig.tag.toLowerCase();

    if (internalConfig.html) {
      let regexMatch: RegExpExecArray;
      const fieldsInHtml = new Set<string>();
      while (regexMatch = fieldTemplateBindRegex.exec(internalConfig.html)) {
        fieldsInHtml.add(regexMatch[1].replace(/^this\./, ''));
      }
      fieldTemplateBindRegex.lastIndex = 0;

      internalConfig.fieldsInHtml = Array.from(fieldsInHtml);
    }

    const dummyController = new constructor();
    // TODO find fields used in *if and *for
    for (const field of internalConfig.fieldsInHtml) {
      if (!(field in dummyController)) {
        UtilsLog.warn(`Field '${field}' expected in element ${internalConfig.tag} but was not found.`);
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

const templateContextSymbol = Symbol('TemplateContext');
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
    if (!this.connected) {
      return; // TODO is this correct? probably not
    }
    // TODO this should be added to a queue to rerender
    const html = this.generateHtml();
    this.innerHTML = ``;
    this.appendChild(html);
  }

  /**
   * Invoked each time the custom element is appended into a document-connected element.
   * This will happen each time the node is moved, and may happen before the element's contents have been fully parsed. 
   */
  private connected = false;
  public connectedCallback(): void {
    this.connected = true;
    this.setAttribute(`${cssComponentHostIdAttrPrefix}-${this.getComponentConfig().componentId}`, '');
    if (typeof this.controller['onInit'] === 'function') {
      this.controller['onInit']();
    }
    this.innerHTML = ``;
    this.replaceChildren(this.generateHtml());
    this.registerEventListeners();
  }

  /**
   * Invoked each time the custom element is disconnected from the document's DOM.
   */
  public disconnectedCallback(): void {
    this.connected = false;
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

  private generateHtml(): DocumentFragment {
    const fragment = document.createDocumentFragment();
    if (this.getComponentConfig().html == null) {
      return fragment;
    }
    // TODO precompile
    const container = document.createElement('div');
    container.innerHTML = this.getComponentConfig().html;
    let pendingNodes: Node[] = Array.from(container.children);
    const attrName = `${cssComponentIdAttrPrefix}-${this.getComponentConfig().componentId}`;
    let regexMatch: RegExpExecArray;
    while (pendingNodes.length > 0) {
      const nodes = pendingNodes;
      pendingNodes = [];
      for (const node of nodes) {
        UtilsLog.log('context', node, node[templateContextSymbol])
        if (node instanceof Element) {
          if (node instanceof Element && node.hasAttribute('*for')) {
            const forRgx = /^ *let +(.*?) +of +(.*)$/.exec(node.getAttribute('*for'));
            if (forRgx) {
              try {
                const loopable = this.evalTemplate(forRgx[2], node);
                if (loopable[Symbol.iterator] != null) {
                  const forFragment = document.createDocumentFragment();
                  for (const loopItem of Array.from(loopable)) {
                    const clone = node.cloneNode(true) as Element;
                    clone.removeAttribute('*for');
                    let context = this.getContext(node);
                    if (context == null) {
                      clone[templateContextSymbol] = {
                        [forRgx[1]]: loopItem,
                      }
                    } else {
                      clone[templateContextSymbol] = {
                        ...context,
                        [forRgx[1]]: loopItem,
                      }
                    }
                    forFragment.appendChild(clone);
                    pendingNodes.push(clone);
                    UtilsLog.log('clone', clone)
                  }
                  node.parentNode.replaceChild(forFragment, node);
                  continue;
                }
              } catch (e) {
                UtilsLog.error(e)
                continue;
              }
            }
          }
          if (node instanceof Element && node.hasAttribute('*if')) {
            try {
              const result = this.evalTemplate(node.getAttribute('*if'), node);
              if (!AttributeParser.parseBoolean(result)) {
                node.parentNode.removeChild(node);
                continue;
              }
            } catch (e) {
              UtilsLog.error(e)
              continue;
            }
          }
          for (const attr of Array.from(node.attributes)) {
            while (regexMatch = fieldTemplateBindRegex.exec(attr.nodeValue)) {
              try {
                const result = this.evalTemplate(regexMatch[1], node);
                attr.nodeValue = attr.nodeValue.replace(regexMatch[0], result == null ? '' : String(result));
              } catch (e) {
                UtilsLog.error('failed to parse expression', regexMatch[1], e)
                continue;
              }
            }
            fieldTemplateBindRegex.lastIndex = 0;
            if (attr.name.startsWith('(') && attr.name.endsWith(')')) {
              const callback = Function('$event', '$element', `return ${attr.nodeValue}`);
              node.addEventListener(attr.name.substring(1, attr.name.length - 1), event => callback.call(this.controller, event, node));
            }
          }
          node.setAttribute(attrName, '');
        }
        
        while (regexMatch = fieldTemplateBindRegex.exec(node.nodeValue)) {
          try {
            const result = this.evalTemplate(regexMatch[1], node);
            UtilsLog.debug(regexMatch[1], result)
            node.nodeValue = node.nodeValue.replace(regexMatch[0], result == null ? '' : String(result));
          } catch (e) {
            UtilsLog.error('failed to parse expression', regexMatch[1], e)
            continue;
          }
        }
        fieldTemplateBindRegex.lastIndex = 0;
        for (let i = 0; i < node.childNodes.length; i++) {
          pendingNodes.push(node.childNodes[i]);
        }
      }
    }
    UtilsLog.debug(container.innerHTML)
    fragment.append(...Array.from(container.children));
    return fragment;
  }

  private evalTemplate(js: string, contextHolder: Node): any {
    let context = this.getContext(contextHolder);
    if (context) {
      const paramNames: string[] = [];
      const paramValues: any[] = [];
      for (const field in context) {
        paramNames.push(field);
        paramValues.push(context[field]);
      }
      return Function(...paramNames, `return ${js}`).call(this.controller, ...paramValues)
    } else {
      return Function(`return ${js}`).call(this.controller)
    }
  }

  private getContext(contextHolder: Node): {[key: string]: any} {
    let context = contextHolder?.[templateContextSymbol];
    while (!context && contextHolder !== null) {
      context = contextHolder[templateContextSymbol];
      contextHolder = contextHolder.parentNode;
    }
    return context;
  }

}