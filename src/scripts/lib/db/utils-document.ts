import { MyActor, MyActorData, MyItem } from "../../types/fixed-types";
import { UtilsFoundry } from "../../utils/utils-foundry";
import { UtilsLog } from "../../utils/utils-log";

export type FoundryDocument = foundry.abstract.Document<any, FoundryDocument> & {uuid: string};

interface DocumentsByContext<T extends foundry.abstract.Document<any, FoundryDocument>> {
  contextKey: string;
  documentClass: typeof foundry.abstract.Document;
  parent?: FoundryDocument;
  pack?: string;
  documents: Array<T>
}

type EntityPermission = keyof typeof foundry.CONST.USER_ROLES;
type DocumentPermission = keyof ReturnType<typeof UtilsFoundry['getDocumentPermissions']>;
const dmlPermissions = ['create', 'update', 'delete'] as const;
export interface PermissionCheck<T = any> {
  uuid?: string;
  permission: EntityPermission | typeof dmlPermissions[number] | DocumentPermission | string;
  user: User;
  meta?: T;
}

export interface PermissionResponse<T = any> {
  requestedCheck: PermissionCheck<T>;
  result: boolean;
}

class MaybePromise<T> {
  constructor(private value: T | Promise<T>){}

  public then<R>(func: (value: T) => R): MaybePromise<R> {
    if (this.value instanceof Promise) {
      return new MaybePromise(this.value.then(func));
    } else {
      return new MaybePromise(func(this.value));
    }
  }

  public getValue(): T | Promise<T> {
    return this.value;
  }
}

export type PermissionCheckHandler = ({}: {user: User; document: FoundryDocument;}) => boolean;
const defaultPermissionChecks: {[key: string]: PermissionCheckHandler} = {};
for (const perm of Object.keys(UtilsFoundry.getUserRolls())) {
  defaultPermissionChecks[perm.toUpperCase()] = ({document, user}) => {
    let doc = document;
    while (doc != null) {
      if (doc.testUserPermission(user, perm as any)) {
        return true;
      }
      doc = doc.parent;
    }
    return false;
  }
}
for (const perm of Object.keys(UtilsFoundry.getDocumentPermissions())) {
  const level = UtilsFoundry.getDocumentPermissions()[perm];
  defaultPermissionChecks[perm.toUpperCase()] = ({document, user}) => {
    let doc = document;
    while (doc != null) {
      if (doc.getUserLevel(user) >= level) {
        return true;
      }
      doc = doc.parent;
    }
    return false;
  }
}
for (const perm of (['create', 'update', 'delete'] as const)) {
  defaultPermissionChecks[perm.toUpperCase()] = ({document, user}) => {
    let doc = document;
    while (doc != null) {
      if (doc.canUserModify(user, perm)) {
        return true;
      }
      doc = doc.parent;
    }
    return false;
  }
}
defaultPermissionChecks['GM'] = ({user}) => {
  return user.isGM;
}
defaultPermissionChecks['DM'] = defaultPermissionChecks['GM'];

interface DmlUpdateRequest {
  document: FoundryDocument;
  data: any;
};

/**
 * This prevents updating the same record at the same time, but only for the local client, not for others
 */
class UpdateQueue {
  private uuidLocks = new Set<string>();
  private nextQueueId = 0;
  private queue = new Map<number, DmlUpdateRequest & {queuedAt: number}>();
  private resolves: Array<{resolve: () => void, reject: (err: any) => void, queueIds: number[]}> = [];
  private rootUuidRegex = /^([^\.]+\.[^\.]+)/i;

  public add(inputDocuments: Array<DmlUpdateRequest>): Promise<void> {
    if (inputDocuments.length === 0) {
      return Promise.resolve();
    }

    const queueIds: number[] = [];
    const now = Date.now();
    for (const input of inputDocuments) {
      queueIds.push(this.nextQueueId);
      this.queue.set(this.nextQueueId++, {...input, queuedAt: now});
    }

    return new Promise<void>((resolve, reject) => {
      this.resolves.push({resolve, reject, queueIds});
      this.execQueue();
    });
  }

