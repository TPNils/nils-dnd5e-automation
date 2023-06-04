import { UtilsDocument } from "../lib/db/utils-document";
import { MyActor, MyItem, SpellData } from "../types/fixed-types";
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

  public static createUpcastItemByFirstSpellSlot(item: MyItem, actor: MyActor): MyItem {
    const itemData = UtilsFoundry.getSystemData(item);
    if (itemData.level == null || itemData.level <= 0) {
      return item;
    }

    const actorData = UtilsFoundry.getSystemData(actor);
    if (!actorData) {
      return item;
    }
    
    const itemLevel = itemData.level;
    const spellIsPact = itemData?.preparation?.mode === 'pact';
    let selectedLevel: number | 'pact' = spellIsPact ? actorData.spells.pact.level : itemData.level;
    let selectedSpell: SpellData = spellIsPact ? actorData.spells.pact : actorData.spells[`spell${selectedLevel}`];
    
    if (selectedLevel < itemLevel || selectedSpell.value < 1) {
      let newItemLevel = itemLevel;
      if (actorData.spells.pact.level >= itemLevel && actorData.spells.pact.value > 0) {
        newItemLevel = actorData.spells.pact.level;
      } else {
        const spellLevels = Object.keys(actorData.spells)
          .map(prop => /^spell([0-9]+)$/i.exec(prop))
          .filter(rgx => !!rgx)
          .map(rgx => Number(rgx[1]))
          .sort();
        for (const spellLevel of spellLevels) {
          if (spellLevel <= itemLevel) {
            continue;
          }
          let actorSpellData: SpellData = actorData.spells[`spell${spellLevel}`];
          if (actorSpellData.value > 0) {
            newItemLevel = spellLevel;
            break;
          }
        }
      }
      if (itemLevel != newItemLevel) {
        return ItemUtils.createUpcastItem(item, newItemLevel);
      }
    }
    return item;
  }

  public static async getOriginalLevel(item: MyItem): Promise<number> {
    return item[originalLevelSymbol] !== undefined ? item[originalLevelSymbol] : UtilsFoundry.getSystemData(await UtilsDocument.itemFromUuid(item.uuid)).level;
  }

}