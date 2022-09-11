import { staticValues } from "../static-values";

export class UtilsLog {

  public static info(...args: any[]): void {
    console.info(`%c${staticValues.moduleName}`, `color: #ff8f00`, ...args);
  }
  public static debug(...args: any[]): void {
    console.debug(`%c${staticValues.moduleName}`, `color: #ff8f00`, ...args);
  }
  public static log(...args: any[]): void {
    console.log(`%c${staticValues.moduleName}`, `color: #ff8f00`, ...args);
  }
  public static warn(...args: any[]): void {
    console.warn(`%c${staticValues.moduleName}`, `color: #ff8f00`, ...args);
  }
  public static error(...args: any[]): void {
    console.error(`%c${staticValues.moduleName}`, `color: #ff8f00`, ...args);
  }

}
