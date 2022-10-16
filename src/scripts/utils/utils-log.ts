import { staticValues } from "../static-values";

export class UtilsLog {

  public static info = UtilsLog.createWithPrefix('info');
  public static debug = UtilsLog.createWithPrefix('debug');
  public static log = UtilsLog.createWithPrefix('log');
  public static warn = UtilsLog.createWithPrefix('warn');
  public static error = UtilsLog.createWithPrefix('error');

  private static createWithPrefix<T extends keyof Console>(key: T): Console[T] {
    if (typeof console[key] === 'function') {
      return console[key].bind(console, `%c${staticValues.moduleName}`, `color: #ff8f00`);
    } else {
      return console[key];
    }
  }

}
