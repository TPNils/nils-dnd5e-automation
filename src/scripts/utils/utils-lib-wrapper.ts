import { RunOnce } from "../lib/decorator/run-once";
import { Stoppable } from "../lib/utils/stoppable";
import { staticValues } from "../static-values";
import { UtilsHooks } from "./utils-hooks";
import { UtilsLog } from "./utils-log";

let libWrapperResolve: () => void;
const libWrapperResolvePromise = new Promise<void>((resolve) => libWrapperResolve = resolve);

function isLibWrapperActive(): boolean {
  return game.modules.get('lib-wrapper')?.active === true;
}

function getGlobalProperty(key: string): any {
  if (!key) {
    return undefined;
  }
  const path = key.split('.');
  const rootPath = path.splice(0, 1)[0];
  let target: any;
  if (rootPath in globalThis) {
    target = globalThis[rootPath];
  } else if (/^[a-z][a-z0-9]*$/i.test(rootPath)) {
    // Some "global" variables are not in the globalThis scope
    target = eval(rootPath);
  } else {
    throw new Error(`Could not find the global variable ${rootPath} for key: ${key}`)
  }
  for (let prop of path) {
    target = target[prop];
    if (target == null) {
      return target
    }
  }
  return target;
}

interface FuncData {
  readonly id: number;
  readonly fn: libWrapper.Func;
  readonly type: 'WRAPPER' | 'MIXED' | 'OVERRIDE';
  readonly stoppable: Stoppable;
}

const modifiedFunctionsByTarget = new Map<string, ModifiedFunctionWrapper>();
class ModifiedFunctionWrapper {
  public originalFunction?: (...args: any[]) => any;
  public functions = new Map<number, FuncData>();
  #nextFnId = 0;

  private constructor(public readonly target: string) {}

  public add(fn: libWrapper.Func, type: 'WRAPPER' | 'MIXED' | 'OVERRIDE'): Stoppable {
    try {
      const id = this.#nextFnId++;
      this.functions.set(id, {
        fn,
        type,
        id,
        stoppable: {
          stop: () => {
            this.functions.delete(id);
            if (this.functions.size === 0) {
              if (isLibWrapperActive()) {
                libWrapper.unregister(staticValues.moduleName, this.target);
              } else {
                const parentTarget = this.target.split('.');
                const childProp = parentTarget.pop();
                const parent = getGlobalProperty(parentTarget.join('.'));
                parent[childProp] = this.originalFunction;
              }
              modifiedFunctionsByTarget.delete(this.target);
            }
          }
        }
      });
      if (type === 'OVERRIDE' && Array.from(this.functions.values()).find(fn => fn.type === 'OVERRIDE')) {
        throw new Error(`Can't have multiple overrides for target: ${type}`);
      }
      if (this.functions.size === 1) {
        if (isLibWrapperActive()) {
          libWrapper.register(staticValues.moduleName, this.target, this.createExecFunc(), 'MIXED');
        } else {
          const parentTarget = this.target.split('.');
          const childProp = parentTarget.pop();
          const parent = getGlobalProperty(parentTarget.join('.'));
          this.originalFunction = parent[childProp];
          const execFunc = this.createExecFunc();
          const that = this;
          parent[childProp] = function(...args: any[]) {
            return execFunc.call(this, that.originalFunction, ...args);
          }
        }
      }
      return this.functions.get(id).stoppable;
    } catch (e) {
      UtilsLog.error(`Error occurred when trying to ${type} ${this.target}`);
      throw e;
    }
  }

