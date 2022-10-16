import { staticValues } from "../../static-values";
import { Stoppable } from "../utils/stoppable";
import { AttributeParser } from "./attribute-parser";
import { Template } from "./template/template";
import { rerenderQueue } from "./virtual-dom/render-queue";
import { VirtualAttributeNode, VirtualNode, VirtualParentNode } from "./virtual-dom/virtual-node";
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
  if (selector.length === 0) {
    return selector;
  }
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
      return [
        rule.substring(0, ruleIndex-1),
        adjustCssSelector(rule.substring(ruleIndex), componentId),
      ].join(' ');
    }
  } else if (selector.toLowerCase().startsWith(':host')) {
    let parts = [`[${cssComponentHostIdAttrPrefix}-${componentId}]`];
    if (selector[5] === ' ') {
      parts.push(' ');
    }
    parts.push(adjustCssSelector(selector.substring(5), componentId));
    return parts.join('');
  } else {
    // TODO this doesnt cover selectors like :is(span, div)
    return selector
      .split(' ')
      .map(part => `${part}[${cssComponentIdAttrPrefix}-${componentId}]`)
      .join(' ');
  }

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
  html?: string;
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
      ...config as ComponentConfig,
      componentId: String(nextComponentId++),
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
  /* default: false. Won't emit if the last emit was the same */
  deduplicate?: boolean;
}
interface OutputConfigInternal {
  eventName: string;
  bubbels: boolean;
  deduplicate: boolean;
}
export function Output(config?: string | OutputConfig) {
  return function (targetPrototype: any, propertyKey: string, descriptor?: PropertyDescriptor) {
    const configInternal: OutputConfigInternal = {
      eventName: propertyKey,
      bubbels: false,
      deduplicate: false,
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
      if (config.deduplicate != null) {
        configInternal.deduplicate = config.deduplicate;
      }
    }
    let lastEmitValue: any;
    const setFunction = function (this: {[htmlElementSymbol]: ComponentElement}, value: any): void {
      if (configInternal.deduplicate && lastEmitValue === value) {
        return;
      }
      lastEmitValue = value;

      if (this[htmlElementSymbol] == null) {
        // htmlElement is init after the constructor has finished
        return;
      }
      this[htmlElementSymbol].dispatchEvent(new CustomEvent(configInternal.eventName, {detail: value, cancelable: false, bubbles: configInternal.bubbels}));
    };
    if (descriptor) {
      if (descriptor.set) {
        const originalSet = descriptor.set;
        descriptor.set = function(this: {[htmlElementSymbol]: ComponentElement}, value: any) {
          originalSet.call(this, value);
          setFunction.call(this, value);
        };
      } else {
        descriptor.get = function (this: {[htmlElementSymbol]: ComponentElement}): void {
          return lastEmitValue;
        };
        descriptor.set = setFunction;
      }
    } else {
      Reflect.defineProperty(targetPrototype, propertyKey, {
        get: function (this: {[htmlElementSymbol]: ComponentElement}): void {
          return lastEmitValue;
        },
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
    if (newValue === false) {
      // disabled="false" is still disabled => don't set false attributes
      this.removeAttribute(name);
    } else {
      this.setAttribute(name, AttributeParser.serialize(newValue));
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
      this.generateHtmlQueue();
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

    if (this.getComponentConfig().hasHtmlSlots) {
      // Create an observer instance linked to the callback function
      const observer = new MutationObserver((mutationList) => {
        for (const mutation of mutationList) {
          switch (mutation.type) {
            case 'childList': {
              for (let i = 0; i < mutation.addedNodes.length; i++) {
                const node = mutation.addedNodes.item(i);
                if (node instanceof HTMLElement && node.hasAttribute('slot')) {
                  this.applySlots();
                  return;
                }
              }
              for (let i = 0; i < mutation.removedNodes.length; i++) {
                const node = mutation.removedNodes.item(i);
                if (node instanceof HTMLElement && node.hasAttribute('slot')) {
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
      observer.observe(this, { childList: true, subtree: true, attributeFilter: ['slot'] });

      // Later, you can stop observing
      this.unregisters.push({stop: () => observer.disconnect()})
    }

    this.generateHtmlQueue().then(() => {
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
  private templateRenderResult: VirtualNode & VirtualParentNode;
  private generateHtmlExec = async (): Promise<void> =>  {
    if (this.template === undefined) {
      const parsedHtml = this.getComponentConfig().parsedHtml;
      if (!parsedHtml) {
        this.template = null;
      } else {
        this.template = new Template(parsedHtml, this.#controller);
        this.templateRenderResult = await this.template.render();
        const node = await VirtualNodeRenderer.renderDom(this.templateRenderResult, true);
        this.findSlots();
        this.applySlots();
        this.prepend(node);
      }
    } else if (this.template !== null) {
      this.templateRenderResult = await this.template.render({force: true});
      await VirtualNodeRenderer.renderDom(this.templateRenderResult, true);
      this.findSlots();
      this.applySlots();
    }
  }

  private generateHtmlQueue(): Promise<void> {
    return rerenderQueue.add(this.generateHtmlExec, this.generateHtmlExec);
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
      replacementElementsBySlotName.set(slotName, Array.from(this.querySelectorAll(`:scope > [slot="${slotName}"]:not([${cssComponentIdAttrPrefix}-${componentId}])`)));
    }
    
    // Check if the target slots still match
    for (const slotName of this.slotsToReplacements.keys()) {
      const filteredElements: Element[] = [];
      for (const elem of this.slotsToReplacements.get(slotName).elements) {
        const slotAttr = elem.getAttribute('slot');
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

}