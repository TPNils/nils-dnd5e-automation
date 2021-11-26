import { staticValues } from "../static-values";

export interface IDmlTrigger<T extends foundry.abstract.Document<any, any>> {
  readonly type: {new(...args: any[]): T, documentName: string};
  
  // TODO async before triggers, Hooks does not support async hooks

  /**
   * A hook event that fires for every Document type before execution of a creation workflow.
   * This hook only fires for the client who is initiating the creation request.
   * 
   * The hook provides the pending document instance which will be used for the Document creation.
   * 
   * @returns Explicitly return false to prevent creation of this Document
   */
  beforeCreate?(context: IDmlContext<T>): boolean | void;
  /**
   * A hook event that fires for every Document type before execution of an update workflow.
   * This hook only fires for the client who is initiating the update request.
   * 
   * Hooked functions may modify that data
   * 
   * @returns Explicitly return false to prevent update of this Document
   */
  beforeUpdate?(context: IDmlContext<T>): boolean | void;
  beforeUpsert?(context: IDmlContext<T>): boolean | void;
  /**
   * A hook event that fires for every Document type before execution of a deletion workflow.
   * This hook only fires for the client who is initiating the delete request.
   * 
   * @returns Explicitly return false to prevent deletion of this Document
   */
  beforeDelete?(context: IDmlContext<T>): boolean | void;
  

  /**
   * A hook event that fires for every Document type after execution of a creation workflow.
   * This hook only fires for the client who is initiating the creation request.
   * 
   * The hook provides the commited document instance can be modified, which will trigger another update.
   */
   create?(context: IDmlContext<T>): void | Promise<void>;
   /**
    * A hook event that fires for every Document type after execution of an update workflow.
    * This hook only fires for the client who is initiating the update request.
    * 
   * The hook provides the commited document instance can be modified, which will trigger another update.
    */
   update?(context: IDmlContext<T>): void | Promise<void>;
   upsert?(context: IDmlContext<T>): void | Promise<void>;


  /**
   * A hook event that fires for every embedded Document type after conclusion of a creation workflow.
   * This hook fires for all connected clients after the creation has been processed.
   */
  afterCreate?(context: IDmlContext<T>): void | Promise<void>;
  /**
   * A hook event that fires for every Document type after conclusion of an update workflow.
   * This hook fires for all connected clients after the update has been processed.
   */
  afterUpdate?(context: IDmlContext<T>): void | Promise<void>;
  afterUpsert?(context: IDmlContext<T>): void | Promise<void>;
  /**
   * A hook event that fires for every Document type after conclusion of an deletion workflow.
   * This hook fires for all connected clients after the deletion has been processed.
   */
  afterDelete?(context: IDmlContext<T>): void | Promise<void>;
}

export interface IDmlContext<T extends foundry.abstract.Document<any, any>> {
  readonly rows: ReadonlyArray<{
    newRow: T,
    oldRow?: T
  }>;
  readonly options: {[key: string]: any};
  readonly userId: string;
}

export interface IUnregisterTrigger {
  unregister(): void;
}

class UnregisterTriggerGroup implements IUnregisterTrigger {
  constructor(private readonly hooks: ReadonlyArray<{hook: string, id: number} | IUnregisterTrigger>){}

  public unregister(): void {
    for (const hook of this.hooks) {
      if (UnregisterTriggerGroup.isIUnregisterTrigger(hook)) {
        hook.unregister();
      } else {
        Hooks.off(hook.hook, hook.id);
      }
    }
  }

  private static isIUnregisterTrigger(hook: any): hook is IUnregisterTrigger {
    return typeof hook.unregister === 'function';
  }
}

export class DmlTrigger {
  private static afterWrappersByHook = new Map<string, WrapAfter<any>>();

