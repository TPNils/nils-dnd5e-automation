import { UtilsLog } from "../../utils/utils-log";

export interface InputParseOptions {
  executeFunctions: boolean;
}

const emptyString = '';
export class AttributeParser {

  public static serialize(value: any): string {
    if (value == null) {
      return emptyString;
    }
    switch (typeof value) {
      case 'bigint':
      case 'boolean':
      case 'number': {
        return String(value);
      }
      case 'string': {
        return value;
      }
      case 'undefined': {
        return emptyString;
      }
      case 'object': {
        return JSON.stringify(value);
      }
    }

    UtilsLog.error(`Can't serialize type ${typeof value}. Value: `, value);
    throw new Error(`Can't serialize type ${typeof value}`);
  }

  public static parseBoolean(value: any, options?: InputParseOptions): boolean | null {
    if (options.executeFunctions) {
      while (typeof value === 'function') {
        value = value();
      }
    }
    if (value == null) {
      return null;
    }

    if (typeof value === 'string') {
      if (value === emptyString || value.toLowerCase() === 'true') {
        return true;
      }
      if (value.toLowerCase() === 'false') {
        return false;
      }
    }

    return !!value;
  }

  public static parseNumber(value: any, options?: InputParseOptions): number | null {
    if (options.executeFunctions) {
      while (typeof value === 'function') {
        value = value();
      }
    }
    if (value == null) {
      return null;
    }

    return Number(value);
  }

  public static parseString(value: any, options?: InputParseOptions): string | null {
    if (options.executeFunctions) {
      while (typeof value === 'function') {
        value = value();
      }
    }
    if (value == null) {
      return null;
    }

    return String(value);
  }

  public static parseObject<T extends object>(value: any, options?: InputParseOptions & {strict?: true}): T | null {
    const inputValue = value;
    if (options.executeFunctions) {
      while (typeof value === 'function') {
        value = value();
      }
    }
    if (value == null) {
      return null;
    }

    while (typeof value === 'string') {
      value = JSON.parse(value);
    }
    if (options.strict && typeof value !== 'object') {
      UtilsLog.warn('Failed to parse value to an object. Input: ', inputValue)
      return null;
    }
    
    return value;
  }

}