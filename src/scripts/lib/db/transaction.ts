import { DocumentModificationOptions } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/abstract/document.mjs";
import { DmlUpdateRequest, FoundryDocument, UtilsDocument } from "./utils-document";
import { UtilsLog } from "../../utils/utils-log";

const currentTransactionSymbol = Symbol('Current transaction');
const proxyWrappedSymbol = Symbol('proxyWrappedSymbol');
const globalsSymbol = Symbol('globals');

interface ActionCallback<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
}

/** TODO Should probably still implement in the future */
type NotImplementedOptions = 'deleteAll' | 'isUndo' | 'recursive' | 'diff' | 'renderSheet' | 'render' | 'temporary' | 'index' | 'indexFields' | 'noHook' | 'keepId' | 'keepEmbeddedIds';
type DmlOptions = {[key: string]: any;} & Omit<DocumentModificationOptions, 'parent' | 'pack' | NotImplementedOptions>;

interface InsertAction<T = any> {
  type: 'insert';
  cb: ActionCallback<T>;
  dmlData: Iterable<FoundryDocument>;
  options: DmlOptions;
}

interface UpdateAction<T = any> {
  type: 'update';
  cb: ActionCallback<T>;
  dmlData: Iterable<FoundryDocument>;
  options: DmlOptions;
}

interface DeleteAction<T = any> {
  type: 'delete';
  cb: ActionCallback<T>;
  uuids: Iterable<string>;
  options: DmlOptions;
}

type ActionQueueItem<T = any> = InsertAction<T> | UpdateAction<T> | DeleteAction<T>;

class DeleteIterableWrapper implements Iterable<string> {

  constructor(private readonly delegate: Iterable<string | FoundryDocument>) {}

  [Symbol.iterator](): Iterator<string, any, undefined> {
    return new DeleteIteratorWrapper(this.delegate[Symbol.iterator]());
  }

}

class DeleteIteratorWrapper implements Iterator<string, any, undefined> {
  
  constructor(private readonly delegate: Iterator<string | FoundryDocument, any, undefined>) {}

  public next(...args: [] | [undefined]): IteratorResult<string, any> {
    return this.convert(this.delegate.next(...args));
  }

  public return?(value?: any): IteratorResult<string, any> {
    return this.convert(this.delegate.return(value));
  }

  public throw?(e?: any): IteratorResult<string, any> {
    return this.convert(this.delegate.throw(e));
  }
  
  private convert(delegateResult: IteratorResult<string | FoundryDocument, any>): IteratorResult<string, any> {
    if (delegateResult.value instanceof foundry.abstract.Document) {
      const result: IteratorResult<string, any> = {
        value: (delegateResult.value as FoundryDocument).uuid,
        done: delegateResult.done,
      }
      if (!('done' in delegateResult)) {
        delete result.done;
      }
      return result;
    }

    return delegateResult as IteratorResult<string, any>;
  }

}

export class Transaction {

  private constructor() {}

  public static init() {
    
  }

  public static execute<T extends (transaction: Transaction) => any>(fn: T): ReturnType<T> {
    const transaction = new Transaction();
    let result: any;
    try {
      result = fn(new Transaction());
      if (result instanceof Promise) {
        result.finally(() => transaction.commit());
      }
    } finally {
      if (!(result instanceof Promise)) {
        transaction.commit();
      }
    }
    // TODO throw error when new actions get added after commit
    return result;
  }

  public queryByUuid(inputUuid: string, options?: DmlOptions): Promise<FoundryDocument>
  public queryByUuid(inputUuid: Iterable<string>, options?: DmlOptions): Promise<Map<string, FoundryDocument>>
  public queryByUuid(inputUuid: string | Iterable<string>, options?: DmlOptions): Promise<FoundryDocument> | Promise<Map<string, FoundryDocument>> {
    // TODO needs to wait if there is an action queued for that uuid
    //   can resolve without a queue otherwise

    // return this.execute(UtilsDocument.fromUuid.bind(UtilsDocument, inputUuid, options));
    return null;
  }

  public insert(inputs: Iterable<FoundryDocument>, options?: Omit<DocumentModificationOptions, 'parent' | 'pack'>): Promise<void> {
    const action: InsertAction = {
      type: 'insert',
      cb: Transaction.createCallback(),
      dmlData: inputs,
      options: {},
    }
    this.actionQueue.push(action);
    this.processActionQueue();

    return action.cb.promise;
  }

