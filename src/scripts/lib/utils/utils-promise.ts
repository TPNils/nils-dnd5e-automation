export class TimeoutError extends Error {

}

export class UtilsPromise {

  public static maxDuration<T>(promise: Promise<T> | T, durationMs: number): Promise<T> {
    if (!(promise instanceof Promise)) {
      return Promise.resolve(promise);
    }

    let timeout: NodeJS.Timeout;
    const timeoutPromise = new Promise((resolve, reject) => {
      timeout = setTimeout(() => {
        reject(new TimeoutError(`Maximum duration reached (${durationMs}ms)`));
      }, durationMs);
    });

    promise.then(() => clearTimeout(timeout));

    return Promise.race<any>([promise, timeoutPromise]);
  }

  public static setTimeout(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, timeoutMs);
    });
  }

}