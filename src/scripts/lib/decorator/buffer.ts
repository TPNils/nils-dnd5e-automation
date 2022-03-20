function bufferInternal<T>(bufferTime: number, originalFunction: (args: Array<Array<T>>) => any): (...args: T[]) => any {
  let bufferedCallsByThis = new Map<any, Array<Array<T>>>();
  // use 'function' to retain the original context from the caller (use another this context)
  return function (...args: T[]): any {
    if (!bufferedCallsByThis.has(this)) {
      bufferedCallsByThis.set(this, []);
    }
    const bufferedCalls = bufferedCallsByThis.get(this);
    const isFirstCall = bufferedCalls.length === 0;
    bufferedCalls.push(args);
    if (isFirstCall) {
      // use '=>' to keep the context within this function (don't create a new this context)
      setTimeout(() => {
        const calls = bufferedCalls;
        bufferedCallsByThis.delete(this);
        originalFunction.call(this, calls);
      }, bufferTime);
    }
  }
}

export function buffer(args: {bufferTime?: number} = {}) {
  const bufferTime = args.bufferTime ?? 0;

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
    
    const bufferMethod = bufferInternal(
      bufferTime,
      descriptor.get ? descriptor.get() : descriptor.value
    )
    if (descriptor.get) {
      descriptor.set(bufferMethod);
    } else {
      descriptor.value = bufferMethod;
    }
  };
}