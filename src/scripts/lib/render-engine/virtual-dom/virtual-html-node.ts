import { AttributeParser } from "../attribute-parser";
import { StoredEventCallback, VirtualChildNode, VirtualNode, VirtualTextNode, VNode } from "./virtual-node";

export class VirtualHtmlNode extends VNode({attribute: true, child: true, event: true, parent: true}) implements VirtualNode {
  
  public constructor(nodeName: string) {
    super();
    this.#nodeName = nodeName.toUpperCase();
  }

  #nodeName: string;
  get nodeName(): string {
    return this.#nodeName;
  }

  public cloneNode(deep?: boolean): this {
    const clone = new VirtualHtmlNode(this.#nodeName);
    clone.startAttributeClone(this, deep);
    clone.startChildClone(this, deep);
    clone.startEventClone(this, deep);
    clone.startParentClone(this, deep);
    return clone as this;
  }
  
  public createDom(): Node {
    return document.createElement(this.#nodeName);
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
      parts.push(`<${this.#nodeName.toLowerCase()}/>`);
    } else {
      parts.push('/>');
    }
    return parts.join('');
  }

}