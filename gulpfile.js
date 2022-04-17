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

import child_process from 'child_process';
import yargs from 'yargs';

const sass = gulpSass(sassCompiler);
const exec = child_process.exec;
const argv = yargs.argv;

/**
* @returns {{
*   dataPath: string,
*   foundryPath: string,
*   githubRepository: string
* }}
*/
function getConfig() {
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

 function getManifest() {
   const json = {};
 
   if (fs.existsSync('src')) {
     json.root = 'src';
   } else {
     json.root = 'dist';
   }
 
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

function buildManifest() {
  const manifest = getManifest();

  /** @type {Promise<string[]>[]} */
  const filePromises = [];
  filePromises.push(new Promise((resolve, reject) => {
    glob('dist/**/*.css', (err, matches) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(matches);
    })
  }));
  filePromises.push(new Promise((resolve, reject) => {
    glob('dist/**/*.hbs', (err, matches) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(matches);
    })
  }));

  return Promise.all(filePromises).then(fileNameCollection => {
    /** @type {Set<string>} */
    const cssFiles = new Set();
    /** @type {Set<string>} */
    const hbsFiles = new Set();
    for (const fileNames of fileNameCollection) {
      for (let fileName of fileNames) {
        fileName = fileName.replace(/^(dist|src)\//, '');
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

    fs.writeFileSync(path.join('dist', manifest.name), JSON.stringify(manifest.file, null, 2));
  })
}
 
 /**
  * TypeScript transformers
  * @returns {typescript.TransformerFactory<typescript.SourceFile>}
  */
 function createTransformer() {
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
 
 const tsConfig = ts.createProject('tsconfig.json', {
   getCustomTransformers: (_program) => ({
     after: [createTransformer()],
   }),
 });
 
 /********************/
 /*    BUILD    */
 /********************/
 
/**
 * Build TypeScript
 * @param {string} target the destination directory
 */
function buildTS(target) {
   return function buildTS() {
    return gulp.src('src/**/*.ts')
    .pipe(sourcemaps.init())
    .pipe(tsConfig())
    .pipe(sourcemaps.write())
    .pipe(gulp.dest(target));
   }
}
 
/**
 * Build Less
 * @param {string} target the destination directory
 */
function buildLess(target) {
  return function buildLess() {
    return gulp.src('src/**/*.less').pipe(less()).pipe(gulp.dest(target));
  }
}
 
/**
 * Build SASS
 * @param {string} target the destination directory
 */
function buildSASS(target) {
  return function buildSASS() {
   return gulp
     .src('src/**/*.scss')
     .pipe(sass().on('error', sass.logError))
     .pipe(gulp.dest(target));
  }
}
 
 const staticCopyFiles = [
   {from: ['src','lang'], to: ['lang']},
   {from: ['src','fonts'], to: ['fonts']},
   {from: ['src','assets'], to: ['assets']},
   {from: ['src','templates'], to: ['templates']},
   {from: ['src','module.json'], to: ['module.json']},
   {from: ['src','system.json'], to: ['system.json']},
   {from: ['src','template.json'], to: ['template.json']},
 ];
 
 /**
  * Copy static files
  * @param {Array<{from: string, to: string, options?: any}>} copyFilesArg How files should be copied
  */
 function createCopyFiles(copyFilesArg) {
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
 
/**
 * Watch for changes for each build step
 */
function buildWatch() {
  const config = getConfig();
  const manifest = getManifest();
  if (config?.dataPath == null) {
    throw new Error(`Missing "dataPath" in the file foundryconfig.json. This should point to the foundry data folder.`);
  }
  const destPath = path.join(config.dataPath, 'Data', 'modules', manifest.file.name);
  if (!fs.existsSync(destPath)) {
    fs.mkdirSync(destPath);
  }
  const copyFiles = [...staticCopyFiles, {from: ['src','packs'], to: ['packs'], options: {override: false}}];
  for (let i = 0; i < copyFiles.length; i++) {
    copyFiles[i].to = [destPath, ...copyFiles[i].to];
  }
  const copyFilesFunc = createCopyFiles(copyFiles);
  
  return gulp.series(
    async function initialSetup() {
      // Initial build
      //console.log(buildTS().eventNames())
      // finish, close, end
      await clean();
      await Promise.all([
        new Promise((resolve) => buildTS(destPath)().once('end', () => resolve())),
        new Promise((resolve) => buildLess(destPath)().once('end', () => resolve())),
        new Promise((resolve) => buildSASS(destPath)().once('end', () => resolve())),
        copyFilesFunc(),
      ]);
      // Only build manifest once all hbs & css files are generated
      await buildManifest();

      // Only start foundry when the manifest is build
      startFoundry();
    },
    function watch() {
      // Do not watch to build the manifest since it only gets loaded on server start
      gulp.watch('src/**/*.ts', { ignoreInitial: true }, buildTS(destPath));
      gulp.watch('src/**/*.less', { ignoreInitial: true }, buildLess(destPath));
      gulp.watch('src/**/*.scss', { ignoreInitial: true }, buildSASS(destPath));
      gulp.watch(
        [...copyFiles.map(file => path.join(...file.from)), 'src/*.json'],
        { ignoreInitial: true },
        copyFilesFunc
      )
    }
  );
}
 
 /********************/
 /*    CLEAN    */
 /********************/
 
/**
 * Remove built files from `dist` folder
 * @param {string} target the destination directory
 */
function clean(target) {
  return async function clean() {
    const promises = [];
    for (const file of await fs.readdir('dist')) {
      promises.push(fs.rm(path.join('dist', file), {recursive: true}));
    }
    return Promise.all(promises).then();
  }
}
 
 /*********************/
 /*    PACKAGE     */
 /*********************/
 
 /**
  * Package build
  */
 async function packageBuild() {
   const manifest = getManifest();
 
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
       zip.directory('dist/', manifest.file.name);
 
       zip.finalize();
     } catch (err) {
       return reject(err);
     }
   });
 }
 
 /**
  * @param {string} currentVersion
  * @returns {string} version name
  */
 function getVersionFromArgs(currentVersion) {
   const version = argv.update || argv.u;
   if (!version) {
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
  * Update version and URLs in the manifest JSON
  */
 function updateGithubManifest(cb) {
   console.log('updateGithubManifest')
   const packageJson = fs.readJSONSync('package.json');
   const config = getConfig();
   const manifest = getManifest();
 
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
     let targetVersion = getVersionFromArgs(currentVersion)
 
     if (targetVersion.startsWith('v')) {
       targetVersion = targetVersion.substring(1);
     }
     
     // Don't allow the same version for explicit verions (not 'latest')
     if (targetVersion === currentVersion) {
       return cb(Error(chalk.red('Error: Target version is identical to current version.')));
     }
 
     console.log(`Updating version number to '${targetVersion}'`);
 
     packageJson.version = targetVersion;
 
     manifest.file.version = targetVersion;
     manifest.file.url = `https://github.com/${config.githubRepository}`;
     manifest.file.manifest = `https://github.com/${config.githubRepository}/releases/download/v${targetVersion}/module.json`;
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
 
 function validateCleanRepo(cb) {
   return git.status({args: '--porcelain'}, function (err, stdout) {
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
 
 function gitCommit() {
   let newVersion = 'v' + getManifest().file.version;
   return gulp.src('.').pipe(git.commit(`Updated to ${newVersion}`));
 }
 
 function gitTag() {
   let newVersion = 'v' + getManifest().file.version;
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
 
 function gitPush(cb) {
   git.push('origin', (err) => {
     if (err) {
       cb(err);
       throw err;
     }
     cb();
   });
 }
 
 function gitPushTag(cb) {
   let newVersion = 'v' + getManifest().file.version;
   git.push('origin', newVersion, (err) => {
     if (err) {
       cb(err);
       throw err;
     }
     cb();
   });
 }
 
 const execGit = gulp.series(gitCommit, gitTag, gitPush, gitPushTag);
 
 const execBuild = gulp.parallel(buildTS('dist'), buildLess('dist'), buildSASS('dist'), createCopyFiles([...staticCopyFiles, {from: ['src','packs'], to: ['dist','packs']}]));
 
 function startFoundry() {
   if (!fs.existsSync('foundryconfig.json')) {
     console.warn('Could not start foundry: foundryconfig.json not found in project root');
     return;
   }
   const config = getConfig();
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
 
 
 export const build = gulp.series(clean, execBuild, buildManifest);
 const config = getConfig();
 if (!config.dataPath) {
   console.warn('Could not start foundry: foundryconfig.json is missing the property "dataPath"');
 }
 const manifest = getManifest();
 export const updateSrcPacks =  gulp.parallel(createCopyFiles([{from: [config.dataPath, 'Data', 'modules', manifest.file.name, 'packs'], to: ['src','packs']}]));
 export const watch = buildWatch();
 export {clean};
 export const buildZip = packageBuild;
 export const updateManifest = updateGithubManifest;
 export const test = gitPushTag;
 export const publish = gulp.series(
   clean,
   validateCleanRepo,
   updateGithubManifest,
   execGit
 );
