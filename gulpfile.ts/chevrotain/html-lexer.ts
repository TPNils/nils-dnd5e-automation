import { CustomPatternMatcherReturn, ILexingResult, IToken, Lexer, TokenType, createToken } from 'chevrotain';

const attrValueNoQuoteRegex = /([^"'=<>`\s]+)/;
const attrValueDoubleQuoteRegex = /""|"(.*?[^\\](?:\\\\)*)"/s;
const attrValueSingleQuoteRegex = /''|'(.*?[^\\](?:\\\\)*)'/s;
const attrNameRegex = /([^\s"'>/=]+)/y;
const attrRegex = new RegExp(`\\s*${attrNameRegex.source}(?:\\s*=(?:${attrValueNoQuoteRegex.source}|\\s*${attrValueDoubleQuoteRegex.source}|\\s*${attrValueSingleQuoteRegex.source}))?`, `ys`)
const attrQuotesSorted = ['', `"`, `'`];

/** Can't push and pop at the same time, this is a workaround */
function pushAfterToken(push_mode: string, previousToken: TokenType): TokenType {
  return createToken({
    name: `PushPopFix` + push_mode,
    push_mode: push_mode,
    group: Lexer.SKIPPED,
    pattern: (text: string, offset: number, tokens: IToken[], groups: {[groupName: string]: IToken[]}) => {
      if (!tokens.length) {
        return null;
      }
      if (tokens[tokens.length-1].tokenType === previousToken) {
        const response = [''] as CustomPatternMatcherReturn;
        response.payload = '';
        return response;
      }
      return null;
    }
  });
}

function attributePattern(text: string, offset: number, tokens: IToken[], groups: {[groupName: string]: IToken[]}): CustomPatternMatcherReturn {
  attrRegex.lastIndex = offset;

  // One of the groups 2, 3 or 4 may contain a value
  const regexResult = attrRegex.exec(text);
  if (!regexResult) {
    return null;
  }
  
  let attrQuote = '';
  let value = '';
  for (let i = 2; i <= 4; i++) {
    if (regexResult[i]) {
      attrQuote = attrQuotesSorted[i - 2];
      value = regexResult[i];
      break;
    }
  }
  
  const response = [regexResult[0]] as CustomPatternMatcherReturn;
  response.payload = {
    name: regexResult[1],
    quoteType: attrQuote,
    value: value,
  }
  return response;
}

export const htmlTokenVocabulary = {
  comment: createToken({name: 'Comment', pattern: /<!--(.*?)-->/, line_breaks: true}),

  // https://www.ibm.com/docs/en/app-connect-pro/7.5.3?topic=schemas-valid-node-names
  elementOpen: createToken({name: 'ElementOpen', pattern: /</, push_mode: 'elementName'}),
  elementSlashOpen: createToken({name: 'ElementSlashOpen', pattern: /<\//, push_mode: 'elementName'}),
  elementName: createToken({name: 'ElementName', pattern: /([a-zA-Z_][a-zA-Z0-9_\-\.]*)/, pop_mode: true}),
  elementClose: createToken({name: 'ElementClose', pattern: />/, pop_mode: true}),
  elementSlashClose: createToken({name: 'ElementSlashClose', pattern: /\/>/, pop_mode: true}),

  // https://www.w3.org/TR/2012/WD-html-markup-20120329/syntax.html
  attribute: createToken({name: 'AttrValue', pattern: attributePattern, line_breaks: true}),

  insideSkip: createToken({name: 'InsideSkip', pattern: /\s+/, group: Lexer.SKIPPED, line_breaks: true}),
  slash: createToken({name: 'Slash', pattern: /\//}),
  equals: createToken({name: 'Equals', pattern: /=/}),
  outsideText: createToken({ name: "OutsideText", pattern: /[^<]+/s, line_breaks: true }),
}

const HtmlLexer = new Lexer({
  defaultMode: 'outside',
  modes: {
    // Order matters, the first in the array will get matched first
    outside: [
      pushAfterToken('inside', htmlTokenVocabulary.elementName),
      htmlTokenVocabulary.comment,
      htmlTokenVocabulary.elementSlashOpen,
      htmlTokenVocabulary.elementOpen,
      htmlTokenVocabulary.outsideText,
    ],
    inside: [
      htmlTokenVocabulary.elementSlashClose,
      htmlTokenVocabulary.elementClose,
      htmlTokenVocabulary.attribute,
      htmlTokenVocabulary.insideSkip,
    ],
    elementName: [
      htmlTokenVocabulary.elementName,
    ],
  }
})

export function htmlLex(inputText: string): ILexingResult {
  const lexingResult = HtmlLexer.tokenize(inputText)

  if (lexingResult.errors.length > 0) {
    console.error(lexingResult.tokens.map(t => ({image: t.image, payload: t.payload, token: t.tokenType.name})))
    throw Error("Sad Sad Panda, lexing errors detected\n" + lexingResult.errors.map(e => JSON.stringify(e)).join('\n'))
  }

  return lexingResult
}