  private queueRunning = false;
  public async execQueue(): Promise<void> {
    if (this.queue.size === 0) {
      return;
    }

    if (this.queueRunning) {
      return;
    }

    try {
      this.queueRunning = true;
      while (this.queue.size > 0) {
        const thisContextLocks = new Map<string, 'self' | 'child'>();
        const selectedQueueIds: number[] = [];
        try {
          for (const [id, queueItem] of this.queue.entries()) {
            const rootUuid = this.rootUuidRegex.exec(queueItem.document.uuid)[1];
            const uuidType = rootUuid === queueItem.document.uuid ? 'self' : 'child';
            // A record can either update itself or it's children. I assume both at the same time will cause problems
            if (thisContextLocks.get(rootUuid) === uuidType || !this.uuidLocks.has(rootUuid)) {
              thisContextLocks.set(rootUuid, uuidType);
              selectedQueueIds.push(id);
              this.uuidLocks.add(rootUuid);
            }
          }
  
          if (selectedQueueIds.length === 0) {
            return;
          }
  
          const documentsByUuid = new Map<string, DmlUpdateRequest>();
          const dmlUpdateRequests: DmlUpdateRequest[] = [];
          for (const queueId of selectedQueueIds) {
            const request = this.queue.get(queueId);
            request.data._id = request.data._id ?? request.document.id;
            documentsByUuid.set(request.document.uuid, request);
            dmlUpdateRequests.push(request);
          }
  
          const updatesPerDocumentName = this.groupDocumentsForDml(dmlUpdateRequests);
  
          const promises: Promise<any>[] = [];
          for (const documentName of updatesPerDocumentName.keys()) {
            const updatesByUuid = updatesPerDocumentName.get(documentName);
            const documentClass: {updateDocuments: (rows: FoundryDocument[], options?: any) => Promise<any>} = CONFIG[documentName].documentClass;
            const rootRows: FoundryDocument[] = [];
  
            for (const bulkEntry of updatesByUuid.values()) {
              if (bulkEntry.data != null) {
                rootRows.push(bulkEntry.data);
              }
  
              const embededByDocumentName = new Map<string, any[]>();
              for (const embeded of bulkEntry.embededDocuments) {
                if (!embededByDocumentName.has(embeded.document.documentName)) {
                  embededByDocumentName.set(embeded.document.documentName, []);
                }
                embededByDocumentName.get(embeded.document.documentName).push(embeded.data);
              }
              for (const embededDocumentName of embededByDocumentName.keys()) {
                let parentDocument: foundry.abstract.Document<any, any> | Promise<foundry.abstract.Document<any, any>> = documentsByUuid.get(bulkEntry.uuid)?.document;
                if (parentDocument == null) {
                  parentDocument = fromUuid(bulkEntry.uuid);
                }
                promises.push(Promise.resolve(parentDocument).then(doc => doc.updateEmbeddedDocuments(embededDocumentName, embededByDocumentName.get(embededDocumentName))));
              }
            }
  
            if (rootRows.length > 0) {
              promises.push(documentClass.updateDocuments(rootRows));
            }
          }
  
          await Promise.all(promises);
          // TODO error checking and reject the right resolves
        } finally {
          for (const id of selectedQueueIds) {
            this.queue.delete(id);
          }
          for (const rootUuid of thisContextLocks.keys()) {
            this.uuidLocks.delete(rootUuid);
          }
  
          const incompleteResolves = [];
          const resolves = this.resolves;
          this.resolves = [];
          for (const resolve of resolves) {
            let hasQueued = false;
            for (const id of resolve.queueIds) {
              if (this.queue.has(id)) {
                hasQueued = true;
                break;
              }
            }
            if (hasQueued) {
              incompleteResolves.push(resolve);
            } else {
              resolve.resolve();
            }
          }
          this.resolves.push(...incompleteResolves);
        }
      }
    } finally {
      this.queueRunning = false;
    }
  }

  private groupDocumentsForDml(inputDocuments: Array<DmlUpdateRequest>): Map<string, Map<string, BulkEntry>> {
    const documentsByUuid = new Map<string, {document: FoundryDocument, data?: any}>();
    for (const document of inputDocuments) {
      documentsByUuid.set(document.document.uuid, document);
    }

    const dmlsPerDocumentName = new Map<string, Map<string, BulkEntry>>();
    for (let documentWrapper of documentsByUuid.values()) {
      // Special use case for actors since they are not an embeded entity
      if (documentWrapper.document.documentName === 'Actor' && (documentWrapper.document as FoundryDocument & MyActor).isToken) {
        documentWrapper.document = documentWrapper.document.parent;
        if (documentWrapper.data) {
          documentWrapper.data = {
            _id: documentWrapper.document.id,
            actorData: documentWrapper.data
          };
        }
      }

      if (documentWrapper.document.parent == null) {
        if (!dmlsPerDocumentName.has(documentWrapper.document.documentName)) {
          dmlsPerDocumentName.set(documentWrapper.document.documentName, new Map<string, BulkEntry>());
        }
        const dmlsByUuid = dmlsPerDocumentName.get(documentWrapper.document.documentName);
        
        if (!dmlsByUuid.has(documentWrapper.document.uuid)) {
          dmlsByUuid.set(documentWrapper.document.uuid, {
            uuid: documentWrapper.document.uuid,
            embededDocuments: [],
          });
        }
        dmlsByUuid.get(documentWrapper.document.uuid).data = documentWrapper.data;
      } else {
        if (!dmlsPerDocumentName.has(documentWrapper.document.parent.documentName)) {
          dmlsPerDocumentName.set(documentWrapper.document.parent.documentName, new Map<string, BulkEntry>());
        }
        const dmlsByUuid = dmlsPerDocumentName.get(documentWrapper.document.parent.documentName);
        if (!dmlsByUuid.has(documentWrapper.document.parent.uuid)) {
          dmlsByUuid.set(documentWrapper.document.parent.uuid, {
            uuid: documentWrapper.document.parent.uuid,
            embededDocuments: [],
          });
        }
        dmlsByUuid.get(documentWrapper.document.parent.uuid).embededDocuments.push(documentWrapper);
      }
    }

     return dmlsPerDocumentName;
  }

}

