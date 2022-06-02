import { UtilsElement } from "../elements/utils-element";
import { ValueProvider } from "../provider/value-provider";

export class MemoryStorageService {

  private static properties = new Map<string, ValueProvider>();

  public static getFocusedElementSelector(): string | null {
    return MemoryStorageService.getValue<string>(`focusedElementSelector`).get();
  }

  public static setFocusedElementSelector(selector: string): void {
    MemoryStorageService.getValue(`focusedElementSelector`).set(selector);
  }

  public static getElementValue<T>(element: Element, subKey: string | string[] = [], defaultValue?: T | (() => T)): ValueProvider<T> {
    if (typeof subKey === 'string') {
      subKey = [subKey];
    }
    const keyParts: string[] = [...subKey.reverse()];
    let foundMessageId = false;
    let foundPartId = false;
    let foundSubtypeId = false;
    do {
      {
        const value = UtilsElement.readAttrString(element, 'data-memory-context');
        if (value) {
          keyParts.push(value);
        }
      }
      if (!foundMessageId) {
        const value = UtilsElement.readAttrString(element, 'data-message-id');
        if (value) {
          keyParts.push('message-', value);
          foundMessageId = true;
        }
      }
      if (!foundPartId) {
        const value = UtilsElement.readAttrString(element, 'data-part-id');
        if (value) {
          keyParts.push('part-', value);
          foundPartId = true;
        }
      }
      if (!foundSubtypeId) {
        const value = UtilsElement.readAttrString(element, 'data-sub-type');
        if (value) {
          keyParts.push('subtype-', value);
          foundSubtypeId = true;
        }
      }
      element = element.parentElement;
    } while (element != null)

    const memoryValue = MemoryStorageService.getValue<T>(keyParts.reverse().join(';'));
    if (defaultValue != null && memoryValue.get() == null) {
      if (typeof defaultValue === `function`) {
        // @ts-ignore
        memoryValue.set(defaultValue());
      } else {
        memoryValue.set(defaultValue);
      }
    }
    return memoryValue;
  }

  private static getValue<T>(key: string): ValueProvider<T> {
    if (!MemoryStorageService.properties.has(key)) {
      MemoryStorageService.properties.set(key, new ValueProvider())
    }
    return MemoryStorageService.properties.get(key);
  }

}