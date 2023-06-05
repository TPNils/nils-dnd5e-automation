import { BindableString, BindExpressionValue } from "../../../../../types/html-data";
import { UtilsLog } from "../../../utils/utils-log";
import { UtilsCompare } from "../../utils/utils-compare";
import { rerenderQueue } from "../virtual-dom/render-queue";
import { VirtualFragmentNode } from "../virtual-dom/virtual-fragment-node";
import { isVirtualNode, VirtualChildNode, VirtualNode, VirtualParentNode } from "../virtual-dom/virtual-node";
import { VirtualNodeParser } from "../virtual-dom/virtual-node-parser";
import { VirtualNodeRenderer } from "../virtual-dom/virtual-node-renderer";
import { VirtualTextNode } from "../virtual-dom/virtual-text-node";

const forAttrRegex = /^\s*let\s+([^\s]+)\s+(of|in)\s([^;]+)(?:;(.*))?$/;
const forAttrSuffixRegex = /\s*let\s+([^\s]+)\s+=\s([^;]+)/g;
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

const globalTemplateScope = {
  localize: (id: string) => game.i18n.localize(id),
};
class ReadonlyProxyHandler implements ProxyHandler<any> {
  constructor(
  ) {}

  public has(target: any, p: string | symbol): boolean {
    return Reflect.has(target, p);
  }

  public get(target: any, p: string | symbol, receiver: any) {
    const value = Reflect.get(target, p, receiver);
    if (value == null || typeof value !== 'object') {
      return value;
    }
    return new Proxy(value, new ReadonlyProxyHandler());
  }

  public set(target: any, p: string | symbol, newValue: any, receiver: any): boolean {
    return false;
  }

  public deleteProperty(target: any, p: string | symbol): boolean {
    return false;
  }

}

// Need to use a dummy as we otherwise get internal errors when using "for (let key in globalThis)" where globalThis is wrapped in this proxy handler
const globalTemplateScopeProxy = new Proxy(globalTemplateScope, new ReadonlyProxyHandler());

export class Template {
  
