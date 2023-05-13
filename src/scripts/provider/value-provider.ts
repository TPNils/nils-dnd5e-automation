import { Stoppable } from "../lib/utils/stoppable";

export type ValueReaderType<T> = T extends null | undefined ? T :
  T extends ValueReader<any> & { listenFirst(): infer F } ? 
    Awaited<F> : T;

export abstract class ValueReader<T> implements ValueReader<T> {
  public listenFirst(): Promise<T> {
    return new Promise((resolve) => {
      let shouldStop = false;
      let stoppable: Stoppable;
      stoppable = this.listen(value => {
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
  public abstract listen(callback: (value?: T) => void): Stoppable;

  public switchMap<R>(transformer: (value: T) => ValueReader<R>): ValueReader<R> {
    return new SwitchMap<T, R>(this, transformer);
  }

  public map<R>(transformer: (value: T) => R): ValueReader<R> {
    return new Mapper<T, R>(this, transformer);
  }
  /**
   * @param predicate The filter method calls the predicate function one time for each element in the array.
   */
  public filter(predicate: (value: T) => boolean | Promise<boolean>): ValueReader<T> {
    return new Filter<T>(this, predicate);
  }

  public static mergeObject<T extends { [key: string]: ValueReader<any> | any }>(obj: T): ValueReader<ObjectWithRefReturnTypes<T>> {
    return new MergeObject<T>(obj);
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
    this.valueProvided = arguments.length > 0;
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

  public listen(callback: (value?: T) => void): Stoppable {
    let lastStoppable: Stoppable
    const delegateStoppable = this.delegate.listen(async value => {
      if (lastStoppable != null) {
        lastStoppable.stop();
      }
      lastStoppable = this.transformer(value).listen(callback)
    });
    return {
      stop: () => {
        delegateStoppable.stop();
        if (lastStoppable) {
          lastStoppable.stop();
        }
      }
    }
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

  public listen(callback: (value?: T) => void): Stoppable {
    return this.delegate.listen(async value => {
      callback(await this.transformer(value));
    })
  }
}

class Filter<T> extends ValueReader<T> {
  constructor(
    private readonly delegate: ValueReader<T>,
    private readonly predicate: (value: T) => boolean | Promise<boolean>
  ){
    super();
  }

  public listen(callback: (value?: T) => void): Stoppable {
    return this.delegate.listen(async value => {
      const response = this.predicate(value);
      if (response instanceof Promise) {
        response.then(r => callback(value));
      } else if (response) {
        callback(value);
      }
    })
  }
}

type ObjectWithRefReturnTypes<T> = {
  [P in keyof T]: ValueReaderType<T[P]>;
};
class MergeObject<T extends { [key: string]: ValueReader<any> }> extends ValueReader<ObjectWithRefReturnTypes<T>> {

  constructor(private readonly obj: T) {
    super();
  }

  public listen(callback: (value?: ObjectWithRefReturnTypes<T>) => void): Stoppable {
    const stoppables: Stoppable[] = [];
    const pendingKeys = new Set<keyof ObjectWithRefReturnTypes<T>>(Object.keys(this.obj));
    let compoundValue = {} as ObjectWithRefReturnTypes<T>;
    for (const key of pendingKeys) {
      const value = this.obj[key];
      if (value instanceof ValueReader) {
        stoppables.push(this.obj[key].listen(value => {
          compoundValue[key] = value;
          pendingKeys.delete(key);
          if (pendingKeys.size === 0) {
            callback({...compoundValue});
          }
        }));
      } else {
        compoundValue[key] = value;
        pendingKeys.delete(key);
        if (pendingKeys.size === 0) {
          callback({...compoundValue});
        }
      }
    }

    return {
      stop: () => {
        for (const stoppable of stoppables) {
          stoppable.stop();
        }
      }
    }
  }

}