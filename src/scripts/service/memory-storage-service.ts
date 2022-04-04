import { UtilsElement } from "../elements/utils-element";
import { Stoppable } from "../lib/utils/stoppable";

export class MemoryValue<T = any> {
  private nextListenerId = 0;
  private listeners = new Map<number, (value?: T) => void>();
  private hasSetValue: boolean;
  private value?: T;

  public set(value?: T): void {
    this.value = value;
    this.hasSetValue = true;
    for (const listener of this.listeners.values()) {
      listener(this.value);
    }
  }

  public get(): T | undefined {
    return this.value;
  }

  public listen(callback: (value?: T) => void): Stoppable {
    const id = this.nextListenerId++;
    this.listeners.set(id, callback);
    if (this.hasSetValue) {
      callback(this.value);
    }
    return {
      stop: () => {
        this.listeners.delete(id);
      }
    }
  }
}


export class MemoryStorageService {

  private static properties = new Map<string, MemoryValue>();

  public static getFocusedElementSelector(): string | null {
    return MemoryStorageService.getValue<string>(`focusedElementSelector`).get();
  }

  public static setFocusedElementSelector(selector: string): void {
    MemoryStorageService.getValue(`focusedElementSelector`).set(selector);
  }

  public static getElementValue<T>(element: Element, subKey: string | string[] = [], defaultValue?: T | (() => T)): MemoryValue<T> {
    if (typeof subKey === 'string') {
      subKey = [subKey];
    }
    const keyParts: string[] = [...subKey.reverse()];
    let foundMessageId = false;
    let foundPartId = false;
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

  private static getValue<T>(key: string): MemoryValue<T> {
    if (!MemoryStorageService.properties.has(key)) {
      MemoryStorageService.properties.set(key, new MemoryValue())
    }
    return MemoryStorageService.properties.get(key);
  }

}