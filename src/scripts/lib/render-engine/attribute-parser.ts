export interface InputParseOptions {
  executeFunctions: boolean;
}

export class AttributeParser {

  public static parseBoolean(value: any, options?: InputParseOptions): boolean | null {
    if (value == null) {
      return null;
    }

    if (typeof value === 'function') {
      if (options.executeFunctions) {
        return this.parseBoolean(value(), options);
      }
    }

    if (typeof value === 'string') {
      if (value === '' || value.toLowerCase() === 'true') {
        return true;
      }
      if (value.toLowerCase() === 'false') {
        return false;
      }
    }

    return !!value;
  }

  public static parseNumber(value: any, options?: InputParseOptions): number | null {
    if (value == null) {
      return null;
    }

    if (typeof value === 'function') {
      if (options.executeFunctions) {
        return this.parseNumber(value(), options);
      }
    }

    return Number(value);
  }

}