import { staticValues } from "../static-values";
import { MyActor } from "../types/fixed-types";
import { ItemCardData, UtilsChatMessage } from "../utils/utils-chat-message";

async function itemRoll(this: Item, {configureDialog=true, rollMode, createMessage=true}: {configureDialog?: boolean, rollMode?: ClientSettings.Values[`core.rollMode`], createMessage?: boolean} = {}): Promise<ChatMessage> {
  let itemData = UtilsChatMessage.createDefaultItemData({
    item: this as any,
    actor: this.actor as MyActor
  });

  itemData = await UtilsChatMessage.setTargets(itemData, Array.from(game.user.targets).map(token => token.document.uuid));

  const itemCardData: ItemCardData = {
    items: [itemData]
  };

  if (this.actor) {
    itemCardData.actor = {uuid: (this.actor as MyActor).uuid};
    if ((this.actor as any).token) {
      itemCardData.token = {uuid: (this.actor as any).token.uuid};
    }
  }

  // TODO spell scaling, both dmg and targets
  // TODO refund spell slot usage with the apply/undo card part
  // TODO auto consume spell slot usage AFTER attack/dmg roll

  return await UtilsChatMessage.createCard(itemCardData);
}

export function registerHooks(): void {
  Hooks.on('setup', () => {
    libWrapper.register(staticValues.moduleName, 'CONFIG.Item.documentClass.prototype.roll', itemRoll, 'OVERRIDE');
  });
}