import { AttributeParser } from "../attribute-parser";
import { StoredEventCallback, VirtualAttributeNode, VirtualChildNode, VirtualEventNode, VirtualNode, VirtualParentNode } from "./virtual-node";
import { VirtualTextNode } from "./virtual-text-node";

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
  
  /**
   * @param virtualNode The virtual node that needs to be converted to a DOM element
   * @param deepUpdate when false and the node already exists, only update the node itself, not it's children
   * @returns Created or updated DOM element
   */
  public static renderDom<T extends VirtualNode>(virtualNode: T, deepUpdate: boolean = false): ReturnType<T['createDom']> {
    let pending: Array<{parent?: VirtualParentNode, node: VirtualNode}> = [{
      node: virtualNode,
    }];
    while (pending.length > 0) {
      const processing = pending;
      pending = [];
      for (const process of processing) {
        const state = VirtualNodeRenderer.getOrNewState(process.node);
        if (state.lastRenderSelfState == null) {
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
          let stateChanged = false;
          if (process.node.isAttributeNode()) {
            for (const attr of process.node.getAttributeNames()) {
              const value = process.node.getAttribute(attr);
              if ((state.lastRenderSelfState as VirtualAttributeNode & VirtualNode).getAttribute(attr) !== value) {
                (state.domNode as Element).setAttribute(attr, value);
                stateChanged = true;
              }
            }
            
            for (const attr of (state.lastRenderSelfState as VirtualAttributeNode & VirtualNode).getAttributeNames()) {
              if (!process.node.hasAttribute(attr)) {
                (state.domNode as Element).removeAttribute(attr);
                stateChanged = true;
              }
            }
          }

          if (process.node.isEventNode()) {
            const oldListeners = new Map<number, StoredEventCallback>();
            for (const listener of (state.lastRenderSelfState as VirtualEventNode & VirtualNode).getEventListerners()) {
              oldListeners.set(listener.guid, listener);
            }
            
            for (const listener of process.node.getEventListerners()) {
              if (oldListeners.has(listener.guid)) {
                oldListeners.delete(listener.guid);
              } else {
                state.domNode.addEventListener(listener.type, listener.callback, listener.options);
                stateChanged = true;
              }
            }

            for (const listener of oldListeners.values()) {
              state.domNode.removeEventListener(listener.type, listener.callback, listener.options);
              stateChanged = true;
            }
          }
          
          if (process.node.isTextNode()) {
            if (process.node.getText() !== (state.lastRenderSelfState as VirtualTextNode & VirtualNode).getText()) {
              state.domNode.nodeValue = process.node.getText();
              stateChanged = true;
            }
          }

          if (stateChanged) {
            state.lastRenderSelfState = process.node.cloneNode(false);
          }
          
          // TODO new/deleted children
          
          if (deepUpdate && process.node.isParentNode()) {
            for (const child of process.node.childNodes) {
              pending.push({parent: process.node, node: child});
            }
          }
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