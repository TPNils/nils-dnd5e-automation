import { UtilsLog } from "../../../utils/utils-log";
import { VirtualChildNode, VirtualNode, VirtualParentNode } from "../virtual-dom/virtual-node";

const localContextSymbol = Symbol('localContext');
const forAttrRegex = /^\s*let\s+(?<letName>[^\s]+\s+of\s(?<expr>.+)$)/;
type PendingNodes<T extends VirtualNode = VirtualNode> = {
  template: T,
  instance: T,
  context: any, 
  parentInstance?: VirtualParentNode
}
export class Template {
  
  public constructor (
    private readonly template: VirtualNode & VirtualParentNode,
  ) {
  }

  #context: any;
  public setContext(context: any): void {
    this.#context = context;
  }

  private render(): VirtualNode[] {
    const rendered: VirtualNode[] = [];

    let pending: Array<PendingNodes> = [{template: this.template, instance: this.template.cloneNode(false), context: this.#context}];
    while (pending.length > 0) {
      const processing = pending;
      pending = [];
      for (let i = 0; i < processing.length; i++) {
        const process = processing[i];
        const instance = process.template.cloneNode(false);
        if (instance.isAttributeNode()) {
          if (instance.hasAttribute('*for')) {
            const regexResult = forAttrRegex.exec(instance.getAttribute('*for'));
            if (!regexResult) {
              UtilsLog.error(`Unable to parse *for expression:`, instance.getAttribute('*for'));
            } else {
              const resolvedExpr = this.parseExpression(regexResult.groups.expr, process.context);
              if (!resolvedExpr[Symbol.iterator]) {                
                UtilsLog.error(`The *for expression did not return an array/iterator:`, instance.getAttribute('*for'), resolvedExpr);
              } else {
                instance.removeAttribute('*for');
                let hasAnItem = false;
                for (const item of resolvedExpr) {
                  hasAnItem = true;
                  pending.push({
                    parentInstance: process.parentInstance,
                    template: process.template,
                    instance: instance.cloneNode(false),
                    context: {
                      ...process.context,
                      [resolvedExpr.groups.letName]: item,
                    }
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
          if (instance.hasAttribute('*if')) {
            const resolvedExpr = this.parseExpression(regexResult.groups.expr, process.context);
            if (!resolvedExpr[Symbol.iterator]) {                
              UtilsLog.error(`The *for expression did not return an array/iterator:`, instance.getAttribute('*for'), resolvedExpr);
            } else {
            }
          }
          for (const name of instance.getAttributeNames()) {
            if (name.length > 2 && name.startsWith('[') && name.endsWith(']')) {
              const value =  instance.getAttribute(name);
              instance.removeAttribute(name);
              if (typeof value === 'string') {
                instance.setAttribute(name.substring(1, name.length - 1), this.parseExpression(value, process.context));
              } else {
                instance.setAttribute(name.substring(1, name.length - 1), value);
              }
            }
          }
        }
        if (instance.isChildNode() && process.parentInstance) {
          process.parentInstance.appendChild(instance);
        } else {
          rendered.push(instance);
        }
        if (instance.isParentNode()) {
          for (const child of instance.childNodes) {
            pending.push({
              parentInstance: instance,
              context: process.context,
              template: child,
              instance: child.cloneNode(false),
            })
          }
        }
      }
    }

    return rendered;
  }

  private parseExpression(expression: string, context: any): any {
    // TODO
  }

}