import { staticValues } from "../../static-values";
import { UtilsCompare } from "../utils/utils-compare";

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

export class DmlTrigger {
  private static wrappersByHook = new Map<string, Wrapper<any>>();

  public static registerTrigger<T extends foundry.abstract.Document<any, any>>(trigger: IDmlTrigger<T>): IUnregisterTrigger {
    if (!this.wrappersByHook.has(trigger.type.documentName)) {
      this.wrappersByHook.set(trigger.type.documentName, new Wrapper<T>(trigger.type.documentName));
    }
  
    return this.wrappersByHook.get(trigger.type.documentName).register(trigger);
  }
}

class CallbackGroup<T extends foundry.abstract.Document<any, any>, R> {
  private nextId = 0;
  private callbacks = new Map<number, (context: IDmlContext<T>) => R>();
  private dmlCallbacks = new Map<number, (context: IDmlContext<T>) => R>();
  
  public register(callback: (context: IDmlContext<T>) => R): IUnregisterTrigger {
    const id = this.nextId++;
    this.callbacks.set(id, callback);

    return this.getIUnregisterTrigger(id);
  }

  public registerDml(callback: (context: IDmlContext<T>) => R): IUnregisterTrigger {
    const id = this.nextId++;
    this.dmlCallbacks.set(id, callback);

    return this.getIUnregisterTrigger(id);
  }

  public getCallbacks(): Array<(context: IDmlContext<T>) => R> {
    const callbackIds = Array.from(this.callbacks.keys()).sort();
    const callbacks = [];
    for (const callbackId of callbackIds) {
      callbacks.push(this.callbacks.get(callbackId));
    }
    return callbacks;
  }

  public getDmlCallbacks(): Array<(context: IDmlContext<T>) => R> {
    const callbackIds = Array.from(this.dmlCallbacks.keys()).sort();
    const callbacks = [];
    for (const callbackId of callbackIds) {
      callbacks.push(this.dmlCallbacks.get(callbackId));
    }
    return callbacks;
  }

  public isEmpty(): boolean {
    return this.callbacks.size === 0 && this.dmlCallbacks.size === 0;
  }
  
  protected getIUnregisterTrigger(id: number): IUnregisterTrigger {
    return {
      unregister: () => {
        this.callbacks.delete(id);
        this.dmlCallbacks.delete(id);
      }
    }
  }
}
class Wrapper<T extends foundry.abstract.Document<any, any>> {

  private isInit: boolean = false;
  private registeredFoundryHooks: Array<{hook: string, id: number}> = [];
  private beforeCallbackGroups = new Map<string, CallbackGroup<T, void | boolean>>();
  private afterCallbackGroups = new Map<string, CallbackGroup<T, void | Promise<void>>>();

  constructor(
    private readonly documentName: string,
  ) {}

  public register(trigger: IDmlTrigger<T>): IUnregisterTrigger {
    if (this.documentName !== trigger.type.documentName) {
      throw new Error(`Incompatible document types. Expected ${this.documentName} but got ${trigger.type.documentName}`)
    }
    
    if (!this.isInit) {
      this.init();
    }

    const unregisterTriggers: IUnregisterTrigger[] = [];
    // before
    if (typeof trigger.beforeCreate === 'function') {
      this.beforeCallbackGroups.get('preCreate').register(trigger.beforeCreate.bind(trigger));
    }
    if (typeof trigger.beforeUpdate === 'function') {
      this.beforeCallbackGroups.get('preUpdate').register(trigger.beforeUpdate.bind(trigger));
    }
    if (typeof trigger.beforeUpsert === 'function') {
      this.beforeCallbackGroups.get('preCreate').register(trigger.beforeUpsert.bind(trigger));
      this.beforeCallbackGroups.get('preUpdate').register(trigger.beforeUpsert.bind(trigger));
    }
    if (typeof trigger.beforeDelete === 'function') {
      this.beforeCallbackGroups.get('preDelete').register(trigger.beforeDelete.bind(trigger));
    }
  
    // after
    if (typeof trigger.afterCreate === 'function') {
      this.afterCallbackGroups.get('create').register(trigger.afterCreate.bind(trigger));
    }
    if (typeof trigger.afterUpdate === 'function') {
      this.afterCallbackGroups.get('update').register(trigger.afterUpdate.bind(trigger));
    }
    if (typeof trigger.afterUpsert === 'function') {
      this.afterCallbackGroups.get('create').register(trigger.afterUpsert.bind(trigger));
      this.afterCallbackGroups.get('update').register(trigger.afterUpsert.bind(trigger));
    }
    if (typeof trigger.afterDelete === 'function') {
      this.afterCallbackGroups.get('delete').register(trigger.afterDelete.bind(trigger));
    }

    // after but you can update
    if (typeof trigger.create === 'function') {
      this.afterCallbackGroups.get('create').registerDml(trigger.create.bind(trigger));
    }
    if (typeof trigger.update === 'function') {
      this.afterCallbackGroups.get('update').registerDml(trigger.update.bind(trigger));
    }
    if (typeof trigger.upsert === 'function') {
      this.afterCallbackGroups.get('create').registerDml(trigger.upsert.bind(trigger));
      this.afterCallbackGroups.get('update').registerDml(trigger.upsert.bind(trigger));
    }

    return {
      unregister: () => {
        for (const unregisterTrigger of unregisterTriggers) {
          unregisterTrigger.unregister();
        }
        let empty = true;
        for (const value of [...Array.from(this.beforeCallbackGroups.values()), ...Array.from(this.afterCallbackGroups.values())]) {
          if (!value.isEmpty()) {
            empty = false;
            break;
          }
        }
        if (empty) {
          this.unInit();
        }
      }
    }
  }

