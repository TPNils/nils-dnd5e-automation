import { AttributeParser } from "../attribute-parser";
import { VirtualChildNode, VirtualNode, VirtualParentNode } from "./virtual-node";

const stateSymbol = Symbol('domCache');
export interface RenderState<T extends VirtualNode = VirtualNode> {
  domNode: ReturnType<T['createDom']>;
  lastRenderSelfState?: T;
  lastRenderChildrenState: Array<VirtualChildNode & VirtualNode>;
}
export class VirtualNodeRenderer {
  
  public static getState<T extends VirtualNode>(virtualNode: T): RenderState<T> | undefined {
    return virtualNode[stateSymbol];
  }
  
  public static setState<T extends VirtualNode>(virtualNode: T, domNode: RenderState<T>): void {
    virtualNode[stateSymbol] = domNode;
  }
  
  public static renderDom<T extends VirtualNode>(virtualNode: T): ReturnType<T['createDom']> {
    let pending: Array<{parent?: VirtualParentNode, node: VirtualNode}> = [{
      node: virtualNode,
    }];
    while (pending.length > 0) {
      const processing = pending;
      pending = [];
      for (const process of processing) {
        const state = VirtualNodeRenderer.getOrNewState(process.node);
        // TODO if (state.lastRenderSelfState == null) {
        if (true) {
          // First time render
          if (process.node.isAttributeNode()) {
            for (const attr of process.node.getAttributeNames()) {
              (state.domNode as Element).setAttribute(attr, AttributeParser.serialize(process.node.getAttribute(attr)));
            }
          }
    
          if (process.node.isEventNode()) {
            for (const listener of process.node.getEventListerners()) {
              state.domNode.addEventListener(listener.type, listener.callback, listener.options);
            }
          }
    
          if (process.node.isTextNode()) {
            state.domNode.nodeValue = process.node.getText();
          }
          
          if (process.node.isParentNode()) {
            for (const child of process.node.childNodes) {
              state.lastRenderChildrenState.push(child);
              state.domNode.appendChild(VirtualNodeRenderer.getOrNewState(child).domNode);
              pending.push({parent: process.node, node: child});
            }
          }

          state.lastRenderSelfState = process.node.cloneNode(false);
        } else {
          // TODO Update
        }
      }
    }
    return VirtualNodeRenderer.getOrNewState(virtualNode).domNode;
  }

  private static getOrNewState<T extends VirtualNode>(virtualNode: T): RenderState<T> {
    let state = VirtualNodeRenderer.getState(virtualNode);
    if (!state) {
      state = {
        domNode: virtualNode.createDom() as ReturnType<T['createDom']>,
        lastRenderChildrenState: [],
      };
      VirtualNodeRenderer.setState(virtualNode, state);
    }


    return state;
  }

}