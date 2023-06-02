import { AttributeData, BindableString, ElementData } from "../../../../../types/html-data";
import { AnyNodeData } from "../../../../../types/html-data";
import { UtilsLog } from "../../../utils/utils-log";
import { VirtualCommmentNode } from "./virtual-comment-node";
import { VirtualFragmentNode } from "./virtual-fragment-node";
import { VirtualHtmlNode } from "./virtual-html-node";
import { VirtualChildNode, VirtualNode, VirtualParentNode } from "./virtual-node";
import { VirtualTextNode } from "./virtual-text-node";

// y flag = sticky => allow useage of lastIndex
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/sticky
const textNodeRegex = /(.*?)(?=<)/ys;
const commentNodeRegex = /\s*<!--(.*?)-->/ys;

// https://www.ibm.com/docs/en/app-connect-pro/7.5.3?topic=schemas-valid-node-names
const startElementPrefixRegex = /\s*<([a-zA-Z_][a-zA-Z0-9_\-\.]*)/y;
const startElementSuffixRegex = /\s*(\/)?>/y;
const endElementRegex = /\s*<\/([a-zA-Z_][a-zA-Z0-9_\-\.]*)>/y;

// https://www.w3.org/TR/2012/WD-html-markup-20120329/syntax.html
const attrValueNoQuoteRegex = /([^"'=<>`\s]+)/y;
const attrValueDoubleQuoteRegex = /""|"(.*?[^\\](?:\\\\)*)"/ys;
const attrValueSingleQuoteRegex = /''|'(.*?[^\\](?:\\\\)*)'/ys;
const attrNameRegex = /([^\s"'>/=]+)/y;
const attrRegex = new RegExp(`\\s*${attrNameRegex.source}(?:\\s*=(?:${attrValueNoQuoteRegex.source}|\\s*${attrValueDoubleQuoteRegex.source}|\\s*${attrValueSingleQuoteRegex.source}))?`, `ys`)
const attrQuotesSorted = ['', `"`, `'`] as const;

// https://html.spec.whatwg.org/multipage/syntax.html#void-elements
const voidElementsTags = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'].map(tag => tag.toUpperCase());

export class VirtualNodeParser {

  private currentIndex = 0;
  private get currentNode(): ElementData {
    return this.nodeStack.length === 0 ? null : this.nodeStack[this.nodeStack.length - 1];
  }
  private nodeStack: ElementData[] = [];
  private regexResult: RegExpExecArray; // don't keep defining new variables for efficiency
  private constructor(private html: string) {
  }

  private startParse(): AnyNodeData[] {
    const rootNode: AnyNodeData = {
      type: 'element',
      tag: '#root#',
      attributes: {},
      children: []
    };
    this.nodeStack.push(rootNode);
    let indexSnapshot: number;
    do {
      indexSnapshot = this.currentIndex;
      this.readTextNode();
      this.readCommentNode();
      this.readStartElement();
      this.readEndElement();
      if (indexSnapshot === this.currentIndex && this.currentIndex < this.html.length) {
        throw new Error(`Internal error. Could not parse html, stuck at index ${indexSnapshot}. html:\n${this.html}`)
      }
    } while (this.currentIndex < this.html.length)

    return rootNode.children;
  }

  private readTextNode(): void {
    if (!this.exec(textNodeRegex)) {
      // Text is the last part that needs to be parsed => no special characters found
      const value = this.html.substring(this.currentIndex);
      if (value.trim().length > 0) {
        this.currentNode.children.push({type: 'text', text: [{type: 'string', text: value}]});
      }
      this.currentIndex = this.html.length;
      return;
    }

    // A special character is found => something else needs to be parsed
    if (this.regexResult[1].trim().length > 0) {
      this.currentNode.children.push({type: 'text', text: [{type: 'string', text: this.regexResult[1]}]});
    }
  }

  private readCommentNode(): void {
    if (this.exec(commentNodeRegex)) {
      this.currentNode.children.push({type: 'comment', text: [{type: 'string', text: this.regexResult[1]}]});
    }
  }

  private readStartElement(): void {
    if (this.exec(startElementPrefixRegex)) {
      const node: ElementData = {
        type: 'element',
        tag: this.regexResult[1],
        attributes: {},
        children: [],
      }
      this.currentNode.children.push(node);
      this.nodeStack.push(node);
      this.readAttributes();
      if (!this.exec(startElementSuffixRegex)) {
        throw new Error(`Invalid html. Did not find closure for node '${node.tag}' around character index ${this.currentIndex}. html:\n${this.html}`)
      }
      if (voidElementsTags.includes(node.tag) || this.regexResult[1] != null) {
        // Element is self closed
        this.nodeStack.pop();
      }
    }
  }

  private readEndElement(): void {
    if (this.exec(endElementRegex)) {
      let closedNode = this.currentNode;
      while (this.regexResult[1].toUpperCase() !== closedNode.tag.toUpperCase()) {
        closedNode = this.nodeStack[this.nodeStack.indexOf(closedNode) - 1];
      }
      if (closedNode === null) {
        throw new Error(`Invalid html. Found closure for node '${this.regexResult[1]}' but did not encounter a start. Closure is found around character index ${this.currentIndex}. html:\n${this.html}`)
      }
      if (closedNode !== this.currentNode) {
        UtilsLog.warn(`Did not find closure for node '${this.currentNode.tag}', instead found ${this.regexResult[1]} around character index ${this.currentIndex}. html:\n${this.html}`)
      }
      for (let i = this.nodeStack.indexOf(closedNode), length = this.nodeStack.length; i < length; i++) {
        this.nodeStack.pop();
      }
    }
  }

  private readAttributes(): void {
    let indexSnapshot: number = this.currentIndex;
    while (this.exec(attrRegex)) {
      // One of the groups 2, 3 or 4 may contain a value
      let attrQuote: AttributeData['quoteType'] = '';
      let value: string;
      for (let i = 2; i <= 4; i++) {
        if (this.regexResult[i]) {
          value = this.regexResult[i];
          attrQuote = attrQuotesSorted[i - 2];
          break;
        }
      }

      this.currentNode.attributes[this.regexResult[1].toLowerCase()] = {
        name: this.regexResult[1],
        value: [{type: 'string', text: value}],
        quoteType: attrQuote,
      }
      if (indexSnapshot === this.currentIndex) {
        throw new Error(`Internal error. Could not parse html, stuck at index ${indexSnapshot}. html:\n${this.html}`)
      }
      indexSnapshot = this.currentIndex;
    }
  }

  private exec(regex: RegExp): boolean {
    regex.lastIndex = this.currentIndex;
    this.regexResult = regex.exec(this.html);
    if (!this.regexResult) {
      return false; // no match
    } else if (this.currentIndex !== (regex.lastIndex - this.regexResult[0].length)) {
      // Match had to start at our current index => emulates regex ^
      this.regexResult = null;
      return false;
    }
    this.currentIndex = regex.lastIndex;
    return true;
  }

  public static parse(html: String | AnyNodeData[]): VirtualNode & VirtualParentNode {
    if (typeof html === 'string') {
      // fallback, need to support for raw html parsing
      // supports less features, but thats fine for the current usecase
      html = new VirtualNodeParser(html).startParse();
    }
    return VirtualNodeParser.parseNodes(html as AnyNodeData[]);
  }
  
  public static parseRaw(html: String | AnyNodeData[]): Array<VirtualChildNode & VirtualNode> {
    const root: Array<VirtualChildNode & VirtualNode> = [];

    for (const node of VirtualNodeParser.parse(html).childNodes) {
      root.push(node);
    }
    for (const node of root) {
      node.remove();
    }

    return root;
  }

  private static parseNodes(nodes: AnyNodeData[]): VirtualNode & VirtualParentNode {
    const rootNode = new VirtualFragmentNode();

    let pending: Array<{nodeData: AnyNodeData, parentVirtualNode: VirtualParentNode}> = [];
    for (const node of nodes) {
      pending.push({nodeData: node, parentVirtualNode: rootNode});
    }

    while (pending.length) {
      const processing = pending;
      pending = [];
      for (const item of processing) {
        switch (item.nodeData.type) {
          case "element": {
            const virtual = new VirtualHtmlNode(item.nodeData.tag);
            for (const attrName in item.nodeData.attributes) {
              const attr = item.nodeData.attributes[attrName];
              if (attr.value.length) {
                // TODO allow bindable text
                virtual.setAttribute(attr.name, VirtualNodeParser.toRawString(attr.value));
              } else {
                virtual.setAttribute(attr.name);
              }
            }
            for (const child of item.nodeData.children) {
              pending.push({nodeData: child, parentVirtualNode: virtual});
            }
            item.parentVirtualNode.appendChild(virtual);
            break;
          }
          case "comment": {
            const virtual = new VirtualCommmentNode(item.nodeData.text);
            item.parentVirtualNode.appendChild(virtual);
            break;
          }
          case "text": {
            const virtual = new VirtualTextNode(item.nodeData.text);
            if (virtual.getText().trim().length > 0) {
              item.parentVirtualNode.appendChild(virtual);
            }
            break;
          }
        }
      }
    }

    return rootNode;
  }

  public static init() {
    
  }

  private static toRawString(strings: BindableString[]): string {
    const parts: string[] = [];

    for (const str of strings) {
      if (str.type === 'string') {
        parts.push(str.text);
      } else {
        if (str.bindMethod === 'raw') {
          parts.push('{{{');
        } else {
          parts.push('{{');
        }
        parts.push(str.text);
        if (str.bindMethod === 'raw') {
          parts.push('}}}');
        } else {
          parts.push('}}');
        }
      }
    }

    if (!parts.length) {
      return null;
    }
    return parts.join('');
  }

}