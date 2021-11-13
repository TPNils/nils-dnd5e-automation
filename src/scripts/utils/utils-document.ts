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

  public static actorsFromUuid(uuids: string[], options: {deduplciate?: boolean} = {}): Promise<MyActor[]> {
    if (options.deduplciate) {
      uuids = Array.from(new Set<string>(uuids));
    }
    return Promise.all(uuids.map(tokenUuid => {
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

  public static tokensFromUuid(uuids: string[], options: {deduplciate?: boolean} = {}): Promise<TokenDocument[]> {
    if (options.deduplciate) {
      uuids = Array.from(new Set<string>(uuids));
    }
    return Promise.all(uuids.map(tokenUuid => {
      return UtilsDocument.tokenFromUuid(tokenUuid);
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

  public static itemsFromUuid(uuids: string[], options: {deduplciate?: boolean} = {}): Promise<MyItem[]> {
    if (options.deduplciate) {
      uuids = Array.from(new Set<string>(uuids));
    }
    return Promise.all(uuids.map(tokenUuid => {
      return UtilsDocument.itemFromUuid(tokenUuid);
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

  public static scenesFromUuid(uuids: string[], options: {deduplciate?: boolean} = {}): Promise<Scene[]> {
    if (options.deduplciate) {
      uuids = Array.from(new Set<string>(uuids));
    }
    return Promise.all(uuids.map(tokenUuid => {
      return UtilsDocument.sceneFromUuid(tokenUuid);
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

  public static templatesFromUuid(uuids: string[], options: {deduplciate?: boolean} = {}): Promise<MeasuredTemplateDocument[]> {
    if (options.deduplciate) {
      uuids = Array.from(new Set<string>(uuids));
    }
    return Promise.all(uuids.map(tokenUuid => {
      return UtilsDocument.templateFromUuid(tokenUuid);
    }));
  }

  public static async bulkUpdate(inputDocuments: Array<{document: FoundryDocument, data: any}>): Promise<void> {
    const documentsByUuid = new Map<string, {document: FoundryDocument, data: any}>();
    for (const document of inputDocuments) {
      documentsByUuid.set(document.document.uuid, document);
    }

    const updatesPerDocumentName = new Map<string, Map<string, BulkUpdateEntry>>();
    for (let update of documentsByUuid.values()) {
      // Special use case for actors since they are not an embeded entity
      if (update.document.documentName === 'Actor' && (update.document as FoundryDocument & MyActor).isToken) {
        update.document = update.document.parent;
        update.data = {
          _id: update.document.id,
          actorData: update.data
        };
      }

      if (update.document.parent == null) {
        if (!updatesPerDocumentName.has(update.document.documentName)) {
          updatesPerDocumentName.set(update.document.documentName, new Map<string, BulkUpdateEntry>());
        }
        const updatesByUuid = updatesPerDocumentName.get(update.document.documentName);
        
        if (!updatesByUuid.has(update.document.uuid)) {
          updatesByUuid.set(update.document.uuid, {
            uuid: update.document.uuid,
            updateEmbeded: [],
          });
        }
        updatesByUuid.get(update.document.uuid).updateData = update.data;
      } else {
        if (!updatesPerDocumentName.has(update.document.parent.documentName)) {
          updatesPerDocumentName.set(update.document.parent.documentName, new Map<string, BulkUpdateEntry>());
        }
        const updatesByUuid = updatesPerDocumentName.get(update.document.parent.documentName);
        if (!updatesByUuid.has(update.document.parent.uuid)) {
          updatesByUuid.set(update.document.parent.uuid, {
            uuid: update.document.parent.uuid,
            updateEmbeded: [],
          });
        }
        updatesByUuid.get(update.document.parent.uuid).updateEmbeded.push(update);
      }
    }

    const promises: Promise<any>[] = [];
    for (const documentName of updatesPerDocumentName.keys()) {
      const updatesByUuid = updatesPerDocumentName.get(documentName);
      const documentClass: {updateDocuments: (rows: FoundryDocument[], options?: any) => Promise<any>} = CONFIG[documentName].documentClass;
      const rootRows: FoundryDocument[] = [];

      for (const bulkEntry of updatesByUuid.values()) {
        if (bulkEntry.updateData != null) {
          rootRows.push(bulkEntry.updateData);
        }

        const embededByDocumentName = new Map<string, any[]>();
        for (const embeded of bulkEntry.updateEmbeded) {
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

  public static async updateTokenActors(actorDataByTokenUuid: Map<string, DeepPartial<MyActorData>>): Promise<void> {
    const tokensByUuid = new Map<string, TokenDocument>();
    for (const token of (await UtilsDocument.tokensFromUuid(Array.from(actorDataByTokenUuid.keys())))) {
      tokensByUuid.set(token.uuid, token);
    }
    
    if (true) {
      const documents: Parameters<typeof UtilsDocument['bulkUpdate']>[0] = [];
      for (const [tokenUuid, actorData] of actorDataByTokenUuid.entries()) {
        documents.push({
          document: tokensByUuid.get(tokenUuid).actor,
          data: actorData
        })
      }
      return UtilsDocument.bulkUpdate(documents);
    }
  }

}

interface BulkUpdateEntry {
  uuid: string;
  updateData?: any; // when provided, update this record itself
  updateEmbeded: {document: FoundryDocument, data: any}[];
}