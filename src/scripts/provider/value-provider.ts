import { Stoppable } from "../lib/utils/stoppable";

/**
 * Allow to request a value before it may have been initialized, queueing the requests if the value is missing
 */
 export class ValueProvider<T = any> {
  private nextListenerId = 0;
  private listeners = new Map<number, (value?: T) => void>();
  private valueProvided = false;
  private value: T;
  private requestFirstQueue: Array<(value?: T) => void> = [];

  constructor(value?: T) {
    this.value = value;
    this.valueProvided = true;
  }

  public listenFirst(): Promise<T> {
    if (this.valueProvided) {
      return new Promise((resolve) => {
        resolve(this.value);
      });
    } else {
      return new Promise((resolve) => {
        // I believe, in theory, the value could be set before this callback function is executed
        if (this.valueProvided) {
          resolve(this.value);
        } else {
          this.requestFirstQueue.push(resolve);
        }
      });
    }
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
    for (const callback of this.requestFirstQueue) {
      callback(value);
    }
    for (const callback of this.listeners.values()) {
      callback(value);
    }
    this.requestFirstQueue = [];
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