  public update(inputs: Iterable<FoundryDocument>): Promise<void> {
    const action: UpdateAction = {
      type: 'update',
      cb: Transaction.createCallback(),
      dmlData: inputs,
      options: {},
    }
    this.actionQueue.push(action);
    this.processActionQueue();

    return action.cb.promise;
  }

  public delete(inputs: Iterable<string | FoundryDocument> | string | FoundryDocument): Promise<void> {
    if (typeof inputs === 'string' || !Transaction.isIterable(inputs)) {
      inputs = [inputs];
    }

    const action: DeleteAction = {
      type: 'delete',
      cb: Transaction.createCallback(),
      uuids: new DeleteIterableWrapper(inputs),
      options: {},
    }
    this.actionQueue.push(action);
    this.processActionQueue();

    return action.cb.promise;
  }

  // dmls that have happened in this transaction but not yet committed to the database
  private insertCache = new Map<string, FoundryDocument>();
  private updateCache = new Map<string, FoundryDocument>();
  private deleteCache = new Set<string>();
  private actionQueue: ActionQueueItem[] = [];
  private actionQueueProcessing = false;
  private async processActionQueue(): Promise<void> {
    if (this.actionQueueProcessing) {
      return;
    }

    try {
      this.actionQueueProcessing = true;
      while (this.actionQueue.length > 0) {
        const pending = this.actionQueue;
        this.actionQueue = [];

        for (let i = 0; i < pending.length; i++) {
          const action = pending[i];

          // TODO regarding calling the trigger hooks
          // We can overwrite default dml actions as this is sync.
          //  Pro: this would capture actions other modules could do
          //  Con: Does not capture async actions
          //  Con: may interact unfavorably in ways I may not expect with other modules
          // 
          // Implementation idea
          //  1) Foundry before (excl DmlTrigger)
          //  2) DmlTrigger before
          //  3) Save within this transaction
          //  4) DmlTrigger afterSave (new hook + needs clearer name) => used for only other dml actions
          //    <on any error so far, everything can be rolled back>
          //  5) commit to Foundry DB
          //  6) Foundry after (excl DmlTrigger)
          //  7) DmlTrigger after
          //
          //  Split Foundry & Dml for a predictable behavior
          //  Although... vanilla DMLs would have a different exec order
          //  The exec order shouldn't matter,
          //   + the order within DmlTrigger won't change
          //   + the only change in the Foundry order is that DmlTrigger is now the last hook

          switch (action.type) {
            case 'insert': {
              break;
            }
            case 'update': {
              break;
            }
            case 'delete': {
              break;
            }
          }
          
          // If new actions are added, they should get processed first
          if (this.actionQueue.length > 0) {
            for (i++; i < pending.length; i++) {
              this.actionQueue.push(pending[i])
            }
          }
        }
      }
    } finally {
      this.actionQueueProcessing = false;
    }
  }

  private async commit(): Promise<void> {
    const insertCache = this.insertCache;
    const updateCache = this.updateCache;
    const deleteCache = this.deleteCache;
    this.insertCache = new Map<string, FoundryDocument>();
    this.updateCache = new Map<string, FoundryDocument>();
    this.deleteCache = new Set<string>();
    if (insertCache.size > 0) {
      await UtilsDocument.bulkCreate(insertCache.values(), {keepId: true});
    }
    if (updateCache.size > 0) {
      // TODO
      // await UtilsDocument.bulkUpdate(updateCache.values());
    }
    if (deleteCache.size > 0) {
      await UtilsDocument.bulkDelete(deleteCache);
    }
  }

  private static isIterable(obj: any): obj is Iterable<any> {
    if (obj == null) {
      return false;
    }
    return typeof obj[Symbol.iterator] === 'function';
  }

  private static createCallback<T = any>(): ActionCallback<T> {
    const cb: Partial<ActionCallback<T>> = {
      promise: new Promise<T>((resolve, reject) => {
        cb.resolve = resolve;
        cb.reject = reject;
      })
    };

    return cb as ActionCallback<T>;
  }

}

// @ts-ignore
window.Transaction = Transaction;
UtilsLog.debug('Reminder to remove the line above')