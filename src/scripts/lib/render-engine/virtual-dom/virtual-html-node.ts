import { AttributeParser } from "../attribute-parser";
import { VirtualNode, VirtualTextNode, VNode } from "./virtual-node";

export class VirtualHtmlNode extends VNode({attribute: true, child: true, event: true, parent: true}) implements VirtualNode {
  
  public constructor(nodeName: string) {
    super();
    this.#nodeName = nodeName;
  }

  #nodeName: string;
  get nodeName(): string {
    return this.#nodeName.toUpperCase();
  }

  public cloneNode(deep?: boolean): this {
    const clone = new VirtualHtmlNode(this.#nodeName);
    clone.startAttributeClone(this, deep);
    clone.startChildClone(this, deep);
    clone.startEventClone(this, deep);
    clone.startParentClone(this, deep);
    return clone as this;
  }
  
  public createDom(defaultNamespace?: string): Node {
    if (this.getAttribute('xmlns')) {
      return document.createElementNS(this.getAttribute('xmlns'), this.#nodeName);
    } else if (this.#nodeName.toLowerCase() === 'svg') { // should this be case insensitive?
      // SVG overwrites default namespace
      return document.createElementNS('http://www.w3.org/2000/svg', this.#nodeName);
    } else if (defaultNamespace) {
      return document.createElementNS(defaultNamespace, this.#nodeName);
    } else {
      return document.createElement(this.#nodeName);
    }
  }

  public isNode(): this is VirtualNode {
    return true;
  }

  public isTextNode(): this is VirtualTextNode {
    return false;
  }
  
  public toString(): string {
    const parts: string[] = [];
    parts.push('<');
    parts.push(this.#nodeName.toLowerCase());
    for (const attr of this.getAttributeNames()) {
      parts.push(' ');
      parts.push(attr);
      const value = AttributeParser.serialize(this.getAttribute(attr));
      if (value) {
        parts.push('="');
        // escape \ (escape character) & " (start/end of value)
        parts.push(value.replace(/\\/g, '\\\\').replace(/"/g, '\\"'));
        parts.push('"');
      }
    }
    if (this.hasChildNodes()) {
      parts.push('>');
      for (const child of this.childNodes) {
        parts.push(String(child));
      }
      parts.push(`</${this.#nodeName.toLowerCase()}>`);
    } else {
      parts.push('/>');
    }
    return parts.join('');
  }

}