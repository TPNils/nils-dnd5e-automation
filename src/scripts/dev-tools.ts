import { FolderDataConstructorData } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/data/data.mjs/folderData";
import { staticValues } from "./static-values";
import { MyItem } from "./types/fixed-types";
import { UtilsDocument } from "./lib/db/utils-document";

interface CompendiumItemDml {
  compendiumUuid: string;
  insertItems: any[];
  updateItems: any[];
  deleteItemsById: string[];
}

export class DevTools {

  public static async importItemCompendiums(): Promise<void> {
    // TODO support folder structure from compendium-folders module
    const packs = DevTools.getItemCompendiums();
    let packFolders = DevTools.getCompendiumFolders();
    const missingFolders: CompendiumCollection<CompendiumCollection.Metadata>[] = [];
    for (const pack of packs) {
      if (!packFolders.has(DevTools.getCompendiumUuid(pack))) {
        missingFolders.push(pack);
      }
    }

    if (missingFolders.length > 0) {
      const newFolders: FolderDataConstructorData[] = [];
      for (const pack of missingFolders) {
        newFolders.push({
          name: pack.metadata.label,
          type: 'Item',
          sorting: 'a', // automatic
          flags: {
            [staticValues.moduleName]: {
              'imported-pack-root': DevTools.getCompendiumUuid(pack)
            }
          }
        });
      }
      await Folder.createDocuments(newFolders);
      packFolders = DevTools.getCompendiumFolders();
    }

    const worldItemsBySourceUuid = new Map<string, MyItem>();
    for (const item of game.items.values()) {
      const sourceUuid = item.getFlag(staticValues.moduleName, 'source-uuid');
      if (typeof sourceUuid === 'string') {
        worldItemsBySourceUuid.set(item.getFlag(staticValues.moduleName, 'source-uuid'), item);
      }
    }

    const insertItems = [];
    const updateItems = [];
    const compendiumItemUuids: string[] = [];
    for (const pack of packs) {
      const compendiumDocumentDatas: MyItem[] = await pack.getDocuments();
      for (const documentData of compendiumDocumentDatas) {
        if (typeof documentData.data?.flags?.cf?.name === 'string') {
          // Don't import folders from the compendium-folders module
          continue;
        }
        compendiumItemUuids.push(documentData.uuid);
        const itemData: any = deepClone({
          ...documentData.data,
          document: null, // dont clone document
        });
        delete itemData._id;
        itemData.folder = packFolders.get(DevTools.getCompendiumUuid(pack)).id;
        if (!itemData.flags) {
          itemData.flags = {};
        }
        if (!itemData.flags[staticValues.moduleName]) {
          itemData.flags[staticValues.moduleName] = {};
        }
        itemData.flags[staticValues.moduleName]['source-uuid'] = documentData.uuid;

        if (worldItemsBySourceUuid.has(documentData.uuid)) {
          itemData._id = worldItemsBySourceUuid.get(documentData.uuid).id;
          updateItems.push(itemData);
        } else {
          insertItems.push(itemData);
        }
      }
    }
    
    const deleteItemsById: string[] = [];
    for (const [key, value] of worldItemsBySourceUuid.entries()) {
      if (!compendiumItemUuids.includes(key)) {
        deleteItemsById.push(value.id);
      }
    }

    if (insertItems.length > 0) {
      CONFIG.Item.documentClass.createDocuments(insertItems);
    }
    if (updateItems.length > 0) {
      CONFIG.Item.documentClass.updateDocuments(updateItems);
    }
    if (deleteItemsById.length > 0) {
      CONFIG.Item.documentClass.deleteDocuments(deleteItemsById);
    }
  }