  public static registerTrigger<T extends foundry.abstract.Document<any, any>>(trigger: IDmlTrigger<T>): IUnregisterTrigger {
    const hooks: Array<{hook: string, id: number} | IUnregisterTrigger> = [];
  
    // before
    if (typeof trigger.beforeCreate === 'function') {
      hooks.push({
        hook: `preCreate${trigger.type.documentName}`,
        id: Hooks.on(`preCreate${trigger.type.documentName}`, wrapBeforeCreate(trigger.beforeCreate.bind(trigger))),
      });
    }
    if (typeof trigger.beforeUpdate === 'function') {
      hooks.push({
        hook: `preUpdate${trigger.type.documentName}`,
        id: Hooks.on(`preUpdate${trigger.type.documentName}`, wrapBeforeUpdate(trigger.beforeUpdate.bind(trigger))),
      });
    }
    if (typeof trigger.beforeUpsert === 'function') {
      hooks.push({
        hook: `preCreate${trigger.type.documentName}`,
        id: Hooks.on(`preCreate${trigger.type.documentName}`, wrapBeforeCreate(trigger.beforeUpsert.bind(trigger))),
      });
      hooks.push({
        hook: `preUpdate${trigger.type.documentName}`,
        id: Hooks.on(`preUpdate${trigger.type.documentName}`, wrapBeforeUpdate(trigger.beforeUpsert.bind(trigger))),
      });
    }
    if (typeof trigger.beforeDelete === 'function') {
      hooks.push({
        hook: `preDelete${trigger.type.documentName}`,
        id: Hooks.on(`preDelete${trigger.type.documentName}`, wrapBeforeDelete(trigger.beforeDelete.bind(trigger))),
      });
    }
  
    // after
    if (typeof trigger.afterCreate === 'function') {
      const hook = `create${trigger.type.documentName}`;
      if (!DmlTrigger.afterWrappersByHook.has(hook)) {
        DmlTrigger.afterWrappersByHook.set(hook, new WrapAfterCreate(hook));
      }
      hooks.push(DmlTrigger.afterWrappersByHook.get(hook).register(trigger.afterCreate.bind(trigger)));
    }
    if (typeof trigger.afterUpdate === 'function') {
      const hook = `update${trigger.type.documentName}`;
      if (!DmlTrigger.afterWrappersByHook.has(hook)) {
        DmlTrigger.afterWrappersByHook.set(hook, new WrapAfterUpdate(hook));
      }
      hooks.push(DmlTrigger.afterWrappersByHook.get(hook).register(trigger.afterUpdate.bind(trigger)));
    }
    if (typeof trigger.afterUpsert === 'function') {
      {
        const hook = `create${trigger.type.documentName}`;
        if (!DmlTrigger.afterWrappersByHook.has(hook)) {
          DmlTrigger.afterWrappersByHook.set(hook, new WrapAfterCreate(hook));
        }
        hooks.push(DmlTrigger.afterWrappersByHook.get(hook).register(trigger.afterUpsert.bind(trigger)));
      }
      {
        const hook = `update${trigger.type.documentName}`;
        if (!DmlTrigger.afterWrappersByHook.has(hook)) {
          DmlTrigger.afterWrappersByHook.set(hook, new WrapAfterUpdate(hook));
        }
        hooks.push(DmlTrigger.afterWrappersByHook.get(hook).register(trigger.afterUpsert.bind(trigger)));
      }
    }
    if (typeof trigger.afterDelete === 'function') {
      const hook = `delete${trigger.type.documentName}`;
      if (!DmlTrigger.afterWrappersByHook.has(hook)) {
        DmlTrigger.afterWrappersByHook.set(hook, new WrapAfterDelete(hook));
      }
      hooks.push(DmlTrigger.afterWrappersByHook.get(hook).register(trigger.afterDelete.bind(trigger)));
    }

    // after but you can update
    if (typeof trigger.create === 'function') {
      const hook = `create${trigger.type.documentName}`;
      if (!DmlTrigger.afterWrappersByHook.has(hook)) {
        DmlTrigger.afterWrappersByHook.set(hook, new WrapAfterCreate(hook));
      }
      hooks.push(DmlTrigger.afterWrappersByHook.get(hook).registerDml(trigger.create.bind(trigger)));
    }
    if (typeof trigger.update === 'function') {
      const hook = `update${trigger.type.documentName}`;
      if (!DmlTrigger.afterWrappersByHook.has(hook)) {
        DmlTrigger.afterWrappersByHook.set(hook, new WrapAfterUpdate(hook));
      }
      hooks.push(DmlTrigger.afterWrappersByHook.get(hook).registerDml(trigger.update.bind(trigger)));
    }
    if (typeof trigger.upsert === 'function') {
      {
        const hook = `create${trigger.type.documentName}`;
        if (!DmlTrigger.afterWrappersByHook.has(hook)) {
          DmlTrigger.afterWrappersByHook.set(hook, new WrapAfterCreate(hook));
        }
        hooks.push(DmlTrigger.afterWrappersByHook.get(hook).registerDml(trigger.upsert.bind(trigger)));
      }
      {
        const hook = `update${trigger.type.documentName}`;
        if (!DmlTrigger.afterWrappersByHook.has(hook)) {
          DmlTrigger.afterWrappersByHook.set(hook, new WrapAfterUpdate(hook));
        }
        hooks.push(DmlTrigger.afterWrappersByHook.get(hook).registerDml(trigger.upsert.bind(trigger)));
      }
    }

    // Special usecases
    // @ts-ignore
    if (trigger.type === User) {
      // I am unsure if targetToken allows 'before' functionality (editing the record), to be save, only tigger after
      if (typeof trigger.afterUpdate === 'function') {
        hooks.push({
          hook: `targetToken`,
          id: Hooks.on(`targetToken`, wrapTargetToken(trigger.afterUpdate.bind(trigger))),
        });
      }
    }
  
    return new UnregisterTriggerGroup(hooks);
  }
}

