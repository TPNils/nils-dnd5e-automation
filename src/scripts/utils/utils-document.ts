import { MyActor, MyItem } from "../types/fixed-types";

export class UtilsDocument {

  public static async actorFromUuid(uuid: string): Promise<MyActor> {
    let document = await fromUuid(uuid);
    // The UUID of a token actor is the token
    if (document.collectionName === 'Token') {
      document = (document as TokenDocument).actor;
    }
    if (document.collectionName !== 'Actor') {
      throw new Error(`UUID '${uuid}' is not an Actor. In stead found: ${document.collectionName}`)
    }
    return document as any as MyActor;
  }

  public static actorsFromUuid(uuids: string[]): Promise<MyActor[]> {
    return Promise.all(uuids.map(tokenUuid => {
      return UtilsDocument.actorFromUuid(tokenUuid);
    }));
  }

  public static async tokenFromUuid(uuid: string): Promise<TokenDocument> {
    let document = await fromUuid(uuid);
    if (document.collectionName === 'Token') {
      throw new Error(`UUID '${uuid}' is not a Token. In stead found: ${document.collectionName}`)
    }
    return document as TokenDocument;
  }

  public static tokensFromUuid(uuids: string[]): Promise<TokenDocument[]> {
    return Promise.all(uuids.map(tokenUuid => {
      return UtilsDocument.tokenFromUuid(tokenUuid);
    }));
  }

  public static async itemFromUuid(uuid: string): Promise<MyItem> {
    let document = await fromUuid(uuid);
    if (document.collectionName === 'Item') {
      throw new Error(`UUID '${uuid}' is not an Item. In stead found: ${document.collectionName}`)
    }
    return document as any as MyItem;
  }

  public static itemsFromUuid(uuids: string[]): Promise<MyItem[]> {
    return Promise.all(uuids.map(tokenUuid => {
      return UtilsDocument.itemFromUuid(tokenUuid);
    }));
  }

}