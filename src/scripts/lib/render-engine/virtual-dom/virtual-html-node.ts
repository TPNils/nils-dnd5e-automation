import { StoredEventCallback, VirtualAttributeNode, VirtualChildNode, VirtualEventNode, VirtualNode, VirtualParentNode } from "./virtual-node";

export class VirtualHtmlNode extends VirtualChildNode(VirtualParentNode(VirtualEventNode(VirtualAttributeNode()))) implements VirtualNode {
  
  public constructor(nodeName: string) {
    super();
    this.#nodeName = nodeName.toUpperCase();
  }

  #nodeName: string;
  get nodeName(): string {
    return this.#nodeName;
  }

  public cloneNode(deep?: boolean): this {
    const clone = new VirtualHtmlNode(this.#nodeName);
    clone.startAttributeClone(this, deep);
    clone.startChildClone(this, deep);
    clone.startEventClone(this, deep);
    clone.startParentClone(this, deep);
    return clone as this;
  }

  #node: HTMLElement;
  #appliedState: this;
  public domNode(): HTMLElement {
    if (this.#node == null) {
      this.#node = document.createElement(this.#nodeName);

      for (const attr of this.getAttributeNames()) {
        this.#node.setAttribute(attr, this.getAttribute(attr));
      }

      for (const listener of this.getEventListerners()) {
        this.#node.addEventListener(listener.type, listener.callback, listener.options);
      }
      
      const children: Node[] = [];
      for (const child of this.getRawChildren()) {
        if (child.isNode && child.isNode()) {
          children.push(child.domNode());
        }
      }
      this.#node.append(...children);
      this.#appliedState = this.cloneNode(false);
    }
    return this.#node;
  }

  public executeUpdate(): void {
    let stateChanged = false;
    for (const attr of this.getAttributeNames()) {
      const value = this.getAttribute(attr);
      if (this.#appliedState.getAttribute(attr) !== value) {
        this.#node.setAttribute(attr, value);
        stateChanged = true;
      }
    }
    
    for (const attr of this.#appliedState.getAttributeNames()) {
      if (!this.hasAttribute(attr)) {
        this.#node.removeAttribute(attr);
        stateChanged = true;
      }
    }

    const oldListeners = new Map<number, StoredEventCallback>();
    for (const listener of this.#appliedState.getEventListerners()) {
      oldListeners.set(listener.guid, listener);
    }
    
    for (const listener of this.getEventListerners()) {
      if (oldListeners.has(listener.guid)) {
        oldListeners.delete(listener.guid);
      } else {
        this.#node.addEventListener(listener.type, listener.callback, listener.options);
        stateChanged = true;
      }
    }

    for (const listener of oldListeners.values()) {
      this.#node.removeEventListener(listener.type, listener.callback, listener.options);
      stateChanged = true;
    }

    // TODO children

    if (stateChanged) {
      this.#appliedState = this.cloneNode(false);
    }
  }

  public isNode(): this is VirtualNode {
    return true;
  }

}