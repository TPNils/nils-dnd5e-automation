import { RefValueWrite } from "../lib/ref-value/ref-value-write";
import { Stoppable } from "../lib/utils/stoppable";

/**
 * Allow to request a value before it may have been initialized, queueing the requests if the value is missing
 * // TODO @deprecated
 * @deprecated
 */
 export class ValueProvider<T = any> {
  private delegate: RefValueWrite<T>;

  constructor(value?: T) {
    this.delegate = new RefValueWrite(value);
  }

  public listenFirst(): Promise<T> {
    return this.delegate.once();
  }

  public get(): T {
    return this.delegate.get();
  }

  public isSet(): boolean {
    return this.delegate.isSet();
  }

  public set(value: T): void {
    this.delegate.set(value);
  }

  public listen(callback: (value?: T) => void): Stoppable {
    return this.delegate.listen(callback);
  }
}