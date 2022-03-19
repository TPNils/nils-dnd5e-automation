import { staticValues } from "../../static-values";
import { buffer } from "../decorator/buffer";
import { UtilsCompare } from "../utils/utils-compare";


export interface ITrigger<T> {

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
   * @returns Explicitly return false to prevent the update of this Document
   */
  beforeUpdate?(context: IDmlContext<T>): boolean | void;
  /**
   * A hook event that fires for every Document type before execution of an insert or update workflow.
   * This hook only fires for the client who is initiating the insert or update request.
   * 
   * Hooked functions may modify that data
   * 
   * @returns Explicitly return false to prevent the insert or update of this Document
   */
  beforeUpsert?(context: IDmlContext<T>): boolean | void;
  /**
   * A hook event that fires for every Document type before execution of a deletion workflow.
   * This hook only fires for the client who is initiating the delete request.
   * 
   * @returns Explicitly return false to prevent the deletion of this Document
   */
  beforeDelete?(context: IDmlContext<T>): boolean | void;
  

  /**
   * A hook event that fires for every Document type after execution of a creation workflow.
   * This hook only fires for the client who is initiating the creation request.
   * 
   * The hook provides the commited document instance can be modified, which will trigger another update.
   */
   create?(context: IAfterDmlContext<T>): void | Promise<void>;
   /**
    * A hook event that fires for every Document type after execution of an update workflow.
    * This hook only fires for the client who is initiating the update request.
    * 
   * The hook provides the commited document instance can be modified, which will trigger another update.
    */
   update?(context: IAfterDmlContext<T>): void | Promise<void>;
   /**
    * A hook event that fires for every Document type after execution of an insert or update workflow.
    * This hook only fires for the client who is initiating the insert or update request.
    * 
    * The hook provides the commited document instance can be modified, which will trigger another update.
    */
   upsert?(context: IAfterDmlContext<T>): void | Promise<void>;


  /**
   * A hook event that fires for every embedded Document type after conclusion of a creation workflow.
   * This hook fires for all connected clients after the creation has been processed.
   */
  afterCreate?(context: IAfterDmlContext<T>): void | Promise<void>;
  /**
   * A hook event that fires for every Document type after conclusion of an update workflow.
   * This hook fires for all connected clients after the update has been processed.
   */
  afterUpdate?(context: IAfterDmlContext<T>): void | Promise<void>;
  /**
   * A hook event that fires for every Document type after conclusion of an insert or update workflow.
   * This hook fires for all connected clients after the insert or update has been processed.
   */
  afterUpsert?(context: IAfterDmlContext<T>): void | Promise<void>;
  /**
   * A hook event that fires for every Document type after conclusion of an deletion workflow.
   * This hook fires for all connected clients after the deletion has been processed.
   */
  afterDelete?(context: IAfterDmlContext<T>): void | Promise<void>;
}

export interface IDmlTrigger<T extends foundry.abstract.Document<any, any>> extends ITrigger<T> {
  readonly type: {new(...args: any[]): T, documentName: string};
}

interface DmlOptions {
  [key: string]: any;
}

export interface IDmlContextRow<T> {
    /**
     * Has a value during insert and update
     */
     newRow?: T;
     /**
      * Has a value during update and delete
      */
     oldRow?: T;
     changedByUserId: string;
     options: DmlOptions;
}

export interface IDmlContext<T> {
  readonly rows: ReadonlyArray<Readonly<IDmlContextRow<T>>>;
}

export interface IAfterDmlContext<T> extends IDmlContext<T> {
  endOfContext(...execs: Array<() => void | Promise<void>>): void
}

class AfterDmlContext<T> implements IAfterDmlContext<T> {
  public endOfContextExecutes: Array<() => void | Promise<void>> = [];

  constructor(
    public readonly rows: ReadonlyArray<{
      readonly newRow?: T;
      readonly oldRow?: T;
      readonly changedByUserId: string;
      readonly options: {[key: string]: any},
    }>,
  ) {}

  public endOfContext(...execs: Array<() => void | Promise<void>>): void {
    for (const exec of execs) {
      this.endOfContextExecutes.push(exec);
    }
  }
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

type OnFoundryTargetToken = (user: User, token: Token, targeted: boolean) => Promise<void>;

/**
 * Output the diff when detection a recurring dml
 * Automatically gets activated AFTER the first infinit loop is detected
 */
let outputDiff = false;
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
        id: Hooks.on(`targetToken`, this.onFoundryTargetToken.bind(this)),
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
  private onFoundryBeforeCreate(document: T & {constructor: new (...args: any[]) => T}, data: any, options: DmlOptions, userId: string): void | boolean {
    const context: IDmlContext<T> = {
      rows: [{
        newRow: document,
        changedByUserId: userId,
        options: options
      }],
    };
    for (const callback of this.beforeCallbackGroups.get('preCreate').getCallbacks()) {
      const response = callback(context);
      if (response === false) {
        return false;
      }
    }
  }
  
