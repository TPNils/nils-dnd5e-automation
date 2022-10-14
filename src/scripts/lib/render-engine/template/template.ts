import { UtilsLog } from "../../../utils/utils-log";
import { UtilsCompare } from "../../utils/utils-compare";
import { VirtualFragmentNode } from "../virtual-dom/virtual-fragment-node";
import { VirtualNode, VirtualParentNode } from "../virtual-dom/virtual-node";
import { VirtualNodeRenderer } from "../virtual-dom/virtual-node-renderer";

const forAttrRegex = /^\s*let\s+([^\s]+\s)+of\s(.+)$/;
type PendingNodes<T extends VirtualNode = VirtualNode> = {
  template: T;
  instance: T;
  localVars: any;
  parentInstance?: VirtualParentNode;
  pathContext: {
    parentPrefix: string;
    siblings: {[nodeName: string]: number}
  };
}
type ParsedExpression = (...args: any[]) => any;
interface ParsedEventExpression {
  readonly localVars: any | null;
  readonly exec: (event: Event) => any
};
export class Template {
  
  public constructor (
    private readonly template: VirtualNode & VirtualParentNode,
    context?: any
  ) {
    if (context != null) {
      this.setContext(context);
    }
  }

  #context: any;
  /**
   * @param context The new context to render the template
   * @returns A promise when the change has been applied returning itself
   */
  public setContext(context: any): void {
    this.#context = context;
    if (this.#processedVirtualNode != null) {
      this.calcVirtualNode();
    }
  }

