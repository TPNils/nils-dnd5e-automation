import * as gulp from 'gulp';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as chalk from 'chalk';
import * as archiver from 'archiver';
import * as stringify from 'json-stringify-pretty-compact';
import * as typescript from 'typescript';
import * as postcss from 'postcss';

import * as ts from 'gulp-typescript';
import * as less from 'gulp-less';
import * as sassCompiler from 'sass';
import * as gulpSass from 'gulp-sass';
import * as git from 'gulp-git';
import * as sourcemaps from 'gulp-sourcemaps';
import * as gulpFilter from 'gulp-filter';
import * as gulpUglify from 'gulp-uglify';
import * as minifyCss from 'gulp-clean-css';
import * as postCssMinify from 'postcss-minify';
import * as open from 'open';

import * as child_process from 'child_process';
import * as yargs from 'yargs';
import { CssSelectorParser, Rule } from 'css-selector-parser';
import { FoundryManifestJson, foundryManifest } from './foundry-manifest';
import { FoundryConfigJson, foundryConfig } from './foundry-config';
import { configJson } from './config';
import { buildMeta } from './build-meta';
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

const sass = gulpSass(sassCompiler);
const exec = child_process.exec;
const execPromise = (command) => {
  return new Promise((resolve, reject) => {
    child_process.exec(command, (err, stdout, stderr) => {
      if (err) {
        return reject(err);
      }
      if (stderr) {
        return reject(stderr);
      }
      return resolve(stdout);
    })
  });
}

