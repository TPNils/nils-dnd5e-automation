import { FoundryDocument } from "../lib/db/utils-document";
import { MyItem } from "../types/fixed-types";

interface ItemIdentifier {
  name: string;
  dnd5eCompendiumId: string;
}

type ItemMap = {[key: string]: ItemIdentifier};

const itemMap = {
  layOnHands: {
    name: 'Lay on hands',
    dnd5eCompendiumId: 'Compendium.dnd5e.classfeatures.OdrvL3afwLOPeuYZ',
  },
  sneakAttack: {
    name: 'Sneak attack',
    dnd5eCompendiumId: 'Compendium.dnd5e.classfeatures.DPN2Gfk8yi1Z5wp7',
  },
};

function normalizeName(name: string): string {
  return name.normalize('NFD').replace(/[^a-z]/gi, '').toLowerCase();
}

for (const identifier of Object.values(itemMap)) {
  // @ts-ignore
  identifier.name = normalizeName(identifier.name);
}

export class UtilsItem {

  private static getItemIdentifier(id: keyof typeof itemMap): ItemIdentifier  {
    return itemMap[id];
  }

  public static matchesItemIdentifier(id: keyof typeof itemMap, item: MyItem): boolean  {
    const identifier = UtilsItem.getItemIdentifier(id);
    if (!identifier || !item) {
      return false;
    }

    // Imported from dnd5e compendium
    if (item.getFlag('core', 'sourceId') === identifier.dnd5eCompendiumId) {
      return true;
    } else if (item.getFlag('dnd5e', 'sourceId') === identifier.dnd5eCompendiumId) {
      // Imported from dnd5e level up with the 1.6.0 advancement system
      return true;
    }

    // Fall back, doesn't work for player renaming the item, but idk what else to do
    return identifier.name === normalizeName(item.name);
  }

}