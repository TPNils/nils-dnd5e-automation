import { VirtualAttributeNode, VirtualEventNode, VirtualNode, VirtualParentNode, VNode } from "./virtual-node";

export class VirtualTextNode extends VNode({child: true}) implements VirtualNode {

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
    clone.startChildClone(this, deep);
    return clone as this;
  }

  #node: Text;
  #appliedState: this;
  public domNode(): Node {
    if (this.#node == null) {
      this.#node = document.createTextNode(this.nodeValue);
      this.#appliedState = this.cloneNode(false);
    }
    return this.#node;
  }

  public executeUpdate(): void {
    if (this.#appliedState.nodeValue !== this.#nodeValue) {
      this.#node.nodeValue = this.#nodeValue;
      this.#appliedState = this.cloneNode(false);
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

  public toString(): string {
    return this.nodeValue;
  }
  
}