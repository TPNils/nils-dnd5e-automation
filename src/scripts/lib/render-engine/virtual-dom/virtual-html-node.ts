import { VirtualAttributeNode, VirtualChildNode, VirtualEventNode, VirtualNode, VirtualParentNode } from "./virtual-node";

export class VirtualHtmlNode extends VirtualChildNode(VirtualParentNode(VirtualEventNode(VirtualAttributeNode()))) implements VirtualNode {

  nodeName: string;
  public cloneNode(deep?: boolean): this {
    throw new Error("Method not implemented.");
  }
  public createDomNode(): Node {
    throw new Error("Method not implemented.");
  }
  public updateDomNode(node: Node): void {
    throw new Error("Method not implemented.");
  }
  public isNode(): this is VirtualNode {
    return true;
  }

}