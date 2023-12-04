import { DocumentModificationOptions } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/abstract/document.mjs";
import { DmlUpdateRequest, FoundryDocument, UtilsDocument } from "./utils-document";

import { UtilsLog } from "../../utils/utils-log";

interface ActionCallback<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
}
interface DocumentsByContext<T = FoundryDocument> {
  contextKey: string;
  documentClass: typeof foundry.abstract.Document;
  parent?: FoundryDocument;
  pack?: string;
  documents: Array<T>;
}

/** TODO Should probably still implement in the future */
type NotImplementedOptions = 'deleteAll' | 'isUndo' | 'recursive' | 'diff' | 'renderSheet' | 'render' | 'temporary' | 'index' | 'indexFields' | 'noHook' | 'keepId' | 'keepEmbeddedIds';
type DmlBaseOptions = {[key: string]: any;} & Pick<DocumentModificationOptions, 'noHook' | 'render' | 'recursive'>;
type DmlInsertOptions = DmlBaseOptions & Omit<Pick<DocumentModificationOptions, 'keepId' | 'keepEmbeddedIds' | 'temporary' | 'renderSheet'>, NotImplementedOptions>;
type DmlUpdateOptions = DmlBaseOptions & Omit<Pick<DocumentModificationOptions, 'diff'>, NotImplementedOptions>;
type DmlDeleteOptions = DmlBaseOptions & Omit<Pick<DocumentModificationOptions, 'deleteAll'>, NotImplementedOptions>;
type QueryOptions = {[key: string]: any;} & Omit<Pick<DocumentModificationOptions, 'index' | 'indexFields'>, NotImplementedOptions>;
type ActionStage = 'pending' | 'beforeFinished' | 'middleFinished';

interface InsertAction<T = any> {
  type: 'insert';
  stage: ActionStage;
  cb: ActionCallback<T>;
  dmlData: DocumentsByContext<FoundryDocument>;
  options: Readonly<DmlInsertOptions>;
}

interface UpdateAction<T = any> {
  type: 'update';
  stage: ActionStage;
  cb: ActionCallback<T>;
  dmlData: DocumentsByContext<FoundryDocument>;
  options: Readonly<DmlUpdateOptions>;
}

interface DeleteAction<T = any> {
  type: 'delete';
  stage: ActionStage;
  cb: ActionCallback<T>;
  dmlData: DocumentsByContext<string>;
  options: Readonly<DmlDeleteOptions>;
}

type ActionQueueItem<T = any> = InsertAction<T> | UpdateAction<T> | DeleteAction<T>;

export class Transaction {

  public readonly uuid: string;
  private constructor(uuid: string) {
    Object.defineProperty(this, 'uuid', {
      configurable: false,
      value: uuid,
      writable: false,
    });
  }

  public static init() {
    
  }

  private static ongoingTransactionsByUuid = new Map<string, Transaction>();
  public static execute<T extends (transaction: Transaction) => any>(fn: T): ReturnType<T> {
    const transaction = new Transaction(`User.${game.userId}.Transaction.${foundry.utils.randomID()}`);
    Transaction.ongoingTransactionsByUuid.set(transaction.uuid, transaction);
    let result: any;
    try {
      result = fn(transaction);
      if (result instanceof Promise) {
        result.finally(() => {
          Transaction.ongoingTransactionsByUuid.delete(transaction.uuid);
          transaction.commit();
        });
      }
    } finally {
      if (!(result instanceof Promise)) {
        Transaction.ongoingTransactionsByUuid.delete(transaction.uuid);
        transaction.commit();
      }
    }
    // TODO throw error when new actions get added after commit
    return result;
  }

  public queryByUuid(inputUuid: string, options?: QueryOptions): Promise<FoundryDocument>
  public queryByUuid(inputUuid: Iterable<string>, options?: QueryOptions): Promise<Map<string, FoundryDocument>>
  public queryByUuid(inputUuid: string | Iterable<string>, options?: QueryOptions): Promise<FoundryDocument> | Promise<Map<string, FoundryDocument>> {
    // TODO needs to wait if there is an action queued for that uuid
    //   can resolve without a queue otherwise

    // return this.execute(UtilsDocument.fromUuid.bind(UtilsDocument, inputUuid, options));
    return null;
  }