export class UtilsDocument {

  //#region query
  public static actorFromUuid(inputUuid: string): Promise<MyActor>
  public static actorFromUuid(inputUuid: Iterable<string>, options?: {sync?: false}): Promise<Map<string, MyActor>>
  public static actorFromUuid(inputUuid: string, options: {sync: true}): MyActor
  public static actorFromUuid(inputUuid: Iterable<string>, options: {sync: true}): Map<string, MyActor>
  public static actorFromUuid(inputUuid: string | Iterable<string>, options: {sync?: boolean} = {}): MyActor | Map<string, MyActor> | Promise<MyActor> | Promise<Map<string, MyActor>> {
    let uuids: Iterable<string> = typeof inputUuid === 'string' ? [inputUuid] : inputUuid;
    return new MaybePromise(UtilsDocument.fromUuidInternal(uuids, options as any)).then(response => {
      for (let document of response.values()) {
        if (document.documentName === (TokenDocument as any).documentName) {
          document = (document as TokenDocument).getActor();
          response.set(document.uuid, document);
        }
        if (document.documentName !== (Actor as any).documentName) {
          throw new Error(`UUID '${document.uuid}' is not an ${(Actor as any).documentName}. In stead found: ${document.documentName}`)
        }
      }
      return typeof inputUuid === 'string' ? response.get(inputUuid) : response;
    }).getValue() as any;
  }

  public static tokenFromUuid(inputUuid: string): Promise<TokenDocument>
  public static tokenFromUuid(inputUuid: Iterable<string>, options?: {sync?: false}): Promise<Map<string, TokenDocument>>
  public static tokenFromUuid(inputUuid: string, options: {sync: true}): TokenDocument
  public static tokenFromUuid(inputUuid: Iterable<string>, options: {sync: true}): Map<string, TokenDocument>
  public static tokenFromUuid(inputUuid: string | Iterable<string>, options: {sync?: boolean} = {}): TokenDocument | Map<string, TokenDocument> | Promise<TokenDocument> | Promise<Map<string, TokenDocument>> {
    let uuids: Iterable<string> = typeof inputUuid === 'string' ? [inputUuid] : inputUuid;
    return new MaybePromise(UtilsDocument.fromUuidInternal(uuids, options as any)).then(response => {
      for (let document of response.values()) {
        if (document.documentName !== (TokenDocument as any).documentName) {
          throw new Error(`UUID '${document.uuid}' is not an ${(TokenDocument as any).documentName}. In stead found: ${document.documentName}`)
        }
      }
      return typeof inputUuid === 'string' ? response.get(inputUuid) : response;
    }).getValue() as any;
  }

  public static activeEffectFromUuid(inputUuid: string): Promise<ActiveEffect>
  public static activeEffectFromUuid(inputUuid: Iterable<string>, options?: {sync?: false}): Promise<Map<string, ActiveEffect>>
  public static activeEffectFromUuid(inputUuid: string, options: {sync: true}): ActiveEffect
  public static activeEffectFromUuid(inputUuid: Iterable<string>, options: {sync: true}): Map<string, ActiveEffect>
  public static activeEffectFromUuid(inputUuid: string | Iterable<string>, options: {sync?: boolean} = {}): ActiveEffect | Map<string, ActiveEffect> | Promise<ActiveEffect> | Promise<Map<string, ActiveEffect>> {
    let uuids: Iterable<string> = typeof inputUuid === 'string' ? [inputUuid] : inputUuid;
    return new MaybePromise(UtilsDocument.fromUuidInternal(uuids, options as any)).then(response => {
      for (let document of response.values()) {
        if (document.documentName !== (ActiveEffect as any).documentName) {
          throw new Error(`UUID '${document.uuid}' is not an ${(ActiveEffect as any).documentName}. In stead found: ${document.documentName}`)
        }
      }
      return typeof inputUuid === 'string' ? response.get(inputUuid) : response;
    }).getValue() as any;
  }

