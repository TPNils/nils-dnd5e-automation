import * as typescript from 'typescript';
import * as postcss from 'postcss';

import * as sassCompiler from 'sass';
import * as postCssMinify from 'postcss-minify';
import { CssSelectorParser, Rule } from 'css-selector-parser';
import { parseHtml } from '../chevrotain/html-parser';
import { UtilsTransformer } from './utils-transformer';


const cssParser = new CssSelectorParser();
cssParser.registerSelectorPseudos(
  'host-context', 'deep',
  'dir', 'lang',
  'is', 'not', 'where', 'has'
);
cssParser.registerNumericPseudos('nth-child', 'nth-last-child', 'first-child', 'last-child', 'nth-of-type', 'nth-last-of-type');
cssParser.registerNestingOperators('>', '+', '~');
cssParser.registerAttrEqualityMods('^', '$', '*', '~');
cssParser.enableSubstitutes();

class CssScoperPlugin  {
  private static isProcessed = Symbol('isProcessed');
  public postcssPlugin = 'prefix-scope';

  constructor(private hostAttr: string, private itemAttr: string) {
  }

  RuleExit = (rule, helpers) => {
    if (rule[CssScoperPlugin.isProcessed] === true) {
      return;
    }
    const rootParsedRules = cssParser.parse(rule.selector);
    let pendingRules = rootParsedRules.type === 'selectors' ? rootParsedRules.selectors : [rootParsedRules];
    for (const rootRule of pendingRules) {
      let rules: Array<Partial<Rule>> = [rootRule.rule];
      while (rules[rules.length - 1].rule) {
        rules.push(rules[rules.length - 1].rule!);
      }
      
      for (const rule of rules) {
        rule.attrs = rule.attrs == null ? [] : rule.attrs;
      }
      
      // Inject :host if the first attr is :deep
      if (rules[0].pseudos && rules[0].pseudos[0].name === 'deep') {
        rules.unshift({type: 'rule', attrs: [{name: this.hostAttr}]});
      }

      // replace :host selector
      for (const rule of rules) {
        if (rule.pseudos) {
          let deletePseudoIndexes = [];
          for (let i = 0; i < rule.pseudos.length; i++) {
            const pseudo = rule.pseudos[i];
            if (pseudo.name === 'host') {
              deletePseudoIndexes.push(i);
              rule.attrs!.unshift({name: this.hostAttr});
            }
          }
          for (let i = deletePseudoIndexes.length - 1; i >= 0; i--) {
            rule.pseudos.splice(i, 1);
          }
        }
      }

      // Inject item attributes
      rules: for (const rule of rules) {
        let shouldAddItemAttr = true;
        for (const attr of rule.attrs!) {
          if ((attr.name === this.hostAttr || attr.name === this.itemAttr) && (attr as any).operator == null && (attr as any).value == null) {
            shouldAddItemAttr = false;
            break;
          }
        }
        if (shouldAddItemAttr && rule.pseudos) {
          for (const pseudo of rule.pseudos) {
            if (pseudo.name === 'host-context') {
              shouldAddItemAttr = false;
              break;
            }
            if (pseudo.name === 'deep') {
              // Once you encounter :deep, do not inject any more attributes
              if (rule.pseudos.length > 1 || rule.attrs?.length > 0 || rule.classNames?.length > 0 || rule.tagName != null) {
                throw new Error(`:deep can't be combined with other css rules. Found: ${cssParser.render({type: 'ruleSet', rule: rule as Rule})}`);
              }

              // :deep selector only exists virtually => remove it
              rule.pseudos = rule.pseudos.filter(p => p !== pseudo);
              break rules;
            }
          }
        }
        if (shouldAddItemAttr) {
          rule.attrs!.unshift({name: this.itemAttr});
        }
      }
      
      // replace :host-context() selector
      {
        let adjustedRules: Partial<Rule>[] = [];
        for (let i = 0; i < rules.length; i++) {
          const rule = rules[i];
          if (!rule.pseudos || rule.pseudos.length === 0) {
            adjustedRules.push(rule); // Don't change
            continue;
          }
          const hostContextPseudo = rule.pseudos.find(pseudo => pseudo.name === 'host-context');
          if (!hostContextPseudo) {
            adjustedRules.push(rule); // Don't change
            continue;
          }
          
          if (rule.pseudos.length > 1 || rule.attrs?.length > 0 || rule.classNames?.length > 0 || rule.tagName != null || typeof hostContextPseudo.value === 'string') {
            throw new Error(`:host-context() can't be combined with other css rules. Found: ${cssParser.render({type: 'ruleSet', rule: rule as Rule})}`);
          }

          if (hostContextPseudo.value.type !== 'ruleSet') {
            throw new Error(`:host-context() currently only supports ruleSet: ${cssParser.render({type: 'ruleSet', rule: rule as Rule})}`);
          }
          
          const replaceRules = [{
            ...hostContextPseudo.value.rule,
            nestingOperator: null,
          }];
          while (replaceRules[replaceRules.length - 1].rule) {
            replaceRules.push({
              ...replaceRules[replaceRules.length - 1].rule,
              nestingOperator: null,
            });
          }
          adjustedRules.push(...replaceRules);
        }
        rules = adjustedRules;
      }
      
      // Write the order of the rules the way cssParser expects
      for (let i = 0; i < rules.length - 1; i++) {
        rules[i].rule = rules[i+1] as Rule;
        delete rules[i+1].rule;
      }
      rootRule.rule = rules[0] as Rule;
    }
    const newSelectors = cssParser.render(rootParsedRules);
    rule[CssScoperPlugin.isProcessed] = true;
    if (rule.selector !== newSelectors) {
      rule.selector = newSelectors;
    }
  }
}

