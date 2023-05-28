import * as path from 'path';
import * as typescript from 'typescript';

function shouldMutateModuleSpecifier(node: typescript.Node): boolean {
  if (!typescript.isImportDeclaration(node) && !typescript.isExportDeclaration(node)) {
    return false;
  }
  if (node.moduleSpecifier === undefined || !typescript.isStringLiteral(node.moduleSpecifier)) {
    return false;
  }
  if (!node.moduleSpecifier.text.startsWith('./') && !node.moduleSpecifier.text.startsWith('../')) {
    return false;
  }
  if (node.moduleSpecifier.text.endsWith('.js')) {
    return false;
  }
  if (path.extname(node.moduleSpecifier.text) !== '') {
    return false;
  }
  return true;
}

export const importTransformer: typescript.TransformerFactory<typescript.SourceFile> = (context) => {
  return (node) => {
    function visitor(node: typescript.Node) {
      if (shouldMutateModuleSpecifier(node)) {
        if (typescript.isImportDeclaration(node)) {
          const nodeText: string = (node.moduleSpecifier as any).text;
          const newModuleSpecifier = typescript.factory.createStringLiteral(`${nodeText}.js`);
          return typescript.factory.updateImportDeclaration(
            node,
            node.modifiers,
            node.importClause,
            newModuleSpecifier,
            node.assertClause,
          );
        } else if (typescript.isExportDeclaration(node)) {
          const nodeText: string = (node.moduleSpecifier as any).text;
          const newModuleSpecifier = typescript.factory.createStringLiteral(`${nodeText}.js`);
          return typescript.factory.updateExportDeclaration(
            node,
            node.modifiers,
            node.isTypeOnly,
            node.exportClause,
            newModuleSpecifier,
            node.assertClause,
          );
        }
      }
      return typescript.visitEachChild(node, visitor, context);
    }

    return typescript.visitNode(node, visitor);
  };
}