  private createExecFunc(): libWrapper.Func {
    const that = this;
    return function (original: (...args: any[]) => any, ...args: any[]): any {
      const functionsByType = new Map<string, Function[]>();
      functionsByType.set('WRAPPER', []);
      functionsByType.set('MIXED', []);
      functionsByType.set('OVERRIDE', []);
      for (const fn of that.functions.values()) {
        functionsByType.get(fn.type).push(fn.fn);
      }

      const sortedFunctions = Array.from(that.functions.values()).sort(ModifiedFunctionWrapper.sortWrappedFunc);
      let index = 0;

      let originalFuncCalled = false;
      function doNext(...args: any[]): any {
        if (sortedFunctions.length === index) {
          originalFuncCalled = true;
          return original.apply(this, args)
        }
        const {fn} = sortedFunctions[index++];
        return fn.call(this, doNext.bind(this), ...args);
      }

      const validateLastCalled = () => {
        const lastExec = sortedFunctions[index-1];
        if (lastExec.type === 'WRAPPER' && !originalFuncCalled) {
          UtilsLog.error(`${lastExec.type} did not call the wrapper for ${that.target}, that function will be unregistered.`);
          lastExec.stoppable.stop();
        }
      }
      
      let response: any;
      do {
        response = doNext.apply(this, args);
        
        if (response instanceof Promise) {
          return response.then(async () => {
            validateLastCalled();

            while (sortedFunctions.length < index && sortedFunctions[index].type === 'WRAPPER' && !originalFuncCalled) {
              response = await doNext.apply(this, args);
              validateLastCalled();
            }
            
            return response;
          });
        }
        validateLastCalled();
      } while (sortedFunctions.length >= index-1 && sortedFunctions[index-1].type === 'WRAPPER' && !originalFuncCalled)

      return response;
    }
  }

  public static get(target: string): ModifiedFunctionWrapper {
    try {
      if (!modifiedFunctionsByTarget.has(target)) {
        modifiedFunctionsByTarget.set(target, new ModifiedFunctionWrapper(target));
        modifiedFunctionsByTarget.get(target).originalFunction = getGlobalProperty(target);
      }
      return modifiedFunctionsByTarget.get(target);
    } catch (e) {
      UtilsLog.error(`Error occurred when trying to get ${target}`);
      throw e;
    }
  }

  private static sortWrappedFunc(a: {type: 'WRAPPER' | 'MIXED' | 'OVERRIDE'}, b: {type: 'WRAPPER' | 'MIXED' | 'OVERRIDE'}): number {
    return ModifiedFunctionWrapper.typeToNr(a.type) - ModifiedFunctionWrapper.typeToNr(b.type);
  }

  private static typeToNr(type: 'WRAPPER' | 'MIXED' | 'OVERRIDE'): number {
    switch (type) {
      case 'WRAPPER': return 2;
      case 'MIXED': return 1;
      case 'OVERRIDE': return 0;
    }
    return 0;
  }

}

/**
 * lib-wrapper does not allow to register multiple overrides
 * This utility allows me to do this and also make lib-wrapper an optional dependency
 */
export class UtilsLibWrapper {

  /**
   *  Use if your wrapper will *always* continue the chain.
   *  This type has priority over every other type. It should be used whenever possible as it massively reduces the likelihood of conflicts.
   *  Note that the library will auto-detect if you use this type but do not call the original function, and automatically unregister your wrapper.
   */
  public static wrapper(target: string, fn: libWrapper.Func): Promise<Stoppable> {
    return libWrapperResolvePromise.then(() => ModifiedFunctionWrapper.get(target).add(fn, 'WRAPPER'));
  }

  /**
   * Default type. Your wrapper will be allowed to decide whether it continue the chain or not.
   * These will always come after 'WRAPPER'-type wrappers. Order is not guaranteed, but conflicts will be auto-detected.
   */
  public static mixed(target: string, fn: libWrapper.Func): Promise<Stoppable> {
    return libWrapperResolvePromise.then(() => ModifiedFunctionWrapper.get(target).add(fn, 'MIXED'));
  }

  /**
   * Use if your wrapper will *never* continue the chain. This type has the lowest priority, and will always be called last.
   * If another package already has an 'OVERRIDE' wrapper registered to the same method, using this type will throw a <libWrapper.LibWrapperAlreadyOverriddenError> exception.
   * Catching this exception should allow you to fail gracefully, and for example warn the user of the conflict.
   * Note that if the GM has explicitly given your package priority over the existing one, no exception will be thrown and your wrapper will take over.
   */
  public static override(target: string, fn: libWrapper.Func): Promise<Stoppable> {
    return libWrapperResolvePromise.then(() => ModifiedFunctionWrapper.get(target).add(fn, 'OVERRIDE'));
  }

  @RunOnce()
  public static registerHooks() {
    Hooks.once('libWrapper.Ready', libWrapperResolve);
    // fallback
    UtilsHooks.ready(libWrapperResolve);
  }

}