  private onFoundryBeforeUpdate(document: T & {constructor: new (...args: any[]) => T}, change: any, options: DmlOptions, userId: string): void | boolean {
    this.injectOldValue(document, options);
    const modifiedData = mergeObject(document.toObject(), change, {inplace: false});
    const modifiedDocument = new document.constructor(modifiedData, {parent: document.parent, pack: document.pack});
    const context: IDmlContext<T> = {
      rows: [{
        newRow: modifiedDocument,
        oldRow: document,
        changedByUserId: userId,
        options: options
      }],
    };
    for (const callback of this.beforeCallbackGroups.get('preUpdate').getCallbacks()) {
      const response = callback(context);
      if (response === false) {
        return false;
      }
    }

    // Apply the changes made to the document
    const totalDiff = UtilsCompare.findDiff(document.data, modifiedDocument.data);
    const id = change._id
    for (const key in change) {
      if (Object.prototype.hasOwnProperty.call(change, key)) {
        delete change[key];
      }
    }
    change._id = id;
    if (totalDiff.changed) {
      for (const key in totalDiff.diff) {
        if (Object.prototype.hasOwnProperty.call(totalDiff.diff, key)) {
          change[key] = totalDiff.diff[key];
        }
      }
    }
  }

  private onFoundryBeforeDelete(document: T & {constructor: new (...args: any[]) => T}, options: DmlOptions, userId: string): void | boolean {
    const context: IDmlContext<T> = {
      rows: [{
        oldRow: document,
        changedByUserId: userId,
        options: options
      }],
    };
    for (const callback of this.beforeCallbackGroups.get('preDelete').getCallbacks()) {
      const response = callback(context);
      if (response === false) {
        return false;
      }
    }
  }

  private injectOldValue(document: T, options: DmlOptions): void {
    if (!options[staticValues.moduleName]) {
      options[staticValues.moduleName] = {};
    }
    if (!options[staticValues.moduleName].oldData) {
      options[staticValues.moduleName].oldData = deepClone(document.data);
      options[staticValues.moduleName].oldParentUuid = document.parent?.uuid;
      options[staticValues.moduleName].oldPack = document.pack;
    }
  }
  //#endregion

