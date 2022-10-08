import { UtilsLog } from "../../../utils/utils-log";
import { VirtualNode, VirtualParentNode } from "../virtual-dom/virtual-node";

const forAttrRegex = /^\s*let\s+([^\s]+\s)+of\s(.+)$/;
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

  public render(): VirtualNode[] {
    const rendered: VirtualNode[] = [];

    let pending: Array<PendingNodes> = [{template: this.template, instance: this.template.cloneNode(false), context: this.#context}];
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
                UtilsLog.debug('*for after delete', process.instance.getAttribute('*for'))
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
        if (process.instance.isChildNode() && process.parentInstance) {
          process.parentInstance.appendChild(process.instance);
        } else {
          rendered.push(process.instance);
        }
        if (process.instance.isParentNode() && process.template.isParentNode()) {
          for (const child of process.template.childNodes) {
            pending.push({
              parentInstance: process.instance,
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

  private parseExpression(expression: any, context: any): any {
    if (typeof expression !== 'string') {
      // If expression is not a string, assume its the result
      return expression;
    }
    let func: Function;
    const paramValues: any[] = [];
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
    try {
      return func.apply(context, paramValues);
    } catch (e) {
      UtilsLog.error('Error executing expression with context', {expression: expression, context: context, func: func, paramValues: paramValues})
      throw e;
    }
  }

}