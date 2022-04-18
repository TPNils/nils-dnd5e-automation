/**
 * Based on https://gitlab.com/tposney/midi-qol/-/blob/master/gulpfile.js
 */

import glob from 'glob';
import gulp from 'gulp';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import archiver from 'archiver';
import stringify from 'json-stringify-pretty-compact';
import typescript from 'typescript';

import ts from 'gulp-typescript';
import less from 'gulp-less';
import sassCompiler from 'sass';
import gulpSass from 'gulp-sass';
import git from 'gulp-git';
import sourcemaps from 'gulp-sourcemaps';
import minifyJs from 'gulp-minify';
import minifyCss from 'gulp-clean-css';

import child_process from 'child_process';
import yargs from 'yargs';

const sass = gulpSass(sassCompiler);
const exec = child_process.exec;

class Meta {

  /**
  * @returns {{
  *   dataPath: string,
  *   foundryPath: string,
  *   githubRepository: string
  * }}
  */
  static getConfig() {
    const configPath = path.resolve(process.cwd(), 'foundryconfig.json');
    let config;
  
    if (fs.existsSync(configPath)) {
      config = fs.readJSONSync(configPath);
      if (config.dataPath) {
        { // Validate correct path
          const files = fs.readdirSync(config.dataPath);
          if (!files.includes('Data') || !files.includes('Config') || !files.includes('Logs')) {
            throw new Error('dataPath in foundryconfig.json is not recognised as a foundry folder. The folder should include 3 other folders: Data, Config & Logs');
          }
        }
      }
      return config;
    } else {
      return;
    }
  }
  
  /**
   * @param {'src' | 'dist'} type
   * @returns {{
   *   file: any,
   *   name: string,
   *   root: string
   * }}
   */
  static getManifest(type = 'src') {
    const json = {};
    json.root = type;
  
    const modulePath = path.join(json.root, 'module.json');
    const systemPath = path.join(json.root, 'system.json');
  
    if (fs.existsSync(modulePath)) {
      json.file = fs.readJSONSync(modulePath);
      json.name = 'module.json';
    } else if (fs.existsSync(systemPath)) {
      json.file = fs.readJSONSync(systemPath);
      json.name = 'system.json';
    } else {
      return;
    }
  
    return json;
  }

  /**
   * @param {string} dest
   * @returns {Promise<void>}
   */
  static createBuildManifest(dest) {
    dest = path.normalize(dest);
    return async function buildManifest() {
      const manifest = Meta.getManifest();
  
      /** @type {Promise<string[]>[]} */
      const filePromises = [];
      filePromises.push(new Promise((resolve, reject) => {
        glob(path.join(dest, '**/*.css'), (err, matches) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(matches);
        })
      }));
      filePromises.push(new Promise((resolve, reject) => {
        glob(path.join(dest, '**/*.hbs'), (err, matches) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(matches);
        })
      }));
    
      const fileNameCollection = await Promise.all(filePromises)
      /** @type {Set<string>} */
      const cssFiles = new Set();
      /** @type {Set<string>} */
      const hbsFiles = new Set();
      for (const fileNames of fileNameCollection) {
        for (let fileName of fileNames) {
          fileName = path.normalize(fileName);
          if (fileName.startsWith('src' + path.delimiter)) {
            fileName = fileName.substring(('src' + path.delimiter).length)
          } else if (fileName.startsWith(dest)) {
            fileName = fileName.substring(dest.length)
          }
          if (fileName.toLowerCase().endsWith('.css')) {
            cssFiles.add(fileName);
          } else if (fileName.toLowerCase().endsWith('.hbs')) {
            hbsFiles.add(fileName);
          }
        }
      }
  
      if (manifest.file.flags == null) {
        manifest.file.flags = {};
      }
      if (Array.isArray(manifest.file.styles)) {
        cssFiles.add(...manifest.file.styles)
      }
      cssFiles.delete(null);
      cssFiles.delete(undefined);
  
      if (Array.isArray(manifest.file.flags.hbsFiles)) {
        hbsFiles.add(...manifest.file.flags.hbsFiles)
      }
      hbsFiles.delete(null);
      hbsFiles.delete(undefined);
  
