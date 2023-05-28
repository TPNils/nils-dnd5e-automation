import { CstElement, CstNode } from "chevrotain";

const sortMethod = (a: CstElement, b: CstElement) => (UtilsChevrotain.isNode(a) ? a.location.startOffset : a.startOffset) - (UtilsChevrotain.isNode(b) ? b.location.startOffset : b.startOffset);

export class UtilsChevrotain {

  public static isNode(node: CstElement): node is CstNode {
    return !!(node as any).name
  }
  
  public static getChildrenInCorrectOrder(node: CstNode): CstElement[] {
    const children: CstElement[] = [];
  
    for (const type in node.children) {
      for (const child of node.children[type]) {
        children.push(child);
      }
    }
  
    return children.sort(sortMethod);
  }

}