let cssId = 0;
function transformCssProperty(prefix: string, property: typescript.PropertyAssignment): string | false {
  let init = property.initializer;
  let transformer = doCssTransform;
  if (typescript.isTaggedTemplateExpression(init)) {
    if (init.tag.getText() === 'scss') {
      transformer = doScssTransform;
      init = init.template;
    }
  }
  const text = UtilsTransformer.valueFromExpression(init);
  if (text == null) {
    return false;
  }
  if (typeof text !== 'string') {
    throw new Error(`expected a string for css. found ${typeof text} ${text}`)
  }
  return transformer(prefix, text);
}

function doCssTransform(prefix: string, css: string): string {
  const hostAttr = `nd5a-hid-${prefix}`;
  const itemAttr = `nd5a-cid-${prefix}`;

  const rootCss = postcss(new CssScoperPlugin(hostAttr, itemAttr), postCssMinify()).process(css);
  
  return rootCss.toString()
}

function doScssTransform(prefix: string, scss: string): string {
  return doCssTransform(prefix, sassCompiler.compileString(scss).css)
}

function isComponentObjectParam(node: typescript.Node): node is typescript.ObjectLiteralExpression {
  if (!typescript.isObjectLiteralExpression(node)) {
    return false;
  }
  const decorator = node.parent.parent;
  if (!typescript.isDecorator(decorator) || !typescript.isCallExpression(decorator.expression) || !typescript.isIdentifier(decorator.expression.expression)) {
    return false;
  }
  if (decorator.expression.expression.escapedText !== 'Component' || decorator.expression.arguments.length !== 1) {
    return false;
  }
  const classDecl = decorator.parent;
  if (!typescript.isClassDeclaration(classDecl)) {
    return false;
  }

  return true;
}

/**
 * Decent documentation: https://github.com/madou/typescript-transformer-handbook
 * Transform @Component style css at compile time since we can't make use of an external library at runtime
 */
export const componentTransformer: typescript.TransformerFactory<typescript.SourceFile> = context => {
  const visit: typescript.Visitor = (node) => {
    if (isComponentObjectParam(node)) {
      const id = cssId++;
      const properties = [];
      properties.push(context.factory.createPropertyAssignment(
        'componentId',
        context.factory.createNumericLiteral(id),
      ));
      for (const property of node.properties) {
        if (!typescript.isPropertyAssignment(property)) {
          continue;
        }
        switch (property.name.getText()) {
          case 'html': {
            let html = UtilsTransformer.valueFromExpression(property.initializer);
            if (html == null) {
              properties.push(property);
              break;
            }
            if (typeof html !== 'string') {
              throw new Error('Expected html to be a string: ' + html)
            }
            const parsedHtml = parseHtml(html);
            properties.push(typescript.factory.createPropertyAssignment(property.name, UtilsTransformer.valueToExpression(parsedHtml)));
            break;
          }
          case 'style':
            const changed = transformCssProperty(String(id), property);
            if (changed !== false) {
              properties.push(context.factory.createPropertyAssignment(
                property.name,
                context.factory.createNoSubstitutionTemplateLiteral(changed),
              ));
              break;
            } else {
              // fallthrough
            }
          case 'componentId': {
            // omit => Will be supplied by this compiler
            break;
          }
          default:
            properties.push(property);
            break;
        }
      }
      // console.log('set', properties)
      return context.factory.updateObjectLiteralExpression(
        node,
        properties
      );
    }
    return typescript.visitEachChild(node, (child) => visit(child), context);
  };

  return (node) => typescript.visitNode(node, visit);
}