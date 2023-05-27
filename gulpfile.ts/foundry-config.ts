import * as fs from 'fs-extra';
import * as path from 'path';

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

  public getFoundryConfig(runInstanceKey: string): FoundryConfigJson {
    const configPath = path.resolve(process.cwd(), 'foundryconfig.json');
    const response: FoundryConfigJson = {};
  
    if (fs.existsSync(configPath)) {
      const file: FoundryConfigFileJson = fs.readJSONSync(configPath);
      const instance = file[runInstanceKey];
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
      return file;
    }

    return response;
  }

}

export const foundryConfig = new FoundryConfig();