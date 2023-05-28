import { CstElement, CstNode, CstParser, ParserMethod } from "chevrotain"
import { htmlLex, htmlTokenVocabulary } from "./html-lexer"
import type { AnyNodeData, AttributeData, ElementData } from "../../types/html-data";
import { assert } from "console";

class HtmlParser extends CstParser {
  constructor() {
    super(htmlTokenVocabulary, {nodeLocationTracking: 'onlyOffset'})

    // for conciseness

    this.RULE("content", () => {
      this.MANY(() => {
        this.OR([
          { ALT: () => this.SUBRULE(this.comment) },
          { ALT: () => this.SUBRULE(this.element) },
          { ALT: () => this.SUBRULE(this.text) },
        ])
      })
    })

    this.RULE("comment", () => {
      this.CONSUME(htmlTokenVocabulary.comment);
    })

    this.RULE("element", () => {
      this.CONSUME(htmlTokenVocabulary.elementOpen)
      this.CONSUME(htmlTokenVocabulary.elementName)
      this.MANY(() => {
        this.SUBRULE(this.attribute)
      })

      this.OR([
        {
          ALT: () => {
            this.CONSUME(htmlTokenVocabulary.elementClose, { LABEL: "START_CLOSE" })
            this.SUBRULE(this.content)
            this.CONSUME(htmlTokenVocabulary.elementSlashOpen)
            this.CONSUME2(htmlTokenVocabulary.elementName, { LABEL: "END_NAME" })
            this.CONSUME2(htmlTokenVocabulary.elementClose, { LABEL: "END" })
          }
        },
        {
          ALT: () => {
            this.CONSUME(htmlTokenVocabulary.elementSlashClose);
          }
        }
      ])
    })

    this.RULE("attribute", () => {
      this.CONSUME(htmlTokenVocabulary.attribute)
    })

    this.RULE("text", () => {
      this.CONSUME(htmlTokenVocabulary.outsideText)
    })
    
    this.performSelfAnalysis()
  }

  public content: ParserMethod<any, CstNode>;
  public comment: ParserMethod<any, CstNode>;
  public element: ParserMethod<any, CstNode>;
  public attribute: ParserMethod<any, CstNode>;
  public text: ParserMethod<any, CstNode>;
}

// We only ever need one as the parser internal state is reset for each new input.
const parserInstance = new HtmlParser();

export function htmlToCst(inputText: string): CstNode {
  const lexTokens = htmlLex(inputText);

  // ".input" is a setter which will reset the parser's internal's state.
  parserInstance.input = lexTokens;

  const cstNode = parserInstance.content();

  if (parserInstance.errors.length > 0) {
    console.error('parsed tokens(no errors detected, but could be faulty)\n', lexTokens.map(t => ({image: t.image, payload: t.payload, token: t.tokenType.name, offset: t.startOffset})));
    console.error('\nhtml\n', inputText);
    throw new Error("Parsing errors detected\n" + parserInstance.errors.map(e => JSON.stringify(e, null, 2)).join('\n'));
  }

  // any top level rule may be used as an entry point
  return cstNode;
}

function isNode(node: CstElement): node is CstNode {
  return !!(node as any).name
}

function getChildrenInCorrectOrder(node: CstNode): CstElement[] {
  const children: CstElement[] = [];

  for (const type in node.children) {
    for (const child of node.children[type]) {
      children.push(child);
    }
  }

  return children.sort((a, b) => (isNode(a) ? a.location.startOffset : a.startOffset) - (isNode(b) ? b.location.startOffset : b.startOffset));
}

const parsedSymbol = Symbol('htmlParsed');
const cstParentSymbol = Symbol('htmlParsed');
export function parseHtml(input: string | CstNode): AnyNodeData[] {
  const root = typeof input === 'string' ? htmlToCst(input) : input;
  const dummyRootElement: ElementData = {
    type: 'element',
    tag: '*dummy*',
    attributes: {},
    children: [],
  }

  let pending: Array<CstElement & {[parsedSymbol]?: AnyNodeData, [cstParentSymbol]?: CstElement}> = [root];
  while (pending.length) {
    const processing = pending;
    pending = [];

    for (let i = 0; i < processing.length; i++) {
      const process = processing[i];
      if (process[parsedSymbol]) {
        console.error('CstNode:', process)
        throw new Error('Already parsed node. Check error logs for details.')
      }
      
      let parentElement: CstElement = process;
      while (parentElement[cstParentSymbol] && parentElement[parsedSymbol]?.type !== 'element') {
        parentElement = parentElement[cstParentSymbol];
      }
      const parentElementData: ElementData = parentElement[parsedSymbol] ?? dummyRootElement;

      if (isNode(process)) {
        switch (process.name) {
          case 'element': {
            const elementNames = process.children[htmlTokenVocabulary.elementName.name];
            if (!elementNames) {
              throw new Error('Internal compiler error: no element name found.')
            }
            if (elementNames.length !== 1) {
              throw new Error('Internal compiler error: multiple element names found.')
            }
            if (isNode(elementNames[0])) {
              throw new Error('Internal compiler error: expected element name to be an IToken.')
            }
            const elementData: ElementData = {
              type: 'element',
              tag: (elementNames[0]).image,
              attributes: {},
              children: [],
            }
            parentElementData.children.push(elementData);

            process[parsedSymbol] = elementData;
            // fallthrough to add children to pending
          }
          case 'content':
          case 'comment':
          case 'attribute':
          case 'text': {
            for (const child of getChildrenInCorrectOrder(process)) {
              child[cstParentSymbol] = process;
              pending.push(child);
            }

            // Ensure correct parsing order
            i++;
            for (;i < processing.length; i++) {
              pending.push(processing[i]);
            }
            break;
          }
          default: {
            throw new Error(`unknown node ${process.name}, did you update the compiler after editing the lexer?`);
          }
        }
      } else {
        switch (process.tokenType) {
          case htmlTokenVocabulary.comment: {
            // htmlTokenVocabulary.comment uses custom payload
            process[parsedSymbol] = {
              type: 'comment',
              text: process.payload,
            };
            parentElementData.children.push(process[parsedSymbol]);
            break;
          }
          case htmlTokenVocabulary.outsideText: {
            process[parsedSymbol] = {
              type: 'text',
              text: process.image,
            };
            parentElementData.children.push(process[parsedSymbol]);
            break;
          }
          case htmlTokenVocabulary.attribute: {
            if (!parentElement) {
              throw new Error('Internal compiler error: could not find the element to which we need to assign the attribute')
            }
            const attrData: AttributeData = process.payload;
            if (parentElementData.attributes[attrData.name.toLowerCase()]) {
              throw new Error(`Duplicate attribute detected on element ${parentElementData.tag}. Attribute: ${attrData.name} (attributes are case insensitive)`);
            }
            parentElementData.attributes[attrData.name.toLowerCase()] = attrData;
            
            process[parsedSymbol] = parentElementData;
            break;
          }
          case htmlTokenVocabulary.elementOpen:
          case htmlTokenVocabulary.elementSlashOpen:
          case htmlTokenVocabulary.elementName:
          case htmlTokenVocabulary.elementClose:
          case htmlTokenVocabulary.elementSlashClose: {
            // do nothing
            break;
          }
          default: {
            throw new Error(`unknown node ${process.tokenType.name}, did you update the compiler after editing the lexer?`);
          }
        }
      }
    }
  }

  return dummyRootElement.children;
}