  public static combatFromUuid(inputUuid: string): Promise<Combat>
  public static combatFromUuid(inputUuid: Iterable<string>, options?: {sync?: false}): Promise<Map<string, Combat>>
  public static combatFromUuid(inputUuid: string, options: {sync: true}): Combat
  public static combatFromUuid(inputUuid: Iterable<string>, options: {sync: true}): Map<string, Combat>
  public static combatFromUuid(inputUuid: string | Iterable<string>, options: {sync?: boolean} = {}): Combat | Map<string, Combat> | Promise<Combat> | Promise<Map<string, Combat>> {
    let uuids: Iterable<string> = typeof inputUuid === 'string' ? [inputUuid] : inputUuid;
    return new MaybePromise(UtilsDocument.fromUuidInternal(uuids, options as any)).then(response => {
      for (let document of response.values()) {
        if (document.documentName !== (Combat as any).documentName) {
          throw new Error(`UUID '${document.uuid}' is not an ${(Combat as any).documentName}. In stead found: ${document.documentName}`)
        }
      }
      return typeof inputUuid === 'string' ? response.get(inputUuid) : response;
    }).getValue() as any;
  }

  public static journalFromUuid(inputUuid: string): Promise<Journal>
  public static journalFromUuid(inputUuid: Iterable<string>, options?: {sync?: false}): Promise<Map<string, Journal>>
  public static journalFromUuid(inputUuid: string, options: {sync: true}): Journal
  public static journalFromUuid(inputUuid: Iterable<string>, options: {sync: true}): Map<string, Journal>
  public static journalFromUuid(inputUuid: string | Iterable<string>, options: {sync?: boolean} = {}): Journal | Map<string, Journal> | Promise<Journal> | Promise<Map<string, Journal>> {
    let uuids: Iterable<string> = typeof inputUuid === 'string' ? [inputUuid] : inputUuid;
    return new MaybePromise(UtilsDocument.fromUuidInternal(uuids, options as any)).then(response => {
      for (let document of response.values()) {
        if (document.documentName !== (Journal as any).documentName) {
          throw new Error(`UUID '${document.uuid}' is not an ${(Journal as any).documentName}. In stead found: ${document.documentName}`)
        }
      }
      return typeof inputUuid === 'string' ? response.get(inputUuid) : response;
    }).getValue() as any;
  }

  public static rollTableFromUuid(inputUuid: string): Promise<RollTable>
  public static rollTableFromUuid(inputUuid: Iterable<string>, options?: {sync?: false}): Promise<Map<string, RollTable>>
  public static rollTableFromUuid(inputUuid: string, options: {sync: true}): RollTable
  public static rollTableFromUuid(inputUuid: Iterable<string>, options: {sync: true}): Map<string, RollTable>
  public static rollTableFromUuid(inputUuid: string | Iterable<string>, options: {sync?: boolean} = {}): RollTable | Map<string, RollTable> | Promise<RollTable> | Promise<Map<string, RollTable>> {
    let uuids: Iterable<string> = typeof inputUuid === 'string' ? [inputUuid] : inputUuid;
    return new MaybePromise(UtilsDocument.fromUuidInternal(uuids, options as any)).then(response => {
      for (let document of response.values()) {
        if (document.documentName !== (RollTable as any).documentName) {
          throw new Error(`UUID '${document.uuid}' is not an ${(RollTable as any).documentName}. In stead found: ${document.documentName}`)
        }
      }
      return typeof inputUuid === 'string' ? response.get(inputUuid) : response;
    }).getValue() as any;
  }

  public static itemFromUuid(inputUuid: string): Promise<MyItem>
  public static itemFromUuid(inputUuid: Iterable<string>, options?: {sync?: false}): Promise<Map<string, MyItem>>
  public static itemFromUuid(inputUuid: string, options: {sync: true}): MyItem
  public static itemFromUuid(inputUuid: Iterable<string>, options: {sync: true}): Map<string, MyItem>
  public static itemFromUuid(inputUuid: string | Iterable<string>, options: {sync?: boolean} = {}): MyItem | Map<string, MyItem> | Promise<MyItem> | Promise<Map<string, MyItem>> {
    let uuids: Iterable<string> = typeof inputUuid === 'string' ? [inputUuid] : inputUuid;
    return new MaybePromise(UtilsDocument.fromUuidInternal(uuids, options as any)).then(response => {
      for (let document of response.values()) {
        if (document.documentName !== (Item as any).documentName) {
          throw new Error(`UUID '${document.uuid}' is not an ${(Item as any).documentName}. In stead found: ${document.documentName}`)
        }
      }
      return typeof inputUuid === 'string' ? response.get(inputUuid) : response;
    }).getValue() as any;
  }
  
