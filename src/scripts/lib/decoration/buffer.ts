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
    
    const bufferInternal = new BufferInternal(
      bufferTime,
      descriptor.get ? descriptor.get() : descriptor.value
    )
    if (descriptor.get) {
      descriptor.set(bufferInternal.bufferMethod);
    } else {
      descriptor.value = bufferInternal.bufferMethod;
    }
  };
}

class BufferInternal<T> {
  constructor(
    private readonly bufferTime: number,
    private readonly originalFunction: (args: Array<Array<T>>) => any,
  ){}

  private bufferedCalls: Array<Array<T>> = [];
  public bufferMethod = (...args: T[]): any => {
    const isFirstCall = this.bufferedCalls.length === 0;
    this.bufferedCalls.push(args);
    if (isFirstCall) {
      setTimeout(() => {
        const bufferedCalls = this.bufferedCalls;
        this.bufferedCalls = [];
        this.originalFunction(bufferedCalls);
      }, this.bufferTime);
    }
  }
}