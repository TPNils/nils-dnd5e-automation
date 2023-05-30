import { ChatMessageDataConstructorData } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/data/data.mjs/chatMessageData";
import { ModularCard } from "../modular-card/modular-card";
import { staticValues } from "../static-values";
import { MyActor, MyItem } from "../types/fixed-types";
import { UtilsFoundry, Version } from "../utils/utils-foundry";
import { UtilsHooks } from "../utils/utils-hooks";

interface ItemUseOptions {
  configureDialog?: boolean;
  rollMode?: ClientSettings.Values[`core.rollMode`];
  createMessage?: boolean;

  // since V10 I believe
  flags?: Record<string, any>;
  event?: Event;
}

interface ItemUseConfiguration {
  /** Trigger a template creation */
  createMeasuredTemplate: boolean;
  /** Should the item's quantity be consumed? */
  consumeQuantity: boolean;
  /** Should a recharge be consumed? */
  consumeRecharge: boolean;
  /** Should a linked (non-ammo) resource be consumed? */
  consumeResource: boolean;
  /** Specific spell level to consume, or "pact" for pact level. */
  consumeSpellLevel: number|string|null;
  /** Should any spell slot be consumed? */
  consumeSpellSlot: boolean;
  /** Should limited uses be consumed? */
  consumeUsage: boolean;
  /** Is user-configuration needed? */
  needsConfiguration: boolean;
}

  /**
   * Configuration data for an item usage being prepared.
   *
   * @typedef {object} ItemUseConfiguration
   */

// Source: https://gitlab.com/foundrynet/dnd5e/-/blob/e0e7ac62469046b0bf51a2fa933b7be34a476b2e/module/item/entity.js#L415
async function roll(this: MyItem, wrapped: (...args: any) => any, ...args: [ItemUseOptions]) {
  const [options] = args;
  if (this.type === 'tool') {
    return wrapped(...args);
  }
  return this.displayCard({rollMode: options?.rollMode, createMessage: options?.createMessage});
}

async function displayCard(this: MyItem, wrapped: (...args: any) => any, ...args: [{rollMode?: ClientSettings.Values[`core.rollMode`], createMessage?: boolean}]): Promise<ChatMessage | ChatMessageDataConstructorData> {
  const [options] = args;
  if (this.type === 'tool') {
    return wrapped(...args);
  }
  let token: TokenDocument = ((this.actor as any).token);
  if (!token) {
    // In 0.8.9, actor.token seems very broken, might be fixed in later versions?
    const speaker = ChatMessage.getSpeaker();
    if (speaker.actor === (this.actor as MyActor)?.id) {
      if (speaker.scene && speaker.token) {
        token = game.scenes.get(speaker.scene).getEmbeddedDocument((TokenDocument as any).documentName, speaker.token) as TokenDocument;
      }
    }
  }
  const parts = await ModularCard.getDefaultItemParts({
    item: this as any,
    actor: this.actor as MyActor,
    token: token,
  });

  const chatData = ModularCard.createCardData(parts);
  
  Hooks.callAll("dnd5e.preDisplayCard", this, chatData, options);

  const returnValue = options.createMessage ? await ChatMessage.create(chatData) : chatData;
  
  Hooks.callAll("dnd5e.displayCard", this, returnValue);

  return returnValue;
}

export function registerHooks(): void {
  UtilsHooks.setup().then(() => {
    if (UtilsFoundry.getSystemVersion() < new Version(2)) {
      // deprecated since 2.0.0, dnd5e hooks are the replacement
      libWrapper.register(staticValues.moduleName, 'CONFIG.Item.documentClass.prototype.roll', roll, 'MIXED');
    }

    // I want to use promises for displayCard so can't hook into dnd5e.preDisplayCard
    libWrapper.register(staticValues.moduleName, 'CONFIG.Item.documentClass.prototype.displayCard', displayCard, 'MIXED');
  });

  // dnd 2.0.0 and up
  Hooks.on('dnd5e.preUseItem', (item: MyItem, config: ItemUseConfiguration, options: ItemUseOptions) => {
    if (item.type === 'tool') {
      return;
    }
    config.createMeasuredTemplate = false;
    config.consumeQuantity = false;
    config.consumeRecharge = false;
    config.consumeResource = false;
    config.consumeSpellSlot = false;
    config.consumeUsage = false;
    config.needsConfiguration = false;
  })
}