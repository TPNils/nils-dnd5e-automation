export interface SecureOptions {
  /* Default: true */
  write?: boolean;
  /* Default: true */
  throw?: boolean;
}

const secureOptionsSymbol = Symbol('SecureOptions');
const revokeAction = Symbol('revokeAction');
const securityHandler: ProxyHandler<object> = {
  set(target: object, p: string | symbol, receiver: any): boolean {
    if (p === secureOptionsSymbol) {
      return false;
    }
    if (target[secureOptionsSymbol]?.write !== false) {
      return Reflect.set(target, p, receiver);
    }
    return !target[secureOptionsSymbol]?.throw;
  }
}

export function applySecurity<T extends object>(instance: T, options: SecureOptions): T {
  if (instance[secureOptionsSymbol]) {
    throw new Error(`Security was already applied, update the options instance that was passed through.`);
  } else {
    instance[secureOptionsSymbol] = options;
    const resp = Proxy.revocable<T>(instance, securityHandler);
    instance[revokeAction] = resp.revoke;
    return resp.proxy;
  }
}

export function revokeSecurity<T extends object>(instance: T, options: SecureOptions): void {
  if (instance[secureOptionsSymbol] !== options) {
    throw new Error(`Options did not match, they need to match to verify access`);
  }
  instance[revokeAction]();
  delete instance[revokeAction];
  delete instance[secureOptionsSymbol];
}