  private init(): void {
    this.beforeCallbackGroups = new Map();
    this.afterCallbackGroups = new Map();
    this.registeredFoundryHooks = ([
      ['preCreate', this.onFoundryBeforeCreate],
      ['preUpdate', this.onFoundryBeforeUpdate],
      ['preDelete', this.onFoundryBeforeDelete],
      ['create', this.onFoundryAfterCreate],
      ['update', this.onFoundryAfterUpdate],
      ['delete', this.onFoundryAfterDelete],
    ] as Array<[string, (...args: any[]) => any]>).map(([prefix, callback]) => {
      const hookName = `${prefix}${this.documentName}`;
      const hookId = Hooks.on(hookName, callback.bind(this));
      (prefix.startsWith('pre') ? this.beforeCallbackGroups : this.afterCallbackGroups).set(prefix, new CallbackGroup<T, any>());
      return {
        hook: hookName,
        id: hookId
      }
    });

    // Special usecases
    if (this.documentName === User.documentName) {
      this.registeredFoundryHooks.push({
        hook: `targetToken`,
        id: Hooks.on(`targetToken`, this.onFoundryTargetToken.bind.bind(this)),
      })
    }

    this.isInit = true;
  }

  private unInit(): void {
    this.beforeCallbackGroups = new Map();
    this.afterCallbackGroups = new Map();
    for (const hook of this.registeredFoundryHooks) {
      Hooks.off(hook.hook, hook.id);
    }
    this.registeredFoundryHooks = [];
    this.isInit = false;
  }

  //#region Before
  private onFoundryBeforeCreate(document: T & {constructor: new (...args: any[]) => T}, change: any, options: IDmlContext<T>['options'], userId: string): void | boolean {
    let context: IDmlContext<T> = {
      rows: [{newRow: document}],
      options: options,
      userId: userId
    };
    for (const callback of this.beforeCallbackGroups.get('preCreate').getCallbacks()) {
      const response = callback(context);
      if (response === false) {
        return false;
      }
    }
  }
  
  private onFoundryBeforeUpdate(document: T & {constructor: new (...args: any[]) => T}, change: any, options: IDmlContext<T>['options'], userId: string): void | boolean {
    const modifiedData = mergeObject(document.toObject(), change, {inplace: false});
    const modifiedDocument = new document.constructor(modifiedData, {parent: document.parent, pack: document.pack});
    let context: IDmlContext<T> = {
      rows: [{newRow: modifiedDocument, oldRow: document}],
      options: options,
      userId: userId,
    };
    for (const callback of this.beforeCallbackGroups.get('preUpdate').getCallbacks()) {
      const response = callback(context);
      if (response === false) {
        return false;
      }
    }
  }
  private onFoundryBeforeDelete(document: T & {constructor: new (...args: any[]) => T}, change: any, options: IDmlContext<T>['options'], userId: string): void | boolean {
    let context: IDmlContext<T> = {
      rows: [{newRow: document, oldRow: document}],
      options: options,
      userId: userId
    };
    for (const callback of this.beforeCallbackGroups.get('preDelete').getCallbacks()) {
      const response = callback(context);
      if (response === false) {
        return false;
      }
    }
  }
  //#endregion

