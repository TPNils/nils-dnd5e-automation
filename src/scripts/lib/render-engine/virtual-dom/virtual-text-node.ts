import { VirtualAttributeNode, VirtualChildNode, VirtualEventNode, VirtualNode, VirtualParentNode } from "./virtual-node";

export class VirtualTextNode extends VirtualChildNode() implements VirtualNode {

  public constructor(nodeValue?: string) {
    super();
    this.nodeValue = nodeValue;
  }

  get nodeName(): string {
    return '#text';
  }
  #nodeValue: string = '';
  public get nodeValue(): string {
    return this.#nodeValue;
  }
  public set nodeValue(value: string) {
    if (value == null) {
      this.#nodeValue = '';
    } else {
      this.#nodeValue = String(value);
    }
  }

  public cloneNode(deep?: boolean): this {
    const clone = new VirtualTextNode();
    clone.#nodeValue = this.#nodeValue;
    this.startChildClone(clone, deep);
    return clone as this;
  }

  public createDomNode(): Node {
    return document.createTextNode(this.nodeValue);
  }

  public updateDomNode(node: Text): void {
    if (node.nodeValue !== this.#nodeValue) {
      node.nodeValue = this.#nodeValue;
    }
  }

  public isNode(): this is VirtualNode {
    return true;
  }

  public isAttributeNode(): this is VirtualAttributeNode {
    return false;
  }

  public isEventNode(): this is VirtualEventNode {
    return false;
  }

  public isParentNode(): this is VirtualParentNode {
    return false;
  }

  
}