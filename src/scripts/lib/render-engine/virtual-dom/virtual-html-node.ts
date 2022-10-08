import { AttributeParser } from "../attribute-parser";
import { StoredEventCallback, VirtualChildNode, VirtualNode, VNode } from "./virtual-node";

export class VirtualHtmlNode extends VNode({attribute: true, child: true, event: true, parent: true}) implements VirtualNode {
  
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
  #appliedChildren: Array<VirtualChildNode & VirtualNode> = [];
  public domNode(): HTMLElement {
    if (this.#node == null) {
      this.#node = document.createElement(this.#nodeName);

      for (const attr of this.getAttributeNames()) {
        this.#node.setAttribute(attr, AttributeParser.serialize(this.getAttribute(attr)));
      }

      for (const listener of this.getEventListerners()) {
        this.#node.addEventListener(listener.type, listener.callback, listener.options);
      }
      
      const children: Node[] = [];
      for (const child of this.getRawChildren()) {
        if (child.isNode && child.isNode()) {
          this.#appliedChildren.push(child);
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

    // TODO check if updating children works
    // TODO do I even want this behavour? should only update itself... but how do I solve new children?
    //  => should be handled on a higher level? maybe the whole create/update node should be
    /*if (this.hasChildNodes()) {
      const childNodes = this.getRawChildren();
      const missingDomChildren: Array<{index: number, node: VirtualChildNode & VirtualNode}> = [];
      let i = 0;
      for (const childNode of childNodes) {
        if (childNode.isNode && childNode.isNode()) {
          // TODO element has been moved
          if (!this.#appliedChildren.includes(childNode)) {
            missingDomChildren.push({index: i, node: childNode})
          } else {
            childNode.executeUpdate();
          }
          i++;
        }
      }
      if (missingDomChildren.length > 0) {
        stateChanged = true;
      }

      for (const domChild of missingDomChildren) {
        if (domChild.index === 0) {
          this.#node.prepend(domChild.node.domNode());
        } else if (domChild.index >= this.#appliedChildren.length) {
          this.#node.append(domChild.node.domNode());
        } else {
          (this.#appliedChildren[domChild.index].domNode() as ChildNode).before(domChild.node.domNode())
        }
        this.#appliedChildren.splice(domChild.index, 0, domChild.node);
      }
    }*/

    if (stateChanged) {
      this.#appliedState = this.cloneNode(false);
    }
  }

  public isNode(): this is VirtualNode {
    return true;
  }

}