      manifest.file.styles = Array.from(cssFiles).sort();
      manifest.file.flags.hbsFiles = Array.from(hbsFiles).sort();
  
      fs.writeFileSync(path.join(dest, manifest.name), JSON.stringify(manifest.file, null, 2));
    }
  }

}

class BuildActions {
  /**
   * TypeScript transformers
   * @returns {typescript.TransformerFactory<typescript.SourceFile>}
   */
  static #createTransformer() {
    /**
     * @param {typescript.Node} node
     */
    function shouldMutateModuleSpecifier(node) {
      if (
        !typescript.isImportDeclaration(node) &&
        !typescript.isExportDeclaration(node)
      )
        return false;
      if (node.moduleSpecifier === undefined) return false;
      if (!typescript.isStringLiteral(node.moduleSpecifier)) return false;
      if (
        !node.moduleSpecifier.text.startsWith('./') &&
        !node.moduleSpecifier.text.startsWith('../')
      )
        return false;
      if (path.extname(node.moduleSpecifier.text) !== '') return false;
      return true;
    }

    /**
     * Transforms import/export declarations to append `.js` extension
     * @param {typescript.TransformationContext} context
     */
    function importTransformer(context) {
      return (node) => {
        /**
         * @param {typescript.Node} node
         */
        function visitor(node) {
          if (shouldMutateModuleSpecifier(node)) {
            if (typescript.isImportDeclaration(node)) {
              const newModuleSpecifier = typescript.createLiteral(
                `${node.moduleSpecifier.text}.js`
              );
              return typescript.updateImportDeclaration(
                node,
                node.decorators,
                node.modifiers,
                node.importClause,
                newModuleSpecifier
              );
            } else if (typescript.isExportDeclaration(node)) {
              const newModuleSpecifier = typescript.createLiteral(
                `${node.moduleSpecifier.text}.js`
              );
              return typescript.updateExportDeclaration(
                node,
                node.decorators,
                node.modifiers,
                node.exportClause,
                newModuleSpecifier
              );
            }
          }
          return typescript.visitEachChild(node, visitor, context);
        }

        return typescript.visitNode(node, visitor);
      };
    }