class CssScoperPlugin {
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

class BuildActions {
  /**
   * Appends .js to import statements
   * @returns {typescript.TransformerFactory<typescript.SourceFile>}
   */
  static importTransformer() {
    /**
     * @param {typescript.Node} node
     * @returns {boolean}
     */
    function shouldMutateModuleSpecifier(node) {
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

    /**
     * Transforms import/export declarations to append `.js` extension
     * @param {typescript.TransformationContext} context
     */
    function importTransformer(context: typescript.TransformationContext) {
      return (node) => {
        function visitor(node: typescript.Node) {
          if (shouldMutateModuleSpecifier(node)) {
            if (typescript.isImportDeclaration(node)) {
              const nodeText: string = (node.moduleSpecifier as any).text;
              if (!nodeText.endsWith('.js')) {
                const newModuleSpecifier = typescript.factory.createStringLiteral(`${nodeText}.js`);
                return typescript.factory.updateImportDeclaration(
                  node,
                  node.decorators,
                  node.modifiers,
                  node.importClause,
                  newModuleSpecifier,
                  node.assertClause,
                );
              }
            } else if (typescript.isExportDeclaration(node)) {
              const nodeText: string = (node.moduleSpecifier as any).text;
              if (!nodeText.endsWith('.js')) {
                const newModuleSpecifier = typescript.factory.createStringLiteral(`${nodeText}.js`);
                return typescript.updateExportDeclaration(
                  node,
                  node.decorators,
                  node.modifiers,
                  node.exportClause,
                  newModuleSpecifier,
                  node.isTypeOnly,
                );
              }
            }
          }
          return typescript.visitEachChild(node, visitor, context);
        }

        return typescript.visitNode(node, visitor);
      };
    }

    return importTransformer;
  }

  // TODO add a html transformer?
  //  - Improve reading text templates
  //  - Parse html string with https://github.com/Chevrotain/chevrotain
  //  - Add param parsedHtml as javascript objects

  /**
   * Decent documentation: https://github.com/madou/typescript-transformer-handbook
   * Transform @Component style css at compile time since we can't make use of an external library at runtime
   * @returns {typescript.TransformerFactory<typescript.SourceFile>}
   */
  private static cssTransformer() {
    function transformCssProperty(prefix: string, property: typescript.PropertyAssignment): string | false {
      let init = property.initializer;
      let transformer = doCssTransform;
      if (typescript.isTaggedTemplateExpression(init)) {
        if (init.tag.getText() === 'scss') {
          transformer = doScssTransform;
          init = init.template;
        }
      }
      if (typescript.isStringLiteral(init)) {
        return transformer(prefix, init.text);
      } else if (typescript.isNoSubstitutionTemplateLiteral(init)) {
        return transformer(prefix, init.text);
      } else if (typescript.isTemplateExpression(init)) {
        throw Error(`Javascript string templates with variables are not supported in @Component styles`)
      }
      return false;
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

    /**
     * @param {typescript.Node} node 
     * @returns {node is typescript.ObjectLiteralExpression}
     */
    function isComponentObjectParam(node) {
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

    let cssId = 0;
    return function cssTransformer(context: typescript.TransformationContext) {
      
      /** @type {typescript.Visitor} */
      const visit = (node) => {
        if (isComponentObjectParam(node)) {
          const id = cssId++;
          const properties = [];
          properties.push(context.factory.createPropertyAssignment(
            'componentId',
            context.factory.createNumericLiteral(id),
          ));
          for (const property of node.properties) {
            switch (property.name?.escapedText) {
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
  }

  private static tsConfig: ts.Project;
  private static getTsConfig(): ts.Project {
    if (BuildActions.tsConfig == null) {
      BuildActions.tsConfig = ts.createProject('tsconfig.json', {
        getCustomTransformers: (_program) => ({
          before: [BuildActions.cssTransformer()],
          after: [BuildActions.importTransformer()],
        }),
      });
    }
    return BuildActions.tsConfig;
  }

  static createFolder(target: string) {
    return function createFolder(cb) {
      if (!fs.existsSync(target)) {
        fs.mkdirSync(target);
      }
      cb();
    }
  }

  /**
   * @param {string} target the destination directory
   */
  static createBuildTS(options: {inlineMapping?: boolean} = {}) {
    options.inlineMapping = options.inlineMapping ?? false;

    if (options.inlineMapping) {
      // When building locally, inject the mapping into the js file
      // Can't figure out how to get the mapping working well otherwise
      return function buildTS() {
        const manifest = foundryManifest.getManifest();
        return gulp.src(`${buildMeta.getSrcPath()}/**/*.ts`)
          .pipe(sourcemaps.init())
          .pipe(BuildActions.getTsConfig()())
          /*.pipe(minifyJs({
            ext: { min: '.js' },
            mangle: false,
            noSource: true,
            output: {
              source_map: false,
              comments: false,
            }
          }))*/
          .pipe(sourcemaps.mapSources(function(sourcePath, file) {
            const filePathParts = path.normalize(sourcePath).split(path.sep);
            return filePathParts[filePathParts.length - 1];
          }))
          .pipe(sourcemaps.write('./', {
            //includeContent: false,
            sourceMappingURL: (file) => {
              const filePathParts = file.relative.split(path.sep);
              return '/' + [(manifest.type === 'system' ? 'systems' : 'modules'), manifest.file.id, ...filePathParts].join('/') + '.map';
            }
          }))
          .pipe(gulp.dest(buildMeta.getDestPath()));
      }
    }
    return function buildTS() {
      const manifest = foundryManifest.getManifest();
      const urlPrefix = '/' + [(manifest.type === 'system' ? 'systems' : 'modules'), manifest.file.id].join('/');
      const jsFilter = gulpFilter((file) => file.basename.endsWith('.js'), {restore: true})
      const sourceMapConfig = {
        addComment: true,
        includeContent: false,
        sourceMappingURL: (file) => {
          const filePathParts = file.relative.split(path.sep);
          return '/' + [(manifest.type === 'system' ? 'systems' : 'modules'), manifest.file.id, ...filePathParts].join('/') + '.map';
        },
      };
      return gulp.src(`${buildMeta.getSrcPath()}/**/*.ts`)
        .pipe(sourcemaps.init())
        .pipe(BuildActions.getTsConfig()())
        .pipe(sourcemaps.mapSources(function(sourcePath, file) {
          const filePathParts = file.relative.split(path.sep);
          return '/' + [urlPrefix, ...filePathParts].join('/').replace(/\.js$/, '.ts');
        }))
        .pipe(jsFilter)  // only let JavaScript files through to be minified
        .pipe(gulpUglify({
          output: {
            comments: false,
          }
        }))
        .pipe(jsFilter.restore)
        .pipe(sourcemaps.write('./', sourceMapConfig))
        .pipe(gulp.dest(buildMeta.getDestPath()));
    }
  }

  static createBuildLess() {
    return function buildLess() {
      return gulp.src(`${buildMeta.getSrcPath()}/**/*.less`)
        .pipe(less())
        .pipe(minifyCss())
        .pipe(gulp.dest(buildMeta.getDestPath()));
    }
  }
  
  static createBuildSASS() {
    return function buildSASS() {
      return gulp
        .src(`${buildMeta.getSrcPath()}/**/*.scss`)
        .pipe(sass().on('error', sass.logError))
        .pipe(minifyCss())
        .pipe(gulp.dest(buildMeta.getDestPath()));
    }
  }

  /**
   * @returns {Array<{from: string[], to: string[], options?: any}>}
   */
  static getStaticCopyFiles() {
    return [
      {from: [buildMeta.getSrcPath(),'scripts'], to: ['scripts']}, // include ts files for source mappings
      {from: [buildMeta.getSrcPath(),'lang'], to: ['lang']},
      {from: [buildMeta.getSrcPath(),'fonts'], to: ['fonts']},
      {from: [buildMeta.getSrcPath(),'assets'], to: ['assets']},
      {from: [buildMeta.getSrcPath(),'templates'], to: ['templates']},
      {from: [buildMeta.getSrcPath(),'template.json'], to: ['template.json']},
    ]
  }
  
  /**
   * @param {Array<{from: string[], to: string[], options?: any}>} copyFilesArg How files should be copied
   */
  static createCopyFiles(copyFilesArg) {
    return async function copyFiles() {
      const promises: any[] = [];
      for (const file of copyFilesArg) {
        if (fs.existsSync(path.join(...file.from))) {
          if (file.options) {
            promises.push(fs.copy(path.join(...file.from), path.join(...file.to), file.options));
          } else {
            promises.push(fs.copy(path.join(...file.from), path.join(...file.to)));
          }
        }
      }
      return await Promise.all(promises);
    }
  }

  private static startFoundry() {
    if (!fs.existsSync('foundryconfig.json')) {
      console.warn('Could not start foundry: foundryconfig.json not found in project root');
      return;
    }
    const config = foundryConfig.getFoundryConfig('v8');
    if (!config.dataPath) {
      console.warn('Could not start foundry: foundryconfig.json is missing the property "dataPath"');
      return;
    }
    if (!config.foundryPath) {
      console.warn('Could not start foundry: foundryconfig.json is missing the property "foundryPath"');
      return;
    }
  
    const cmd = `node "${path.join(config.foundryPath, 'resources', 'app', 'main.js')}" --dataPath="${config.dataPath}"`;
    console.log('starting foundry: ', cmd)
    const childProcess = exec(cmd);

    let serverStarted = false;
    childProcess.stdout!.on('data', function (data) {
      process.stdout.write(data);
      if (!serverStarted) {
        const result = /Server started and listening on port ([0-9]+)/i.exec(data.toString());
        if (result) {
          open(`http://localhost:${result[1]}/game`)
        }
      }
    });
    
    childProcess.stderr!.on('data', function (data) {
      process.stderr.write(data);
    });
  }

  /**
   * Watch for changes for each build step
   */
  static createWatch() {
    let config: FoundryConfigJson;
    let manifest: FoundryManifestJson;
    let destPath: string;
    let copyFiles;
    let copyFilesFunc;
    
    return gulp.series(
      async function init() {
        config = foundryConfig.getFoundryConfig('v8');
        manifest = foundryManifest.getManifest();
        if (config?.dataPath == null) {
          throw new Error(`Missing "dataPath" in the file foundryconfig.json. This should point to the foundry data folder.`);
        }
        destPath = path.join(config.dataPath, 'Data', 'modules', manifest!.file.id);
        console.log(destPath)
        if (!fs.existsSync(destPath)) {
          fs.mkdirSync(destPath, {recursive: true});
        }
        buildMeta.setDestPath(destPath);
        copyFiles = [...BuildActions.getStaticCopyFiles(), {from: [buildMeta.getSrcPath(),'packs'], to: ['packs'], options: {override: false}}];
        for (let i = 0; i < copyFiles.length; i++) {
          copyFiles[i].to = [destPath, ...copyFiles[i].to];
        }
        copyFilesFunc = BuildActions.createCopyFiles(copyFiles);
      },
      async function initialSetup() {
        // Initial build
        //console.log(buildTS().eventNames())
        // finish, close, end
        console.log('1');
        await BuildActions.createClean()();
        console.log('2');
        await Promise.all([
          new Promise<void>((resolve) => BuildActions.createBuildTS({inlineMapping: true})().once('end', () => resolve())),
          new Promise<void>((resolve) => BuildActions.createBuildLess()().once('end', () => resolve())),
          new Promise<void>((resolve) => BuildActions.createBuildSASS()().once('end', () => resolve())),
          copyFilesFunc(),
        ]);
        console.log('3');
        // Only build manifest once all hbs & css files are generated
        await foundryManifest.createBuildManifest()();
        console.log('4');
  
        // Only start foundry when the manifest is build
        BuildActions.startFoundry();
        console.log('5');
      },
      function watch() {
        // Do not watch to build the manifest since it only gets loaded on server start
        gulp.watch('src/**/*.ts', { ignoreInitial: true }, BuildActions.createBuildTS({inlineMapping: true}));
        gulp.watch('src/**/*.less', { ignoreInitial: true }, BuildActions.createBuildLess());
        gulp.watch('src/**/*.scss', { ignoreInitial: true }, BuildActions.createBuildSASS());
        gulp.watch(
          [...copyFiles.map(file => path.join(...file.from)), 'src/*.json'],
          { ignoreInitial: true },
          copyFilesFunc
        )
      }
    );
  }

  /**
   * Delete every file and folder within the target
   */
  static createClean() {
    return async function clean() {
      const promises: any[] = [];
      for (const file of await fs.readdir(buildMeta.getDestPath())) {
        promises.push(fs.rm(path.join(buildMeta.getDestPath(), file), {recursive: true}));
      }
      return Promise.all(promises).then();
    }
  }

  /**
   * Package the module into a zip
   * @param {string} inputDir the directory which should be zipped
   */
  static createBuildPackage(inputDir: string) {
    return async function buildPackage() {
      const manifest = foundryManifest.getManifest();
      inputDir = path.normalize(inputDir);
      if (!inputDir.endsWith(path.sep)) {
        inputDir += path.sep;
      }
    
      return new Promise<void>((resolve, reject) => {
        try {
          // Ensure there is a directory to hold all the packaged versions
          fs.ensureDirSync('package');
    
          // Initialize the zip file
          const zipName = `module.zip`;
          const zipFile = fs.createWriteStream(path.join('package', zipName));
          const zip = archiver('zip', { zlib: { level: 9 } });
    
          zipFile.on('close', () => {
            console.log(chalk.green(zip.pointer() + ' total bytes'));
            console.log(
              chalk.green(`Zip file ${zipName} has been written`)
            );
            return resolve();
          });
    
          zip.on('error', (err) => {
            throw err;
          });
    
          zip.pipe(zipFile);
    
          // Add the directory with the final code
          zip.directory(inputDir, manifest.file.id);
    
          zip.finalize();
        } catch (err) {
          return reject(err);
        }
      });
    }
  }

  /**
   * Copy packs from foundry to source
   */
  static createUpdateSrcPacks() {
    return async function updateSrcPacks() {
      const config = foundryConfig.getFoundryConfig('v8');
      if (!config.dataPath) {
        console.warn('Could not start foundry: foundryconfig.json is missing the property "dataPath"');
      }
      const manifest = foundryManifest.getManifest();
      const srcPath = [buildMeta.getSrcPath(),'packs'];
      await BuildActions.createCopyFiles([{from: [config.dataPath, 'Data', 'modules', manifest.file.id, 'packs'], to: srcPath}])();
      for (const fileName of fs.readdirSync(path.join(...srcPath))) {
        const lines = fs.readFileSync(path.join(...srcPath, fileName), {encoding: 'UTF-8'}).split('\n');
        const filteredLines: any[] = [];
        const foundIds = new Set();
        for (let i = lines.length - 1; i >= 0; i--) {
          if (!lines[i]) {
            continue;
          }
          const line = JSON.parse(lines[i]);
          if (foundIds.has(line._id)) {
            continue;
          }
          foundIds.add(line._id);
          filteredLines.unshift(lines[i]);
        }
        fs.writeFileSync(path.join(...srcPath, fileName), filteredLines.join('\n'), {encoding: 'UTF-8'});
      }
    }
  }

}

class Args {
  /** @type {{u?: string; update?: string;}} */
  private static args = yargs.argv;
 
  /**
   * @param {string} currentVersion
   * @returns {string} version name
   */
  static getVersion(currentVersion, allowNoVersion = false): string | null {
    if (currentVersion == null || currentVersion == '') {
      currentVersion = '0.0.0';
    }
    const version = Args.args.update || Args.args.u;
    if (!version) {
      if (allowNoVersion) {
        return null;
      }
      throw new Error('Missing version number. Use -u <version> (or --update) to specify a version.');
    }
  
    const versionMatch = /^v?(\d{1,}).(\d{1,}).(\d{1,})(-.+)?$/;
    let targetVersion = null;
  
    if (versionMatch.test(version)) {
      targetVersion = version;
    } else {
      targetVersion = currentVersion.replace(
        versionMatch,
        (substring, major, minor, patch, addon) => {
          let target: string | null = null;
          if (version.toLowerCase() === 'major') {
            target = `${Number(major) + 1}.0.0`;
          } else if (version.toLowerCase() === 'minor') {
            target = `${major}.${Number(minor) + 1}.0`;
          } else if (version.toLowerCase() === 'patch') {
            target = `${major}.${minor}.${Number(patch) + 1}`;
          }
  
          if (addon) {
            target += addon;
          }
  
          return target;
        }
      );
    }
  
    if (targetVersion == null) {
      throw new Error(chalk.red('Error: Incorrect version arguments. Accepts the following:\n- major\n- minor\n- patch\n- the following patterns: 1.0.0 | 1.0.0-beta'));
    }
    return targetVersion;
  }

  /**
   * @param {string} version
   * @returns {{major: number, minor: number, patch: number, addon?: string}}
   */
  static parseVersion(version) {
    if (version == null) {
      return null;
    }
    const versionMatch = /^v?(\d{1,}).(\d{1,}).(\d{1,})(-.+)?$/;
    const exec = versionMatch.exec(version);
    if (exec) {
      return {
        major: Number(exec[1]),
        minor: Number(exec[2]),
        patch: Number(exec[3]),
        addon: exec[4],
      }
    }

    return null;
  }

  static createVersionValdiation() {
    return function versionValdiation(cb) {
      const currentVersionString = foundryManifest.getManifest().file.version;
      const currentVersion = Args.parseVersion(currentVersionString);
      if (!currentVersion) {
        cb();
        return;
      }
      const newVersionString = Args.getVersion(currentVersionString, false);
      const newVersion = Args.parseVersion(newVersionString)!;

      if (currentVersion.major < newVersion.major) {
        cb();
        return;
      } else if (currentVersion.major > newVersion.major) {
        cb(new Error(`New version is not higher. old: ${currentVersionString} | new: ${newVersionString}`));
        return;
      }
      if (currentVersion.minor < newVersion.minor) {
        cb();
        return;
      } else if (currentVersion.minor > newVersion.minor) {
        cb(new Error(`New version is not higher. old: ${currentVersionString} | new: ${newVersionString}`));
        return;
      }
      if (currentVersion.patch < newVersion.patch) {
        cb();
        return;
      } else if (currentVersion.patch > newVersion.patch) {
        cb(new Error(`New version is not higher. old: ${currentVersionString} | new: ${newVersionString}`));
        return;
      }
      
      cb(new Error(`New version is not higher. old: ${currentVersionString} | new: ${newVersionString}`));
    }
  }
}

class Git {

  static createUpdateManifestForGithub({source, externalManifest}: {source: boolean, externalManifest: boolean}) {
    return async function updateManifestForGithub() {
      const packageJson = fs.readJSONSync('package.json');
      const config = configJson.getConfig();
      const manifest = foundryManifest.getManifest();

      if (!config) {
        throw new Error(chalk.red('foundryconfig.json not found in the ./ (root) folder'));
      }
      if (!manifest) {
        throw new Error(chalk.red('Manifest JSON not found in the ./src folder'));
      }
      if (!config.githubRepository) {
        throw new Error(chalk.red('Missing "githubRepository" property in ./config.json. Expected format: <githubUsername>/<githubRepo>'));
      }

      const currentVersion = manifest.file.version;
      let targetVersion = Args.getVersion(currentVersion, true);
      if (targetVersion == null) {
        targetVersion = currentVersion;
      }

      if (targetVersion.startsWith('v')) {
        targetVersion = targetVersion.substring(1);
      }

      console.log(`Updating version number to '${targetVersion}'`);

      packageJson.version = targetVersion;

      manifest.file.version = targetVersion;
      manifest.file.url = `https://github.com/${config.githubRepository}`;
      // When foundry checks if there is an update, it will fetch the manifest present in the zip, for us it points to the latest one.
      // The external one should point to itself so you can download a specific version
      // The zipped one should point to the latest manifest so when the "check for update" is executed it will fetch the latest
      if (externalManifest) {
        // Seperate file uploaded for github
        manifest.file.manifest = `https://github.com/${config.githubRepository}/releases/download/v${targetVersion}/module.json`;
      } else {
        // The manifest which is within the module zip
        manifest.file.manifest = `https://github.com/${config.githubRepository}/releases/download/latest/module.json`;
      }
      manifest.file.download = `https://github.com/${config.githubRepository}/releases/download/v${targetVersion}/module.zip`;

      fs.writeFileSync(
        'package.json',
        stringify(packageJson, {indent: '  '}),
        'utf8'
      );
      await foundryManifest.saveManifest({overrideManifest: manifest.file, source: source});
    }
  }

  static validateCleanRepo(cb) {
    return git.status({args: '--porcelain'}, (err, stdout) => {
      if (typeof stdout === 'string' && stdout.length > 0) {
        err = new Error("You must first commit your pending changes");
      }
      if (err) {
        cb(Error(err));
        throw Error(err);
      }
      cb();
    });
  }

  static gitCommit() {
    let newVersion = 'v' + foundryManifest.getManifest().file.version;
    return gulp.src('.').pipe(git.commit(`Updated to ${newVersion}`));
  }

  static async gitDeleteTag() {
    let version = 'v' + foundryManifest.getManifest().file.version;
    // Ignore errors
    try {
      await execPromise(`git tag -d ${version}`);
    } catch {}
    try {
      await execPromise(`git push --delete origin ${version}`);
    } catch {}
  }

  static async gitTag() {
    let version = 'v' + foundryManifest.getManifest().file.version;
    await execPromise(`git tag -a ${version} -m "Updated to ${version}"`);
  }

  static gitPush(cb) {
    git.push('origin', (err) => {
      if (err) {
        cb(err);
        throw err;
      }
      cb();
    });
  }

  static async gitPushTag() {
    let version = 'v' + foundryManifest.getManifest().file.version;
    try {
      await execPromise(`git push origin ${version}`);
    } catch (e) {
      console.log('git push tag error', e)
    }
  }

  static async gitMoveTag() {
    let currentVersion = 'v' + foundryManifest.getManifest().file.version;
    try {
      await execPromise(`git tag -d ${currentVersion}`);
    } catch {}
    try {
      await execPromise(`git push --delete origin ${currentVersion}`);
    } catch {}
    await Git.gitTag();
    await Git.gitPushTag();
  }

}


export const build = gulp.series(
  BuildActions.createFolder(buildMeta.getDestPath()),
  BuildActions.createClean(),
  gulp.parallel(
    BuildActions.createBuildTS({inlineMapping: false}),
    BuildActions.createBuildLess(),
    BuildActions.createBuildSASS(),
    BuildActions.createCopyFiles([
     {from: [buildMeta.getSrcPath(),'packs'], to: [buildMeta.getDestPath(),'packs']},
      ...BuildActions.getStaticCopyFiles().map(copy => {
        copy.to = [buildMeta.getDestPath(), ...copy.to];
        return copy;
      }),
    ])
  ),
  foundryManifest.createBuildManifest(),
);
export const updateSrcPacks = gulp.series(BuildActions.createUpdateSrcPacks());
export const watch = BuildActions.createWatch();
export const buildZip = gulp.series(
  build,
  BuildActions.createBuildPackage(buildMeta.getDestPath())
);
export const test = Args.createVersionValdiation();
export const rePublish = Git.gitMoveTag;
export const updateZipManifestForGithub = Git.createUpdateManifestForGithub({source: false, externalManifest: false});
export const updateExternalManifestForGithub = Git.createUpdateManifestForGithub({source: false, externalManifest: true});
export const publish = gulp.series(
  Args.createVersionValdiation(),
  Git.validateCleanRepo,
  Git.createUpdateManifestForGithub({source: true, externalManifest: false}),
  Git.gitCommit, 
  Git.gitTag,
  Git.gitPush,
  Git.gitPushTag
);
export const reupload = gulp.series(
  Git.gitDeleteTag,
  Git.gitTag,
  Git.gitPushTag
);