/**
 * Allow to request a value before it may have been initialized, queueing the requests if the value is missing
 */
 export class ValueProvider<T> {
  private valueProvided = false;
  private value: T;
  private queue: Array<(value?: T) => void> = [];

  public get(): Promise<T> {
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
          this.queue.push(resolve);
        }
      });
    }
  }

  public getSync(): T {
    return this.value;
  }

  public isSet(): boolean {
    return this.valueProvided;
  }

  public set(value: T): void {
    this.valueProvided = true;
    this.value = value;
    for (const callback of this.queue) {
      callback(value);
    }
    this.queue = [];
  }
}