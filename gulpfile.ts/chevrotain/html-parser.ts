"use strict"

import { CstNode, CstParser, ParserMethod } from "chevrotain"
import { htmlLex, htmlTokenVocabulary } from "./html-lexer"

// ----------------- parser -----------------
class HtmlParser extends CstParser {
  constructor() {
    super(htmlTokenVocabulary)

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

export function parseHtml(inputText: string) {
  const lexResult = htmlLex(inputText);

  // ".input" is a setter which will reset the parser's internal's state.
  parserInstance.input = lexResult.tokens;

  // No semantic actions so this won't return anything yet.
  parserInstance.content();

  if (parserInstance.errors.length > 0) {
    throw Error(
      "Sad sad panda, parsing errors detected!\n" +
        parserInstance.errors[0].message
    )
  }

  // any top level rule may be used as an entry point
  return parserInstance.content()
}
