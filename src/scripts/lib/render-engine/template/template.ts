import { UtilsLog } from "../../../utils/utils-log";
import { UtilsCompare } from "../../utils/utils-compare";
import { rerenderQueue } from "../virtual-dom/render-queue";
import { VirtualFragmentNode } from "../virtual-dom/virtual-fragment-node";
import { isVirtualNode, VirtualNode, VirtualParentNode } from "../virtual-dom/virtual-node";
import { VirtualNodeParser } from "../virtual-dom/virtual-node-parser";
import { VirtualNodeRenderer } from "../virtual-dom/virtual-node-renderer";

const domParser = new DOMParser();
const forAttrRegex = /^\s*let\s+([^\s]+\s)+(of|in)\s(.+)$/;
type PendingNodes<T extends VirtualNode = VirtualNode> = {
  template: T;
  instance: T;
  localVars: any;
  parentInstance?: VirtualParentNode;
  pathContext: {
    parentPrefix: string;
  };
}
type ParsedExpression = (...args: any[]) => any;
interface ParsedEventExpression {
  readonly localVars: any | null;
  readonly exec: (event: Event) => any
};
const nodeIdSymbol = Symbol('nodeId');
export class Template {
  
  private readonly template: VirtualNode & VirtualParentNode;
  public constructor (
    template: VirtualNode & VirtualParentNode,
    context?: any
  ) {
    this.template = template.cloneNode(true);
    const nextIdByParent = new Map<VirtualParentNode, number>();
    let pending: Array<VirtualNode> = [this.template];
    while (pending.length > 0) {
      const processing = pending;
      pending = [];
      for (const process of processing) {
        let parent: VirtualParentNode = process.isChildNode() ? process.parentNode : null;
        if (!nextIdByParent.has(parent)) {
          nextIdByParent.set(parent, 0);
        }
        let nextNodeId = nextIdByParent.get(parent);
        process[nodeIdSymbol] = String(nextNodeId);
        nextIdByParent.set(parent, nextNodeId+1);
        if (process.isParentNode()) {
          pending.push(...process.childNodes);
        }
      }
    }

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
      this.render({force: true});
    }
  }

  public async render(options: {force?: boolean} = {}): Promise<VirtualNode & VirtualParentNode> {
    if (this.#processedVirtualNode == null) {
      if (this.#context) {
        await rerenderQueue.add(this.rerenderCallback);
      } else {
        this.#processedVirtualNode = new VirtualFragmentNode();
      }
    } else if (options.force) {
      await rerenderQueue.add(this.rerenderCallback);
    }
    return this.#processedVirtualNode;
  }

  public rerenderCallback = () => {
    this.calcVirtualNode();
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
              const resolvedExpr = this.parseExpression(regexResult[3], process.localVars);
              let forIndex = 0;
              let items: any[];
              if (regexResult[2].toLowerCase() === 'in') {
                if (typeof resolvedExpr === 'object') {
                  items = Object.keys(resolvedExpr);
                } else {
                  UtilsLog.error(`The *for (in) expression did not return an object:`, process.instance.getAttribute('*for'), resolvedExpr);
                }
              } else {
                if (!resolvedExpr[Symbol.iterator]) {                
                  UtilsLog.error(`The *for (of) expression did not return an array/iterator:`, process.instance.getAttribute('*for'), resolvedExpr);
                } else {
                  items = Object.values(resolvedExpr);
                }
              }
              if (items) {
                process.instance.removeAttribute('*for');
                for (const item of items) {
                  pending.push({
                    parentInstance: process.parentInstance,
                    template: process.template,
                    instance: process.instance.cloneNode(false),
                    localVars: {
                      ...process.localVars,
                      $index: forIndex,
                      $last: false, // set later
                      $first: forIndex === 0,
                      [regexResult[1]]: item,
                    },
                    pathContext: {
                      parentPrefix: process.pathContext.parentPrefix + `${forIndex}.`
                    },
                  });
                  forIndex++;
                }

                if (forIndex > 0) {
                  pending[pending.length - 1].localVars.$last = true;
                  // The newly added items need to be processed before the rest of the queue
                  for (let j = i+1; j < processing.length; j++) {
                    pending.push(processing[j]);
                  }
                  // Don't add this instance since it has been 'split' into multiple to be processed
                  break;
                } else {
                  // No items => skip this node
                  continue;
                }
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
          for (let name of process.instance.getAttributeNames()) {
            let value = process.instance.getAttribute(name);
            let updateValue = false;
            if (name.length > 2 && name.startsWith('[') && name.endsWith(']')) {
              process.instance.removeAttribute(name);
              updateValue = true;
              name = name.substring(1, name.length - 1);
              switch (name) {
                case 'innerhtml': {
                  if (process.instance.isParentNode()) {
                    let nodeValue = value;
                    if (typeof value === 'string') {
                      nodeValue = VirtualNodeParser.parse(this.parseExpression(value, process.localVars));
                    }
                    if (isVirtualNode(nodeValue)) {
                      if (nodeValue.isChildNode()) {
                        process.instance.appendChild(nodeValue);
                      } else if (nodeValue.isParentNode()) {
                        for (const child of [...nodeValue.childNodes]) {
                          child.remove();
                          process.instance.appendChild(child);
                        }
                      }
                      continue;
                    }
                  }
                }
                default: {
                  if (typeof value === 'string') {
                    process.instance.setAttribute(name, this.parseExpression(value, process.localVars));
                  } else {
                    process.instance.setAttribute(name, value);
                  }
                  break;
                }
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
        
        const path = process.pathContext.parentPrefix + process.template[nodeIdSymbol]
        if (process.instance.isParentNode() && process.template.isParentNode()) {
          const pathContext = {
            parentPrefix: path + '-',
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
    let endExpression = -1;
    const parsedParts: string[] = [];
    while ((startExpression = value.indexOf('{{', endExpression)) !== -1) {
      if (value[startExpression-1] === '\\') {
        // escaped, please continue
        parsedParts.push('{');
        startExpression++;
        continue;
      }
      
      // endExpression = the end of the last parsed expression
      // startExpression = a start of a new expression
      parsedParts.push(this.unescapeHtml(value.substring(endExpression, startExpression)));

      endExpression = startExpression;
      do {
        endExpression = value.indexOf('}}', endExpression);
        if (value[endExpression-1] === '\\') {
          // escaped, please continue
          endExpression++;
        } else {
          break;
        }
      } while (endExpression !== -1)
      parsedParts.push(String(this.parseExpression(value.substring(startExpression+2/*{{*/, endExpression), localVars)));

      endExpression += 2 /*}}*/;
      startExpression = endExpression;
    }
    parsedParts.push(this.unescapeHtml(value.substring(endExpression)));
    return parsedParts.join('');
  }

  private unescapeHtml(html: string): string {
    // domParser.parseFromString removes the start whitespaces
    const whitespacePrefix = /^ */.exec(html);
    const unescapedHtml = domParser.parseFromString(html, 'text/html').documentElement.textContent;
    return whitespacePrefix[0] + unescapedHtml;
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