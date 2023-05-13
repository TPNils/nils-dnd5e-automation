import { ValueReader, ValueReaderType } from "../../provider/value-provider";

export class MaybeAsyncWrapper<T> {
  constructor(private value: T | Promise<T> | ValueReader<T>){}

  public then<R>(func: (value: T) => R): MaybeAsyncWrapper<R extends Promise<any> ? PromisedType<T> : R extends ValueReader<any> ? ValueReaderType<R> : R> {
    if (this.value instanceof Promise) {
      return new MaybeAsyncWrapper(this.value.then(func) as any);
    } else if (this.value instanceof ValueReader) {
      return new MaybeAsyncWrapper(this.value.map(func) as any);
    } else {
      return new MaybeAsyncWrapper(func(this.value) as any);
    }
  }

  public getValue(): T | Promise<T> | ValueReader<T> {
    return this.value;
  }
}