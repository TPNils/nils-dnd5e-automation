import { Stoppable } from "../lib/utils/stoppable";

export type ValueReaderType<T> = T extends null | undefined ? T :
  T extends ValueProvider & { get(): infer F } ? 
    ValueReader<F> : T;

export abstract class ValueReader<T> implements ValueReader<T> {
  public listenFirst(): Promise<T> {
    return new Promise((resolve) => {
      let shouldStop = false;
      const stoppable = this.listen(value => {
        shouldStop = true;
        if (stoppable != null) {
          stoppable.stop();
        }
        resolve(value);
      });
      if (shouldStop) {
        stoppable.stop();
      }
    });
  }
  public abstract get(): T;
  public abstract isSet(): boolean;
  public abstract listen(callback: (value?: T) => void): Stoppable;

  public switchMap<R>(transformer: (value: T) => ValueReader<R>): ValueReader<R> {
    return new SwitchMap<T, R>(this, transformer);
  }

  public map<R>(transformer: (value: T) => R): ValueReader<R> {
    return new Mapper<T, R>(this, transformer);
  }

}

/**
 * Allow to request a value before it may have been initialized, queueing the requests if the value is missing
 */
export class ValueProvider<T = any> extends ValueReader<T> {
  private nextListenerId = 0;
  private listeners = new Map<number, (value?: T) => void>();
  private valueProvided = false;
  private value: T;

  constructor(value?: T) {
    super();
    this.value = value;
    this.valueProvided = value !== undefined;
  }

  public get(): T {
    return this.value;
  }

  public isSet(): boolean {
    return this.valueProvided;
  }

  public set(value: T): void {
    this.valueProvided = true;
    this.value = value;
    for (const callback of this.listeners.values()) {
      callback(value);
    }
  }

  public listen(callback: (value?: T) => void): Stoppable {
    const id = this.nextListenerId++;
    this.listeners.set(id, callback);
    if (this.valueProvided) {
      callback(this.value);
    }
    return {
      stop: () => {
        this.listeners.delete(id);
      }
    }
  }

}

class SwitchMap<D, T> extends ValueReader<T> {
  constructor(
    private readonly delegate: ValueReader<D>,
    private readonly transformer: (value: D) => ValueReader<T>
  ){
    super();
  }

  public async listenFirst(): Promise<T> {
    const value = await this.delegate.listenFirst();
    return this.transformer(value).listenFirst();
  }

  public get(): T {
    const value = this.delegate.get();
    return this.transformer(value).get();
  }

  public isSet(): boolean {
    throw this.delegate.isSet();
  }

  public listen(callback: (value?: T) => void): Stoppable {
    return this.delegate.listen(async value => {
      callback(await this.transformer(value).listenFirst());
    })
  }
}

class Mapper<D, T> extends ValueReader<T> {
  constructor(
    private readonly delegate: ValueReader<D>,
    private readonly transformer: (value: D) => T
  ){
    super();
  }

  public async listenFirst(): Promise<T> {
    const value = await this.delegate.listenFirst();
    return this.transformer(value);
  }

  public get(): T {
    const value = this.delegate.get();
    return this.transformer(value);
  }

  public isSet(): boolean {
    throw this.delegate.isSet();
  }

  public listen(callback: (value?: T) => void): Stoppable {
    return this.delegate.listen(async value => {
      callback(await this.transformer(value));
    })
  }
}