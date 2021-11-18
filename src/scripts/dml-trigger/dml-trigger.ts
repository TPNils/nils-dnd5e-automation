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

class UnregisterTrigger implements IUnregisterTrigger {
  constructor(private readonly hooks: ReadonlyArray<{hook: string, id: number}>){}

  public unregister(): void {
    for (const hook of this.hooks) {
      Hooks.off(hook.hook, hook.id);
    }
  }
}

export class DmlTrigger {
  public static registerTrigger<T extends foundry.abstract.Document<any, any>>(trigger: IDmlTrigger<T>): IUnregisterTrigger {
    const hooks: Array<{hook: string, id: number}> = [];
  
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
      hooks.push({
        hook: `create${trigger.type.documentName}`,
        id: Hooks.on(`create${trigger.type.documentName}`, wrapAfterCreate(trigger.afterCreate.bind(trigger))),
      });
    }
    if (typeof trigger.afterUpdate === 'function') {
      hooks.push({
        hook: `update${trigger.type.documentName}`,
        id: Hooks.on(`update${trigger.type.documentName}`, wrapAfterUpdate(trigger.afterUpdate.bind(trigger))),
      });
    }
    if (typeof trigger.afterUpsert === 'function') {
      hooks.push({
        hook: `create${trigger.type.documentName}`,
        id: Hooks.on(`create${trigger.type.documentName}`, wrapAfterCreate(trigger.afterUpsert.bind(trigger))),
      });
      hooks.push({
        hook: `update${trigger.type.documentName}`,
        id: Hooks.on(`update${trigger.type.documentName}`, wrapAfterUpdate(trigger.afterUpsert.bind(trigger))),
      });
    }
    if (typeof trigger.afterDelete === 'function') {
      hooks.push({
        hook: `delete${trigger.type.documentName}`,
        id: Hooks.on(`delete${trigger.type.documentName}`, wrapAfterDelete(trigger.afterDelete.bind(trigger))),
      });
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
  
    return new UnregisterTrigger(hooks);
  }
}

function wrapBeforeCreate<T extends foundry.abstract.Document<any, any>>(callback: (context: IDmlContext<T>) => boolean | void): (document: T, options: IDmlContext<T>['options'], userId: string) => void {
  return (document: T, options: IDmlContext<T>['options'], userId: string) => {
    return callback({
      rows: [{newRow: document}],
      options: options,
      userId: userId
    });
  }
}
function wrapBeforeUpdate<T extends foundry.abstract.Document<any, any>>(callback: (context: IDmlContext<T>) => boolean | void): (document: T, change: any, options: IDmlContext<T>['options'], userId: string) => void {
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
    
    const diff: any = diffObject(document.toObject(), modifiedDocument.data, {inner: true});
    mergeObject(change, diff);
  }
}
const wrapBeforeDelete = wrapBeforeCreate;


function wrapAfterCreate<T extends foundry.abstract.Document<any, any>>(callback: (context: IDmlContext<T>) => void | Promise<void>): (document: T, options: IDmlContext<T>['options'], userId: string) => void {
  return (document: T, options: IDmlContext<T>['options'], userId: string) => {
    return callback({
      rows: [{newRow: document}],
      options: options,
      userId: userId
    });
  }
}
function wrapAfterUpdate<T extends foundry.abstract.Document<any, any>>(callback: (context: IDmlContext<T>) => void | Promise<void>): (document: T, change: any, options: IDmlContext<T>['options'], userId: string) => void {
  return (document: T & {constructor: new (...args: any[]) => T}, change: any, options: IDmlContext<T>['options'], userId: string) => {
    const modifiedData = mergeObject(document.toObject(), change, {inplace: false});
    const modifiedDocument = new document.constructor(modifiedData, {parent: document.parent, pack: document.pack});
    return callback({
      rows: [{newRow: modifiedDocument}],
      options: options,
      userId: userId
    });
  }
}
const wrapAfterDelete = wrapAfterCreate;

function wrapTargetToken<T extends foundry.abstract.Document<any, any>>(callback: (context: IDmlContext<T>) => void | Promise<void>): (user: T, token: TokenDocument, arg3: boolean) => void {
  return (user: T, token: TokenDocument, arg3: boolean) => {
    return callback({
      rows: [{newRow: user}],
      options: {},
      userId: user.id
    });
  }
}