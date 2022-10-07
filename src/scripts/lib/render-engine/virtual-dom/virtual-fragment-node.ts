import { VirtualAttributeNode, VirtualChildNode, VirtualEventNode, VirtualNode, VirtualParentNode } from "./virtual-node";

export class VirtualFragmentNode extends VirtualParentNode() implements VirtualNode {

  public constructor() {
    super();
  }

  get nodeName(): string {
    return '#document-fragment';
  }

  public cloneNode(deep?: boolean): this {
    const clone = new VirtualFragmentNode();
    clone.startParentClone(this, deep);
    return clone as this;
  }

  public domNode(): Node {
    throw new Error("Method not implemented.");
  }

  public executeUpdate(): void {
    throw new Error("Method not implemented.");
  }

  public isNode(): this is VirtualNode {
    throw true;
  }

  public isAttributeNode(): this is VirtualAttributeNode {
    return false;
  }

  public isChildNode(): this is VirtualChildNode {
    return false;
  }
  
  public isEventNode(): this is VirtualEventNode {
    return false;
  }
  
}