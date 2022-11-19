class RerenderQueue {
  private queueNextAnimationFrame = window.requestAnimationFrame.bind(window) || ((cb: () => void) => setTimeout(cb, 16/*~60fps*/));
  private queueKeys: Array<any> = [];
  private queueExecs: Array<() => any> = [];
  private promiseResolvers: Array<{resolve: (value: any) => void, reject: (err: any) => void}> = [];
  private promises: Array<Promise<any>> = [];

  public add<T extends () => R, R>(exec: T, dedupeKey?: any): Promise<R> {
    if (dedupeKey == null) {
      dedupeKey = exec;
    }
    let index = this.queueKeys.indexOf(dedupeKey);
    if (index === -1) {
      index = this.queueKeys.length;
      this.queueKeys.push(dedupeKey);
      this.queueExecs.push(exec);
      this.promises.push(new Promise<R>((resolve, reject) => this.promiseResolvers[index] = {resolve, reject}));
    }
    if (index === 0) {
      this.queueNextAnimationFrame(() => this.processQueue());
    }
    return this.promises[index];
  }

  public isInQueue(dedupeKey: any): boolean {
    return this.queueKeys.includes(dedupeKey);
  }

  public delete(dedupeKey: any): void {
    let index = this.queueKeys.indexOf(dedupeKey);
    if (index > -1) {
      this.queueKeys.splice(index, 1);
      this.queueExecs.splice(index, 1);
      this.promiseResolvers.splice(index, 1);
      this.promises.splice(index, 1);
    }
  }

  private processQueue(): void {
    while (this.queueExecs.length > 0) {
      const queue = this.queueExecs;
      const promiseResolvers = this.promiseResolvers;
      this.queueKeys = [];
      this.queueExecs = [];
      this.promiseResolvers = [];
      this.promises = [];

      for (let i = 0; i < queue.length; i++) {
        try {
          promiseResolvers[i].resolve(queue[i]());
        } catch (e) {
          promiseResolvers[i].reject(e);
        }
      }
    } 
  }

}

export const rerenderQueue = new RerenderQueue();