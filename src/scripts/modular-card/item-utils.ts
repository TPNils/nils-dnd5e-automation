import { UtilsDocument } from "../lib/db/utils-document";
import { MyItem } from "../types/fixed-types";
import { UtilsFoundry } from "../utils/utils-foundry";

const originalLevelSymbol = Symbol('Original level');

export class ItemUtils {

  public static createUpcastItem(item: MyItem, level: number): MyItem {
    const originalLevel = UtilsFoundry.getSystemData(item).level;
    if (UtilsFoundry.usesDataModel(item)) {
      item = item.clone({system: {level: level}}, {keepId: true});
    } else if (UtilsFoundry.usesDocumentData(item)) {
      item = item.clone({data: {level: level}}, {keepId: true});
    }
    item.prepareFinalAttributes(); // Spell save DC, etc...
    item[originalLevelSymbol] = originalLevel;
    return item;
  }

  public static async getOriginalLevel(item: MyItem): Promise<number> {
    return item[originalLevelSymbol] !== undefined ? item[originalLevelSymbol] : UtilsFoundry.getSystemData(await UtilsDocument.itemFromUuid(item.uuid)).level;
  }

}