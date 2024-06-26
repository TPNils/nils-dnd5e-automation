import { DataModel } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/abstract/module.mjs";
import { staticValues } from "../../static-values";
import { UtilsFoundry, Version } from "../../utils/utils-foundry";
import { UtilsLog } from "../../utils/utils-log";
import { buffer } from "../decorator/buffer";
import { RunOnce } from "../decorator/run-once";
import { Stoppable } from "../utils/stoppable";
import { UtilsCompare } from "../utils/utils-compare";
import { TimeoutError, UtilsPromise } from "../utils/utils-promise";
import { FoundryDocument, UtilsDocument } from "./utils-document";
import { StaticInitFunc } from "../decorator/static-init-func";
import { UtilsLibWrapper } from "../../utils/utils-lib-wrapper";

const thisSessionId = typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : String(Math.random());
const unsupportedAfterDocuments = [
  FogExploration, // Old document is only available on the client
];
const unsupportedAfterDocumentNames = unsupportedAfterDocuments.map(doc => doc.documentName);

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

export const maxTriggerDurationMs = 5000;
class MinifierHelper implements Required<{[PropertyKey in keyof ITrigger<any>]: PropertyKey;}> {

  private constructor() {}
  readonly beforeCreate = 'beforeCreate';
  readonly beforeUpdate = 'beforeUpdate';
  readonly beforeUpsert = 'beforeUpsert';
  readonly beforeDelete = 'beforeDelete';
  readonly create = 'create';
  readonly update = 'update';
  readonly upsert = 'upsert';
  readonly afterCreate = 'afterCreate';
  readonly afterUpdate = 'afterUpdate';
  readonly afterUpsert = 'afterUpsert';
  readonly afterDelete = 'afterDelete';

  private static functionMap: Map<string, string>;

  /**
   * Get the name of the function (key) transated to the label.
   * This is to support minifying
   */
  public static getFunctionMap(): Map<string, string> {
    if (MinifierHelper.functionMap == null) {
      const helper = new MinifierHelper();
      MinifierHelper.functionMap = new Map();
      for (const key in helper) {
        MinifierHelper.functionMap.set(key, helper[key]);
      }
    }
    return MinifierHelper.functionMap;
  }
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


export class DmlTrigger {
  private static wrappersByHook = new Map<string, Wrapper<any>>();

