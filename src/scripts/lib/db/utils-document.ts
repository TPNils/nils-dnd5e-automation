import { MyActor, MyActorData, MyItem } from "../../types/fixed-types";

type FoundryDocument = foundry.abstract.Document<any, FoundryDocument> & {uuid: string};

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

export class UtilsDocument {

  //#region query
  public static actorFromUuid(inputUuid: string): Promise<MyActor>
  public static actorFromUuid(inputUuid: Iterable<string>, options?: {sync?: false}): Promise<Map<string, MyActor>>
  public static actorFromUuid(inputUuid: string, options: {sync: true}): MyActor
  public static actorFromUuid(inputUuid: Iterable<string>, options: {sync: true}): Map<string, MyActor>
  public static actorFromUuid(inputUuid: string | Iterable<string>, options: {sync?: boolean} = {}): MyActor | Map<string, MyActor> | Promise<MyActor> | Promise<Map<string, MyActor>> {
    let uuids: Iterable<string> = typeof inputUuid === 'string' ? [inputUuid] : inputUuid;
    return new MaybePromise(UtilsDocument.fromUuid(uuids, options as any)).then(response => {
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
    return new MaybePromise(UtilsDocument.fromUuid(uuids, options as any)).then(response => {
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
    return new MaybePromise(UtilsDocument.fromUuid(uuids, options as any)).then(response => {
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
    return new MaybePromise(UtilsDocument.fromUuid(uuids, options as any)).then(response => {
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
    return new MaybePromise(UtilsDocument.fromUuid(uuids, options as any)).then(response => {
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
    return new MaybePromise(UtilsDocument.fromUuid(uuids, options as any)).then(response => {
      for (let document of response.values()) {
        if (document.documentName !== (MeasuredTemplateDocument as any).documentName) {
          throw new Error(`UUID '${document.uuid}' is not an ${(MeasuredTemplateDocument as any).documentName}. In stead found: ${document.documentName}`)
        }
      }
      return typeof inputUuid === 'string' ? response.get(inputUuid) : response;
    }).getValue() as any;
  }

  private static fromUuid(uuids: Iterable<string>): Promise<Map<string, FoundryDocument>>
  private static fromUuid(uuids: Iterable<string>, options: {sync: true}): Map<string, FoundryDocument>
  private static fromUuid(uuids: Iterable<string>, options: {sync?: boolean} = {}): Promise<Map<string, FoundryDocument>> | Map<string, FoundryDocument> {
    // Fixes map keyset iterators, maybe you can only iterate them onces? not sure why it breaks without converting
    uuids = Array.from(new Set<string>(uuids));
    const getIdsPerPack = new Map<string, string[]>();
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
        getIdsPerPack.get(pack).push(parts[3])
      }
    }

    const documentPromises: Promise<FoundryDocument[]>[] = [];
    for (const [packName, ids] of getIdsPerPack.entries()) {
      documentPromises.push(game.packs.get(`${packName}`).getDocuments({_id: {$in: ids}} as any));
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
      return Promise.all(documentPromises).then(queryResponses => {
        for (const documents of queryResponses) {
          for (const document of documents) {
            documentsByUuid.set(document.uuid, document);
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

  public static async bulkDelete(inputDocuments: Array<{document: FoundryDocument}>): Promise<void> {
    const documentsByUuid = new Map<string, {document: FoundryDocument}>();
    for (const document of inputDocuments) {
      documentsByUuid.set(document.document.uuid, document);
    }

    const deletesPerDocumentName = UtilsDocument.groupDocumentsForDml(inputDocuments);

    const promises: Promise<any>[] = [];
    for (const documentName of deletesPerDocumentName.keys()) {
      const deletesByUuid = deletesPerDocumentName.get(documentName);
      const documentClass: {deleteDocuments: (ids: string[], options?: any) => Promise<any>} = CONFIG[documentName].documentClass;
      const rootRows: FoundryDocument[] = [];

      for (const bulkEntry of deletesByUuid.values()) {
        if (bulkEntry.data != null) {
          rootRows.push(bulkEntry.data);
        }

        const embededIdsByDocumentName = new Map<string, string[]>();
        for (const embeded of bulkEntry.embededDocuments) {
          if (!embededIdsByDocumentName.has(embeded.document.documentName)) {
            embededIdsByDocumentName.set(embeded.document.documentName, []);
          }
          embededIdsByDocumentName.get(embeded.document.documentName).push(embeded.document.id);
        }
        for (const embededDocumentName of embededIdsByDocumentName.keys()) {
          let parentDocument: foundry.abstract.Document<any, any> | Promise<foundry.abstract.Document<any, any>> = documentsByUuid.get(bulkEntry.uuid)?.document;
          if (parentDocument == null) {
            parentDocument = fromUuid(bulkEntry.uuid);
          }
          promises.push(Promise.resolve(parentDocument).then(doc => doc.deleteEmbeddedDocuments(embededDocumentName, embededIdsByDocumentName.get(embededDocumentName))));
        }
      }

      if (rootRows.length > 0) {
        promises.push(documentClass.deleteDocuments(rootRows.map(row => row.id)));
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

}

interface BulkEntry {
  uuid: string;
  data?: any; // when provided, update this record itself
  embededDocuments: {document: FoundryDocument, data?: any}[];
}