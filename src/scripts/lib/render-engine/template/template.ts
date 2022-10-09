import { UtilsLog } from "../../../utils/utils-log";
import { VirtualNode, VirtualParentNode } from "../virtual-dom/virtual-node";
import { VirtualNodeRenderer } from "../virtual-dom/virtual-node-renderer";

const forAttrRegex = /^\s*let\s+([^\s]+\s)+of\s(.+)$/;
type PendingNodes<T extends VirtualNode = VirtualNode> = {
  template: T;
  instance: T;
  context: any;
  parentInstance?: VirtualParentNode;
  pathContext: {
    parentPrefix: string;
    siblings: {[nodeName: string]: number}
  };
}
export class Template {
  
  public constructor (
    private readonly template: VirtualNode & VirtualParentNode,
    context: any
  ) {
    this.setContext(context);
  }

  #context: any;
  /**
   * @param context The new context to render the template
   * @returns A promise when the change has been applied returning itself
   */
  public setContext(context: any): void {
    this.#context = context;
    this.calcVirtualNode();
  }

  public render(): VirtualNode & VirtualParentNode {
    return this.#processedVirtualNode;
  }

  #processedVirtualNode: VirtualNode & VirtualParentNode;
  #processedVirtualNodesMap = new Map<string, VirtualNode>();
  private calcVirtualNode(): void {
    const rootInstance: VirtualNode & VirtualParentNode = this.template.cloneNode(false);
    const createdNodesByMap = new Map<string, VirtualNode>();

    let pending: Array<PendingNodes> = [{
      template: this.template,
      instance: rootInstance,
      context: this.#context,
      pathContext: {
        parentPrefix: '',
        siblings: {}
      }
    }];
    while (pending.length > 0) {
      const processing = pending;
      pending = [];
      for (let i = 0; i < processing.length; i++) {
        const process = processing[i];
        if (process.instance.isAttributeNode()) {
          if (process.instance.hasAttribute('*for')) {
            const regexResult = forAttrRegex.exec(process.instance.getAttribute('*for'));
            if (!regexResult) {
              UtilsLog.error(`Unable to parse *for expression:`, process.instance.getAttribute('*for'));
            } else {
              const resolvedExpr = this.parseExpression(regexResult[2], process.context);
              if (!resolvedExpr[Symbol.iterator]) {                
                UtilsLog.error(`The *for expression did not return an array/iterator:`, process.instance.getAttribute('*for'), resolvedExpr);
              } else {
                process.instance.removeAttribute('*for');
                let hasAnItem = false;
                for (const item of resolvedExpr) {
                  hasAnItem = true;
                  pending.push({
                    parentInstance: process.parentInstance,
                    template: process.template,
                    instance: process.instance.cloneNode(false),
                    context: {
                      ...process.context,
                      [regexResult[1]]: item,
                    },
                    pathContext: process.pathContext,
                  });
                }

                if (hasAnItem) {
                  // The newly added items need to be processed before the rest of the queue
                  for (let j = i+1; j < processing.length; j++) {
                    pending.push(processing[j]);
                  }
                  // Don't add this instance since it has been 'split' into multiple to be processed
                  break;
                }
              }
            }
          }
          if (process.instance.hasAttribute('*if')) {
            const resolvedExpr = this.parseExpression(process.instance.getAttribute('*if'), process.context);
            if (!resolvedExpr) {
              continue; // Don't render
            } else {
              process.instance.removeAttribute('*if');
            }
          }
          for (const name of process.instance.getAttributeNames()) {
            if (name.length > 2 && name.startsWith('[') && name.endsWith(']')) {
              const value =  process.instance.getAttribute(name);
              process.instance.removeAttribute(name);
              if (typeof value === 'string') {
                process.instance.setAttribute(name.substring(1, name.length - 1), this.parseExpression(value, process.context));
              } else {
                process.instance.setAttribute(name.substring(1, name.length - 1), value);
              }
            }
          }
        }
        if (process.instance.isTextNode()) {
          // TODO this is currently a dumb implementation and does not account for the 'keywords' {{ and }} to be present within the expression (example: in a javascript string)
          // Best to write an interpreter but thats a lot of work and maybe more process intensive so lets cross that bridge when we get there :)
          let nodeValue = process.instance.getText();
          let startExpression = 0;
          let endExpression: number;
          while ((startExpression = nodeValue.indexOf('{{', startExpression)) !== -1) {
            startExpression = nodeValue.indexOf('{{');
            if (nodeValue[startExpression-1] === '\\') {
              // escaped, please continue
              continue;
            }

            endExpression = startExpression;
            do {
              endExpression = nodeValue.indexOf('}}', endExpression);
              if (nodeValue[endExpression-1] === '\\') {
                // escaped, please continue
                endExpression += 2;
              } else {
                break;
              }
            } while (endExpression !== -1)
            
            let originalLength = nodeValue.length;
            nodeValue = [
              nodeValue.substring(0, startExpression),
              String(this.parseExpression(nodeValue.substring(startExpression+2, endExpression), process.context)),
              nodeValue.substring(endExpression+2),
            ].join('');

            startExpression = endExpression + 2 - /*offset str length*/originalLength + nodeValue.length;
          }

          if (nodeValue !== process.instance.getText()) {
            process.instance.setText(nodeValue);
          }
        }
        if (process.instance.isChildNode() && process.parentInstance) {
          process.parentInstance.appendChild(process.instance);
        }
        
        let siblingIndex = 0;
        if (process.pathContext.siblings[process.instance.nodeName]) {
          siblingIndex = process.pathContext.siblings[process.instance.nodeName];
        }
        process.pathContext.siblings[process.instance.nodeName] = siblingIndex + 1;
        const path = process.pathContext.parentPrefix + process.instance.nodeName + siblingIndex;
        if (process.instance.isParentNode() && process.template.isParentNode()) {
          const pathContext = {
            parentPrefix: path + '.',
            siblings: {}
          };
          for (const child of process.template.childNodes) {
            pending.push({
              parentInstance: process.instance,
              context: process.context,
              template: child,
              instance: child.cloneNode(false),
              pathContext: pathContext, // Same path context intsnace needs to be shared by all children/siblings
            })
          }
        }
        // Move the previous rendered state to the new node
        if (this.#processedVirtualNodesMap.has(path)) {
          const original = this.#processedVirtualNodesMap.get(path);
          const originalState = VirtualNodeRenderer.getState(original);
          if (originalState) {
            VirtualNodeRenderer.setState(process.instance, originalState);
            VirtualNodeRenderer.clearState(original);
          }
        }
        createdNodesByMap.set(path, process.instance);
      }
    }

    // Remove items which don't exist anymore
    for (const [path, instance] of this.#processedVirtualNodesMap.entries()) {
      if (!createdNodesByMap.has(path) && instance.isChildNode()) {
        instance.remove();
      }
    }

    this.#processedVirtualNode = rootInstance;
    this.#processedVirtualNodesMap = createdNodesByMap;
  }

  private parseExpression(expression: any, context: any): any {
    if (typeof expression !== 'string') {
      // If expression is not a string, assume its the result
      return expression;
    }
    let func: Function;
    const paramValues: any[] = [];
    try {
      if (context) {
        const paramNames: string[] = [];
        for (const field in context) {
          paramNames.push(field);
          paramValues.push(context[field]);
        }
        func = Function(...paramNames, `return ${expression}`);
      } else {
        func = Function(`return ${expression}`);
      }
      return func.apply(context, paramValues);
    } catch (e) {
      UtilsLog.error('Error executing expression with context', {expression: expression, context: context, func: func})
      throw e;
    }
  }

}