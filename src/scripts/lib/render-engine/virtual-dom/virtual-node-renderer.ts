import { AttributeParser } from "../attribute-parser";
import { Component } from "../component";
import { rerenderQueue } from "./render-queue";
import { StoredEventCallback, VirtualAttributeNode, VirtualChildNode, VirtualEventNode, VirtualNode, VirtualParentNode } from "./virtual-node";
import { VirtualTextNode } from "./virtual-text-node";

type DomAction = {

} & ({
  type: 'setAttribute';
  node: Element;
  attrName: string;
  value: any;
} | {
  type: 'removeAttribute';
  node: Element;
  attrName: string;
} | {
  type: 'addEventListener';
  node: Node;
  listener: StoredEventCallback;
} | {
  type: 'removeEventListener';
  node: Node;
  listener: StoredEventCallback;
} | {
  type: 'nodeValue';
  node: Node;
  value: string;
} | {
  type: 'removeNode';
  node: Node;
} | {
  type: 'addNodeToEnd';
  node: Node;
  parent: Node;
} | {
  type: 'addNodeBefore';
  node: Node;
  parent: Node;
  addBefore: Node;
})

const stateSymbol = Symbol('domCache');
const rerenderIdSymbol = Symbol('rerenderId');
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
  public static async renderDom<T extends VirtualNode>(virtualNode: T, deepUpdate: boolean = false): Promise<ReturnType<T['createDom']>> {
    let pending: Array<{parent?: VirtualParentNode, node: VirtualNode}> = [{
      node: virtualNode,
    }];
    const allSyncDomActions: DomAction[] = [];
    const allAsyncDomActions: DomAction[] = [];
    
    while (pending.length > 0) {
      const processing = pending;
      pending = [];
      for (const process of processing) {
        const state = VirtualNodeRenderer.getOrNewState(process.node);
        if (state.lastRenderSelfState == null) {
          // First time render
          if (process.node.isAttributeNode()) {
            for (const attr of process.node.getAttributeNames()) {
              allSyncDomActions.push({
                type: 'setAttribute',
                node: (state.domNode as Element),
                attrName: attr,
                value: process.node.getAttribute(attr)
              });
            }
          }
    
          if (process.node.isEventNode()) {
            for (const listener of process.node.getEventListerners()) {
              allSyncDomActions.push({
                type: 'addEventListener',
                node: state.domNode,
                listener: listener,
              });
            }
          }
    
          if (process.node.isTextNode()) {
            allSyncDomActions.push({
              type: 'nodeValue',
              node: state.domNode,
              value: process.node.getText(),
            });
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
          const domActions: DomAction[] = [];
          if (process.node.isAttributeNode()) {
            for (const attr of process.node.getAttributeNames()) {
              const value = process.node.getAttribute(attr);
              if ((state.lastRenderSelfState as VirtualAttributeNode & VirtualNode).getAttribute(attr) !== value) {
                domActions.push({
                  type: 'setAttribute',
                  node: (state.domNode as Element),
                  attrName: attr,
                  value: value
                });
              }
            }
            
            for (const attr of (state.lastRenderSelfState as VirtualAttributeNode & VirtualNode).getAttributeNames()) {
              if (!process.node.hasAttribute(attr)) {
                domActions.push({
                  type: 'removeAttribute',
                  node: (state.domNode as Element),
                  attrName: attr,
                });
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
                domActions.push({
                  type: 'addEventListener',
                  node: state.domNode,
                  listener: listener,
                });
              }
            }

            for (const listener of oldListeners.values()) {
              domActions.push({
                type: 'removeEventListener',
                node: state.domNode,
                listener: listener,
              });
            }
          }
          
          if (process.node.isTextNode()) {
            if (process.node.getText() !== (state.lastRenderSelfState as VirtualTextNode & VirtualNode).getText()) {
              domActions.push({
                type: 'nodeValue',
                node: state.domNode,
                value: process.node.getText(),
              });
            }
          }

          if (domActions.length > 0) {
            state.lastRenderSelfState = process.node.cloneNode(false);
          }
          
          // add/delete children
          if (deepUpdate && process.node.isParentNode()) {
            const currentChildrenByNode = new Map<Node, VirtualNode>();
            for (const child of process.node.childNodes) {
              currentChildrenByNode.set(VirtualNodeRenderer.getOrNewState(child).domNode, child);
            }

            const previousChildNodes: Node[] = [];
            for (const child of state.lastRenderChildrenState) {
              const childDomNode = VirtualNodeRenderer.getOrNewState(child).domNode;
              previousChildNodes.push(childDomNode);
              if (!currentChildrenByNode.has(childDomNode)) {
                domActions.push({
                  type: 'removeNode',
                  node: childDomNode,
                })
              }
            }
            for (let i = process.node.childNodes.length - 1; i >= 0; i--) {
              const childDomNode = VirtualNodeRenderer.getOrNewState(process.node.childNodes[i]).domNode;
              if (!previousChildNodes.includes(childDomNode)) {
                if (i === process.node.childNodes.length - 1) {
                  domActions.push({
                    type: 'addNodeToEnd',
                    node: childDomNode,
                    parent: state.domNode
                  });
                } else {
                  domActions.push({
                    type: 'addNodeBefore',
                    node: childDomNode,
                    parent: state.domNode,
                    addBefore: VirtualNodeRenderer.getState(process.node.childNodes[i+1]).domNode,
                  });
                }
              }
            }
          }
          
          // add children to the process queue
          if (deepUpdate && process.node.isParentNode()) {
            for (const child of process.node.childNodes) {
              pending.push({parent: process.node, node: child});
            }
          }

          allAsyncDomActions.push(...domActions);
        }
      }
    }
    if (allSyncDomActions.length > 0) {
      VirtualNodeRenderer.processDomActions(allSyncDomActions);
    }
    if (allAsyncDomActions.length > 0) {
      VirtualNodeRenderer.queuedDomActions.push(...allAsyncDomActions);
      return rerenderQueue.add(VirtualNodeRenderer, VirtualNodeRenderer.processDomActionQueue).then(() => {
        return VirtualNodeRenderer.getOrNewState(virtualNode).domNode;
      });
    }
    return Promise.resolve(VirtualNodeRenderer.getOrNewState(virtualNode).domNode);
  }

  private static queuedDomActions: DomAction[] = [];
  private static processDomActionQueue = () => {
    const queuedDomActions = VirtualNodeRenderer.queuedDomActions;
    VirtualNodeRenderer.queuedDomActions = [];

    VirtualNodeRenderer.processDomActions(queuedDomActions);
  }
  
  private static processDomActions(domActions: DomAction[]) {
    // Resolve sequential actions on the same property
    const actionMap = new Map<any, any>();
    let actionPathMap: Map<any, any>;
    let actionKey: any[];
    for (const action of domActions) {
      // Actions are listed from earliest to latest added
      switch (action.type) {
        case 'addEventListener':
        case 'removeEventListener': {
          actionKey = [action.node, 'event', action.type, action.listener];
          break;
        }
        case 'setAttribute': 
        case 'removeAttribute': {
          actionKey = [action.node, 'attribute', action.attrName];
          break;
        }
        case 'addNodeBefore':
        case 'addNodeToEnd':
        case 'removeNode': {
          actionKey = [action.node, 'dml'];
        }
        default: {
          actionKey = [action.node, action.type];
        }
      }

      actionPathMap = actionMap;
      for (let i = 0; i < actionKey.length - 1; i++) {
        if (!actionPathMap.has(actionKey[i])) {
          actionPathMap.set(actionKey[i], new Map());
        }
        actionPathMap = actionPathMap.get(actionKey[i]);
      }
      actionPathMap.set(actionKey[actionKey.length - 1], action);
    }

    let pending: Array<Map<any, any>> = [actionMap];
    while (pending.length > 0) {
      const processing = pending;
      pending = [];
      for (const process of processing) {
        for (const item of process.values() as IterableIterator<Map<any, any> | DomAction>) {
          if (item instanceof Map) {
            pending.push(item);
          } else {
            switch (item.type) {
              case 'addEventListener': {
                item.node.addEventListener(item.listener.type, item.listener.callback, item.listener.options);
                break;
              }
              case 'removeEventListener': {
                item.node.removeEventListener(item.listener.type, item.listener.callback, item.listener.options);
                break;
              }
              case 'setAttribute': {
                if (Component.isComponentElement(item.node)) {
                  item.node.setInput(item.attrName, item.value);
                } else {
                  if (item.value === false) {
                    // disabled="false" is still disabled => don't set false attributes
                    item.node.removeAttribute(item.attrName);
                  } else {
                    item.node.setAttribute(item.attrName, AttributeParser.serialize(item.value));
                  }
                }
                break;
              }
              case 'removeAttribute': {
                item.node.removeAttribute(item.attrName);
                break;
              }
              case 'nodeValue': {
                item.node.nodeValue = item.value;
                break;
              }
              case 'removeNode': {
                if (item.node.parentNode) {
                  item.node.parentNode.removeChild(item.node)
                }
                break;
              }
              case 'addNodeBefore': {
                item.parent.insertBefore(item.node, item.addBefore);
                break;
              }
              case 'addNodeToEnd': {
                item.parent.appendChild(item.node);
                break;
              }
            }
          }
        }
      }
    }
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