  public render(options: {force?: boolean} = {}): VirtualNode & VirtualParentNode {
    if (this.#processedVirtualNode == null) {
      if (this.#context) {
        this.calcVirtualNode();
      } else {
        this.#processedVirtualNode = new VirtualFragmentNode();
      }
    } else if (options.force) {
      this.calcVirtualNode();
    }
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
      localVars: {},
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
              const resolvedExpr = this.parseExpression(regexResult[2], process.localVars);
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
                    localVars: {
                      ...process.localVars,
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
                }
                // Don't add this instance since it has been 'split' into multiple to be processed
                break;
              }
            }
          }
          if (process.instance.hasAttribute('*if')) {
            const resolvedExpr = this.parseExpression(process.instance.getAttribute('*if'), process.localVars);
            if (!resolvedExpr) {
              continue; // Don't render
            } else {
              process.instance.removeAttribute('*if');
            }
          }
          if (process.instance.isEventNode()) {
            for (const name of process.instance.getAttributeNames()) {
              if (name.length > 2 && name.startsWith('(') && name.endsWith(')')) {
                const value = process.instance.getAttribute(name);
                process.instance.addEventListener(name.substring(1, name.length - 1), this.parseEvent(value, process.localVars));
                process.instance.removeAttribute(name);
              }
            }
          }
          for (const name of process.instance.getAttributeNames()) {
            const value = process.instance.getAttribute(name);
            if (name.length > 2 && name.startsWith('[') && name.endsWith(']')) {
              process.instance.removeAttribute(name);
              if (typeof value === 'string') {
                process.instance.setAttribute(name.substring(1, name.length - 1), this.parseExpression(value, process.localVars));
              } else {
                process.instance.setAttribute(name.substring(1, name.length - 1), value);
              }
            } else if (typeof value === 'string') {
              const processedValue = this.processBindableString(value, process.localVars);
              if (value !== processedValue) {
                process.instance.setAttribute(name, processedValue);
              }
            }
          }
        }
        if (process.instance.isTextNode()) {
          let nodeValue = this.processBindableString(process.instance.getText(), process.localVars);
          if (nodeValue !== process.instance.getText()) {
            process.instance.setText(nodeValue);
          }
        }
        const createDom = process.instance.nodeName !== 'VIRTUAL'; // TODO Don't create <virtual> dom nodes like angular <ng-container>. this may need to be tweaked
        if (process.instance.isChildNode() && process.parentInstance && createDom) {
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
              parentInstance: createDom ? process.instance : process.parentInstance,
              localVars: process.localVars,
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

  private processBindableString(value: string, localVars: any | null): string {
    // TODO this is currently a dumb implementation and does not account for the 'keywords' {{ and }} to be present within the expression (example: in a javascript string)
    // Best to write an interpreter but thats a lot of work and maybe more process intensive so lets cross that bridge when we get there :)
    let startExpression = 0;
    let endExpression: number;
    while ((startExpression = value.indexOf('{{', startExpression)) !== -1) {
      startExpression = value.indexOf('{{');
      if (value[startExpression-1] === '\\') {
        // escaped, please continue
        continue;
      }

      endExpression = startExpression;
      do {
        endExpression = value.indexOf('}}', endExpression);
        if (value[endExpression-1] === '\\') {
          // escaped, please continue
          endExpression += 2;
        } else {
          break;
        }
      } while (endExpression !== -1)
      
      let originalLength = value.length;
      value = [
        value.substring(0, startExpression),
        String(this.parseExpression(value.substring(startExpression+2, endExpression), localVars)),
        value.substring(endExpression+2),
      ].join('');

      startExpression = endExpression + 2 - /*offset str length*/originalLength + value.length;
    }
    return value;
  }

  private parsedExpressions = new Map<string, ParsedExpression>();
  private parseExpression(expression: any, localVars: any | null): any {
    if (typeof expression !== 'string') {
      // If expression is not a string, assume its the result
      return expression;
    }
    const paramNames: string[] = [];
    const paramValues: any[] = [];
    try {
      if (localVars) {
        for (const field in localVars) {
          let index = paramNames.indexOf(field);
          if (index === -1) {
            paramNames.push(field);
            paramValues.push(localVars[field]);
          } else {
            paramValues[index] = localVars[field];
          }
        }
      }
      const funcKey = `${expression}(${paramNames.join(',')})`;
      if (!this.parsedExpressions.has(funcKey)) {
        this.parsedExpressions.set(funcKey, Function(...paramNames, `return ${expression}`) as ParsedExpression);
      }
      return this.parsedExpressions.get(funcKey).apply(this.#context, paramValues);
    } catch (e) {
      UtilsLog.error('Error executing expression with context', {expression: expression, thisContext: this.#context, localVars: localVars, err: e})
      throw e;
    }
  }

  // Use the same cached function so the change detection knows no new event listeners are made
  private parsedEventExpressions = new Map<string, Array<ParsedEventExpression>>();
  private parseEvent(expression: any, localVars: object | null): (event: Event) => any {
    if (typeof expression !== 'string') {
      // If expression is not a string, assume its the result
      return expression;
    }
    try {
      if (!this.parsedEventExpressions.has(expression)) {
        this.parsedEventExpressions.set(expression, []);
      }
      let alreadyParsedExpression: ParsedEventExpression;
      for (const parsed of this.parsedEventExpressions.get(expression)) {
        if (UtilsCompare.deepEquals(parsed.localVars, localVars)) {
          alreadyParsedExpression = parsed;
          break;
        }
      }
      if (!alreadyParsedExpression) {
        const paramNames: string[] = ['$event'];
        const paramValues: any[] = [null];
        
        if (localVars) {
          for (const field in localVars) {
            let index = paramNames.indexOf(field);
            if (index === -1) {
              paramNames.push(field);
              paramValues.push(localVars[field]);
            } else {
              paramValues[index] = localVars[field];
            }
          }
        }
        paramValues.splice(0, 1); // remove $event

        const exprFunc = Function(...paramNames, `return ${expression}`).bind(this.#context);

        alreadyParsedExpression = {
          localVars: localVars == null ? {} : deepClone(localVars),
          exec: (event: Event) => {
            return exprFunc(event, ...paramValues);
          }
        }
      }
      return alreadyParsedExpression.exec;
    } catch (e) {
      UtilsLog.error('Error parsing expression with context', {expression: expression, thisContext: this.#context, localVars: localVars, err: e})
      throw e;
    }
  }

}