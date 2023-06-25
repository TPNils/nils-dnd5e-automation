import { FoundryDocument, UtilsDocument } from "../../../lib/db/utils-document";
import { RunOnce } from "../../../lib/decorator/run-once";
import { staticValues } from "../../../static-values";
import { ModularCard, ModularCardInstance } from "../../modular-card";
import { ModularCardCreateArgs, ModularCardPart } from "../../modular-card-part";

export interface DeletedDocumentsData {
  [uuid: string]: any;
}

export class DeletedDocumentsCardPart implements ModularCardPart<DeletedDocumentsData> {
  
  public static readonly instance = new DeletedDocumentsCardPart();
  private constructor(){}
  
  public create({item}: ModularCardCreateArgs): DeletedDocumentsData {
    return {};
  }

  public refresh(data: DeletedDocumentsData, args: ModularCardCreateArgs): DeletedDocumentsData {
    return data
  }

  public refreshVisual(data: DeletedDocumentsData, args: ModularCardCreateArgs): DeletedDocumentsData {
    return this.refresh(data, args);
  }

  @RunOnce()
  public registerHooks(): void {
    ModularCard.registerModularCardPart(staticValues.moduleName, this);
  }

  public getType(): string {
    return 'DeletedDocumentsCardPart';
  }

  public static async deleteAndCache(operations: Array<{uuids: string[], modularInstance: ModularCardInstance}>): Promise<void> {
    const allUuids = new Set<string>();
    for (const operation of operations) {
      for (const uuid of operation.uuids) {
        allUuids.add(uuid);
      }
    }

    const documents = await UtilsDocument.fromUuid(allUuids);
    for (const operation of operations) {
      for (const uuid of operation.uuids) {
        if (!documents.has(uuid)) {
          continue;
        }

        operation.modularInstance.getTypeData(DeletedDocumentsCardPart.instance)[uuid] = documents.get(uuid);
      }
    }

    await UtilsDocument.bulkDelete(documents.values());
  }

  public static async undelete<T = FoundryDocument>(uuids: string[], modularInstances: ModularCardInstance[]): Promise<Map<string, T>> {
    const undeletedDocuments = new Map<string, T>();

    const deletedUuidToPart = new Map<string, ModularCardInstance>();
    for (const instance of modularInstances) {
      const data = instance.getTypeData(DeletedDocumentsCardPart.instance);
      if (!data) {
        continue;
      }
      for (const uuid in data) {
        deletedUuidToPart.set(uuid, instance);
      }
    }

    if (deletedUuidToPart.size === 0) {
      return undeletedDocuments;
    }


    const uuidData: Array<{uuid: string, docId: string; docType: string; parentUuid?: string;}> = [];
    for (const uuid of uuids) {
      if (!deletedUuidToPart.has(uuid)) {
        continue;
      }

      const uuidParts = uuid.split('.');
      const docId = uuidParts.pop();
      const docType = uuidParts.pop();

      uuidData.push({
        uuid: uuid,
        docId: docId,
        docType: docType,
        parentUuid : uuidParts.length > 0 ? uuidParts.join('.') : null,
      })
    }

    const parentDocuments = await UtilsDocument.fromUuid(uuidData.map(d => d.parentUuid).filter(uuid => !!uuid));
    const createCalls: FoundryDocument[] = [];
    for (const uuid of uuidData) {
      const deletePart = deletedUuidToPart.get(uuid.uuid).getTypeData(DeletedDocumentsCardPart.instance);
      const document = new CONFIG[uuid.docType].documentClass(deletePart[uuid.uuid], {parent: parentDocuments.get(uuid.parentUuid)});
      createCalls.push(document);
    }

    const createResponse = await UtilsDocument.bulkCreate(createCalls, {keepId: true});
    for (const doc of createResponse) {
      undeletedDocuments.set(doc.uuid, doc as T);
    }

    // Clear the deleted entries and save to the DB
    const updateInstances: ModularCardInstance[] = [];
    for (const doc of createResponse) {
      const clone = deletedUuidToPart.get(doc.uuid).deepClone();
      delete clone.getTypeData(DeletedDocumentsCardPart.instance)[doc.uuid];
      updateInstances.push(clone);
    }

    await ModularCard.writeBulkModuleCards(updateInstances)
    
    // Update the in memory instances
    for (const doc of createResponse) {
      delete deletedUuidToPart.get(doc.uuid).getTypeData(DeletedDocumentsCardPart.instance)[doc.uuid];
    }

    return undeletedDocuments;
  }

}