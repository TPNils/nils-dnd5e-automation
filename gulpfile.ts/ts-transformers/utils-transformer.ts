import { resolve, sep } from 'path';
import * as typescript from 'typescript';

const validProperty = /$[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*/u
/**
 * https://ts-ast-viewer.com/
 */
export class UtilsTransformer {

  private static parsedSourceFiles = new Map<string, typescript.SourceFile>();

  public static beforeCompilerHook: typescript.TransformerFactory<typescript.SourceFile> = (context) => {
    return (node: typescript.SourceFile) => {
      UtilsTransformer.parsedSourceFiles.set(node.fileName.split('/').join(sep), node);
      return node;
    }
  }

  public static valueToExpression(value: any, factory: typescript.NodeFactory = typescript.factory): typescript.Expression | null {
    switch (typeof value) {
      case 'bigint': {
        return factory.createBigIntLiteral(String(value));
      }
      case 'boolean': {
        return value === true ? factory.createTrue() : factory.createFalse()
      }
      case 'function': {
        throw new Error('functions not supported at this time')
      }
      case 'number': {
        return factory.createNumericLiteral(value);
      }
      case 'object': {
        if (value == null) {
          return factory.createNull();
        }
        if (Array.isArray(value)) {
          return factory.createArrayLiteralExpression(value.map(v => UtilsTransformer.valueToExpression(v)));
        }

        const props: typescript.PropertyAssignment[] = [];
        for (const prop of Object.keys(value)) {
          const expr = UtilsTransformer.valueToExpression(value[prop], factory);
          if (expr) {
            props.push(factory.createPropertyAssignment(validProperty.exec(prop) ? prop : factory.createStringLiteral(prop, true), expr));
          }
        }
        return factory.createObjectLiteralExpression(props);
      }
      case 'string': {
        return factory.createStringLiteral(value, true);
      }
      case 'symbol': {
        // skip
        return null;
      }
      case 'undefined': {
        // Can't figure it out :/
        return null;
      }
    }
  }

  public static valueFromExpression(value: typescript.Expression): any | null {
    if (typescript.isStringLiteralLike(value)) {
      return value.text;
    }
    if (typescript.isNumericLiteral(value)) {
      return Number(value.text);
    }
    if (value.kind === typescript.SyntaxKind.TrueKeyword) {
      return true;
    }
    if (value.kind === typescript.SyntaxKind.FalseKeyword) {
      return false;
    }
    if (typescript.isObjectLiteralExpression(value)) {
      const obj: any = {};
      for (const prop of value.properties) {
        const key = UtilsTransformer.getName(prop.name);

        // ShorthandPropertyAssignment | SpreadAssignment | MethodDeclaration | AccessorDeclaration
        if (typescript.isPropertyAssignment(prop)) {
          obj[key] = UtilsTransformer.valueFromExpression(prop.initializer);
        } else {
          console.warn('could not read property name', prop.name, value)
        }
      }
      return obj;
    }
    if (typescript.isTemplateExpression(value)) {
      const templateParts = [value.head.text];
      for (const span of value.templateSpans) {
        templateParts.push(String(UtilsTransformer.valueFromExpression(span.expression)))
        templateParts.push(span.literal.text);
      }
      return templateParts.join('');
    }
    if (typescript.isPropertyAccessExpression(value)) {
      // https://stackoverflow.com/questions/3709866/whats-a-valid-left-hand-side-expression-in-javascript-grammar
      if (!typescript.isIdentifier(value.expression)) {
        throw new Error(`Can only parse simple expressions. The following is to complex: ${value.getFullText()}`);
      }
      const propName = typescript.idText(value.name);
      
      const instance = UtilsTransformer.valueFromExpression(value.expression);
      return instance?.[propName];
    }
    if (typescript.isExpressionStatement(value)) {
      return UtilsTransformer.valueFromExpression(value.expression);
    }
    if (typescript.isBinaryExpression(value)) {
      const right = UtilsTransformer.valueFromExpression(value.right);
      if (value.operatorToken.kind === typescript.SyntaxKind.EqualsToken) {
        return right;
      }
      const left = UtilsTransformer.valueFromExpression(value.left);
      return Function('left', 'right', `return left ${value.operatorToken.getText()} right;`)(left, right);
    }
    if (typescript.isIdentifier(value) || typescript.isPrivateIdentifier(value)) {
      const instanceName = value.getText();
      let ancestor: typescript.Node = value;

      while (ancestor) {
        if (typescript.isSourceFile(ancestor) || typescript.isBlock(ancestor) || typescript.isCaseClause(ancestor) || typescript.isDefaultClause(ancestor) || typescript.isModuleBlock(ancestor)) {
          for (const statement of ancestor.statements) {
            if (typescript.isImportDeclaration(statement)) {
              if (statement.importClause?.namedBindings) {
                if (typescript.isNamedImports(statement.importClause.namedBindings)) {
                  for (const element of statement.importClause.namedBindings.elements) {
                    if (typescript.idText(element.name) === instanceName) {
                      const specifier: string = UtilsTransformer.valueFromExpression(statement.moduleSpecifier);
                      const filePath = resolve(value.getSourceFile().fileName, '../'/*Go up to the directory*/ + specifier)
                      
                      let sourceFile = UtilsTransformer.parsedSourceFiles.get(filePath);
                      if (!sourceFile) {
                        sourceFile = UtilsTransformer.parsedSourceFiles.get(filePath + '.ts');
                      }
                      if (!sourceFile) {
                        sourceFile = UtilsTransformer.parsedSourceFiles.get(filePath + '/index.ts');
                      }
                      if (!sourceFile) {
                        sourceFile = UtilsTransformer.parsedSourceFiles.get(filePath + '.js');
                      }
                      if (!sourceFile) {
                        sourceFile = UtilsTransformer.parsedSourceFiles.get(filePath + '/index.js');
                      }
                      if (!sourceFile) {
                        throw new Error(`Could not find the source file of ${filePath} (from: ${value.getSourceFile().fileName})`)
                      }
                      return UtilsTransformer.valueFromExpression(UtilsTransformer.getExport(instanceName, sourceFile));
                    }
                  }
                } else {
                  // TODO not quite sure what this syntax is
                }
              }
            }
            if (typescript.isVariableStatement(statement)) {
              for (const declaration of statement.declarationList.declarations) {
                if (typescript.isIdentifier(declaration.name)) {
                  if (typescript.idText(declaration.name) === instanceName) {
                    return UtilsTransformer.valueFromExpression(declaration.initializer);
                  }
                } else {
                  // TODO
                }
              }
            }
          }
        }
        ancestor = ancestor.parent;
      }
    }

    throw new Error(`Can't parse expression. ${UtilsTransformer.nodeToString(value)}`)
  }

  private static getName(value: typescript.PropertyName): any | null {
    if (typescript.isIdentifier(value)) {
      return value.text;
    }
    if (typescript.isStringLiteralLike(value)) {
      return UtilsTransformer.valueFromExpression(value);
    }
    if (typescript.isNumericLiteral(value)) {
      return UtilsTransformer.valueFromExpression(value);
    }

    throw new Error(`Can't find the name of expression. ${UtilsTransformer.nodeToString(value)}`)
  }

  private static getExport(name: string, file: typescript.SourceFile): typescript.Identifier {
    for (const statement of file.statements) {
      if (typescript.isExportDeclaration(statement)) {
        if (typescript.isNamedExports(statement.exportClause)) {
          for (const elem of statement.exportClause.elements) {
            if (UtilsTransformer.getName(elem.name) === name) {
              return elem.name;
            }
          }
        }
      }
      if (typescript.isExportAssignment(statement)) {
        // TODO
      }
    }

    throw new Error(`Can't find an export with the name ${name} in file ${file.fileName}`)
  }

  private static nodeToString(node: typescript.Node): string {
    let kindName = '';
    for (const [key, kind] of Object.entries(typescript.SyntaxKind)) {
      if (node.kind === kind) {
        kindName = key;
        break;
      }
    }
    return `Kind: ${node.kind}/${kindName}. Value: ${node.getFullText()}. Start: ${node.getStart()}. File: ${node.getSourceFile().fileName}`
  }

}