  public static chatMessageFromUuid(inputUuid: string): Promise<ChatMessage>
  public static chatMessageFromUuid(inputUuid: Iterable<string>, options?: {sync?: false}): Promise<Map<string, ChatMessage>>
  public static chatMessageFromUuid(inputUuid: string, options: {sync: true}): ChatMessage
  public static chatMessageFromUuid(inputUuid: Iterable<string>, options: {sync: true}): Map<string, ChatMessage>
  public static chatMessageFromUuid(inputUuid: string | Iterable<string>, options: {sync?: boolean} = {}): ChatMessage | Map<string, ChatMessage> | Promise<ChatMessage> | Promise<Map<string, ChatMessage>> {
    let uuids: Iterable<string> = typeof inputUuid === 'string' ? [inputUuid] : inputUuid;
    return new MaybePromise(UtilsDocument.fromUuidInternal(uuids, options as any)).then(response => {
      for (let document of response.values()) {
        if (document.documentName !== ChatMessage.documentName) {
          throw new Error(`UUID '${document.uuid}' is not an ${ChatMessage.documentName}. In stead found: ${document.documentName}`)
        }
      }
      return typeof inputUuid === 'string' ? response.get(inputUuid) : response;
    }).getValue() as any;
  }
  
  public static sceneFromUuid(inputUuid: string): Promise<Scene>
  public static sceneFromUuid(inputUuid: Iterable<string>, options?: {sync?: false}): Promise<Map<string, Scene>>
  public static sceneFromUuid(inputUuid: string, options: {sync: true}): Scene
  public static sceneFromUuid(inputUuid: Iterable<string>, options: {sync: true}): Map<string, Scene>
  public static sceneFromUuid(inputUuid: string | Iterable<string>, options: {sync?: boolean} = {}): Scene | Map<string, Scene> | Promise<Scene> | Promise<Map<string, Scene>> {
    let uuids: Iterable<string> = typeof inputUuid === 'string' ? [inputUuid] : inputUuid;
    return new MaybePromise(UtilsDocument.fromUuidInternal(uuids, options as any)).then(response => {
      for (let document of response.values()) {
        if (document.documentName !== (Scene as any).documentName) {
          throw new Error(`UUID '${document.uuid}' is not an ${(Scene as any).documentName}. In stead found: ${document.documentName}`)
        }
      }
      return typeof inputUuid === 'string' ? response.get(inputUuid) : response;
    }).getValue() as any;
  }
  
  public static templateFromUuid(inputUuid: string): Promise<MeasuredTemplateDocument>
  public static templateFromUuid(inputUuid: Iterable<string>, options?: {sync?: false}): Promise<Map<string, MeasuredTemplateDocument>>
  public static templateFromUuid(inputUuid: string, options: {sync: true}): MeasuredTemplateDocument
  public static templateFromUuid(inputUuid: Iterable<string>, options: {sync: true}): Map<string, MeasuredTemplateDocument>
  public static templateFromUuid(inputUuid: string | Iterable<string>, options: {sync?: boolean} = {}): MeasuredTemplateDocument | Map<string, MeasuredTemplateDocument> | Promise<MeasuredTemplateDocument> | Promise<Map<string, MeasuredTemplateDocument>> {
    let uuids: Iterable<string> = typeof inputUuid === 'string' ? [inputUuid] : inputUuid;
    return new MaybePromise(UtilsDocument.fromUuidInternal(uuids, options as any)).then(response => {
      for (let document of response.values()) {
        if (document.documentName !== (MeasuredTemplateDocument as any).documentName) {
          throw new Error(`UUID '${document.uuid}' is not an ${(MeasuredTemplateDocument as any).documentName}. In stead found: ${document.documentName}`)
        }
      }
      return typeof inputUuid === 'string' ? response.get(inputUuid) : response;
    }).getValue() as any;
  }
  
  
  public static fromUuid(inputUuid: string): Promise<FoundryDocument>
  public static fromUuid(inputUuid: Iterable<string>, options?: {sync?: false}): Promise<Map<string, FoundryDocument>>
  public static fromUuid(inputUuid: string, options: {sync: true}): FoundryDocument
  public static fromUuid(inputUuid: Iterable<string>, options: {sync: true}): Map<string, FoundryDocument>
  public static fromUuid(inputUuid: string | Iterable<string>, options: {sync?: boolean} = {}): FoundryDocument | Map<string, FoundryDocument> | Promise<FoundryDocument> | Promise<Map<string, FoundryDocument>> {
    let uuids: Iterable<string> = typeof inputUuid === 'string' ? [inputUuid] : inputUuid;
    return new MaybePromise(UtilsDocument.fromUuidInternal(uuids, options as any)).then(response => {
      return typeof inputUuid === 'string' ? response.get(inputUuid) : response;
    }).getValue() as any;
  }