    return importTransformer;
  }

  /** @type {ts.Project} */
  static #tsConfig;
  /**
   * @returns {ts.Project}
   */
  static #getTsConfig() {
    if (BuildActions.#tsConfig == null) {
      BuildActions.#tsConfig = ts.createProject('tsconfig.json', {
        getCustomTransformers: (_program) => ({
          after: [BuildActions.#createTransformer()],
        }),
      });
    }
    return BuildActions.#tsConfig;
  }

  /**
   * @param {string} target Ensure the folder exists
   */
  static createFolder(target) {
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
  static createBuildTS(target) {
    return function buildTS() {
      const manifest = Meta.getManifest();
      return gulp.src('src/**/*.ts')
        .pipe(sourcemaps.init())
        .pipe(BuildActions.#getTsConfig()())
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
            return '/' + [(manifest.file.type === 'system' ? 'systems' : 'modules'), manifest.file.name, ...filePathParts].join('/') + '.map';
          }
        }))
        .pipe(gulp.dest(target));
    }
  }

  /**
   * @param {string} target the destination directory
   */
  static createBuildLess(target) {
    return function buildLess() {
      return gulp.src('src/**/*.less')
        .pipe(less())
        .pipe(minifyCss())
        .pipe(gulp.dest(target));
    }
  }
  
  /**
   * @param {string} target the destination directory
   */
  static createBuildSASS(target) {
    return function buildSASS() {
      return gulp
        .src('src/**/*.scss')
        .pipe(sass().on('error', sass.logError))
        .pipe(minifyCss())
        .pipe(gulp.dest(target));
    }
  }

  /**
   * @returns {Array<{from: string[], to: string[], options?: any}>}
   */
  static getStaticCopyFiles() {
    return [
      {from: ['src','lang'], to: ['lang']},
      {from: ['src','fonts'], to: ['fonts']},
      {from: ['src','assets'], to: ['assets']},
      {from: ['src','templates'], to: ['templates']},
      {from: ['src','module.json'], to: ['module.json']},
      {from: ['src','system.json'], to: ['system.json']},
      {from: ['src','template.json'], to: ['template.json']},
    ]
  }
  
  /**
   * @param {Array<{from: string[], to: string[], options?: any}>} copyFilesArg How files should be copied
   */
  static createCopyFiles(copyFilesArg) {
    return async function copyFiles() {
      const promises = [];
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

  static #startFoundry() {
    if (!fs.existsSync('foundryconfig.json')) {
      console.warn('Could not start foundry: foundryconfig.json not found in project root');
      return;
    }
    const config = Meta.getConfig();
    if (!config.dataPath) {
      console.warn('Could not start foundry: foundryconfig.json is missing the property "dataPath"');
    }
    if (!config.foundryPath) {
      console.warn('Could not start foundry: foundryconfig.json is missing the property "foundryPath"');
    }
  
    const cmd = `node "${path.join(config.foundryPath, 'resources', 'app', 'main.js')}" --dataPath="${config.dataPath}"`;
    console.log('starting foundry: ', cmd)
    exec(cmd);
  }

  /**
   * Watch for changes for each build step
   */
  static createWatch() {
    let config;
    let manifest;
    let destPath;
    let copyFiles;
    let copyFilesFunc;
    
    return gulp.series(
      async function init() {
        config = Meta.getConfig();
        manifest = Meta.getManifest();
        if (config?.dataPath == null) {
          throw new Error(`Missing "dataPath" in the file foundryconfig.json. This should point to the foundry data folder.`);
        }
        destPath = path.join(config.dataPath, 'Data', 'modules', manifest.file.name);
        if (!fs.existsSync(destPath)) {
          fs.mkdirSync(destPath);
        }
        copyFiles = [...BuildActions.getStaticCopyFiles(), {from: ['src','packs'], to: ['packs'], options: {override: false}}];
        for (let i = 0; i < copyFiles.length; i++) {
          copyFiles[i].to = [destPath, ...copyFiles[i].to];
        }
        copyFilesFunc = BuildActions.createCopyFiles(copyFiles);
      },
      async function initialSetup() {
        // Initial build
        //console.log(buildTS().eventNames())
        // finish, close, end
        await BuildActions.createClean(destPath)();
        await Promise.all([
          new Promise((resolve) => BuildActions.createBuildTS(destPath)().once('end', () => resolve())),
          new Promise((resolve) => BuildActions.createBuildLess(destPath)().once('end', () => resolve())),
          new Promise((resolve) => BuildActions.createBuildSASS(destPath)().once('end', () => resolve())),
          copyFilesFunc(),
        ]);
        // Only build manifest once all hbs & css files are generated
        await Meta.createBuildManifest(destPath)();
  
        // Only start foundry when the manifest is build
        BuildActions.#startFoundry();
      },
      function watch() {
        // Do not watch to build the manifest since it only gets loaded on server start
        gulp.watch('src/**/*.ts', { ignoreInitial: true }, BuildActions.createBuildTS(destPath));
        gulp.watch('src/**/*.less', { ignoreInitial: true }, BuildActions.createBuildLess(destPath));
        gulp.watch('src/**/*.scss', { ignoreInitial: true }, BuildActions.createBuildSASS(destPath));
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
   * @param {string} target the directory which should be made empty
   */
  static createClean(target) {
    return async function clean() {
      const promises = [];
      for (const file of await fs.readdir(target)) {
        promises.push(fs.rm(path.join(target, file), {recursive: true}));
      }
      return Promise.all(promises).then();
    }
  }

  /**
   * Package the module into a zip
   * @param {string} inputDir the directory which should be zipped
   */
  static createBuildPackage(inputDir) {
    return async function buildPackage() {
      const manifest = Meta.getManifest();
      inputDir = path.normalize(inputDir);
      if (!inputDir.endsWith(path.sep)) {
        inputDir += path.sep;
      }
    
      return new Promise((resolve, reject) => {
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
          zip.directory(inputDir, manifest.file.name);
    
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
    return function updateSrcPacks() {
      const config = Meta.getConfig();
      if (!config.dataPath) {
        console.warn('Could not start foundry: foundryconfig.json is missing the property "dataPath"');
      }
      const manifest = Meta.getManifest();
      return BuildActions.createCopyFiles([{from: [config.dataPath, 'Data', 'modules', manifest.file.name, 'packs'], to: ['src','packs']}])();
    }
  }

}

class Args {
  /** @type {{u?: string; update?: string;}} */
  static #args = yargs.argv;
 
  /**
   * @param {string} currentVersion
   * @returns {string} version name
   */
  static getVersion(currentVersion, allowNoVersion = false) {
    if (currentVersion == null || currentVersion == '') {
      currentVersion = '0.0.0';
    }
    const version = Args.#args.update || Args.#args.u;
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
          let target = null;
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
      const currentVersionString = Meta.getManifest().file.version;
      const currentVersion = Args.parseVersion(Meta.getManifest().file.version);
      if (!currentVersion) {
        cb();
        return;
      }
      const newVersionString  = Args.getVersion(currentVersionString, false);
      const newVersion = Args.parseVersion(newVersionString);

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

  /**
   * Update version and URLs in the manifest JSON
   * @param {'src' | 'dist'} manifestType
   */
  static createUpdateManifestForGithub(manifestType, externalManifest = false) {
    /**
     * @param {Function} cb
     */
    return function updateManifestForGithub(cb) {
      const packageJson = fs.readJSONSync('package.json');
      const config = Meta.getConfig();
      const manifest = Meta.getManifest(manifestType);

      if (!config) {
        return cb(Error(chalk.red('foundryconfig.json not found in the ./ (root) folder')));
      }
      if (!manifest) {
        return cb(Error(chalk.red('Manifest JSON not found in the ./src folder')));
      }
      if (!config.githubRepository) {
        return cb(Error(chalk.red('Missing "githubRepository" property in ./foundryconfig.json. Epxected format: <githubUsername>/<githubRepo>')));
      }

      try {
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
        fs.writeFileSync(
          path.join(manifest.root, manifest.name),
          stringify(manifest.file, {indent: '  '}),
          'utf8'
        );

        return cb();
      } catch (err) {
        return cb(err);
      }
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
    let newVersion = 'v' + Meta.getManifest().file.version;
    return gulp.src('.').pipe(git.commit(`Updated to ${newVersion}`));
  }

  static gitTag() {
    let newVersion = 'v' + Meta.getManifest().file.version;
    return git.tag(
      `${newVersion}`,
      `Updated to ${newVersion}`,
      (err) => {
        if (err) {
          throw err;
        }
      }
    );
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

  static gitPushTag(cb) {
    let newVersion = 'v' + Meta.getManifest().file.version;
    git.push('origin', newVersion, (err) => {
      if (err) {
        cb(err);
        throw err;
      }
      cb();
    });
  }

}


export const build = gulp.series(
  BuildActions.createFolder('dist'),
  BuildActions.createClean('dist'),
  gulp.parallel(
    BuildActions.createBuildTS('dist'),
    BuildActions.createBuildLess('dist'),
    BuildActions.createBuildSASS('dist'),
    BuildActions.createCopyFiles([
     {from: ['src','packs'], to: ['dist','packs']},
      ...BuildActions.getStaticCopyFiles().map(copy => {
        copy.to = ['dist', ...copy.to];
        return copy;
      }),
    ])),
  Meta.createBuildManifest('dist'),
);
export const updateSrcPacks = gulp.series(BuildActions.createUpdateSrcPacks());
export const watch = BuildActions.createWatch();
export const buildZip = gulp.series(
  build,
  BuildActions.createBuildPackage('dist')
);
export const test = Args.createVersionValdiation();
export const updateZipManifestForGithub = Git.createUpdateManifestForGithub('dist', false);
export const updateExternalManifestForGithub = Git.createUpdateManifestForGithub('dist', true);
export const publish = gulp.series(
  Args.createVersionValdiation(),
  Git.validateCleanRepo,
  Git.createUpdateManifestForGithub('src'),
  Git.gitCommit, 
  Git.gitTag,
  Git.gitPush,
  Git.gitPushTag
);
