import { MyActor, MyItem } from "../types/fixed-types";

export class UtilsDocument {

  public static async actorFromUuid(uuid: string): Promise<MyActor> {
    let document = await fromUuid(uuid);
    // The UUID of a token actor is the token
    if (document.collectionName === 'Token') {
      document = (document as TokenDocument).actor;
    }
    if (document.documentName !== (Actor as any).documentName) {
      throw new Error(`UUID '${uuid}' is not an ${(Actor as any).documentName}. In stead found: ${document.documentName}`)
    }
    return document as any as MyActor;
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
    let document = await fromUuid(uuid);
    if (document.documentName !== (TokenDocument as any).documentName) {
      throw new Error(`UUID '${uuid}' is not a ${(TokenDocument as any).documentName}. In stead found: ${document.documentName}`)
    }
    return document as TokenDocument;
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
    let document = await fromUuid(uuid);
    if (document.documentName !== (Item as any).documentName) {
      throw new Error(`UUID '${uuid}' is not an ${(Item as any).documentName}. In stead found: ${document.documentName}`)
    }
    return document as any as MyItem;
  }

  public static itemsFromUuid(uuids: string[], options: {deduplciate?: boolean} = {}): Promise<MyItem[]> {
    if (options.deduplciate) {
      uuids = Array.from(new Set<string>(uuids));
    }
    return Promise.all(uuids.map(tokenUuid => {
      return UtilsDocument.itemFromUuid(tokenUuid);
    }));
  }

}