  private static fromUuidInternal(uuids: Iterable<string>, options?: {sync?: true}): Promise<Map<string, FoundryDocument>>
  private static fromUuidInternal(uuids: Iterable<string>, options: {sync: true}): Map<string, FoundryDocument>
  private static fromUuidInternal(uuids: Iterable<string>, options: {sync?: boolean} = {}): Promise<Map<string, FoundryDocument>> | Map<string, FoundryDocument> {
    // Fixes map keyset iterators, maybe you can only iterate them onces? not sure why it breaks without converting
    {
      const uuidSet = new Set<string>(uuids);
      uuidSet.delete(null);
      uuidSet.delete(undefined);
      uuidSet.delete('');
      uuids = Array.from(uuidSet);
    }
    const getIdsPerPack = new Map<string, Array<string[]>>();
    const documentsByUuid = new Map<string, FoundryDocument>();
    for (const uuid of uuids) {
      let parts = uuid.split(".");

      // Compendium is always the root
      if (parts[0] === "Compendium") {
        if (options.sync === true) {
          throw new Error(`${uuid} not supported for sync calls`);
        }

        const pack = `${parts[1]}.${parts[2]}`
        if (!getIdsPerPack.has(pack)) {
          getIdsPerPack.set(pack, []);
        }
        getIdsPerPack.get(pack).push(parts.slice(2));
      }
    }

    for (const uuid of uuids) {
      let parts = uuid.split(".");
      let document: FoundryDocument;
  
      if (parts[0] === "Compendium") {
        // Only handle sync calls here
        continue;
      }
      
      for (let i = 0; i < parts.length; i = i+2) {
        const documentName = parts[i];
        const id = parts[i+1];
        
        if (document == null) {
          document = CONFIG[documentName].collection.instance.get(id);
        } else {
          document = document.getEmbeddedDocument(documentName, id) as FoundryDocument;
        }
        if (document == null) {
          break;
        }
      }

      if (document != null) {
        documentsByUuid.set(uuid, document);
      }
    }

    // When async, always return a promise, even when there are no 'documentPromises'
    if (options.sync !== true) {
      const documentPromises: Promise<FoundryDocument[]>[] = [];
      for (const [packName, ids] of getIdsPerPack.entries()) {
        const missingIds: string[] = [];
        const pack = game.packs.get(packName);
        for (const idParts of ids) {
          if (pack.has(idParts[0])) {
            documentPromises.push(Promise.resolve(pack.get(idParts[0])));
          } else {
            missingIds.push()
          }
        }
        if (missingIds.length > 0) {
          documentPromises.push(game.packs.get(`${packName}`).getDocuments({_id: {$in: missingIds}} as any));
        }
      }

      return Promise.all(documentPromises).then(queryResponses => {
        const documentsByKey = new Map<string, FoundryDocument>();
        for (const documents of queryResponses) {
          for (const document of documents) {
            documentsByKey.set(`Compendium.${document.pack}.${document.id}`, document);
          }
        }

        for (const [packName, ids] of getIdsPerPack.entries()) {
          for (const idParts of ids) {
            let document = documentsByKey.get(`Compendium.${packName}.${idParts[0]}`);
            if (!document) {
              continue;
            }

            
            for (let i = 4; i < idParts.length && document != null; i = i+2) {
              const documentName = idParts[i];
              const id = idParts[i+1];
              
              document = document.getEmbeddedDocument(documentName, id) as FoundryDocument;
            }

            if (document) {
              documentsByUuid.set(document.uuid, document);
            }
          }
        }
        return documentsByUuid;
      });
    } else {
      return documentsByUuid;
    }  
  }
  //#endregion

  //#region dml
  public static async bulkCreate(inputs: Iterable<FoundryDocument>): Promise<FoundryDocument[]> {
    const createsPerContext = UtilsDocument.groupDocumentsByContext(Array.from(inputs));

    const promises: Promise<FoundryDocument[]>[] = [];
    for (const documentContext of createsPerContext) {
      const promise = documentContext.documentClass.createDocuments.call(
        documentContext.documentClass,
        documentContext.documents.map(doc => doc.data),
        {
          parent: documentContext.parent,
          pack: documentContext.pack,
        }
      );
      promises.push(promise);
      if (documentContext.parent != null) {
        // Await per dml, otherwise there is a bug where it doesn't always come through to the server (it looks fine for the client)
        // I would guess this would be caused since it would update the same parent document
        await promise;
      }
    }

    return Promise.all(promises).then(values => values.deepFlatten());
  }

