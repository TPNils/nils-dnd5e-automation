import * as fs from 'fs-extra';
import * as chalk from 'chalk';
import * as stringify from 'json-stringify-pretty-compact';
import { foundryManifest } from './foundry-manifest';
import { cli } from './cli';
import { args } from './args';

export class Git {
  public async updateManifestForGithub({source, externalManifest}: {source: boolean, externalManifest: boolean}): Promise<void> {
    const packageJson = fs.readJSONSync('package.json');
    const manifest = foundryManifest.getManifest();
    if (!manifest) {
      throw new Error(chalk.red('Manifest JSON not found in the ./src folder'));
    }
    let remoteName: string;
    {
      const out = await cli.execPromise('git remote');
      if (out.stdout) {
        const lines = out.stdout.split('\n');
        if (lines.length === 1) {
          remoteName = lines[0];
        }
      }
    }
    if (remoteName == null) {
      // Find the correct remote
      const out = await cli.execPromise('git branch -vv --no-color');
      if (out.stdout) {
        const rgx = /^\* [^\s]+ +[0-9a-fA-F]+ \[([^\/]+)\//;
        for (const line of out.stdout.split('\n')) {
          const match = rgx.exec(line);
          if (match) {
            remoteName = match[1];
          }
        }
      }
    }

    if (remoteName == null) {
      throw new Error(chalk.red('Could not find the remote git url.'));
    }
    const remoteUrl = await cli.execPromise(`git remote get-url --push "${remoteName.replace(/"/g, '\\"')}"`);
    cli.throwError(remoteUrl);
    console.log({out: remoteUrl.stdout.trim()})
    let githubRepository: string;
    const sshRgx = /^git@github\.com:(.*)\.git$/i.exec(remoteUrl.stdout.trim());
    if (sshRgx) {
      githubRepository = sshRgx[1];
    } else {
      const httpRgx = /^https?:\/\/github\.com\/(.*)\.git$/i.exec(remoteUrl.stdout.trim());
      if (httpRgx) {
        githubRepository = httpRgx[1];
      }
    }
    if (githubRepository == null) {
      throw new Error(chalk.red(`Git remote "${remoteName}" was not detected as a github repo.`));
    }

    const currentVersion = await args.getCurrentVersion();
    let targetVersion = await args.getNextVersion(currentVersion, true);
    if (targetVersion == null) {
      targetVersion = currentVersion;
    }

    if (targetVersion.startsWith('v')) {
      targetVersion = targetVersion.substring(1);
    }

    console.log(`Updating version number to '${targetVersion}'`);

    packageJson.version = targetVersion;

    manifest.file.version = targetVersion;
    manifest.file.url = `https://github.com/${githubRepository}`;
    // When foundry checks if there is an update, it will fetch the manifest present in the zip, for us it points to the latest one.
    // The external one should point to itself so you can download a specific version
    // The zipped one should point to the latest manifest so when the "check for update" is executed it will fetch the latest
    if (externalManifest) {
      // Seperate file uploaded for github
      manifest.file.manifest = `https://github.com/${githubRepository}/releases/download/v${targetVersion}/module.json`;
    } else {
      // The manifest which is within the module zip
      manifest.file.manifest = `https://github.com/${githubRepository}/releases/download/latest/module.json`;
    }
    manifest.file.download = `https://github.com/${githubRepository}/releases/download/v${targetVersion}/module.zip`;

    fs.writeFileSync(
      'package.json',
      stringify(packageJson, {indent: '  '}),
      'utf8'
    );
    await foundryManifest.saveManifest({overrideManifest: manifest.file, source: source});
    
  }

  public async validateCleanRepo(): Promise<void> {
    const cmd = await cli.execPromise('git status --porcelain');
    cli.throwError(cmd);
    if (typeof cmd.stdout === 'string' && cmd.stdout.length > 0) {
      throw new Error("You must first commit your pending changes");
    }
  }

  public async commitNewVersion(): Promise<void> {
    cli.throwError(await cli.execPromise('git add .'), {ignoreOut: true});
    let newVersion = 'v' + await args.getCurrentVersion();
    cli.throwError(await cli.execPromise(`git commit -m "Updated to ${newVersion}`));
  }

  public async deleteVersionTag(version?: string): Promise<void> {
    if (version == null) {
      version = 'v' + await args.getCurrentVersion();
    }
    // Ignore errors
    await cli.execPromise(`git tag -d ${version}`);
    await cli.execPromise(`git push --delete origin ${version}`);
  }

  public async tagCurrentVersion(): Promise<void> {
    let version = 'v' + await args.getCurrentVersion();
    cli.throwError(await cli.execPromise(`git tag -a ${version} -m "Updated to ${version}"`));
    cli.throwError(await cli.execPromise(`git push origin ${version}`), {ignoreOut: true});
  }

  public async getLatestVersionTag(): Promise<string> {
    const tagHash = await cli.execPromise('git rev-list --tags --max-count=1');
    cli.throwError(tagHash);
    const cmd = await cli.execPromise(`git describe --tags ${tagHash.stdout}`);
    cli.throwError(cmd);
    return cmd.stdout.trim();
  }

  public async push(): Promise<void> {
    cli.throwError(await cli.execPromise(`git push`));
  }

  public async gitMoveTag() {
    await this.deleteVersionTag();
    await this.tagCurrentVersion();
  }
}

export const git = new Git();
for (let prop in git) {
  if (typeof git[prop] === 'function') {
    git[prop] = git[prop].bind(git);
  }
}