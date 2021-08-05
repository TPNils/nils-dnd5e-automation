import { MyActor, MyItem } from "../types/fixed-types";

export class UtilsDocument {

  public static actorFromUuid(uuid: string): Promise<MyActor> {
    return fromUuid(uuid) as Promise<any> as Promise<MyActor>;
  }

  public static actorsFromUuid(uuids: string[]): Promise<MyActor[]> {
    return Promise.all(uuids.map(tokenUuid => {
      return UtilsDocument.actorFromUuid(tokenUuid);
    }));
  }

  public static tokenFromUuid(uuid: string): Promise<TokenDocument> {
    return fromUuid(uuid) as Promise<TokenDocument>;
  }

  public static tokensFromUuid(uuids: string[]): Promise<TokenDocument[]> {
    return Promise.all(uuids.map(tokenUuid => {
      return UtilsDocument.tokenFromUuid(tokenUuid);
    }));
  }

  public static itemFromUuid(uuid: string): Promise<MyItem> {
    return fromUuid(uuid) as Promise<any> as Promise<MyItem>;
  }

  public static itemsFromUuid(uuids: string[]): Promise<MyItem[]> {
    return Promise.all(uuids.map(tokenUuid => {
      return UtilsDocument.itemFromUuid(tokenUuid);
    }));
  }

}