import * as gulp from 'gulp';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as chalk from 'chalk';
import * as archiver from 'archiver';

import * as ts from 'gulp-typescript';
import * as less from 'gulp-less';
import * as sassCompiler from 'sass';
import * as gulpSass from 'gulp-sass';
import * as sourcemaps from 'gulp-sourcemaps';
import * as gulpFilter from 'gulp-filter';
import * as gulpUglify from 'gulp-uglify';
import * as minifyCss from 'gulp-clean-css';
import * as open from 'open';

import { exec } from 'child_process';
import { FoundryManifestJson, foundryManifest } from './foundry-manifest';
import { FoundryConfigJson, foundryConfig } from './foundry-config';
import { buildMeta } from './build-meta';
import { args } from './args';
import { git } from './git';
import { componentTransformer } from './ts-transformers/component-transformer';
import { importTransformer } from './ts-transformers/import-transformer';
import { parseHtml } from './chevrotain/html-parser';
import { UtilsTransformer } from './ts-transformers/utils-transformer';

const sass = gulpSass(sassCompiler);

class BuildActions {

  private static tsConfig: ts.Project;
  private static getTsConfig(): ts.Project {
    if (BuildActions.tsConfig == null) {
      BuildActions.tsConfig = ts.createProject('tsconfig.json', {
        getCustomTransformers: (_program) => ({
          before: [UtilsTransformer.beforeCompilerHook, componentTransformer],
          after: [importTransformer],
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
        await BuildActions.createClean()();
        await Promise.all([
          new Promise<void>((resolve) => BuildActions.createBuildTS({inlineMapping: true})().once('end', () => resolve())),
          new Promise<void>((resolve) => BuildActions.createBuildLess()().once('end', () => resolve())),
          new Promise<void>((resolve) => BuildActions.createBuildSASS()().once('end', () => resolve())),
          copyFilesFunc(),
        ]);
        // Only build manifest once all hbs & css files are generated
        await foundryManifest.createBuildManifest()();
  
        // Only start foundry when the manifest is build
        BuildActions.startFoundry();
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
export async function test() {
  const html = /*html*/`
  <div class="loh-grid">
    <label>{{this.localeHealing}}:</label>
    <input name="heal-amount" type="number" min="0" [max]="this.maxHeal" [value]="this.currentHeal" [disabled]="this.missingPermission" (keyup)="this.heal($event)" (blur)="this.heal($event)">
    <label>{{this.localeCure}}:</label>
    <input name="cure-amount" type="number" min="0" [max]="this.maxCure" [value]="this.currentCure" [disabled]="this.missingPermission" (keyup)="this.cure($event)" (blur)="this.cure($event)">
  </div>
  `;
  const fromPath = `C:/Users/Nils/Documents/foundry/dev-modules/nils-automated-compendium/src/scripts/elements/roll.ts`;
  const toPath = `../static-values`;
  console.log(path.resolve(fromPath, toPath))
  // console.log(JSON.stringify(parseHtml(html), null, 2))
}
export function rePublish() {
  return git.gitMoveTag();
}
export function updateZipManifestForGithub() {
  return git.updateManifestForGithub({source: false, externalManifest: false})
}
export function updateExternalManifestForGithub() {
  return git.updateManifestForGithub({source: false, externalManifest: false})
}
export const publish = gulp.series(
  function validateVersion() {args.validateVersion()},
  function validateCleanRepo() {git.validateCleanRepo()},
  function updateManifestForGithub() {git.updateManifestForGithub({source: true, externalManifest: false})},
  function gitCommit() {git.commitNewVersion()},
  function gitDeleteCurrentVersionTag() {git.deleteVersionTag()},
  function gitTag() {git.tagCurrentVersion()},
);
export const reupload = gulp.series(
  function gitDeleteTag() {git.deleteVersionTag()},
  function gitTag() {git.tagCurrentVersion()},
);