  public insert(inputs: Iterable<FoundryDocument>, options?: DmlInsertOptions): Promise<void> {
    const actions: InsertAction[] = [];
    for (const doc of inputs) {
      const contextKey = `${doc.documentName}/${doc.parent?.uuid}/${doc.pack}`;
      if (actions.length === 0 || actions[actions.length - 1].dmlData.contextKey !== contextKey) {
        actions.push({
          type: 'insert',
          stage: 'pending',
          cb: Transaction.createCallback(),
          dmlData: {
            contextKey: contextKey,
            documentClass: CONFIG[doc.documentName].documentClass,
            parent: doc.parent,
            pack: doc.pack,
            documents: [],
          },
          options: deepClone(options) ?? {},
        });
      }

      actions[actions.length - 1].dmlData.documents.push(doc)
    }
    
    if (actions.length > 0) {
      const promises: Promise<any>[] = [];
      for (const action of actions) {
        this.actionQueue.push(action);
        promises.push(action.cb.promise);
      }
      this.processActionQueue();
      return Promise.all(promises).then();
    }

    return Promise.resolve();
  }

  public update(inputs: Iterable<FoundryDocument>, options?: DmlUpdateOptions): Promise<void> {
    const actions: UpdateAction[] = [];
    for (const doc of inputs) {
      const contextKey = `${doc.documentName}/${doc.parent?.uuid}/${doc.pack}`;
      if (actions.length === 0 || actions[actions.length - 1].dmlData.contextKey !== contextKey) {
        actions.push({
          type: 'update',
          stage: 'pending',
          cb: Transaction.createCallback(),
          dmlData: {
            contextKey: contextKey,
            documentClass: CONFIG[doc.documentName].documentClass,
            parent: doc.parent,
            pack: doc.pack,
            documents: [],
          },
          options: deepClone(options) ?? {},
        });
      }

      actions[actions.length - 1].dmlData.documents.push(doc)
    }
    
    if (actions.length > 0) {
      const promises: Promise<any>[] = [];
      for (const action of actions) {
        this.actionQueue.push(action);
        promises.push(action.cb.promise);
      }
      this.processActionQueue();
      return Promise.all(promises).then();
    }

    return Promise.resolve();
  }

  public async delete(inputs: Iterable<string | FoundryDocument> | string | FoundryDocument, options?: DmlDeleteOptions): Promise<void> {
    if (typeof inputs === 'string' || !Transaction.isIterable(inputs)) {
      inputs = [inputs];
    }

    const uuids: string[] = [];
    const documentsByUuid = new Map<string, FoundryDocument>();
    for (const input of inputs) {
      if (typeof input === 'string') {
        uuids.push(input);
      } else {
        documentsByUuid.set(input.uuid, input);
      }
    }

    if (uuids.length > 0) {
      for (const [uuid, document] of (await this.queryByUuid(uuids)).entries()) {
        documentsByUuid.set(uuid, document);
      }
    }

    const actions: DeleteAction[] = [];
    for (const input of inputs) {
      const doc = typeof input === 'string' ? documentsByUuid.get(input) : input;

      const contextKey = `${doc.documentName}/${doc.parent?.uuid}/${doc.pack}`;
      if (actions.length === 0 || actions[actions.length - 1].dmlData.contextKey !== contextKey) {
        actions.push({
          type: 'delete',
          stage: 'pending',
          cb: Transaction.createCallback(),
          dmlData: {
            contextKey: contextKey,
            documentClass: CONFIG[doc.documentName].documentClass,
            parent: doc.parent,
            pack: doc.pack,
            documents: [],
          },
          options: deepClone(options) ?? {},
        });
      }

      actions[actions.length - 1].dmlData.documents.push(doc.uuid)
    }
    
    if (actions.length > 0) {
      const promises: Promise<any>[] = [];
      for (const action of actions) {
        this.actionQueue.push(action);
        promises.push(action.cb.promise);
      }
      this.processActionQueue();
      return Promise.all(promises).then();
    }

    return Promise.resolve();
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

        let i = 0
        pendingLoop: for (; i < pending.length; i++) {
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
          //  4) DmlTrigger middle (new hook + needs clearer name) => used for only other dml actions
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

          // TODO error catching
          // TODO currently implemented based on V9, check compatibility
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
            break;
          }
        }
          
        for (i++; i < pending.length; i++) {
          this.actionQueue.push(pending[i])
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
    };

    cb.promise = new Promise<T>((resolve, reject) => {
      cb.resolve = resolve;
      cb.reject = reject;
    });

    return cb as ActionCallback<T>;
  }

}

// @ts-ignore
window.Transaction = Transaction;
UtilsLog.debug('Reminder to remove the line above')