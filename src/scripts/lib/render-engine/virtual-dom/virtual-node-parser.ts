import { UtilsLog } from "../../../utils/utils-log";
import { Template } from "../template/template";
import { VirtualCommmentNode } from "./virtual-comment-node";
import { VirtualFragmentNode } from "./virtual-fragment-node";
import { VirtualHtmlNode } from "./virtual-html-node";
import { VirtualNode, VirtualParentNode } from "./virtual-node";
import { VirtualTextNode } from "./virtual-text-node";

// y flag = sticky => allow useage of lastIndex
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/sticky
const textNodeRegex = /(.*?)(?=<)/ys;
const commentNodeRegex = /\s*<!--(.*)-->/ys;

// https://www.ibm.com/docs/en/app-connect-pro/7.5.3?topic=schemas-valid-node-names
const startElementPrefixRegex = /\s*<([a-zA-Z_][a-zA-Z0-9_\-\.]*)/y;
const startElementSuffixRegex = /\s*(\/)?>/y;
const endElementRegex = /\s*<\/([a-zA-Z_][a-zA-Z0-9_\-\.]*)>/y;

// https://www.w3.org/TR/2012/WD-html-markup-20120329/syntax.html
const attrValueNoQuoteRegex = /([^"'=<>`\s]+)/y;
const attrValueDoubleQuoteRegex = /"(.*?[^\\](?:\\\\)*)"/ys;
const attrValueSingleQuoteRegex = /'(.*?[^\\](?:\\\\)*)'/ys;
const attrNameRegex = /([^\s"'>/=]+)/y;
const attrRegex = new RegExp(`\\s*${attrNameRegex.source}(?:\\s*=(?:${attrValueNoQuoteRegex.source}|\\s*${attrValueDoubleQuoteRegex.source}|\\s*${attrValueSingleQuoteRegex.source}))?`, `ys`)

export class VirtualNodeParser {

  private currentIndex = 0;
  private currentNode: VirtualNode & VirtualParentNode;
  private regexResult: RegExpExecArray; // don't keep defining new variables for efficiency
  private constructor(private html: string) {
  }

  private startParse(): VirtualNode & VirtualParentNode {
    const rootNode = new VirtualFragmentNode();
    this.currentNode = rootNode;
    let indexSnapshot: number;
    do {
      indexSnapshot = this.currentIndex;
      this.readTextNode();
      this.readCommentNode();
      this.readStartElement();
      this.readEndElement();
      if (indexSnapshot === this.currentIndex) {
        throw new Error(`Internal error. Could not parse html, stuck at index ${indexSnapshot}. html:\n${this.html}`)
      }
    } while (this.currentIndex < this.html.length)

    return rootNode;
  }

  private readTextNode(): void {
    if (!this.exec(textNodeRegex)) {
      // Text is the last part that needs to be parsed => no special characters found
      const value = this.html.substring(this.currentIndex);
      if (value.trim().length > 0) {
        this.currentNode.appendChild(new VirtualTextNode(value));
      }
      this.currentIndex = this.html.length;
      return;
    }

    // A special character is found => something else needs to be parsed
    if (this.regexResult[1].trim().length > 0) {
      this.currentNode.appendChild(new VirtualTextNode(this.regexResult[1]));
    }
  }

  private readCommentNode(): void {
    if (this.exec(commentNodeRegex)) {
      this.currentNode.appendChild(new VirtualCommmentNode(this.regexResult[1]))
      this.currentIndex = commentNodeRegex.lastIndex;
    }
  }

  private readStartElement(): void {
    if (this.exec(startElementPrefixRegex)) {
      const node = new VirtualHtmlNode(this.regexResult[1]);
      this.currentNode.appendChild(node);
      this.currentNode = node;
      this.readAttributes();
      if (!this.exec(startElementSuffixRegex)) {
        throw new Error(`Invalid html. Did not find closure for node '${node.nodeName}' around character index ${this.currentIndex}. html:\n${this.html}`)
      }
      if (this.regexResult[1] != null) {
        // Element is self closed
        this.currentNode = node.parentNode as typeof this.currentNode;
      }
    }
  }

  private readEndElement(): void {
    if (this.exec(endElementRegex)) {
      let closedNode = this.currentNode;
      while (this.regexResult[1].toUpperCase() !== closedNode.nodeName) {
        if (closedNode.isChildNode && closedNode.isChildNode() && closedNode.parentNode.isNode && closedNode.parentNode.isNode()) {
          closedNode = closedNode.parentNode;
        }
      }
      if (closedNode === null) {
        throw new Error(`Invalid html. Found closure for node '${this.regexResult[1]}' but did not encounter a start. Closure is found around character index ${this.currentIndex}. html:\n${this.html}`)
      }
      if (closedNode !== this.currentNode) {
        UtilsLog.warn(`Did not find closure for node '${this.currentNode.nodeName}', instead found ${this.regexResult[1]} around character index ${this.currentIndex}. html:\n${this.html}`)
      }
      if (closedNode.isChildNode && closedNode.isChildNode() && closedNode.parentNode.isNode && closedNode.parentNode.isNode()) {
        this.currentNode = closedNode.parentNode;
      } else {
        throw new Error(`Internal error. Could not properly close '${this.regexResult[1]}'. Closure is found around character index ${this.currentIndex}. html:\n${this.html}`)
      }
    }
  }

  private readAttributes(): void {
    if (!this.currentNode.isAttributeNode || !this.currentNode.isAttributeNode()) {
      return; // TODO remove due to performance?
    }
    let indexSnapshot: number = this.currentIndex;
    while (this.exec(attrRegex)) {
      let value = '';
      // One of the groups 2, 3 or 4 may contain a value
      for (let i = 2; i <= 4; i++) {
        if (this.regexResult[i]) {
          value = this.regexResult[i];
          break;
        }
      }

      this.currentNode.setAttribute(this.regexResult[1], value);
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

  public static parse(html: string): VirtualNode & VirtualParentNode {
    return new VirtualNodeParser(html).startParse();
  }

  public static init() {
    (window as any).vparse = VirtualNodeParser.parse;
    (window as any).tparse = (html: string, context: any = {}) => {
      if (context.items == null) {
        context.items = [1,2,3];
      }
      const template = new Template(VirtualNodeParser.parse(html));
      template.setContext(context);
      return template.render();
    };
    /*
    (() => {
      const html = `test 
      <!-- comment with <input/> -->
      <div *if=false>should not be rendered</div>
      <p *for="let i of items">
        {{i}}
      </p>
      <input value="val" placeholder="yes"/>
      <a href="www.google.be">non bold<b>bold</b></a>`;

      const vparse = window.vparse(html);
      const tparse = window.tparse(html);
      console.log(vparse, String(vparse));
      console.log(tparse, String(tparse));
    })()
    */
  }

}