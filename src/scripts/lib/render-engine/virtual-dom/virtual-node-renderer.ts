import { AttributeParser } from "../attribute-parser";
import { rerenderQueue } from "./render-queue";
import { StoredEventCallback, VirtualAttributeNode, VirtualChildNode, VirtualEventNode, VirtualNode, VirtualParentNode } from "./virtual-node";
import { VirtualTextNode } from "./virtual-text-node";

type DomAction = {

} & ({
  type: 'setAttribute';
  node: Element;
  attrName: string;
  value: string;
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
})

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
  
  public static clearState<T extends VirtualNode>(virtualNode: T): void {
    delete virtualNode[stateSymbol];
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
    const allDomActions: DomAction[] = [];
    
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
          
          // TODO new/deleted children
          
          if (deepUpdate && process.node.isParentNode()) {
            for (const child of process.node.childNodes) {
              pending.push({parent: process.node, node: child});
            }
          }

          allDomActions.push(...domActions);
        }
      }
    }
    if (allDomActions.length > 0) {
      VirtualNodeRenderer.queuedDomActions.push(...allDomActions);
      return rerenderQueue.add(VirtualNodeRenderer, VirtualNodeRenderer.processDomActions).then(() => {
        return VirtualNodeRenderer.getOrNewState(virtualNode).domNode;
      });
    }
    return Promise.resolve(VirtualNodeRenderer.getOrNewState(virtualNode).domNode);
  }

  private static queuedDomActions: DomAction[] = [];
  private static processDomActions = () => {
    const queuedDomActions = VirtualNodeRenderer.queuedDomActions;
    VirtualNodeRenderer.queuedDomActions = [];

    // Resolve sequential actions on the same property
    const actionMap = new Map<any, any>();
    let actionPathMap: Map<any, any>;
    let actionKey: any[];
    for (const action of queuedDomActions) {
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
        default: {
          actionKey = [action.node, action.type];
        }
      }

      actionPathMap = actionMap;
      for (let i = 0; i < actionKey.length - 1; i++) {
        actionPathMap.set(actionKey[i], new Map());
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
                item.node.setAttribute(item.attrName, item.value);
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