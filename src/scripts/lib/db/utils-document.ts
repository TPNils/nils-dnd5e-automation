import { MyActor, MyActorData, MyItem } from "../../types/fixed-types";

export type FoundryDocument = foundry.abstract.Document<any, FoundryDocument> & {uuid: string};

interface DocumentsByContext<T extends foundry.abstract.Document<any, FoundryDocument>> {
  contextKey: string;
  documentClass: typeof foundry.abstract.Document;
  parent?: FoundryDocument;
  pack?: string;
  documents: Array<T>
}

type EntityPermission = keyof typeof foundry.CONST.ENTITY_PERMISSIONS;
export interface PermissionCheck<T = any> {
  uuid: string;
  permission: string;
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
for (const perm of Object.keys(foundry.CONST.ENTITY_PERMISSIONS)) {
  defaultPermissionChecks[perm.toUpperCase()] = ({document, user}) => {
    return document.testUserPermission(user, perm as EntityPermission);
  }
}
for (const perm of (['create', 'update', 'delete'] as const)) {
  defaultPermissionChecks[perm.toUpperCase()] = ({document, user}) => {
    return document.canUserModify(user, perm);
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
  public static async bulkUpdate(inputDocuments: Array<{document: FoundryDocument, data: any}>): Promise<void> {
    const documentsByUuid = new Map<string, {document: FoundryDocument, data: any}>();
    for (const document of inputDocuments) {
      document.data._id = document.data._id ?? document.document.id;
      documentsByUuid.set(document.document.uuid, document);
    }

    const updatesPerDocumentName = UtilsDocument.groupDocumentsForDml(inputDocuments);

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

    return Promise.all(promises).then();
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
      promises.push(documentContext.documentClass.deleteDocuments.call(
        documentContext.documentClass,
        documentContext.documents.map(doc => doc.id),
        {
          parent: documentContext.parent,
          pack: documentContext.pack,
        }
      ));
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
  
  private static groupDocumentsForDml(inputDocuments: Array<{document: FoundryDocument, data?: any}>): Map<string, Map<string, BulkEntry>> {
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

  public static hasPermissions<T>(permissionChecks: PermissionCheck<T>[]): Promise<PermissionResponse<T>[]>
  public static hasPermissions<T>(permissionChecks: PermissionCheck<T>[], options: {sync: true}): PermissionResponse<T>[]
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
            result: true,
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