  //#region After
  private async onFoundryAfterCreate(document: T & {constructor: new (...args: any[]) => T}, options: IDmlContext<T>['options'], userId: string): Promise<void> {
    // Don't allow updates directly on the original document
    let documentSnapshot = new document.constructor(deepClone(document.data), {parent: document.parent, pack: document.pack});
    let context: IDmlContext<T> = {
      rows: [{newRow: documentSnapshot}],
      options: options,
      userId: userId
    };

    for (const callback of this.afterCallbackGroups.get('create').getCallbacks()) {
      await callback(context);
    }

    if (game.userId === userId) {
      let documentSnapshot = new document.constructor(deepClone(document.data), {parent: document.parent, pack: document.pack});
      let context: IDmlContext<T> = {
        rows: [{newRow: documentSnapshot}],
        options: options,
        userId: userId
      };

      for (const callback of this.afterCallbackGroups.get('create').getDmlCallbacks()) {
        await callback(context);
      }

      const diff = UtilsCompare.findDiff(document.data, documentSnapshot.data);
      if (diff.changed) {
        if (options?.[staticValues.moduleName]?.recursiveUpdate > 5) {
          console.error('Infinite update loop. Stopping any further updates.', {diff: diff});
        } else {
          await document.update(diff.diff, {[staticValues.moduleName]: {recursiveUpdate: (options?.[staticValues.moduleName]?.recursiveUpdate ?? 0) + 1}});
        }
      }
    }
  }
  
  private async onFoundryAfterUpdate(document: T & {constructor: new (...args: any[]) => T}, change: any, options: IDmlContext<T>['options'], userId: string): Promise<void> {
    const modifiedData = mergeObject(document.toObject(), change, {inplace: false});
    const modifiedDocument = new document.constructor(modifiedData, {parent: document.parent, pack: document.pack});
    let documentSnapshot = new document.constructor(deepClone(modifiedDocument.data), {parent: document.parent, pack: document.pack});
    let context = {
      rows: [{newRow: documentSnapshot}],
      options: options,
      userId: userId
    };

    for (const callback of this.afterCallbackGroups.get('update').getCallbacks()) {
      await callback(context);
    }

    if (game.userId === userId) {
      documentSnapshot = new document.constructor(deepClone(modifiedDocument.data), {parent: document.parent, pack: document.pack});
      context = {
        rows: [{newRow: documentSnapshot}],
        options: options,
        userId: userId
      };

      for (const callback of this.afterCallbackGroups.get('update').getDmlCallbacks()) {
        await callback(context);
      }

      const diff = UtilsCompare.findDiff(modifiedDocument.data, documentSnapshot.data);
      if (diff.changed) {
        if (options?.[staticValues.moduleName]?.recursiveUpdate > 5) {
          console.error('Infinite update loop. Stopping any further updates.', {diff: diff});
        } else {
          await modifiedDocument.update(diff.diff, {[staticValues.moduleName]: {recursiveUpdate: (options?.[staticValues.moduleName]?.recursiveUpdate ?? 0) + 1}});
        }
      }
    }
  }

  private async onFoundryAfterDelete(document: T & {constructor: new (...args: any[]) => T}, options: IDmlContext<T>['options'], userId: string): Promise<void> {
    // Don't allow updates directly on the original document
    let documentSnapshot = new document.constructor(deepClone(document.data), {parent: document.parent, pack: document.pack});
    let context: IDmlContext<T> = {
      rows: [{newRow: documentSnapshot}],
      options: options,
      userId: userId
    };

    for (const callback of this.afterCallbackGroups.get('delete').getCallbacks()) {
      await callback(context);
    }

    // deletes do not support registerDml 
    // What are you going to do, update a record that has been deleted (:
  }
  //#endregion

  //#region Special usecases
  private async onFoundryTargetToken(user: T & {constructor: new (...args: any[]) => T}, token: TokenDocument, arg3: boolean): Promise<void> {
    // Don't allow updates directly on the original document
    let documentSnapshot = new user.constructor(deepClone(user.data), {parent: user.parent, pack: user.pack});
    let context: IDmlContext<T> = {
      rows: [{newRow: documentSnapshot}],
      options: {},
      userId: user.id
    };

    // I am unsure if targetToken allows 'before' functionality (editing the record), to be save, only tigger after
    for (const callback of this.afterCallbackGroups.get('update').getCallbacks()) {
      await callback(context);
    }
  }
  //#endregion

}
 