  private readonly template: VirtualNode & VirtualParentNode;
  public constructor (
    public readonly name: string,
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

  #context: Record<string | number | symbol, any>;
  /**
   * @param context The new context to render the template
   * @returns A promise when the change has been applied returning itself
   */
  public setContext(context: Record<string | number | symbol, any>): void {
    this.#context = context;
    if (this.#processedVirtualNode != null) {
      this.render({force: true});
    }
  }

  public render(options: {force?: boolean, sync: true}): VirtualNode & VirtualParentNode
  public render(options?: {force?: boolean, sync?: false}): Promise<VirtualNode & VirtualParentNode>
  public render(options: {force?: boolean, sync?: boolean} = {}): Promise<VirtualNode & VirtualParentNode> | VirtualNode & VirtualParentNode {
    if (this.#processedVirtualNode == null || options.force) {
      if (options.sync) {
        rerenderQueue.delete(this.rerenderCallback);
        this.rerenderCallback();
      } else {
        return rerenderQueue.add(this.rerenderCallback).then(() => this.#processedVirtualNode);
      }
    }

    return this.#processedVirtualNode;
  }

  private rerenderCallback = () => {
    this.calcVirtualNode();
  }

  #processedVirtualNode: VirtualNode & VirtualParentNode;
  #processedVirtualNodesMap = new Map<string, VirtualNode>();
  private calcVirtualNode(): void {
    if (this.#context == null) {
      if (!(this.#processedVirtualNode instanceof VirtualFragmentNode) || this.#processedVirtualNode.hasChildNodes()) {
        this.#processedVirtualNode = new VirtualFragmentNode();
      }
      return;
    }
    const rootInstance: VirtualNode & VirtualParentNode = this.template.cloneNode(false);
    const createdNodesByMap = new Map<string, VirtualNode>();

    let pending: Array<PendingNodes> = [{
      template: this.template,
      instance: rootInstance,
      localVars: globalTemplateScopeProxy,
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
                  const childItem: PendingNodes = {
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
                  };
                  if (regexResult[4]) {
                    const expressions = regexResult[4].matchAll(forAttrSuffixRegex);
                    for (const [fullMatch, assignVarName, readVarName] of expressions) {
                      if (readVarName in childItem.localVars) {
                        childItem.localVars[assignVarName] = childItem.localVars[readVarName];
                      } else if (readVarName in this.#context) {
                        childItem.localVars[assignVarName] = this.#context[readVarName];
                      } else {
                        UtilsLog.error(`Could not find variable ${readVarName}`, {templateName: this.name, expression: regexResult[0], thisContext: this.#context, localVars: childItem.localVars})
                      }
                    }
                  }
                  pending.push(childItem);
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
            if (name.length > 2 && name.startsWith('[') && name.endsWith(']')) {
              process.instance.removeAttribute(name);
              name = name.substring(1, name.length - 1);
              
              if (typeof value === 'string') {
                process.instance.setAttribute(name, this.parseExpression(value, process.localVars));
              } else {
                process.instance.setAttribute(name, value);
              }
              
            } else if (typeof value === 'string' && value.length > 4 && value.startsWith('{{') && value.endsWith('}}')) {
              process.instance.setAttribute(name, this.parseExpression(value.substring(2, value.length - 2), process.localVars));
            } else if (typeof value === 'string') {
              const processedValue = this.processBindableString(value, process.localVars, false);
              if (value !== processedValue) {
                process.instance.setAttribute(name, processedValue);
              }
            }
          }
        }
        if (process.instance.isTextNode()) {
          let textData = (process.template as VirtualTextNode).getTextData();
          if (textData.length === 0) {
            continue;
          }

          process.instance.setText('');
          let instances: Array<VirtualNode & VirtualChildNode> = [process.instance as VirtualTextNode];
          for (const part of textData) {
            const lastInstance = instances[instances.length - 1];
            if (part.type === 'string') {
              if (lastInstance.isTextNode()) {
                lastInstance.setText(lastInstance.getText() + part.text);
              } else {
                instances.push(new VirtualTextNode(part.text));
              }
            } else if (part.bindMethod === 'raw') {
              const result = this.parseExpression(part.text, process.localVars);
              const expressions = Array.isArray(result) ? result : [result]
              for (const expression of expressions) {
                if (isVirtualNode(expression) && expression.isChildNode()) {
                  instances.push(expression);
                } else {
                  const parsed = VirtualNodeParser.parseRaw(String(expression));
                  if (parsed.length > 0) {
                    instances.push(...parsed);
                  }
                }
              }
            } else {
              if (lastInstance.isTextNode()) {
                lastInstance.setText(lastInstance.getText() + this.parseExpression(part.text, process.localVars));
              } else {
                instances.push(new VirtualTextNode(String(this.parseExpression(part.text, process.localVars))));
              }
            }
          }
          

          if (instances.length > 1) {
            // TODO check if this can be improved
            process.parentInstance.appendChild(...instances);
            continue;
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
              pathContext: pathContext, // Same path context instance needs to be shared by all children/siblings
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

  private processBindableString(value: string, localVars: any, asNode: false): string
  private processBindableString(value: string, localVars: any, asNode: true): Array<VirtualNode & VirtualChildNode>
  private processBindableString(value: string, localVars: any, asNode: boolean): string | Array<VirtualNode & VirtualChildNode> {
    // TODO this is currently a dumb implementation and does not account for the 'keywords' {{ and }} to be present within the expression (example: in a javascript string)
    // Best to write an interpreter but thats a lot of work and maybe more process intensive so lets cross that bridge when we get there :)
    let startExpression = 0;
    let endExpression = -1;
    let endExpressionStr = '{{';
    const parsedParts: Array<(VirtualNode & VirtualChildNode) | string> = [];
    while ((startExpression = value.indexOf('{{', endExpression)) !== -1) {
      if (value[startExpression-1] === '\\') {
        // escaped, please continue
        parsedParts.push('{');
        startExpression++;
        continue;
      }
      if (value.substring(startExpression, 3) === '{{{') {
        endExpressionStr = '}}}';
      } else {
        endExpressionStr = '}}';
      }
      
      // endExpression = the end of the last parsed expression
      // startExpression = a start of a new expression
      parsedParts.push(value.substring(endExpression, startExpression));

      endExpression = startExpression;
      do {
        endExpression = value.indexOf(endExpressionStr, endExpression);
        if (value[endExpression-1] === '\\') {
          // escaped, please continue
          endExpression++;
        } else {
          break;
        }
      } while (endExpression !== -1)
      const rawExpression = value.substring(startExpression+endExpressionStr.length/*{{ or {{{*/, endExpression);
      const parsedExpression = String(this.parseExpression(rawExpression, localVars));
      if (endExpressionStr.length === 3 && asNode) {
        parsedParts.push(...VirtualNodeParser.parseRaw(parsedExpression));
      } else {
        parsedParts.push(parsedExpression);
      }

      endExpression += endExpressionStr.length /*}} or }}}*/;
      startExpression = endExpression;
    }
    parsedParts.push(value.substring(endExpression));
    UtilsLog.debug('bind', parsedParts, value)
    if (asNode) {
      return parsedParts.map(v => typeof v === 'string' ? new VirtualTextNode(v) : v);
    } else {
      return parsedParts.map(v => String(v)).join('');
    }
  }

  private parsedExpressions = new Map<string, ParsedExpression>();
  private parseExpression(expression: any, localVars: object): any {
    if (typeof expression !== 'string') {
      // If expression is not a string, assume its the result
      return expression;
    }
    try {
      const funcKey = expression;
      if (!this.parsedExpressions.has(funcKey)) {
        this.parsedExpressions.set(funcKey, Function(`with (this) {return ${expression}}`) as ParsedExpression);
      }
      const namespace = new Proxy(
        localVars,
        this.proxyHandler
      );
      return this.parsedExpressions.get(funcKey).call(namespace);
    } catch (e) {
      UtilsLog.error('Error executing expression with context', {templateName: this.name, expression: expression, thisContext: this.#context, localVars: localVars, err: e})
      throw e;
    }
  }

  private proxyHandler: ProxyHandler<any | null> = {
      has: (localVars, prop): boolean => {
        // Catch everything, otherwise it will fallback to the real global
        return true;
      },
      get: (localVars, prop): any => {
        if (Reflect.has(localVars, prop)) {
          return Reflect.get(localVars, prop);
        }
        if (Reflect.has(this.#context, prop)) {
          return Reflect.get(this.#context, prop);
        }
        return undefined;
      },
      set: (localVars, prop, newValue): boolean => {
        if (prop in localVars) {
          return Reflect.set(localVars, prop, newValue);
        }
        if (prop in this.#context) {
          return Reflect.set(this.#context, prop, newValue);
        }
        return Reflect.set(localVars, prop, newValue);
      },
      ownKeys: (localVars): Array<string | symbol> => {
        const keys = new Set<string | symbol>();

        for (const key of Reflect.ownKeys(this.#context)) {
          keys.add(key);
        }
        for (const key in Reflect.ownKeys(localVars)) {
          keys.add(key);
        }

        return Array.from(keys);
      },
      preventExtensions: (localVars): boolean => {
        return true;
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
      UtilsLog.error(e)
      throw e;
    }
  }

}