  public static async exportItemCompendiums(): Promise<void> {
    // TODO support folder structure from compendium-folders module
    const compendiumFolders = DevTools.getCompendiumFolders();
    const compendiumFolderIds = Array.from(compendiumFolders.values()).map(folder => folder.id);

    const syncWorldItems: MyItem[] = [];
    for (const item of game.items.values()) {
      if (compendiumFolderIds.includes(item.data.folder)) {
        // This breaks if you move an item outside of the folder, which is probably working as intended?
        syncWorldItems.push(item)
      }
    }
    console.debug(syncWorldItems, compendiumFolderIds);

    const compendiumItems = await UtilsDocument.itemFromUuid(syncWorldItems.map(item => item.getFlag(staticValues.moduleName, 'source-uuid')).filter(uuid => typeof uuid === 'string'));
    const compendiumItemsByUuid = new Map<string, MyItem>();
    for (const item of compendiumItems) {
      compendiumItemsByUuid.set(item.uuid, item);
    }

    const compendiumDmls = new Map<string, CompendiumItemDml>();
    for (const syncWorldItem of syncWorldItems) {
      const targetCompendium = game.packs.get(game.folders.get(syncWorldItem.data.folder).getFlag(staticValues.moduleName, 'imported-pack-root') as string);
      const compendiumItem = compendiumItemsByUuid.get(syncWorldItem.getFlag(staticValues.moduleName, 'source-uuid'));

      const itemData: any = (syncWorldItem as any).toCompendium();

      // Clean flags
      const allowedModuleFlags = [
        staticValues.moduleName,
        'midi-qol',
        'dae', // Dynamic active effects
        'cf', // compendium folders
        'itemacro',
      ];
      for (const key in itemData.flags) {
        if (Object.prototype.hasOwnProperty.call(itemData.flags, key)) {
          if (!allowedModuleFlags.includes(key)) {
            delete itemData.flags[key];
          }
        }
      }

      const targetCompendiumUuid = DevTools.getCompendiumUuid(targetCompendium);
      if (!compendiumDmls.has(targetCompendiumUuid)) {
        compendiumDmls.set(targetCompendiumUuid, {
          compendiumUuid: targetCompendiumUuid,
          insertItems: [],
          updateItems: [],
          deleteItemsById: [],
        })
      }
      const targetCompendiumDmls = compendiumDmls.get(targetCompendiumUuid);

      if (!compendiumItem || compendiumItem.pack !== targetCompendiumUuid) {
        // insert
        targetCompendiumDmls.insertItems.push(itemData);
      } else {
        // update
        itemData._id = compendiumItem.id;
        targetCompendiumDmls.updateItems.push(itemData);
      }
    }

    // TODO delete

    console.debug(compendiumDmls)
    for (const [compendiumUuid, dmls] of compendiumDmls.entries()) {
      if (dmls.insertItems.length > 0) {
        CONFIG.Item.documentClass.createDocuments(dmls.insertItems, {pack: compendiumUuid, render: false});
      }
      if (dmls.updateItems.length > 0) {
        CONFIG.Item.documentClass.updateDocuments(dmls.updateItems, {pack: compendiumUuid, render: false});
      }
      if (dmls.deleteItemsById.length > 0) {
        CONFIG.Item.documentClass.deleteDocuments(dmls.deleteItemsById, {pack: compendiumUuid, render: false});
      }
    }
    
  }

  private static getItemCompendiums(): CompendiumCollection<CompendiumCollection.Metadata>[] {
    return Array.from(game.packs.values()).filter(pack => {
      return pack.metadata.package === staticValues.moduleName && pack.metadata.entity === 'Item';
    });
  }

  private static getCompendiumUuid(compendium: CompendiumCollection<CompendiumCollection.Metadata>): string {
    return compendium.collection;
  }

  private static getCompendiumFolders(): Map<string, Folder> {
    const compendiumFolders = new Map<string, Folder>();
    for (const folder of game.folders.values()) {
      const importedPack = folder.getFlag(staticValues.moduleName, 'imported-pack-root');
      if (typeof importedPack === 'string') {
        compendiumFolders.set(importedPack, folder);
      }
    }
    return compendiumFolders;
  }

}