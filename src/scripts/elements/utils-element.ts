export class UtilsElement {

  public static readAttrInteger(element: Element, attr: string): number | undefined {
    if (!element.hasAttribute(attr)) {
      return undefined;
    }
    if (/^[0-9]+$/.test(element.getAttribute(attr))) {
      return Number(element.getAttribute(attr));
    }
    return undefined;
  }

  public static readAttrBoolean(element: Element, attr: string): boolean {
    if (!element.hasAttribute(attr)) {
      return false;
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

  public static readAttrString(element: Element, attr: string): string | null {
    if (!element.hasAttribute(attr)) {
      return null;
    }

    const value = element.getAttribute(attr);
    if (value === '') {
      return null;
    }
    return value;
  }

  public static readAttrEnum<T extends string>(element: Element, attr: string, values: T[]): T | null {
    if (!element.hasAttribute(attr)) {
      return null;
    }

    const value = element.getAttribute(attr);
    if (value === '') {
      return null;
    }
    if (values.includes(value as T)) {
      return value as T;
    }
    return null;
  }

  public static readAttrJson<T>(element: Element, attr: string, validator?: (value: any) => value is T): T | null {
    if (!element.hasAttribute(attr)) {
      return null;
    }

    let value: any = element.getAttribute(attr);
    if (value === '') {
      return null;
    }
    try {
      value = JSON.parse(value);
      if (validator && !validator(value)) {
        return null;
      }
      return value;
    } catch {
      return null;
    }
  }

}