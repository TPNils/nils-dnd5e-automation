export class UtilsObject {

  public static getProperty(obj: any, key: string[]): any | null {
    for (let i = 0; i < key.length; i++) {
      if (obj == null || typeof obj !== 'object') {
        return null;
      }

      obj = obj[key[i]];
    }
    return obj;
  }
  

  public static setProperty(obj: any, key: string[], value: any): void {
    for (let i = 0; i < key.length - 1; i++) {
      if (obj == null || typeof obj !== 'object') {
        obj[key[i]] = {};
      }

      obj = obj[key[i]];
    }

    obj[key[key.length-1]] = value;
  }

  public static injectDeleteForDml(original: any, newValue: {[key: string]: any}): {[key: string]: any} {
    for (const path of UtilsObject.getDeletedPropertyPaths(original, newValue)) {
      const pathSplit = path.split('.');
      // This is the delete notation
      //pathSplit[pathSplit.length - 1] = '-=' + pathSplit[pathSplit.length - 1];
      UtilsObject.setProperty(newValue, pathSplit, null);
    }

    return newValue;
  }

  private static getDeletedPropertyPaths(original: any, newValue: any): string[] {
    const deleteProperties = new Set<string>();

    for (const key of Object.keys(original)) {
      if (!original.hasOwnProperty(key) || original[key] == null) {
        continue;
      }
      if (newValue == null || !newValue.hasOwnProperty(key)) {
        deleteProperties.add(key);
      } else if (Array.isArray(newValue[key])) {
        // Arrays always 100% overwrite in foundry
        continue;
      } else if (typeof original[key] === 'object') {
        for (const childProperty of UtilsObject.getDeletedPropertyPaths(original[key], newValue[key])) {
          deleteProperties.add(`${key}.${childProperty}`);
        }
      }
    }

    return Array.from(deleteProperties);
  }

}