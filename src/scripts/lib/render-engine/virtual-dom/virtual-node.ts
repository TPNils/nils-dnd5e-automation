import { UtilsLog } from "../../../utils/utils-log";
import { applySecurity, revokeSecurity, SecureOptions } from "../secure";

class PlaceholderClass {}
type Constructor<I = PlaceholderClass> = new (...args: any[]) => I;

interface VirtualBaseNode {

  isNode?(): this is VirtualNode;
  isAttributeNode?(): this is VirtualAttributeNode;
  isChildNode?(): this is VirtualChildNode;
  isEventNode?(): this is VirtualEventNode;
  isParentNode?(): this is VirtualParentNode;
  isTextNode?(): this is VirtualTextNode;
  
}

export interface VirtualNode extends VirtualBaseNode {

  readonly nodeName: string;
  cloneNode(deep?: boolean): this;
  domNode(): Node; // TODO be like document.createX(...params) => where we only have a createDom() method and the rest is handled outside
  executeUpdate(): void;

  isNode(): this is VirtualNode;
  isAttributeNode(): this is VirtualAttributeNode;
  isChildNode(): this is VirtualChildNode;
  isEventNode(): this is VirtualEventNode;
  isParentNode(): this is VirtualParentNode;
  isTextNode(): this is VirtualTextNode;
  
}

//#region attribute
function VirtualAttributeNode<T extends Constructor>(clazz: T = PlaceholderClass as any) {
  return class extends clazz implements VirtualAttributeNode {
    readonly #attributes = new Map<string, any>();

    public getAttributeNames(): IterableIterator<string> {
      return this.#attributes.keys();
    }

    public hasAttribute(qualifiedName: string): boolean {
      return this.#attributes.has(qualifiedName?.toLowerCase());
    }

    public getAttribute(qualifiedName: string): any {
      return this.#attributes.get(qualifiedName?.toLowerCase());
    }
    
    public setAttribute(qualifiedName: string, value: any): void {
      if (qualifiedName == null || qualifiedName === '')  {
        throw new Error(`qualifiedName needs to have a value. Found: "${qualifiedName}"`)
      }
      this.#attributes.set(qualifiedName?.toLowerCase(), value == null ? '' : value);
    }

    public removeAttribute(qualifiedName: string): void {
      this.#attributes.delete(qualifiedName?.toLowerCase());
    }

    public isAttributeNode(): this is VirtualAttributeNode {
      return true;
    }
    
    protected startAttributeClone(original: VirtualAttributeNode, deep?: boolean) {
      for (const attrName of original.getAttributeNames()) {
        this.#attributes.set(attrName, original.getAttribute(attrName));
      }
    }
    
  }
}
export interface VirtualAttributeNode extends VirtualBaseNode {
  getAttributeNames(): IterableIterator<string>;
  hasAttribute(qualifiedName: string): boolean;
  getAttribute(qualifiedName: string): any | null;
  setAttribute(qualifiedName: string, value: any | null): void;
  removeAttribute(qualifiedName: string): void;
  isAttributeNode(): this is VirtualAttributeNode;
}
//#endregion

//#region child
const setParentOnChild = Symbol('setParent');
function VirtualChildNode<T extends Constructor>(clazz: T = PlaceholderClass as any) {
  return class extends clazz implements VirtualChildNode {
    #parentNode: VirtualParentNode;
    get parentNode(): VirtualParentNode {
      return this.#parentNode;
    }
    [setParentOnChild](node: VirtualParentNode): void {
      this.#parentNode = node;
    }

    public previousSibling(): VirtualChildNode {
      if (!this.parentNode) {
        return undefined;
      }
      return this.parentNode.childNodes[this.parentNode.childNodes.indexOf(this as any) - 1];
    }

    public nextSibling(): VirtualChildNode {
      if (!this.parentNode) {
        return undefined;
      }
      return this.parentNode.childNodes[this.parentNode.childNodes.indexOf(this as any) + 1];
    }

    public getRootNode(): VirtualBaseNode {
      let node: VirtualBaseNode = this;
      while (node.isChildNode && node.isChildNode() && node.parentNode) {
        node = node.parentNode;
      }

      return node;
    }

    public after(...nodes: Array<VirtualChildNode & VirtualNode>): void {
      this.parentNode.insertAfter(this, ...nodes);
    }

    public before(...nodes: Array<VirtualChildNode & VirtualNode>): void {
      this.parentNode.insertBefore(this, ...nodes);
    }

    public remove(): void {
      this.parentNode.removeChild(this);
    }

    public replaceWith(...nodes: Array<VirtualChildNode & VirtualNode>): void {
      this.parentNode.replaceChild(this, ...nodes);
    }

    public isChildNode(): this is VirtualChildNode {
      return true;
    }

    protected startChildClone(original: VirtualChildNode, deep?: boolean) {
      // Do nothing
    }
  }
}
export interface VirtualChildNode extends VirtualBaseNode {
  readonly parentNode: VirtualParentNode;
  [setParentOnChild](node: VirtualParentNode): void;
  previousSibling(): VirtualChildNode;
  nextSibling(): VirtualChildNode;
  /**
   * Get the highest parent node
   */
  getRootNode(): VirtualBaseNode;
  /**
   * Inserts nodes just after node, while replacing strings in nodes with equivalent Text nodes.
   */
  after(...nodes: VirtualChildNode[]): void;
  /**
   * Inserts nodes just before node, while replacing strings in nodes with equivalent Text nodes.
   */
  before(...nodes: VirtualChildNode[]): void;
  /** 
   * Removes node.
   */
  remove(): void;
  /**
   * Replaces node with nodes, while replacing strings in nodes with equivalent Text nodes.
   */
  replaceWith(...nodes: VirtualChildNode[]): void;
  