  //#region After
  private async onFoundryAfterCreate(document: T & {constructor: new (...args: any[]) => T}, options: DmlOptions, userId: string): Promise<void> {
    // Don't allow updates directly on the original document
    let documentSnapshot = new document.constructor(deepClone(document.data), {parent: document.parent, pack: document.pack});
    let context = new AfterDmlContext<T>(
      [{
        newRow: documentSnapshot,
        changedByUserId: userId,
        options: options
      }],
    );

    for (const callback of this.afterCallbackGroups.get('create').getCallbacks()) {
      await callback(context);
    }

    if (game.userId === userId) {
      let documentSnapshot = new document.constructor(deepClone(document.data), {parent: document.parent, pack: document.pack});
      const execs = context.endOfContextExecutes;
      context = new AfterDmlContext<T>(
        [{
          newRow: documentSnapshot,
          changedByUserId: userId,
          options: options
        }],
      );
      context.endOfContext(...execs);

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

    for (const exec of context.endOfContextExecutes) {
      await exec();
    }
  }
  
  private async onFoundryAfterUpdate(document: T & {constructor: new (...args: any[]) => T}, change: any, options: DmlOptions, userId: string): Promise<void> {
    const modifiedData = mergeObject(document.toObject(), change, {inplace: false});
    const modifiedDocument = new document.constructor(modifiedData, {parent: document.parent, pack: document.pack});
    let documentSnapshot = new document.constructor(deepClone(modifiedDocument.data), {parent: document.parent, pack: document.pack});
    const oldDocument = await this.extractOldValue(document.constructor, options);
    let context = new AfterDmlContext<T>(
      [{
        newRow: documentSnapshot,
        oldRow: oldDocument,
        changedByUserId: userId,
        options: options
      }],
    );

    for (const callback of this.afterCallbackGroups.get('update').getCallbacks()) {
      await callback(context);
    }

    if (game.userId === userId) {
      documentSnapshot = new document.constructor(deepClone(modifiedDocument.data), {parent: document.parent, pack: document.pack});
      const execs = context.endOfContextExecutes;
      context = new AfterDmlContext<T>(
        [{
          newRow: documentSnapshot,
          oldRow: oldDocument,
          changedByUserId: userId,
          options: options
        }],
      );
      context.endOfContext(...execs);

      for (const callback of this.afterCallbackGroups.get('update').getDmlCallbacks()) {
        await callback(context);
      }

      const diff = UtilsCompare.findDiff(modifiedDocument.data, documentSnapshot.data);
      if (diff.changed) {
        if (outputDiff) {
          console.log('trigger diff', {
            documentName: document.collectionName,
            uuid: (document as any).uuid,
            diff: diff
          });
        }
        if (options?.[staticValues.moduleName]?.recursiveUpdate > 5) {
          console.error('Infinite update loop. Stopping any further updates.', {diff: diff});
          outputDiff = true;
        } else {
          await modifiedDocument.update(diff.diff, {[staticValues.moduleName]: {recursiveUpdate: (options?.[staticValues.moduleName]?.recursiveUpdate ?? 0) + 1}});
        }
      }
    }
    
    for (const exec of context.endOfContextExecutes) {
      await exec();
    }
  }

  private async onFoundryAfterDelete(document: T & {constructor: new (...args: any[]) => T}, options: DmlOptions, userId: string): Promise<void> {
    // Don't allow updates directly on the original document
    let documentSnapshot = new document.constructor(deepClone(document.data), {parent: document.parent, pack: document.pack});
    const context = new AfterDmlContext<T>(
      [{
        oldRow: documentSnapshot,
        changedByUserId: userId,
        options: options
      }],
    );

    for (const callback of this.afterCallbackGroups.get('delete').getCallbacks()) {
      await callback(context);
    }

    // deletes do not support registerDml 
    // What are you going to do, update a record that has been deleted (:
    
    for (const exec of context.endOfContextExecutes) {
      await exec();
    }
  }
  
  private async extractOldValue(document: new (...args: any[]) => T, options: DmlOptions): Promise<T | null> {
    if (options[staticValues.moduleName]?.oldData) {
      const oldParentUuid = options[staticValues.moduleName]?.oldParentUuid;
      return new document(deepClone(options[staticValues.moduleName]?.oldData), {
        parent: oldParentUuid == null ? null : await fromUuid(oldParentUuid),
        pack: options[staticValues.moduleName]?.oldPack
      });
    }

    return null;
  }
  //#endregion

  //#region Special usecases

  // There is a bug in foundry when you clear the targets and delete the target aswel, the hooks triggers twice with the same data
  // Also, every 1 target changes fires an event. If you target multiple targets at once, it fires multiple events
  // Buffer solved both issues
  @buffer({bufferTime: 5}) 
  private async onFoundryTargetToken(events: Array<Parameters<OnFoundryTargetToken>>): ReturnType<OnFoundryTargetToken> {
    const eventsByUserId = new Map<string, Array<Parameters<OnFoundryTargetToken>>>();
    for (const event of events) {
      if (!eventsByUserId.has(event[0].id)) {
        eventsByUserId.set(event[0].id, []);
      }
      eventsByUserId.get(event[0].id).push(event);
    }

    const rows: Array<IDmlContext<T>['rows'][0]> = [];
    for (const [userId, events] of eventsByUserId.entries()) {
      const user = game.users.get(userId);

      // Don't allow updates directly on the original document
      const documentSnapshot = new User(deepClone(user.data), {parent: user.parent, pack: user.pack});
      const simulatedOldRow: User = new User(deepClone(user.data), {parent: user.parent, pack: user.pack});
      
      // Prevent the hook from going off again
      documentSnapshot.targets.add = Set.prototype.add;
      documentSnapshot.targets.delete = Set.prototype.delete;
      simulatedOldRow.targets.add = Set.prototype.add;
      simulatedOldRow.targets.delete = Set.prototype.delete;
      
      // Targets do not get cloned => manually fill them
      const newlyAddedTokenUuids: string[] = [];
      for (const event of events) {
        if (event[2]) {
          newlyAddedTokenUuids.push(event[1].document.uuid)
        } else {
          // target removed => add it to the old
          simulatedOldRow.targets.add(event[1]);
        }
      }
      for (const target of user.targets) {
        // new target added => remove it from the old
        documentSnapshot.targets.add(target);
        if (!newlyAddedTokenUuids.includes(target.document.uuid)) {
          simulatedOldRow.targets.add(target);
        }
      }
      
      // Re-enable hook events, not for oldRow since it should be immutable anyway
      documentSnapshot.targets.add = UserTargets.prototype.add;
      documentSnapshot.targets.delete = UserTargets.prototype.delete;

      rows.push({
        newRow: documentSnapshot as any,
        oldRow: simulatedOldRow as any,
        changedByUserId: documentSnapshot.id,
        options: {}
      })
    }
    const context: AfterDmlContext<T> = new AfterDmlContext<T>(rows);

    // Before functionality is not supported by foundry (returning false to deny the change)
    for (const callback of this.afterCallbackGroups.get('update').getCallbacks()) {
      await callback(context);
    }
  }
  //#endregion

}