function wrapBeforeCreate<T extends foundry.abstract.Document<any, any> & {constructor: new (...args: any[]) => T}>(callback: (context: IDmlContext<T>) => boolean | void): (document: T, options: IDmlContext<T>['options'], userId: string) => void {
  return (document: T, options: IDmlContext<T>['options'], userId: string) => {
    return callback({
      rows: [{newRow: document}],
      options: options,
      userId: userId
    });
  }
}
function wrapBeforeUpdate<T extends foundry.abstract.Document<any, any> & {constructor: new (...args: any[]) => T}>(callback: (context: IDmlContext<T>) => boolean | void): (document: T, change: any, options: IDmlContext<T>['options'], userId: string) => void {
  return (document: T & {constructor: new (...args: any[]) => T}, change: any, options: IDmlContext<T>['options'], userId: string) => {
    const modifiedData = mergeObject(document.toObject(), change, {inplace: false});
    const modifiedDocument = new document.constructor(modifiedData, {parent: document.parent, pack: document.pack});
    const response = callback({
      rows: [{newRow: modifiedDocument, oldRow: document}],
      options: options,
      userId: userId
    });
    if (response === false) {
      return false;
    }
    
    const diff: any = diffObject(document.toObject(), modifiedDocument.data, {inner: false});
    mergeObject(change, diff);
  }
}
const wrapBeforeDelete = wrapBeforeCreate;


abstract class WrapAfter<T extends foundry.abstract.Document<any, any>> {

  private nextInternalId = 0;
  private hookId: number;
  protected callbacks = new Map<number, (context: IDmlContext<T>) => void | Promise<void>>();
  protected dmlCallbacks = new Map<number, (context: IDmlContext<T>) => void | Promise<void>>();

  constructor(
    private hookName: string,
  ) {}

  protected getNextId(): number {
    return this.nextInternalId++;
  }

  public register(callback: (context: IDmlContext<T>) => void | Promise<void>): IUnregisterTrigger {
    const id = this.getNextId();
    this.callbacks.set(id, callback);
    if (!this.hookId) {
      this.hookId = Hooks.on(`${this.hookName}`, this.execute.bind(this));
    }

    return this.getIUnregisterTrigger(id);
  }

  public registerDml(callback: (context: IDmlContext<T>) => void | Promise<void>): IUnregisterTrigger {
    const id = this.getNextId();
    this.dmlCallbacks.set(id, callback);
    if (!this.hookId) {
      this.hookId = Hooks.on(`${this.hookName}`, this.execute.bind(this));
    }

    return this.getIUnregisterTrigger(id);
  }

  protected getIUnregisterTrigger(id: number): IUnregisterTrigger {
    return {
      unregister: () => {
        this.callbacks.delete(id);
        this.dmlCallbacks.delete(id);
        if (this.callbacks.size === 0 && this.dmlCallbacks.size === 0) {
          Hooks.off(`${this.hookName}`, this.hookId);
          this.hookId = null;
        }
      }
    }
  }

  protected abstract execute(...args: any[]): Promise<void>;
}

class WrapAfterCreate<T extends foundry.abstract.Document<any, any> & {constructor: new (...args: any[]) => T}> extends WrapAfter<T> {

  protected async execute(document: T, options: IDmlContext<T>['options'], userId: string): Promise<void> {
    // Don't allow updates directly on the original document
    let documentSnapshot = new document.constructor(deepClone(document.data), {parent: document.parent, pack: document.pack});
    let context: IDmlContext<T> = {
      rows: [{newRow: documentSnapshot}],
      options: options,
      userId: userId
    };

    // Keep the order of when they were added
    const callbackIds = Array.from(this.callbacks.keys()).sort();
    for (const callbackId of callbackIds) {
      await this.callbacks.get(callbackId)(context);
    }

    if (game.userId === userId) {
      let documentSnapshot = new document.constructor(deepClone(document.data), {parent: document.parent, pack: document.pack});
      let context: IDmlContext<T> = {
        rows: [{newRow: documentSnapshot}],
        options: options,
        userId: userId
      };

      const dmlCallbackIds = Array.from(this.dmlCallbacks.keys()).sort();
      for (const callbackId of dmlCallbackIds) {
        await this.dmlCallbacks.get(callbackId)(context);
      }

      const diff = findDiff(document.data, documentSnapshot.data);
      if (diff.changed) {
        if (options?.[staticValues.moduleName]?.recursiveUpdate > 5) {
          console.error('Infinite update loop. Stopping any further updates.', {diff: diff});
        } else {
          await document.update(diff.diff, {[staticValues.moduleName]: {recursiveUpdate: (options?.[staticValues.moduleName]?.recursiveUpdate ?? 0) + 1}});
        }
      }
    }
  }

}

