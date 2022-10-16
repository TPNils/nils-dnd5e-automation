import { Stoppable } from "../utils/stoppable";
import { RefValueWrite } from "./ref-value-write";

type ObjectWithRefReturnTypes<T> = {
  [P in keyof T]: RefValueRead<T[P]>
};

export abstract class RefValueRead<T = any> {

  /**
   * Will return the first emit from {@see RefValueRead.listen} as a promise.
   */
  public abstract once(): Promise<T>;
  /**
   * Get the current set value.
   */
  public abstract get(): T | null;
  /**
   * If a value has been set.
   */
  public abstract isSet(): boolean;
  /**
   * Listen to changes of this value.
   * Will immidiatly emit if a value was already set.
   */
  public abstract listen(callback: (value?: T) => void): Stoppable;
  
  public static merge<T extends { [key: string]: RefValueRead<any> }>(obj: T): RefValueRead<ObjectWithRefReturnTypes<T>> {
    return new RefValueReadMerge<T>(obj).toReadonly();
  }

}

class RefValueReadMerge<T extends { [key: string]: RefValueRead<any> }> extends RefValueWrite<ObjectWithRefReturnTypes<T>> {

  private pendingKeys: Set<keyof ObjectWithRefReturnTypes<T>>;
  private compoundValue = {} as ObjectWithRefReturnTypes<T>;
  private stoppables: Stoppable[] = [];
  private isListening = false;
  constructor(private readonly obj: T) {
    super();
  }

  public listen(callback: (value?: ObjectWithRefReturnTypes<T>) => void): Stoppable {
    this.startListening();
    return super.listen(callback);
  }

  private startListening(): void {
    if (this.isListening) {
      return;
    }
    this.pendingKeys = new Set(Object.keys(this.obj));
    this.isListening = true;
    for (const key of this.pendingKeys) {
      this.stoppables.push(this.obj[key].listen(value => this.setProperty(key, value)));
    }
  }

  private setProperty(key: keyof ObjectWithRefReturnTypes<T>, value: any) {
    this.compoundValue[key] = value;
    this.pendingKeys.delete(key);
    if (this.pendingKeys.size === 0) {
      this.set({...this.compoundValue});
    }
  }

  protected removeListener(id: number): boolean {
    if (super.removeListener(id)) {
      this.stopListening();
      return true;
    }
    return false;
  }

  private stopListening(): void {
    if (!this.isListening) {
      return;
    }
    for (const stoppable of this.stoppables) {
      stoppable.stop();
    }
    this.pendingKeys = null;
    this.stoppables = [];
    this.isListening = false;
  }

}
