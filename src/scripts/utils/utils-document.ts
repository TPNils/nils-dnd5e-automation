import { documents } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/module.mjs";
import { MyActor, MyActorData, MyItem } from "../types/fixed-types";

type FoundryDocument = foundry.abstract.Document<any, FoundryDocument> & {uuid: string};

export class UtilsDocument {

  public static actorFromUuid(uuid: string): Promise<MyActor>
  public static actorFromUuid(uuid: string, options: {sync: true}): MyActor
  public static actorFromUuid(uuid: string, options: {sync?: boolean} = {}): MyActor | Promise<MyActor> {
    try {
      if (options.sync === true) {
        const directActorRegex = uuid.match(new RegExp(`^${(Actor as any).documentName}.([^\\.]+)$`))
        if (directActorRegex) {
          return game.actors.get(directActorRegex[1]);
        }
        const tokenActorRegex = uuid.match(new RegExp(`^${(Scene as any).documentName}.([^\\.]+).${(TokenDocument as any).documentName}.([^\\.]+)$`))
        if (tokenActorRegex) {
          return (game.scenes.get(tokenActorRegex[1]).getEmbeddedDocument('Token', tokenActorRegex[2]) as TokenDocument).getActor();
        }

        console.warn(`${(Actor as any).documentName} uuid not supported for sync calls`)
        return null;
      }

      return fromUuid(uuid).then(document => {
        if (document.documentName === (TokenDocument as any).documentName) {
          document = (document as TokenDocument).getActor();
        }
        if (document.documentName !== (Actor as any).documentName) {
          throw new Error(`UUID '${uuid}' is not an ${(Actor as any).documentName}. In stead found: ${document.documentName}`)
        }
        return document as any as MyActor;
      }).catch(e => null);
    } catch {
      return null;
    }
  }

  public static actorsFromUuid(uuids: Iterable<string>, options: {deduplciate?: boolean} = {}): Promise<MyActor[]> {
    if (options.deduplciate) {
      uuids = new Set<string>(uuids);
    }
    return Promise.all(Array.from(uuids).map(tokenUuid => {
      return UtilsDocument.actorFromUuid(tokenUuid);
    }));
  }

  public static async tokenFromUuid(uuid: string): Promise<TokenDocument> {
    try {
      let document = await fromUuid(uuid);
      if (document.documentName !== (TokenDocument as any).documentName) {
        throw new Error(`UUID '${uuid}' is not a ${(TokenDocument as any).documentName}. In stead found: ${document.documentName}`)
      }
      return document as TokenDocument;
    } catch {
      return null;
    }
  }

  public static tokensFromUuid(uuids: Iterable<string>, options: {deduplciate?: boolean} = {}): Promise<TokenDocument[]> {
    if (options.deduplciate) {
      uuids = new Set<string>(uuids);
    }
    return Promise.all(Array.from(uuids).map(tokenUuid => {
      return UtilsDocument.tokenFromUuid(tokenUuid);
    }));
  }

  public static async activeEffectFromUuid(uuid: string): Promise<ActiveEffect> {
    try {
      let document = await fromUuid(uuid);
      if (document.documentName !== (ActiveEffect as any).documentName) {
        throw new Error(`UUID '${uuid}' is not an ${(ActiveEffect as any).documentName}. In stead found: ${document.documentName}`)
      }
      return document as any as ActiveEffect;
    } catch {
      return null;
    }
  }

  public static activeEffectFromUuids(uuids: Iterable<string>, options: {deduplciate?: boolean} = {}): Promise<ActiveEffect[]> {
    if (options.deduplciate) {
      uuids = new Set<string>(uuids);
    }
    return Promise.all(Array.from(uuids).map(uuid => {
      return UtilsDocument.activeEffectFromUuid(uuid);
    }));
  }

  public static async itemFromUuid(uuid: string): Promise<MyItem> {
    try {
      let document = await fromUuid(uuid);
      if (document.documentName !== (Item as any).documentName) {
        throw new Error(`UUID '${uuid}' is not an ${(Item as any).documentName}. In stead found: ${document.documentName}`)
      }
      return document as any as MyItem;
    } catch {
      return null;
    }
  }

  public static itemsFromUuid(uuids: Iterable<string>, options: {deduplciate?: boolean} = {}): Promise<MyItem[]> {
    if (options.deduplciate) {
      uuids = new Set<string>(uuids);
    }
    return Promise.all(Array.from(uuids).map(uuid => {
      return UtilsDocument.itemFromUuid(uuid);
    }));
  }

  public static async sceneFromUuid(uuid: string): Promise<Scene> {
    try {
      let document = await fromUuid(uuid);
      if (document.documentName !== (Scene as any).documentName) {
        throw new Error(`UUID '${uuid}' is not an ${(Scene as any).documentName}. In stead found: ${document.documentName}`)
      }
      return document as Scene;
    } catch {
      return null;
    }
  }

  public static scenesFromUuid(uuids: Iterable<string>, options: {deduplciate?: boolean} = {}): Promise<Scene[]> {
    if (options.deduplciate) {
      uuids = new Set<string>(uuids);
    }
    return Promise.all(Array.from(uuids).map(uuid => {
      return UtilsDocument.sceneFromUuid(uuid);
    }));
  }

  public static async templateFromUuid(uuid: string): Promise<MeasuredTemplateDocument> {
    try {
      let document = await fromUuid(uuid);
      if (document.documentName !== (MeasuredTemplateDocument as any).documentName) {
        throw new Error(`UUID '${uuid}' is not an ${(MeasuredTemplateDocument as any).documentName}. In stead found: ${document.documentName}`)
      }
      return document as MeasuredTemplateDocument;
    } catch {
      return null;
    }
  }

  public static templatesFromUuid(uuids: Iterable<string>, options: {deduplciate?: boolean} = {}): Promise<MeasuredTemplateDocument[]> {
    if (options.deduplciate) {
      uuids = new Set<string>(uuids);
    }
    return Promise.all(Array.from(uuids).map(uuid => {
      return UtilsDocument.templateFromUuid(uuid);
    }));
  }

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
    const tokensByUuid = new Map<string, TokenDocument>();
    for (const token of (await UtilsDocument.tokensFromUuid(Array.from(actorDataByTokenUuid.keys())))) {
      tokensByUuid.set(token.uuid, token);
    }
    
    const documents: Parameters<typeof UtilsDocument['bulkUpdate']>[0] = [];
    for (const [tokenUuid, actorData] of actorDataByTokenUuid.entries()) {
      documents.push({
        document: tokensByUuid.get(tokenUuid).getActor(),
        data: actorData
      });
    }
    return UtilsDocument.bulkUpdate(documents);
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

}

interface BulkEntry {
  uuid: string;
  data?: any; // when provided, update this record itself
  embededDocuments: {document: FoundryDocument, data?: any}[];
}