class WrapAfterUpdate<T extends foundry.abstract.Document<any, any> & {constructor: new (...args: any[]) => T}> extends WrapAfter<T> {

  protected async execute(document: T & {constructor: new (...args: any[]) => T}, change: any, options: IDmlContext<T>['options'], userId: string): Promise<void> {
    const modifiedData = mergeObject(document.toObject(), change, {inplace: false});
    const modifiedDocument = new document.constructor(modifiedData, {parent: document.parent, pack: document.pack});
    let documentSnapshot = new document.constructor(deepClone(modifiedDocument.data), {parent: document.parent, pack: document.pack});
    let context = {
      rows: [{newRow: documentSnapshot}],
      options: options,
      userId: userId
    };

    // Keep the order of when they were added
    const callbackIds = Array.from(this.callbacks.keys()).sort();
    for (const callbackId of callbackIds) {
      await this.callbacks.get(callbackId)(context);
    }

    if (game.userId === userId) {
      documentSnapshot = new document.constructor(deepClone(modifiedDocument.data), {parent: document.parent, pack: document.pack});
      context = {
        rows: [{newRow: documentSnapshot}],
        options: options,
        userId: userId
      };

      const dmlCallbackIds = Array.from(this.dmlCallbacks.keys()).sort();
      for (const callbackId of dmlCallbackIds) {
        await this.dmlCallbacks.get(callbackId)(context);
      }

      const diff = findDiff(modifiedDocument.data, documentSnapshot.data);
      if (diff.changed) {
        if (options?.[staticValues.moduleName]?.recursiveUpdate > 5) {
          console.error('Infinite update loop. Stopping any further updates.', {diff: diff});
        } else {
          await modifiedDocument.update(diff.diff, {[staticValues.moduleName]: {recursiveUpdate: (options?.[staticValues.moduleName]?.recursiveUpdate ?? 0) + 1}});
        }
      }
    }
  }

}

class WrapAfterDelete<T extends foundry.abstract.Document<any, any> & {constructor: new (...args: any[]) => T}> extends WrapAfter<T> {
  
  protected async execute(document: T, options: IDmlContext<T>['options'], userId: string): Promise<void> {
    // Don't allow updates directly on the original document
    let documentSnapshot = new document.constructor(deepClone(document.data), {parent: document.parent, pack: document.pack});
    let context: IDmlContext<T> = {
      rows: [{newRow: documentSnapshot}],
      options: options,
      userId: userId
    };

    // Keep the order of when they were added
    const callbackIds = Array.from(this.callbacks.keys()).sort();
    for (const callbackId of callbackIds) {
      await this.callbacks.get(callbackId)(context);
    }
  }

  public registerDml(arg: any): IUnregisterTrigger {
    // What are you going to do, update a record that has been deleted (:
    throw new Error('registerDml is not supported for deletes')
  }

}

function wrapTargetToken<T extends foundry.abstract.Document<any, any> & {constructor: new (...args: any[]) => T}>(callback: (context: IDmlContext<T>) => void | Promise<void>): (user: T, token: TokenDocument, arg3: boolean) => void {
  return (user: T, token: TokenDocument, arg3: boolean) => {
    return callback({
      rows: [{newRow: user}],
      options: {},
      userId: user.id
    });
  }
}

function findDiff(original: any, override: any): {changed: boolean, diff?: any} {
  if (original === override) {
    return {changed: false};
  }
  const originalType = typeof original;
  const overrideType = typeof override;

  if (originalType !== overrideType) {
    return {changed: true, diff: override};
  }

  if (Array.isArray(original) !== Array.isArray(override)) {
    return {changed: true, diff: override};
  }

  if (original === null && override !== null) {
    // null is an object, undefined is it's own type
    return {changed: true, diff: override};
  }

  if (originalType === 'object') {
    const keys = new Set([...Object.keys(original), ...Object.keys(override)]);
    const diff: any = Array.isArray(original) ? [] : {};
    for (const key of keys) {
      const itemResult = findDiff(original[key], override[key]);
      if (itemResult.changed) {
        diff[key] = itemResult.diff;
      }
    }
    if (Object.keys(diff).length > 0) {
      if (Array.isArray(override)) {
        // Foundry can't handle partial array dml updates
        return {changed: true, diff: override};
      }
      return {changed: true, diff: diff};
    } else {
      return {changed: false};
    }
  } else {
    if (original === override) {
      return {changed: false};
    } else {
      return {changed: true, diff: override};
    }
  }
}
