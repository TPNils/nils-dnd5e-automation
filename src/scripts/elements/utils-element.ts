export class UtilsElement {

  /**
   * Source: https://stackoverflow.com/questions/7753448/how-do-i-escape-quotes-in-html-attribute-values
   * @param value Value that you wish to be able to inject into an attribute though a html string
   * @returns The escaped value
   */
  public static serializeAttr(value: any) {
    if (value == null) {
      return '';
    }

    if (typeof value === 'object') {
      value = JSON.stringify(value);
    }

    return String(value)
        .replace(/&/g, '&amp;') /* This MUST be the 1st replacement. */
        .replace(/'/g, '&apos;') /* The 4 other predefined entities, required. */
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
  }

  public static readAttrInteger(element: Element, attr: string): number | undefined {
    if (!element.hasAttribute(attr)) {
      return undefined;
    }
    if (/^[0-9]+$/.test(element.getAttribute(attr))) {
      return Number(element.getAttribute(attr));
    }
    return undefined;
  }

  public static readAttrBoolean(element: Element, attr: string, defaultValue = false): boolean {
    if (!element.hasAttribute(attr)) {
      return defaultValue;
    }

    const value = element.getAttribute(attr);
    if (value === '') {
      return true;
    }
    if (value.toLowerCase() === 'false') {
      return false;
    }
    return Boolean(value);
  }

  public static readAttrString(element: Element, attr: string): string | undefined {
    if (!element.hasAttribute(attr)) {
      return undefined;
    }

    const value = element.getAttribute(attr);
    if (value === '') {
      return undefined;
    }
    return value;
  }

  public static readAttrEnum<T extends string>(element: Element, attr: string, values: T[]): T | undefined {
    if (!element.hasAttribute(attr)) {
      return undefined;
    }

    const value = element.getAttribute(attr);
    if (value === '') {
      return undefined;
    }
    if (values.includes(value as T)) {
      return value as T;
    }
    return undefined;
  }

  public static readAttrJson<T>(element: Element, attr: string, validator?: (value: any) => value is T): T | undefined {
    if (!element.hasAttribute(attr)) {
      return undefined;
    }

    let value: any = element.getAttribute(attr);
    if (value === '') {
      return undefined;
    }
    try {
      value = JSON.parse(value);
      if (validator && !validator(value)) {
        return undefined;
      }
      return value;
    } catch {
      return undefined;
    }
  }

}