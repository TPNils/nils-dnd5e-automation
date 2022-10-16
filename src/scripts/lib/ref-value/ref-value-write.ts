import { Stoppable } from "../utils/stoppable";
import { RefValueRead } from "./ref-value-read";

export class RefValueWrite<T = any> extends RefValueRead<T> {
  
  private nextListenerId = 0;
  private listeners = new Map<number, (value?: T) => void>();
  private valueProvided = false;
  private value: T;

  constructor(value?: T) {
    super();
    this.value = value;
    this.valueProvided = value !== undefined;
  }

  /** @inheritdoc */
  public once(): Promise<T> {
    return new Promise((resolve) => {
      const stoppable = this.listen(value => {
        resolve(value);
        stoppable.stop();
      })
    });
  }

  /** @inheritdoc */
  public get(): T {
    return this.value;
  }

  /** @inheritdoc */
  public isSet(): boolean {
    return this.valueProvided;
  }

  /**
   * Set a new value.
   */
  public set(value: T): void {
    this.valueProvided = true;
    this.value = value;
    for (const callback of this.listeners.values()) {
      callback(value);
    }
  }

  public toReadonly(): RefValueRead<T> {
    return new RefValueReadInternal(this);
  }

  /** @inheritdoc */
  public listen(callback: (value?: T) => void): Stoppable {
    const id = this.nextListenerId++;
    this.listeners.set(id, callback);
    if (this.valueProvided) {
      callback(this.value);
    }
    return {
      stop: () => this.removeListener(id),
    }
  }

  /**
   * @returns true if the last listener was removed
   */
  protected removeListener(id: number): boolean {
    this.listeners.delete(id);
    return this.listeners.size === 0;
  }

}

class RefValueReadInternal<T> extends RefValueRead<T> {

  constructor(
    private readonly delegate: RefValueRead<T>
  ) {
    super();
  }

  /** @inheritdoc */
  public once(): Promise<T> {
    return this.delegate.once();
  }

  /** @inheritdoc */
  public get(): T {
    return this.delegate.get();
  }

  /** @inheritdoc */
  public isSet(): boolean {
    return this.delegate.isSet();
  }

  /** @inheritdoc */
  public listen(callback: (value?: T) => void): Stoppable {
    return this.delegate.listen(callback);
  }

}