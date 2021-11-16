import MyAbilityTemplate from "../pixi/ability-template";
import { staticValues } from "../static-values";
import { MyActor, MyItem } from "../types/fixed-types";
import { UtilsChatMessage } from "../utils/utils-chat-message";

// Source: https://gitlab.com/foundrynet/dnd5e/-/blob/e0e7ac62469046b0bf51a2fa933b7be34a476b2e/module/item/entity.js#L415
async function roll(this: MyItem, {rollMode, createMessage=true}: {configureDialog?: boolean, rollMode?: ClientSettings.Values[`core.rollMode`], createMessage?: boolean} = {}) {
  // Create or return the Chat Message data
  const message = await this.displayCard({rollMode, createMessage});

  // Initiate measured template creation
  if (this.hasAreaTarget) {
    const template = MyAbilityTemplate.fromItem({
      target: this.data.data.target,
      flags: {
        [staticValues.moduleName]: {
          dmlCallbackMessageId: message.id,
          dmlCallbackItemIndex: 0,
        }
      }
    });
    if (template) {
      template.drawPreview();
    }
  }

  return message;
}

async function displayCard(this: Item, {rollMode, createMessage=true}: {rollMode?: ClientSettings.Values[`core.rollMode`], createMessage?: boolean} = {}): Promise<ChatMessage> {
  let itemData = await UtilsChatMessage.createDefaultItemData({
    item: this as any,
    actor: this.actor as MyActor
  });

  itemData = await UtilsChatMessage.setTargets(itemData, Array.from(game.user.targets).map(token => token.document.uuid));

  const itemCardData: Parameters<typeof UtilsChatMessage['createCard']>[0] = {
    items: [itemData]
  };

  if (this.actor) {
    itemCardData.actor = this.actor as MyActor;
    if ((this.actor as any).token) {
      itemCardData.token = (this.actor as any).token;
    }
  }

  // TODO spell scaling, both dmg and targets

  return await UtilsChatMessage.createCard(itemCardData, createMessage);
}

export function registerHooks(): void {
  Hooks.on('setup', () => {
    libWrapper.register(staticValues.moduleName, 'CONFIG.Item.documentClass.prototype.roll', roll, 'OVERRIDE');
    libWrapper.register(staticValues.moduleName, 'CONFIG.Item.documentClass.prototype.displayCard', displayCard, 'OVERRIDE');
  });
}