  private static updateQueue = new UpdateQueue();
  public static async bulkUpdate(inputDocuments: Array<DmlUpdateRequest>): Promise<void> {
    return this.updateQueue.add(inputDocuments);
  }

  public static async bulkDelete(inputs: Iterable<string | FoundryDocument>): Promise<void> {
    // TODO parent.parent updates are still not fixed
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
      for (const document of (await UtilsDocument.fromUuid(uuids)).values()) {
        documentsByUuid.set(document.uuid, document);
      }
    }

    const deletesPerContext = UtilsDocument.groupDocumentsByContext(Array.from(documentsByUuid.values()));

    const promises: Promise<any>[] = [];
    for (const documentContext of deletesPerContext) {
      const promise = documentContext.documentClass.deleteDocuments.call(
        documentContext.documentClass,
        documentContext.documents.map(doc => doc.id),
        {
          parent: documentContext.parent,
          pack: documentContext.pack,
        }
      );
      if (documentContext.parent == null) {
        promises.push(promise);
      } else {
        // Await per dml, otherwise there is a bug where it doesn't always come through to the server (it looks fine for the client)
        // I would guess this would be caused since it would update the same parent document
        await promise;
      }
    }

    return Promise.all(promises).then();
  }

  public static async updateTokenActors(actorDataByTokenUuid: Map<string, DeepPartial<MyActorData>>): Promise<void> {
    const tokensByUuid = await UtilsDocument.tokenFromUuid(actorDataByTokenUuid.keys());
    
    const documents: Parameters<typeof UtilsDocument['bulkUpdate']>[0] = [];
    for (const [tokenUuid, actorData] of actorDataByTokenUuid.entries()) {
      documents.push({
        document: tokensByUuid.get(tokenUuid).getActor(),
        data: actorData
      });
    }
    return UtilsDocument.bulkUpdate(documents);
  }

  public static async setTargets(params: {tokenUuids: string[], user?: User}): Promise<void> {
    const user = params.user ?? game.user;
    // Game seems buggy when unetting targets, this however does work
    if (user.targets.size > 0) {
      Array.from(user.targets)[0].setTarget(false, {releaseOthers: true});
    }
    if (params.tokenUuids?.length > 0) {
      const targetCanvasIds = Array.from((await UtilsDocument.tokenFromUuid(params.tokenUuids)).values()).map(t => t.object.id)
      user.updateTokenTargets(targetCanvasIds);
      user.broadcastActivity({targets: targetCanvasIds});
    }
  }
  
  private static groupDocumentsByContext<T extends foundry.abstract.Document<any, FoundryDocument>>(documents: Array<T>): Array<DocumentsByContext<T>> {
    const responsesByKey = new Map<string, DocumentsByContext<T>>();

    for (const document of documents) {
      const contextKey = `${document.documentName}/${document.parent?.uuid}/${document.pack}`;
      if (!responsesByKey.has(contextKey)) {
        responsesByKey.set(contextKey, {
          contextKey: contextKey,
          documentClass: CONFIG[document.documentName].documentClass,
          parent: document.parent,
          pack: document.pack,
          documents: [],
        });
      }
      responsesByKey.get(contextKey).documents.push(document);
    }

    return Array.from(responsesByKey.values());
  }
  //#endregion

  //#region permission
  private static permissionChecks: {[key: string]: PermissionCheckHandler} = {...defaultPermissionChecks};
  public static registerCustomPermission(permissionName: string, handler: PermissionCheckHandler): void {
    permissionName = permissionName.toUpperCase();
    if (UtilsDocument.permissionChecks[permissionName]) {
      throw new Error('Permission already registered: ' + permissionName);
    }
    UtilsDocument.permissionChecks[permissionName] = handler;
  }

  public static getPermissionHandler(permissionName: string): PermissionCheckHandler {
    return UtilsDocument.permissionChecks[permissionName.toUpperCase()];
  }
  
  public static hasPermissionsFromString(stringChecks: string[]): Promise<PermissionResponse[]>
  public static hasPermissionsFromString(stringChecks: string[], options: {sync: true}): PermissionResponse[]
  public static hasPermissionsFromString(stringChecks: string[], options: {sync?: boolean}): PermissionResponse[] | Promise<PermissionResponse[]>
  public static hasPermissionsFromString(stringChecks: string[], options: {sync?: boolean} = {}): PermissionResponse[] | Promise<PermissionResponse[]> {
    const permissionChecks: PermissionCheck[] = [];
    for (const check of stringChecks) {
      const documentMatch = /^(.+?)(uuid|actorid):(.*)/i.exec(check);
      if (documentMatch) {
        const matchType = documentMatch[2].toLowerCase();
        const matchValue = documentMatch[3];
        let uuid: string;

        switch (matchType) {
          case 'uuid': {
            uuid = matchValue;
            break;
          }
          case 'actorid': {
            uuid = game.actors.get(matchValue).uuid;
            break;
          }
        }
        if (uuid == null) {
          // always show invalid parts to GM
          permissionChecks.push({
            permission: 'GM',
            user: game.user,
          });
        } else {
          permissionChecks.push({
            permission: documentMatch[1],
            uuid: uuid,
            user: game.user,
          });
        }
        
      } else {
        permissionChecks.push({
          permission: check,
          user: game.user,
        });
      }
    }

    return UtilsDocument.hasPermissions(permissionChecks, options);
  }
  
  public static hasAnyPermissions<T>(permissionChecks: PermissionCheck<T>[]): Promise<boolean>
  public static hasAnyPermissions<T>(permissionChecks: PermissionCheck<T>[], options: {sync: true}): boolean
  public static hasAnyPermissions<T>(permissionChecks: PermissionCheck<T>[], options: {sync?: boolean}): boolean | Promise<boolean>
  public static hasAnyPermissions<T>(permissionChecks: PermissionCheck<T>[], options: {sync?: boolean} = {}): boolean | Promise<boolean> {
    const response = UtilsDocument.hasPermissions(permissionChecks, options);
    if (response instanceof Promise) {
      return response.then(r => r.some(check => check.result));
    } else {
      return response.some(check => check.result);
    }
  }
  
  public static hasAllPermissions<T>(permissionChecks: PermissionCheck<T>[]): Promise<boolean>
  public static hasAllPermissions<T>(permissionChecks: PermissionCheck<T>[], options: {sync: true}): boolean
  public static hasAllPermissions<T>(permissionChecks: PermissionCheck<T>[], options: {sync?: boolean}): boolean | Promise<boolean>
  public static hasAllPermissions<T>(permissionChecks: PermissionCheck<T>[], options: {sync?: boolean} = {}): boolean | Promise<boolean> {
    const response = UtilsDocument.hasPermissions(permissionChecks, options);
    if (response instanceof Promise) {
      return response.then(r => r.every(check => check.result));
    } else {
      return response.every(check => check.result);
    }
  }

  public static hasPermissions<T>(permissionChecks: PermissionCheck<T>[]): Promise<PermissionResponse<T>[]>
  public static hasPermissions<T>(permissionChecks: PermissionCheck<T>[], options: {sync: true}): PermissionResponse<T>[]
  public static hasPermissions<T>(permissionChecks: PermissionCheck<T>[], options: {sync?: boolean}): PermissionResponse<T>[] | Promise<PermissionResponse<T>[]>
  public static hasPermissions<T>(permissionChecks: PermissionCheck<T>[], options: {sync?: boolean} = {}): PermissionResponse<T>[] | Promise<PermissionResponse<T>[]> {
    permissionChecks = permissionChecks.filter(check => check != null);
    const response: PermissionResponse[] = [];
    {
      // GM can do anything
      const processing = permissionChecks;
      permissionChecks = [];
      for (const permissionCheck of processing) {
        if (permissionCheck.user.isGM) {
          response.push({
            requestedCheck: permissionCheck,
            result: permissionCheck.permission !== 'player',
          })
        } else {
          permissionChecks.push(permissionCheck);
        }
      }
    }
    if (permissionChecks.length === 0) {
      if (options.sync) {
        return response;
      } else {
        return Promise.resolve(response);
      }
    }
    const permissionChecksByUuid = new Map<string, PermissionCheck[]>();
    for (const permissionCheck of permissionChecks) {
      if (!permissionChecksByUuid.has(permissionCheck.uuid)) {
        permissionChecksByUuid.set(permissionCheck.uuid, []);
      }
      permissionChecksByUuid.get(permissionCheck.uuid).push(permissionCheck);
    }
    return new MaybePromise(UtilsDocument.fromUuidInternal(permissionChecksByUuid.keys(), options as any)).then(documents => {
      for (let [uuid, document] of documents.entries()) {
        for (const permissionCheck of permissionChecksByUuid.get(uuid)) {
          const handler = UtilsDocument.permissionChecks[permissionCheck.permission.toUpperCase()];
          if (!handler) {
            throw new Error(`Unknown permission: ${permissionCheck.permission.toUpperCase()}`);
          }
          response.push({
            requestedCheck: permissionCheck,
            result: handler({user: permissionCheck.user, document: document}),
          });
        }
      }
      return response;
    }).getValue();
  }
  //#endregion

}

interface BulkEntry {
  uuid: string;
  data?: any; // when provided, update this record itself
  embededDocuments: {document: FoundryDocument, data?: any}[];
}