  isChildNode(): this is VirtualChildNode;
}
//#endregion

//#region event
const eventCallbackId = Symbol('eventCallbackId');
let nextEventCallbackId = 0;
export interface StoredEventCallback {
  readonly type: string;
  readonly callback: EventListenerOrEventListenerObject;
  readonly guid: number;
  readonly options?: boolean | AddEventListenerOptions;
}
function VirtualEventNode<T extends Constructor>(clazz: T = PlaceholderClass as any) {
  return class extends clazz implements VirtualEventNode {
    #callbackMap = new Map<number, StoredEventCallback>();

    public getEventListerners(): Iterable<StoredEventCallback> {
      return this.#callbackMap.values();
    }

    public addEventListener(type: string, callback: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void {
      if (callback[eventCallbackId] == null) {
        callback[eventCallbackId] = nextEventCallbackId++;
      }
      this.#callbackMap.set(callback[eventCallbackId], {type: type, callback: callback, options: options, guid: callback[eventCallbackId]});
    }

    public removeEventListener(type: string, callback: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void {
      this.#callbackMap.delete(callback[eventCallbackId]);
    }

    public isEventNode(): this is VirtualEventNode {
      return true;
    }

    protected startEventClone(original: VirtualEventNode, deep?: boolean) {
      for (const listener of original.getEventListerners()) {
        this.#callbackMap.set(listener.callback[eventCallbackId], listener);
      }
    }
  }
}
export interface VirtualEventNode extends VirtualBaseNode {
  getEventListerners(): Iterable<StoredEventCallback>;
  addEventListener(type: string, callback: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, callback: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
  isEventNode(): this is VirtualEventNode;
}
//#endregion

//#region parent
function VirtualParentNode<T extends Constructor>(clazz: T = PlaceholderClass as any) {
  return class extends clazz implements VirtualParentNode {
    #childNodesSecurity: SecureOptions = {write: false, throw: false};
    #childNodes: Array<VirtualChildNode & VirtualNode> = applySecurity([], this.#childNodesSecurity);
    get childNodes(): ReadonlyArray<VirtualChildNode & VirtualNode> {
      return this.#childNodes;
    }

    public firstChild(): VirtualChildNode & VirtualNode {
      return this.#childNodes[0];
    }

    public lastChild(): VirtualChildNode & VirtualNode {
      return this.#childNodes[this.#childNodes.length - 1];
    }

    public hasChildNodes(): boolean {
      return this.#childNodes.length > 0;
    }
    
    public appendChild(...nodes: Array<(VirtualChildNode & VirtualNode)>): void {
      this.insertIndex('appendChild', this.#childNodes.length, nodes);
    }
    
    public prependChild(...nodes: Array<(VirtualChildNode & VirtualNode)>): void {
      this.insertIndex('prependChild', 0, nodes);
    }
    
    public insertBefore(child: VirtualChildNode & VirtualNode, ...nodes: Array<VirtualChildNode & VirtualNode>): void {
      const index = this.#childNodes.indexOf(child);
      if (index === -1) {
        throw new Error(`Failed to execute 'insertBefore' on 'Node': The reference child is not a child of this node.`);
      }
      this.insertIndex('insertBefore', index, nodes);
    }
    
    public insertAfter(child: VirtualChildNode & VirtualNode, ...nodes: Array<VirtualChildNode & VirtualNode>): void {
      const index = this.#childNodes.indexOf(child);
      if (index === -1) {
        throw new Error(`Failed to execute 'insertAfter' on 'Node': The reference child is not a child of this node.`);
      }
      this.insertIndex('insertAfter', index + 1, nodes);
    }
    
    private insertIndex(method: string, index: number, nodes: Array<VirtualChildNode & VirtualNode>): void {
      for (const node of nodes) {
        if (node.parentNode != null) {
          throw new Error(`Failed to execute '${method}' on 'Node': The new child element contains the parent.`);
        }
      }

      this.#childNodesSecurity.write = true;
      this.#childNodes.splice(index, 0, ...nodes);
      this.#childNodesSecurity.write = false;
      for (const node of nodes) {
        node[setParentOnChild](this);
      }
    }
    
    public removeChild<T extends VirtualChildNode>(child: T): T {
      const index = this.#childNodes.indexOf(child as any);
      if (index === -1) {
        throw new Error(`Failed to execute 'removeChild' on 'Node': The reference child is not a child of this node.`);
      }

      child[setParentOnChild](null);
      this.#childNodesSecurity.write = true;
      this.#childNodes.splice(index, 1)
      this.#childNodesSecurity.write = false;
      return child;
    }
    
    public removeAllChildren(): Array<VirtualChildNode & VirtualNode> {
      const children = this.#childNodes;
      revokeSecurity(children, this.#childNodesSecurity);
      this.#childNodes = applySecurity([], this.#childNodesSecurity);
      for (const child of children) {
        child[setParentOnChild](null);
      }
      return children;
    }
    
    public replaceChild<T extends VirtualChildNode>(child: T, ...nodes: Array<VirtualChildNode & VirtualNode>): T {
      const index = this.#childNodes.indexOf(child as any);
      if (index === -1) {
        throw new Error(`Failed to execute 'replaceChild' on 'Node': The reference child is not a child of this node.`);
      }

      child[setParentOnChild](null);
      this.#childNodesSecurity.write = true;
      this.#childNodes.splice(index, 1, ...nodes)
      this.#childNodesSecurity.write = false;
      return child;
    }
    
    public contains(other: VirtualNode): boolean {
      let node: VirtualBaseNode = other;
      while (node.isChildNode && node.isChildNode() && node.parentNode) {
        node = node.parentNode;
        if (node === this) {
          return true;
        }
      }

      return false;
    }

    public isParentNode(): this is VirtualParentNode {
      return true;
    }
    
    protected startParentClone(original: VirtualParentNode, deep?: boolean) {
      if (!deep) {
        return;
      }
      const clones: Array<VirtualChildNode & VirtualNode> = [];
      for (const child of original.childNodes) {
        clones.push(child.cloneNode(true));
      }
      this.appendChild(...clones);
    }
  }
}
export interface VirtualParentNode extends VirtualBaseNode {
  readonly childNodes: ReadonlyArray<VirtualChildNode & VirtualNode>;
  firstChild(): VirtualChildNode & VirtualNode;
  lastChild(): VirtualChildNode & VirtualNode;
  hasChildNodes(): boolean;
  /**
   * Inserts nodes or texts after the last child of this node
   */
  appendChild(...nodes: Array<VirtualChildNode>): void;
  /**
   * Inserts nodes or texts before the child in this node
   * 
   * Throws a "Error" DOMException if the constraints of the node tree are violated.
   */
  insertBefore(child: VirtualChildNode, ...nodes: Array<VirtualChildNode & VirtualNode>): void;
  /**
   * Inserts nodes or texts after the child in this node
   * 
   * Throws a "Error" DOMException if the constraints of the node tree are violated.
   */
  insertAfter(child: VirtualChildNode, ...nodes: Array<VirtualChildNode & VirtualNode>): void;
  /**
   * Inserts nodes or texts before the first child of this node
   */
  prependChild(...nodes: Array<VirtualChildNode>): void;
  /**
   * Remove a direct child of this node
   */
  removeChild<T extends VirtualChildNode>(child: T): T;
  /**
   * Remove all direct children of this node
   * @returns it's direct children
   */
  removeAllChildren(): Array<VirtualChildNode & VirtualNode>
  /**
   * Replace a direct child of this node with another
   */
  replaceChild<T extends VirtualChildNode>(child: T, ...nodes: Array<(VirtualChildNode & VirtualNode) | string>): T;
  /**
   * Return true if this node or any of it's children contain the requested node
   */
  contains(other: VirtualNode): boolean;
  
  isParentNode(): this is VirtualParentNode;
}
//#endregion

//#region text
function VirtualTextNode<T extends Constructor>(clazz: T = PlaceholderClass as any) {
  return class extends clazz implements VirtualTextNode {

    #text = '';
    public getText(): string {
      return this.#text;
    }

    public setText(text: string): void {
      if (text == null) {
        this.#text = '';
      } else {
        this.#text = String(text);
      }
    }

    public isTextNode(): this is VirtualTextNode {
      return true;
    }

    protected startTextClone(original: VirtualTextNode, deep?: boolean) {
      this.#text = original.getText();
    }
    
  }
}
export interface VirtualTextNode extends VirtualBaseNode {
  getText(): string;
  setText(text: string): void;
}
//#endregion


export interface NodeParams {
  attribute?: boolean;
  child?: boolean;
  event?: boolean;
  parent?: boolean;
  text?: boolean;
}
export function VNode(params: {attribute: true}): ReturnType<typeof VirtualAttributeNode>
export function VNode(params: {child: true}): ReturnType<typeof VirtualChildNode>
export function VNode(params: {event: true}): ReturnType<typeof VirtualEventNode>
export function VNode(params: {parent: true}): ReturnType<typeof VirtualParentNode>
export function VNode(params: {attribute: true, child: true}): ReturnType<typeof VirtualAttributeNode> & ReturnType<typeof VirtualChildNode>
export function VNode(params: {attribute: true, event: true}): ReturnType<typeof VirtualAttributeNode> & ReturnType<typeof VirtualEventNode>
export function VNode(params: {attribute: true, parent: true}): ReturnType<typeof VirtualAttributeNode> & ReturnType<typeof VirtualParentNode>
export function VNode(params: {attribute: true, text: true}): ReturnType<typeof VirtualAttributeNode> & ReturnType<typeof VirtualTextNode>
export function VNode(params: {child: true, event: true}): ReturnType<typeof VirtualChildNode> & ReturnType<typeof VirtualEventNode>
export function VNode(params: {child: true, parent: true}): ReturnType<typeof VirtualChildNode> & ReturnType<typeof VirtualParentNode>
export function VNode(params: {child: true, text: true}): ReturnType<typeof VirtualChildNode> & ReturnType<typeof VirtualTextNode>
export function VNode(params: {event: true, parent: true}): ReturnType<typeof VirtualEventNode> & ReturnType<typeof VirtualParentNode>
export function VNode(params: {event: true, text: true}): ReturnType<typeof VirtualEventNode> & ReturnType<typeof VirtualTextNode>
export function VNode(params: {attribute: true, child: true, event: true}): ReturnType<typeof VirtualAttributeNode> & ReturnType<typeof VirtualChildNode> & ReturnType<typeof VirtualEventNode>
export function VNode(params: {attribute: true, child: true, parent: true}): ReturnType<typeof VirtualAttributeNode> & ReturnType<typeof VirtualChildNode> & ReturnType<typeof VirtualParentNode>
export function VNode(params: {attribute: true, child: true, text: true}): ReturnType<typeof VirtualAttributeNode> & ReturnType<typeof VirtualChildNode> & ReturnType<typeof VirtualTextNode>
export function VNode(params: {attribute: true, event: true, parent: true}): ReturnType<typeof VirtualAttributeNode> & ReturnType<typeof VirtualEventNode> & ReturnType<typeof VirtualParentNode>
export function VNode(params: {attribute: true, event: true, text: true}): ReturnType<typeof VirtualAttributeNode> & ReturnType<typeof VirtualEventNode> & ReturnType<typeof VirtualTextNode>
export function VNode(params: {attribute: true, parent: true, text: true}): ReturnType<typeof VirtualAttributeNode> & ReturnType<typeof VirtualParentNode> & ReturnType<typeof VirtualTextNode>
export function VNode(params: {child: true, event: true, parent: true}): ReturnType<typeof VirtualChildNode> & ReturnType<typeof VirtualEventNode> & ReturnType<typeof VirtualParentNode>
export function VNode(params: {child: true, event: true, text: true}): ReturnType<typeof VirtualChildNode> & ReturnType<typeof VirtualEventNode> & ReturnType<typeof VirtualTextNode>
export function VNode(params: {child: true, parent: true, text: true}): ReturnType<typeof VirtualChildNode> & ReturnType<typeof VirtualParentNode> & ReturnType<typeof VirtualTextNode>
export function VNode(params: {attribute: true, child: true, event: true, parent: true}): ReturnType<typeof VirtualAttributeNode> & ReturnType<typeof VirtualChildNode> & ReturnType<typeof VirtualEventNode> & ReturnType<typeof VirtualParentNode>
export function VNode(params: {attribute: true, child: true, event: true, text: true}): ReturnType<typeof VirtualAttributeNode> & ReturnType<typeof VirtualChildNode> & ReturnType<typeof VirtualEventNode> & ReturnType<typeof VirtualTextNode>
export function VNode(params: {attribute: true, child: true, parent: true, text: true}): ReturnType<typeof VirtualAttributeNode> & ReturnType<typeof VirtualChildNode> & ReturnType<typeof VirtualParentNode> & ReturnType<typeof VirtualTextNode>
export function VNode(params: {attribute: true, event: true, parent: true, text: true}): ReturnType<typeof VirtualAttributeNode> & ReturnType<typeof VirtualEventNode> & ReturnType<typeof VirtualParentNode> & ReturnType<typeof VirtualTextNode>
export function VNode(params?: NodeParams): Constructor
export function VNode(params: NodeParams = {}): Constructor {
  let builderClass = PlaceholderClass;
  if (params.child) {
    builderClass = VirtualChildNode(builderClass);
  }
  if (params.event) {
    builderClass = VirtualEventNode(builderClass);
  }
  if (params.parent) {
    builderClass = VirtualParentNode(builderClass);
  }
  if (params.attribute) {
    builderClass = VirtualAttributeNode(builderClass);
  }
  if (params.text) {
    builderClass = VirtualTextNode(builderClass);
  }
  return builderClass;
}

class SimpleCombinationIterator<T> implements Iterator<Array<T>> {
  private readonly originalVector: T[];
  private readonly combinationLength: number;
  private readonly bitVector: number[];
  private endIndex = 0;

  public constructor(originalVector: T[], combinationLength: number) {
    this.originalVector = originalVector;
    this.combinationLength = combinationLength;
    this.bitVector = new Array(combinationLength + 1);

    for(let i = 0; i <= this.combinationLength; this.bitVector[i] = i++) {
    }

    if (originalVector.length > 0) {
      this.endIndex = 1;
    }
  }

  public hasNext(): boolean {
    return this.endIndex != 0 && this.combinationLength <= this.originalVector.length;
  }

  public next(): IteratorResult<T[]> {
    let currentCombination: T[] = [];

    for(let i = 1; i <= this.combinationLength; ++i) {
      let index = this.bitVector[i] - 1;
      if (this.originalVector.length > 0) {
        currentCombination.push(this.originalVector[index]);
      }
    }

    this.endIndex = this.combinationLength;

    while(this.bitVector[this.endIndex] == this.originalVector.length - this.combinationLength + this.endIndex) {
      --this.endIndex;
      if (this.endIndex == 0) {
        break;
      }
    }

    this.bitVector[this.endIndex] = this.bitVector[this.endIndex]+1;

    for(let i = this.endIndex + 1; i <= this.combinationLength; ++i) {
      this.bitVector[i] = this.bitVector[i - 1] + 1;
    }

    UtilsLog.debug('currentCombination', this.hasNext(), currentCombination)
    return {
      done: !this.hasNext(),
      value: currentCombination
    };
  }
}

function generateVNodeContract() {
  const vnodeContract = [
    {attrName: 'attribute', returnType: 'VirtualAttributeNode'},
    {attrName: 'child', returnType: 'VirtualChildNode'},
    {attrName: 'event', returnType: 'VirtualEventNode'},
    {attrName: 'parent', returnType: 'VirtualParentNode'},
    {attrName: 'text', returnType: 'VirtualTextNode'},
  ];


  const lines: string[] = [];
  for (let i = 1; i <= vnodeContract.length; i++) {
    const iterator = new SimpleCombinationIterator(vnodeContract, i);
    for (let results of {[Symbol.iterator]: () => iterator}) {
      // export function VNode(params: {attribute: true, child: true}): ReturnType<typeof VirtualAttributeNode> & ReturnType<typeof VirtualChildNode>
      results.sort((a, b) => a.attrName.localeCompare(b.attrName));
      const lineParts = ['export function VNode(params: {'];
      for (const result of results) {
        lineParts.push(result.attrName, ': true', ', ');
      }
      lineParts.splice(lineParts.length - 1, 1);
      lineParts.push('}): ')
      for (const result of results) {
        lineParts.push('ReturnType<typeof ', result.returnType, '>', ' & ');
      }
      lineParts.splice(lineParts.length - 1, 1);
      lines.push(lineParts.join(''));
    }
    
  }

  lines.push(`export function VNode(params?: NodeParams): Constructor`);
  lines.push(`export function VNode(params: NodeParams = {}): Constructor {`);

  UtilsLog.info('generateVNodeContract\n', lines.join('\n'))
}

// generateVNodeContract();

