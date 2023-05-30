import { UtilsLog } from "../../utils/utils-log";

function runOnceInternal<T>(originalFunction: (args: Array<Array<T>>) => any): (...args: T[]) => any {
  let hasRan = false;
  let response: any;
  // use 'function' to retain the original context from the caller (use another this context)
  return function (...args: T[]): any {
    if (hasRan) {
      return response;
    }
    hasRan = true;
    response = originalFunction.call(this, ...args);
  }
}

export function StaticInitFunc(init: () => any) {
  return function (target: any, propertyKey: string, descriptor?: PropertyDescriptor) {
    if (descriptor) {
      if (descriptor.configurable === false) {
        throw new Error(`Can't change the property ${propertyKey}. configurable is disabled.`);
      }
      if (descriptor.get && !descriptor.set) {
        throw new Error(`Key ${propertyKey} is a getter and does not have a set.`);
      }
      if (descriptor.writable === false) {
        throw new Error(`Can't change the property ${propertyKey}. property is not writable.`);
      }
    }

    const getFunc = () => {
      const value = init();
      UtilsLog.debug(propertyKey, value)
      Reflect.deleteProperty(target, propertyKey);
      target[propertyKey] = value;
      return value;
    }
    
    if (descriptor) {
      descriptor.get = getFunc;
      delete descriptor.value;
      delete descriptor.writable;
    } else {
      Reflect.defineProperty(target, propertyKey, {
        configurable: true,
        get: getFunc
      })
    }
  };
}