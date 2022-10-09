import { VirtualAttributeNode, VirtualEventNode, VirtualNode, VirtualParentNode, VNode } from "./virtual-node";

export class VirtualCommmentNode extends VNode({child: true, text: true}) implements VirtualNode {

  public constructor(nodeValue?: string) {
    super();
    this.setText(nodeValue);
  }

  get nodeName(): string {
    return '#comment';
  }

  public cloneNode(deep?: boolean): this {
    const clone = new VirtualCommmentNode();
    clone.startTextClone(this, deep);
    clone.startChildClone(this, deep);
    return clone as this;
  }

  #node: Comment;
  #appliedState: this;
  public domNode(): Node {
    if (this.#node == null) {
      this.#node = new Comment(this.getText());
      this.#appliedState = this.cloneNode(false);
    }
    return this.#node;
  }

  public executeUpdate(): void {
    if (this.#appliedState.getText() !== this.getText()) {
      this.#node.nodeValue = this.getText();
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
    return `<!--${this.getText()}-->`
  }
  
}