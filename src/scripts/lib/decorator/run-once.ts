function runOnceInternal<T>(originalFunction: (args: Array<Array<T>>) => any): (...args: T[]) => any {
  let hasRan = false;
  let response: any;
  // use 'function' to retain the original context from the caller (use another this context)
  return function (...args: T[]): any {
    if (hasRan) {
      return response;
    }
    response = originalFunction.call(this, ...args);
  }
}

export function RunOnce(args: {bufferTime?: number} = {}) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    if (descriptor.configurable === false) {
      throw new Error(`Can't change the property ${propertyKey}. configurable is disabled.`);
    }
    if (descriptor.get && !descriptor.set) {
      throw new Error(`Key ${propertyKey} is a getter and does not have a set.`);
    }
    if (descriptor.writable === false) {
      throw new Error(`Can't change the property ${propertyKey}. property is not writable.`);
    }
    
    const bufferMethod = runOnceInternal(
      descriptor.get ? descriptor.get() : descriptor.value
    )
    if (descriptor.get) {
      descriptor.set(bufferMethod);
    } else {
      descriptor.value = bufferMethod;
    }
  };
}