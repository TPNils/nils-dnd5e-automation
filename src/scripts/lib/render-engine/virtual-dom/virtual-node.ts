import { VirtualTextNode } from "./virtual-text-node";

class PlaceholderClass {}
type Constructor<I = PlaceholderClass> = new (...args: any[]) => I;

interface VirtualBaseNode {

  isNode?(): this is VirtualNode;
  isChildNode?(): this is VirtualChildNode;
  isEventNode?(): this is VirtualEventNode;
  isParentNode?(): this is VirtualParentNode;
  
}

export interface VirtualNode extends VirtualBaseNode {

  readonly nodeName: string;
  cloneNode(deep?: boolean): this;
  createDomNode(): Node;
  updateDomNode(node: Node): void;

  isNode(): this is VirtualNode;
  isChildNode(): this is VirtualChildNode;
  isEventNode(): this is VirtualEventNode;
  isParentNode(): this is VirtualParentNode;
  
}

const setParentOnChild = Symbol('setParent');
export function VirtualChildNode<T extends Constructor>(clazz: T = PlaceholderClass as any) {
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
      return this.parentNode[getRawChildren]()[this.parentNode[getRawChildren]().indexOf(this as any) - 1];
    }

    public nextSibling(): VirtualChildNode {
      if (!this.parentNode) {
        return undefined;
      }
      return this.parentNode[getRawChildren]()[this.parentNode[getRawChildren]().indexOf(this as any) + 1];
    }

    public getRootNode(): VirtualBaseNode {
      let node: VirtualBaseNode = this;
      while (node.isChildNode && node.isChildNode() && node.parentNode) {
        node = node.parentNode;
      }

      return node;
    }

    public after(...nodes: Array<VirtualChildNode | string>): void {
      this.parentNode.insertAfter(this, ...nodes);
    }

    public before(...nodes: Array<VirtualChildNode | string>): void {
      this.parentNode.insertBefore(this, ...nodes);
    }

    public remove(): void {
      this.parentNode.removeChild(this);
    }

    public replaceWith(...nodes: Array<VirtualChildNode | string>): void {
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
  after(...nodes: (VirtualChildNode | string)[]): void;
  /**
   * Inserts nodes just before node, while replacing strings in nodes with equivalent Text nodes.
   */
  before(...nodes: (VirtualChildNode | string)[]): void;
  /** 
   * Removes node.
   */
  remove(): void;
  /**
   * Replaces node with nodes, while replacing strings in nodes with equivalent Text nodes.
   */
  replaceWith(...nodes: (VirtualChildNode | string)[]): void;
  
  isChildNode(): this is VirtualChildNode;
}