  public static registerTrigger<T extends foundry.abstract.Document<any, any>>(trigger: IDmlTrigger<T>): Stoppable {
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
  
  public register(callback: (context: IDmlContext<T>) => R): Stoppable {
    const id = this.nextId++;
    this.callbacks.set(id, callback);

    return this.getIUnregisterTrigger(id);
  }

  public registerDml(callback: (context: IDmlContext<T>) => R): Stoppable {
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
  
  protected getIUnregisterTrigger(id: number): Stoppable {
    return {
      stop: () => {
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
const functionLabelSymbol = Symbol('functionLabel');
class Wrapper<T extends foundry.abstract.Document<any, any>> {

  private isInit: boolean = false;
  private registeredFoundryHooks: Array<{hook: string, id: number}> = [];
  private beforeCallbackGroups = new Map<string, CallbackGroup<T, void | boolean>>();
  private afterCallbackGroups = new Map<string, CallbackGroup<T, void | Promise<void>>>();

  constructor(
    private readonly documentName: string,
  ) {}

  public register(trigger: IDmlTrigger<T>): Stoppable {
    if (this.documentName !== trigger.type.documentName) {
      throw new Error(`Incompatible document types. Expected ${this.documentName} but got ${trigger.type.documentName}`)
    }
    
    Wrapper.initOldDataInjector();
    if (!this.isInit) {
      this.init();
    }

    const bindWrapper: ITrigger<T> = {};
    for (const [key, name] of MinifierHelper.getFunctionMap()) {
      if (typeof trigger[key] === 'function') {
        const bindFunc = trigger[key].bind(trigger);
        bindFunc[functionLabelSymbol] = `${trigger.type.documentName}-${trigger.constructor.name}.${name}`;
        bindWrapper[key] = bindFunc;
      }
    }

    const unregisterTriggers: Stoppable[] = [];
    // before
    if (typeof bindWrapper.beforeCreate === 'function') {
      unregisterTriggers.push(this.beforeCallbackGroups.get('preCreate').register(bindWrapper.beforeCreate));
    }
    if (typeof bindWrapper.beforeUpdate === 'function') {
      unregisterTriggers.push(this.beforeCallbackGroups.get('preUpdate').register(bindWrapper.beforeUpdate));
    }
    if (typeof bindWrapper.beforeUpsert === 'function') {
      unregisterTriggers.push(this.beforeCallbackGroups.get('preCreate').register(bindWrapper.beforeUpsert));
      unregisterTriggers.push(this.beforeCallbackGroups.get('preUpdate').register(bindWrapper.beforeUpsert));
    }
    if (typeof bindWrapper.beforeDelete === 'function') {
      unregisterTriggers.push(this.beforeCallbackGroups.get('preDelete').register(bindWrapper.beforeDelete));
    }
  
    // after
    if (typeof bindWrapper.afterCreate === 'function') {
      if (unsupportedAfterDocumentNames.includes(this.documentName)) {
        throw new Error(`${this.documentName} does not support the after trigger`);
      }
      unregisterTriggers.push(this.afterCallbackGroups.get('create').register(bindWrapper.afterCreate));
    }
    if (typeof bindWrapper.afterUpdate === 'function') {
      if (unsupportedAfterDocumentNames.includes(this.documentName)) {
        throw new Error(`${this.documentName} does not support the after trigger`);
      }
      unregisterTriggers.push(this.afterCallbackGroups.get('update').register(bindWrapper.afterUpdate));
    }
    if (typeof bindWrapper.afterUpsert === 'function') {
      if (unsupportedAfterDocumentNames.includes(this.documentName)) {
        throw new Error(`${this.documentName} does not support the after trigger`);
      }
      unregisterTriggers.push(this.afterCallbackGroups.get('create').register(bindWrapper.afterUpsert));
      unregisterTriggers.push(this.afterCallbackGroups.get('update').register(bindWrapper.afterUpsert));
    }
    if (typeof bindWrapper.afterDelete === 'function') {
      if (unsupportedAfterDocumentNames.includes(this.documentName)) {
        throw new Error(`${this.documentName} does not support the after trigger`);
      }
      unregisterTriggers.push(this.afterCallbackGroups.get('delete').register(bindWrapper.afterDelete));
    }

    // after but you can update
    if (typeof bindWrapper.create === 'function') {
      unregisterTriggers.push(this.afterCallbackGroups.get('create').registerDml(bindWrapper.create));
    }
    if (typeof bindWrapper.update === 'function') {
      unregisterTriggers.push(this.afterCallbackGroups.get('update').registerDml(bindWrapper.update));
    }
    if (typeof bindWrapper.upsert === 'function') {
      unregisterTriggers.push(this.afterCallbackGroups.get('create').registerDml(bindWrapper.upsert));
      unregisterTriggers.push(this.afterCallbackGroups.get('update').registerDml(bindWrapper.upsert));
    }

    return {
      stop: () => {
        for (const unregisterTrigger of unregisterTriggers) {
          unregisterTrigger.stop();
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
      ['create', this.onFoundryAfterCreateHook],
      ['update', this.onFoundryAfterUpdateHook],
      ['delete', this.onFoundryAfterDeleteHook],
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

  private static oldDocumentSymbol = Symbol('old document');
  @RunOnce()
  private static async initOldDataInjector(): Promise<void> {
    if (await UtilsFoundry.getGameVersion({async: true}) >= new Version(10)) {
      UtilsLibWrapper.wrapper('foundry.abstract.DataModel.prototype.updateSource', function (this: DataModel<{_id?: string}> & {uuid: string}, original, ...args: any[]): void {
        if (this._source._id == null) {
          return original.call(this, ...args);
        }
        const [changes, options] = args;

        // updateSource can be called for multiple reasons, but if there is a DML, there are always options
        // There can also be options without a dml, but I consider this unfortunate necessary overhead.
        if (options) {
          if (options[Wrapper.oldDocumentSymbol] == null) {
            options[Wrapper.oldDocumentSymbol] = {};
          }
  
          options[Wrapper.oldDocumentSymbol][this.uuid] = this.toObject(true);
        }

        return original.call(this, ...args);
      });
    } else {
      UtilsLibWrapper.wrapper('ClientDatabaseBackend.prototype._postUpdateDocumentCallbacks', function (original, ...args: any[]): void {
        const collection = args[0];
        let canInject = true;
        for (const unsupportedAfterDocument of unsupportedAfterDocuments) {
          if (game.collections.get(unsupportedAfterDocument.documentName) === collection) {
            canInject = false;
            break;
          }
        }
        if (canInject) {
          const results: any[] = args[1];
          const options: any = args[2].options;
    
          const oldDocuments: {[uuid: string]: FoundryDocument} = {};
          for (const result of results) {
            const currentDocument = collection.get(result._id);
            if (currentDocument == null) {
              // Found 1 instance, can happen when updating fog of war. Not really sure what to do with this though...
              UtilsLog.error('missing currentDocument for some reason?', collection, result);
              continue;
            }
            oldDocuments[currentDocument.uuid] = currentDocument.toObject(true);
          }
          
          options[Wrapper.oldDocumentSymbol] = oldDocuments;
        }
        return original.call(this, ...args);
      });
    }
  }

  @StaticInitFunc(() => {
    if (UtilsFoundry.usesDataModel()) {
      return (document: FoundryDocument) => document.toObject(true);
    } else {
      return (document: FoundryDocument) => document.data;
    }
  })
  private static getDocumentData(document: any): Record<string, object> {
    throw new Error('Should never get called');
  }

  //#region Before
  private onFoundryBeforeCreate(document: T & {constructor: new (...args: any[]) => T}, data: any, options: DmlOptions, userId: string): void | boolean {
    this.setCurrentUser(options);
    const originalDocumentData = document.toObject(true);
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

    const totalDiff = UtilsCompare.findDiff(originalDocumentData, document.toObject(true));
    if (totalDiff.changed) {
      if (UtilsFoundry.usesDataModel()) {
        (document as any as DataModel<any>).updateSource(totalDiff.diff);
      } else {
        document.data.update(totalDiff.diff);
      }
    }
  }
  
  private onFoundryBeforeUpdate(document: T & {constructor: new (...args: any[]) => T}, change: any, options: DmlOptions, userId: string): void | boolean {
    this.setCurrentUser(options);
    const modifiedData = mergeObject(document.toObject(true), change, {inplace: false});
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
    const totalDiff = UtilsCompare.findDiff(
      Wrapper.getDocumentData(document),
      Wrapper.getDocumentData(modifiedDocument),
    );
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
    this.setCurrentUser(options);
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

  private setCurrentUser(options: DmlOptions): void {
    if (options[staticValues.moduleName] == null) {
      options[staticValues.moduleName] = {};
    }
    if (options[staticValues.moduleName].sessionId == null) {
      options[staticValues.moduleName].sessionId = thisSessionId;
    }
  }
  //#endregion

  //#region After
  private nextExtendedId = 0;
  private extendedOptionsById = new Map<number, any>();
  
  private onFoundryAfterCreateHook(document: T & {constructor: new (...args: any[]) => T}, options: DmlOptions, userId: string): Promise<void> {
    const promise = this.onFoundryAfterCreate(document, options, userId);
    return promise;
  }
  private async onFoundryAfterCreate(document: T & {constructor: new (...args: any[]) => T}, options: DmlOptions, userId: string): Promise<void> {
    // Don't allow updates directly on the original document
    let documentSnapshot = new document.constructor(document.toObject(true), {parent: document.parent, pack: document.pack});
    let context = new AfterDmlContext<T>(
      [{
        newRow: documentSnapshot,
        changedByUserId: userId,
        options: options
      }],
    );

    if (this.isCurrentUser(options)) {
      let documentSnapshot = new document.constructor(document.toObject(true), {parent: document.parent, pack: document.pack});
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
        try {
          await UtilsPromise.maxDuration(callback(context), maxTriggerDurationMs);
        } catch (err) {
          if (err instanceof TimeoutError) {
            ui.notifications.error('An error occured during the save');
            UtilsLog.error(callback[functionLabelSymbol], err);
          } else {
            throw err;
          }
        }
      }

      const diff = UtilsCompare.findDiff(
        Wrapper.getDocumentData(document),
        Wrapper.getDocumentData(documentSnapshot),
      );
      if (diff.changed) {
        if (options?.[staticValues.moduleName]?.recursiveUpdate > 5) {
          UtilsLog.error('Infinite update loop. Stopping any further updates.', {diff: diff, newRow: documentSnapshot});
        } else {
          const recursiveOptions: DmlOptions = {[staticValues.moduleName]: {recursiveUpdate: (options?.[staticValues.moduleName]?.recursiveUpdate ?? 0) + 1}};
          let extendedOptions: Promise<any>;
          try {
            this.initExtendedOptions(recursiveOptions)
            await document.update(diff.diff, recursiveOptions as any);
            extendedOptions = this.getExtendedOptions<Promise<any>>(recursiveOptions);
          } finally {
            this.clearExtendedOptions(recursiveOptions);
          }

          if (extendedOptions != null) {
            await extendedOptions;
          }

          if (typeof (document as any as FoundryDocument).uuid === 'string') {
            const queriedDocument = await UtilsDocument.fromUuid((document as any as FoundryDocument).uuid);
            context = new AfterDmlContext<T>(
              [{
                newRow: new document.constructor(queriedDocument.toObject(true), {parent: queriedDocument.parent, pack: queriedDocument.pack}),
                changedByUserId: userId,
                options: options
              }],
            );
          }
        }
      }
    }
    
    for (const callback of this.afterCallbackGroups.get('create').getCallbacks()) {
      try {
        await UtilsPromise.maxDuration(callback(context), maxTriggerDurationMs);
      } catch (err) {
        if (err instanceof TimeoutError) {
          ui.notifications.error('An error occured during the save');
          UtilsLog.error(callback[functionLabelSymbol], err);
        } else {
          throw err;
        }
      }
    }

    for (const exec of context.endOfContextExecutes) {
      await exec();
    }
  }
  
  private onFoundryAfterUpdateHook(document: T & {constructor: new (...args: any[]) => T}, change: any, options: DmlOptions, userId: string): Promise<void> {
    const promise = this.onFoundryAfterUpdate(document, change, options, userId);
    return promise;
  }
  private async onFoundryAfterUpdate(document: T & {constructor: new (...args: any[]) => T}, change: any, options: DmlOptions, userId: string): Promise<void> {
    let doResolve: (value?: any) => void;
    let doReject: (err: any) => void;
    this.setExtendedOptions(options, new Promise((resolve, reject) => {
      doResolve = resolve;
      doReject = reject;
    }));

    try {
      const modifiedData = mergeObject(document.toObject(true), change, {inplace: false});
      const modifiedDocument = new document.constructor(modifiedData, {parent: document.parent, pack: document.pack});
      let documentSnapshot = new document.constructor(modifiedDocument.toObject(true), {parent: document.parent, pack: document.pack});
      const oldDocument = new document.constructor(this.extractOldData(document as any, options), {parent: document.parent, pack: document.pack});
      if (oldDocument === undefined) {
        // See injector (initOldDataInjector) for more info
        return;
      }
      const originalDiff = UtilsCompare.findDiff(
        Wrapper.getDocumentData(modifiedDocument),
        Wrapper.getDocumentData(oldDocument),
      );
      let context = new AfterDmlContext<T>(
        [{
          newRow: documentSnapshot,
          oldRow: oldDocument,
          changedByUserId: userId,
          options: options
        }],
      );

      const recursiveUpdate = options?.[staticValues.moduleName]?.recursiveUpdate ?? 0;
      if (this.isCurrentUser(options)) {
        documentSnapshot = new document.constructor(modifiedDocument.toObject(true), {parent: document.parent, pack: document.pack});
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
          try {
            await UtilsPromise.maxDuration(callback(context), maxTriggerDurationMs);
          } catch (err) {
            if (err instanceof TimeoutError) {
              ui.notifications.error('An error occured during the save');
              UtilsLog.error(callback[functionLabelSymbol], err);
            } else {
              throw err;
            }
          }
        }

        const diff = UtilsCompare.findDiff(
          Wrapper.getDocumentData(modifiedDocument),
          Wrapper.getDocumentData(documentSnapshot),
        );
        if (!UtilsCompare.deepEquals(originalDiff, diff)) {
          if (outputDiff) {
            UtilsLog.debug('trigger diff', {
              documentName: document.collectionName,
              uuid: (document as any).uuid,
              diff: diff,
              originalDiff: originalDiff,
              diffDiff: UtilsCompare.findDiff(originalDiff, diff),
              oldRow: deepClone(Wrapper.getDocumentData(oldDocument)),
              newRow: deepClone(Wrapper.getDocumentData(modifiedDocument))
            });
          }
          if (recursiveUpdate > 5) {
            UtilsLog.error('Infinite update loop. Stopping any further updates.', {diff: diff, oldRow: oldDocument.toObject(true), newRow: modifiedDocument.toObject(true)});
            outputDiff = true;
          } else {
            const recursiveOptions: DmlOptions = {[staticValues.moduleName]: {recursiveUpdate: recursiveUpdate + 1}};
            let extendedOptions: Promise<any>;
            try {
              this.initExtendedOptions(recursiveOptions)
              await modifiedDocument.update(diff.diff, recursiveOptions);
              extendedOptions = this.getExtendedOptions<Promise<any>>(recursiveOptions);
            } finally {
              this.clearExtendedOptions(recursiveOptions);
            }
            if (extendedOptions != null) {
              await extendedOptions;
            }
            
            // Get the latest values
            if (recursiveUpdate === 0 && typeof (document as any as FoundryDocument).uuid === 'string') {
              const queriedDocument = await UtilsDocument.fromUuid((document as any as FoundryDocument).uuid);
              context = new AfterDmlContext<T>(
                [{
                  newRow: new document.constructor(queriedDocument.toObject(true), {parent: queriedDocument.parent, pack: queriedDocument.pack}),
                  oldRow: oldDocument,
                  changedByUserId: userId,
                  options: options
                }],
              );
            }
          }
        }
      }
      
      if (recursiveUpdate === 0 || !this.isCurrentUser(options)) {
        for (const callback of this.afterCallbackGroups.get('update').getCallbacks()) {
          try {
            await UtilsPromise.maxDuration(callback(context), maxTriggerDurationMs);
          } catch (err) {
            if (err instanceof TimeoutError) {
              ui.notifications.error('An error occured during the save');
              UtilsLog.error(callback[functionLabelSymbol], err);
            } else {
              throw err;
            }
          }
        }
      }
      
      for (const exec of context.endOfContextExecutes) {
        await exec();
      }
      doResolve();
    } catch (e) {
      doReject(e);
    }
  }

  private onFoundryAfterDeleteHook(document: T & {constructor: new (...args: any[]) => T}, options: DmlOptions, userId: string): Promise<void> {
    const promise = this.onFoundryAfterDelete(document, options, userId);
    return promise;
  }
  private async onFoundryAfterDelete(document: T & {constructor: new (...args: any[]) => T}, options: DmlOptions, userId: string): Promise<void> {
    // Don't allow updates directly on the original document
    let documentSnapshot = new document.constructor(document.toObject(true), {parent: document.parent, pack: document.pack});
    const context = new AfterDmlContext<T>(
      [{
        oldRow: documentSnapshot,
        changedByUserId: userId,
        options: options
      }],
    );

    for (const callback of this.afterCallbackGroups.get('delete').getCallbacks()) {
      try {
        await UtilsPromise.maxDuration(callback(context), maxTriggerDurationMs);
      } catch (err) {
        if (err instanceof TimeoutError) {
          ui.notifications.error('An error occured during the save');
          UtilsLog.error(callback[functionLabelSymbol], err);
        } else {
          throw err;
        }
      }
    }

    // deletes do not support registerDml 
    // What are you going to do, update a record that has been deleted (:
    
    for (const exec of context.endOfContextExecutes) {
      await exec();
    }
  }
  
  private extractOldData(document: {uuid: string}, options: any): object {
    return options[Wrapper.oldDocumentSymbol]?.[document.uuid];
  }

  private clearExtendedOptions(options: DmlOptions) {
    const id = options[staticValues.moduleName]?.extendedId;
    if (id != null) {
      this.extendedOptionsById.delete(id);
    }
  }

  private initExtendedOptions(options: DmlOptions) {
    if (!options[staticValues.moduleName]) {
      options[staticValues.moduleName] = {};
    }
    if (options[staticValues.moduleName].extendedId == null) {
      options[staticValues.moduleName].extendedId = this.nextExtendedId++;
    }
  }

  /**
   * Don't check on user id since the user can have multiple tabs open.
   * This is relevant for the "/stream" url
   */
  private isCurrentUser(options: DmlOptions): boolean {
    return options?.[staticValues.moduleName]?.sessionId === thisSessionId;
  }

  private setExtendedOptions(options: DmlOptions, extended: any) {
    const id = options[staticValues.moduleName]?.extendedId;
    if (id != null) {
      this.extendedOptionsById.set(id, extended);
    }
  }

  private getExtendedOptions<T = any>(options: DmlOptions): T | null {
    const id = options[staticValues.moduleName]?.extendedId;
    if (id == null) {
      return null;
    }
    return this.extendedOptionsById.get(id);
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
      const documentSnapshot = new User(user.toObject(true), {parent: user.parent, pack: user.pack});
      const simulatedOldRow: User = new User(user.toObject(true), {parent: user.parent, pack: user.pack});
      
      // Prevent the hook from going off again
      const originalAdd = documentSnapshot.targets.add;
      const originalDelete = documentSnapshot.targets.delete;
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
      documentSnapshot.targets.add = originalAdd;
      documentSnapshot.targets.delete = originalDelete;

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
