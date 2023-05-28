import { CstNode, CstParser, CustomPatternMatcherReturn, IMultiModeLexerDefinition, IToken, Lexer, ParserMethod, createToken } from "chevrotain";
import { StringValue, BindExpressionValue, BindableString } from "../../types/html-data";


function regexGroup(regex: RegExp, groupNr: number) {
  if (!regex.sticky) {
    regex = new RegExp(regex.source, (regex.flags ?? '') + 'y')
  }
  return function regexGroupMatcher(text: string, offset: number, tokens: IToken[], groups: {[groupName: string]: IToken[]}): CustomPatternMatcherReturn {
    regex.lastIndex = offset;

    const regexResult = regex.exec(text);
    if (!regexResult) {
      return null;
    }
    
    const response = [regexResult[0]] as CustomPatternMatcherReturn;
    response.payload = regexResult[groupNr];
    return response;
  }
}

function getExpectedEndBind(previousTokens: IToken[]): string | null {
  let lastOpen: IToken;
  for (let i = previousTokens.length - 1; i >= 0; i--) {
    if (previousTokens[i].tokenType === tokens.startBinding) {
      lastOpen = previousTokens[i];
      break;
    }
  }
  if (!lastOpen) {
    return null;
  }

  return '}'.repeat(lastOpen.image.length);
}

function endBindingPattern(text: string, offset: number, previousTokens: IToken[], groups: {[groupName: string]: IToken[]}): CustomPatternMatcherReturn {
  const expected = getExpectedEndBind(previousTokens);
  if (!expected) {
    return null;
  }
  if (text.substring(offset, offset + expected.length) === expected) {
    return [expected];
  }
  return null;
}

function jsNoQuotesPattern(text: string, offset: number, previousTokens: IToken[], groups: {[groupName: string]: IToken[]}): RegExpExecArray {
  const expected = getExpectedEndBind(previousTokens);
  if (!expected) {
    return null;
  }
  const regex = new RegExp(/[^'"`]+?(?=(}}}?|"|'|`))/.source.replace('}}}', expected), 'sy');
  regex.lastIndex = offset;
  return regex.exec(text);
}

const tokens = {
  freeText: createToken({name: 'FreeText', pattern: /[^{].*?(?={{)/s, line_breaks: true}),
  remainingText: createToken({name: 'RemainingText', pattern: regexGroup(/(.+)/s, 1), line_breaks: true}),
  startBinding: createToken({name: 'StartBinding', pattern: /{{{?/, push_mode: 'bound'}),
  endBinding: createToken({name: 'EndBinding', pattern: endBindingPattern, pop_mode: true}),

  jsNoQuotes: createToken({name: 'JsNoQuotes', pattern: jsNoQuotesPattern, line_breaks: true}),
  jsSingleQuote: createToken({name: 'JsSingleQuote', pattern: /(?<!\\)(?:\\\\)*(?:''|'(.*?[^\\](?:\\\\)*)')/s, line_breaks: true, start_chars_hint: [`'`]}),
  jsDoubleQuote: createToken({name: 'JsDoubleQuote', pattern: /(?<!\\)(?:\\\\)*(?:""|"(.*?[^\\](?:\\\\)*)")/s, line_breaks: true, start_chars_hint: [`"`]}),

  jsStartBacktickQuote: createToken({name: 'JsStartBacktickQuote', pattern: /(?<!\\)(?:\\\\)*`/, push_mode: 'backtick'}),
  jsBacktickValue: createToken({name: 'JsBacktickValue', pattern: /[^`].*?(?=((?<!\\)(?:\\\\)*(?:`))|((?<!\\)(?:\\\\)*(?:\$)((?<!\\)(?:\\\\)*{)))/s, line_breaks: true}),
  jsEndBacktickQuote: createToken({name: 'JsEndBacktickQuote', pattern: /(?<!\\)(?:\\\\)*`/, pop_mode: true}),
  jsStartInterpolation: createToken({name: 'JsStartInterpolation', pattern: /(?<!\\)(?:\\\\)*\$(?<!\\)(?:\\\\)*{/, push_mode: 'interpolation'}),
  jsEndInterpolation: createToken({name: 'JsEndInterpolation', pattern: /(?<!\\)(?:\\\\)*}/, pop_mode: true}),
}

const lexerDef: IMultiModeLexerDefinition = {
  defaultMode: 'freeText',
  modes: {
    // Order matters, the first in the array will get matched first
    freeText: [
      tokens.freeText,
      tokens.startBinding,
      tokens.remainingText,
    ],
    bound: [
      tokens.endBinding,
      tokens.jsSingleQuote,
      tokens.jsDoubleQuote,
      tokens.jsNoQuotes,
      tokens.jsStartBacktickQuote,
    ],
    interpolation: [
      tokens.jsEndInterpolation,
      tokens.jsSingleQuote,
      tokens.jsDoubleQuote,
      tokens.jsNoQuotes,
    ],
    backtick: [
      tokens.jsStartInterpolation,
      tokens.jsEndBacktickQuote,
      tokens.jsBacktickValue,
    ],
  }
};

const BoundLexer = new Lexer(lexerDef)

export function parseBoundString(text: string): BindableString[] {
  const lexingResult = BoundLexer.tokenize(text)

  if (lexingResult.errors.length > 0) {
    console.error('parsed tokens', lexingResult.tokens.map(t => ({image: t.image, payload: t.payload, token: t.tokenType.name})));
    console.error('text', JSON.stringify(text));
    throw new Error("Lexing errors detected\n" + lexingResult.errors.map(e => JSON.stringify(e)).join('\n'))
  }
  
  // console.log('parsed tokens', lexingResult.tokens.map(t => ({image: t.image, payload: t.payload, token: t.tokenType.name})));
  const response: BindableString[] = []
  let bindMethod : BindExpressionValue['bindMethod'] = 'escaped';
  for (const token of lexingResult.tokens) {
    if (token.tokenType === tokens.startBinding || token.tokenType === tokens.endBinding) {
      bindMethod = token.image.length === 2 ? 'escaped' : 'raw';
      if (token.tokenType === tokens.startBinding) {
        response.push({type: 'bind', text: '', bindMethod});
      }
      continue;
    }
    if (lexerDef.modes.freeText.includes(token.tokenType)) {
      if (response[response.length - 1]?.type !== 'string') {
        response.push({type: 'string', text: ''});
      }
      response[response.length - 1].text += token.image;
      continue;
    }
    if (lexerDef.modes.bound.includes(token.tokenType) || lexerDef.modes.backtick.includes(token.tokenType) || lexerDef.modes.interpolation.includes(token.tokenType)) {
      if (response[response.length - 1]?.type !== 'bind') {
        response.push({type: 'bind', text: '', bindMethod});
      }
      response[response.length - 1].text += token.image;
      continue;
    }
    throw new Error('Internal compile error: missing how to parse token: ' + token.tokenType.name)
  };

  return response;
}