import { UtilsDocument } from "../lib/db/utils-document";
import { MyItem } from "../types/fixed-types";

const originalLevelSymbol = Symbol('Original level');

export class ItemUtils {

  public static createUpcastItem(item: MyItem, level: number): MyItem {
    const originalLevel = item.data.data.level;
    const updateItem: {[key: string]: any} = {data: {level: level}};
    item = item.clone(updateItem, {keepId: true});
    item.prepareFinalAttributes(); // Spell save DC, etc...
    item[originalLevelSymbol] = originalLevel;
    return item;
  }

  public static async getOriginalLevel(item: MyItem): Promise<number> {
    return item[originalLevelSymbol] !== undefined ? item[originalLevelSymbol] : (await UtilsDocument.itemFromUuid(item.uuid)).data.data.level;
  }

}