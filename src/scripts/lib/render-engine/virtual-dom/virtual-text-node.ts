import { VirtualAttributeNode, VirtualEventNode, VirtualNode, VirtualParentNode, VNode } from "./virtual-node";

export class VirtualTextNode extends VNode({child: true, text: true}) implements VirtualNode {

  public constructor(nodeValue?: string) {
    super();
    this.setText(nodeValue);
  }

  get nodeName(): string {
    return '#text';
  }

  public cloneNode(deep?: boolean): this {
    const clone = new VirtualTextNode();
    clone.startTextClone(this, deep);
    clone.startChildClone(this, deep);
    return clone as this;
  }

  public createDom(): Node {
    return document.createTextNode('');
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
    return this.getText();
  }
  
}