const eventCallbackId = Symbol('eventCallbackId');
let nextEventCallbackId = 0;
interface StoredEventCallback {
  readonly type: string;
  readonly callback: EventListenerOrEventListenerObject;
  readonly options?: boolean | AddEventListenerOptions;
}
export function VirtualEventNode<T extends Constructor>(clazz: T = PlaceholderClass as any) {
  return class extends clazz implements VirtualEventNode {
    #callbackMap = new Map<number, StoredEventCallback>();

    public getEventListerners(): Iterable<StoredEventCallback> {
      return this.#callbackMap.values();
    }
    public addEventListener(type: string, callback: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void {
      callback[eventCallbackId] = nextEventCallbackId++;
      this.#callbackMap.set(callback[eventCallbackId], {type: type, callback: callback, options: options});
    }
    public removeEventListener(type: string, callback: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void {
      this.#callbackMap.delete(callback[eventCallbackId]);
    }
    public isEventNode(): this is VirtualEventNode {
      return true;
    }
  }
}

export interface VirtualEventNode extends VirtualBaseNode {
  getEventListerners(): Iterable<StoredEventCallback>;
  addEventListener(type: string, callback: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, callback: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
  isEventNode(): this is VirtualEventNode;
}

export function VirtualParentNode<T extends Constructor>(clazz: T = PlaceholderClass as any) {
  return class extends clazz implements VirtualParentNode {
    #childNodes: Array<VirtualChildNode>;
    get childNodes(): ReadonlyArray<VirtualChildNode> {
      return [...this.#childNodes];
    }
    
    [getRawChildren](): ReadonlyArray<VirtualChildNode> {
      return this.#childNodes;
    }

    public firstChild(): VirtualChildNode {
      return this.#childNodes[0];
    }

    public lastChild(): VirtualChildNode {
      return this.#childNodes[this.#childNodes.length - 1];
    }

    public hasChildNodes(): boolean {
      return this.#childNodes.length > 0;
    }
    
    public appendChild(...nodes: Array<VirtualChildNode | string>): void {
      this.insertIndex('appendChild', this.#childNodes.length, this.toVirtualNodes(nodes));
    }
    
    public prependChild(...nodes: Array<VirtualChildNode | string>): void {
      this.insertIndex('prependChild', 0, this.toVirtualNodes(nodes));
    }
    
    public insertBefore(child: VirtualChildNode, ...nodes: Array<VirtualChildNode | string>): void {
      const index = this.#childNodes.indexOf(child);
      if (index === -1) {
        throw new Error(`Failed to execute 'insertBefore' on 'Node': The reference child is not a child of this node.`);
      }
      this.insertIndex('insertBefore', index, this.toVirtualNodes(nodes));
    }
    
    public insertAfter(child: VirtualChildNode, ...nodes: Array<VirtualChildNode | string>): void {
      const index = this.#childNodes.indexOf(child);
      if (index === -1) {
        throw new Error(`Failed to execute 'insertAfter' on 'Node': The reference child is not a child of this node.`);
      }
      this.insertIndex('insertAfter', index + 1, this.toVirtualNodes(nodes));
    }
    
    private insertIndex(method: string, index: number, nodes: Array<VirtualChildNode>): void {
      for (const node of nodes) {
        if (node.parentNode != null) {
          throw new Error(`Failed to execute '${method}' on 'Node': The new child element contains the parent.`);
        }
      }

      this.#childNodes.splice(index, 0, ...nodes);
      for (const node of nodes) {
        node[setParentOnChild](this);
      }
    }
    
    public removeChild<T extends VirtualChildNode>(child: T): T {
      const index = this.#childNodes.indexOf(child);
      if (index === -1) {
        throw new Error(`Failed to execute 'removeChild' on 'Node': The reference child is not a child of this node.`);
      }

      return this.#childNodes.splice(index, 1)[0] as T;
    }
    
    public replaceChild<T extends VirtualChildNode>(child: T, ...nodes: Array<VirtualChildNode | string>): T {
      const index = this.#childNodes.indexOf(child);
      if (index === -1) {
        throw new Error(`Failed to execute 'replaceChild' on 'Node': The reference child is not a child of this node.`);
      }

      return this.#childNodes.splice(index, 1, ...this.toVirtualNodes(nodes))[0] as T;
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

    private toVirtualNodes<T extends VirtualBaseNode>(nodes: (T | string)[]): Array<T | VirtualTextNode> {
      const virtualNodes: Array<T | VirtualTextNode> = [];
      for (const node of nodes) {
        if (typeof node === 'string') {
          virtualNodes.push(new VirtualTextNode(node))
        } else {
          virtualNodes.push(node);
        }
      }
      return virtualNodes;
    }
  }
}

const getRawChildren = Symbol('getRawChildren');
export interface VirtualParentNode extends VirtualBaseNode {
  readonly childNodes: ReadonlyArray<VirtualChildNode>;
  [getRawChildren](): ReadonlyArray<VirtualChildNode>;
  firstChild(): VirtualChildNode;
  lastChild(): VirtualChildNode;
  hasChildNodes(): boolean;
  /**
   * Inserts nodes or texts after the last child of this node
   */
  appendChild(...nodes: Array<VirtualChildNode | string>): void;
  /**
   * Inserts nodes or texts before the child in this node
   * 
   * Throws a "Error" DOMException if the constraints of the node tree are violated.
   */
  insertBefore(child: VirtualChildNode, ...nodes: Array<VirtualChildNode | string>): void;
  /**
   * Inserts nodes or texts after the child in this node
   * 
   * Throws a "Error" DOMException if the constraints of the node tree are violated.
   */
  insertAfter(child: VirtualChildNode, ...nodes: Array<VirtualChildNode | string>): void;
  /**
   * Inserts nodes or texts before the first child of this node
   */
  prependChild(...nodes: Array<VirtualChildNode | string>): void;
  /**
   * Remove a direct child of this node
   */
  removeChild<T extends VirtualChildNode>(child: T): T;
  /**
   * Replace a direct child of this node with another
   */
  replaceChild<T extends VirtualChildNode>(child: T, ...nodes: Array<VirtualChildNode | string>): T;
  /**
   * Return true if this node or any of it's children contain the requested node
   */
  contains(other: VirtualNode): boolean;
  
  isParentNode(): this is VirtualParentNode;
}