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

}