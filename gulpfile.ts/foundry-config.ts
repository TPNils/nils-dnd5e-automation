import * as fs from 'fs-extra';
import * as path from 'path';
import { args } from './args';

interface FoundryConfigFileJson {
  [key: string]: {
    dataPath: string;
    foundryPath: string;
  }
}

export interface FoundryConfigJson {
  dataPath?: string;
  foundryPath?: string;
}

class FoundryConfig {

  public exists(): Boolean {
    return fs.existsSync(path.resolve(process.cwd(), 'foundryconfig.json'));
  }

  public getFoundryConfig(runInstanceKey?: string): FoundryConfigJson {
    if (!runInstanceKey) {
      runInstanceKey = args.getFoundryInstanceName();
    }
    const configPath = path.resolve(process.cwd(), 'foundryconfig.json');
    const response: FoundryConfigJson = {};
  
    if (fs.existsSync(configPath)) {
      const file: FoundryConfigFileJson = fs.readJSONSync(configPath);
      let instance: FoundryConfigJson;
      if (runInstanceKey in file) {
        instance = file[runInstanceKey];
      }
      if (!instance) {
        for (const key in file) {
          if (typeof file[key] === 'object') {
            instance = file[key];
            break;
          }
        }
      }
      if (instance) {
        response.dataPath = instance.dataPath;
        response.foundryPath = instance.foundryPath;
      }
      if (response.dataPath) {
        // Validate correct path
        const files = fs.readdirSync(response.dataPath).filter(fileName => fileName !== 'Data' && fileName !== 'Config' && fileName !== 'Logs');
        // 0 files => only the foundry folders exist (or some of them if the server has not yet started for a first time)
        if (files.length !== 0) {
          throw new Error(`dataPath "${response.dataPath}" in foundryconfig.json is not recognised as a foundry folder. The folder should include 3 other folders: Data, Config & Logs`);
        }
      }
    }

    return response;
  }

}

export const foundryConfig = new FoundryConfig();
for (let prop in foundryConfig) {
  if (typeof foundryConfig[prop] === 'function') {
    foundryConfig[prop] = foundryConfig[prop].bind(foundryConfig);
  }
}