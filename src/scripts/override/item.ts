import MyAbilityTemplate from "../pixi/ability-template";
import { staticValues } from "../static-values";
import { MyActor, MyItem } from "../types/fixed-types";
import { ItemCardData, UtilsChatMessage } from "../utils/utils-chat-message";
// @ts-expect-error
import AbilityUseDialog from "/systems/dnd5e/module/apps/ability-use-dialog.js";

// Source: https://gitlab.com/foundrynet/dnd5e/-/blob/e0e7ac62469046b0bf51a2fa933b7be34a476b2e/module/item/entity.js#L415
async function roll(this: MyItem, {configureDialog=true, rollMode, createMessage=true}: {configureDialog?: boolean, rollMode?: ClientSettings.Values[`core.rollMode`], createMessage?: boolean} = {}) {
  let item = this;
  const id = this.data.data;                // Item system data
  const actor = this.actor as MyActor;
  const ad = actor.data.data;               // Actor system data

  // Reference aspects of the item data necessary for usage
  const hasArea = this.hasAreaTarget;       // Is the ability usage an AoE?
  const resource = id.consume || {};        // Resource consumption
  const recharge = id.recharge || {};       // Recharge mechanic
  const uses: (typeof id)['uses'] = id?.uses ?? {};              // Limited uses
  const isSpell = this.type === "spell";    // Does the item require a spell slot?
  const requireSpellSlot = isSpell && (id.level > 0) && (CONFIG as any).DND5E.spellUpcastModes.includes(id.preparation.mode);

  // Define follow-up actions resulting from the item usage
  let createMeasuredTemplate = hasArea;       // Trigger a template creation
  let consumeRecharge = !!recharge.value;     // Consume recharge
  let consumeResource = !!resource.target && (resource.type !== "ammo") // Consume a linked (non-ammo) resource
  let consumeSpellSlot = requireSpellSlot;    // Consume a spell slot
  let consumeUsage = !!uses.per;              // Consume limited uses
  let consumeSpellLevel = null;               // Consume a specific category of spell slot
  if (requireSpellSlot) {
    consumeSpellLevel = id.preparation.mode === "pact" ? "pact" : `spell${id.level}`;
  }

  // Display a configuration dialog to customize the usage
  const needsConfiguration = createMeasuredTemplate || consumeRecharge || consumeResource || consumeSpellSlot || consumeUsage;
  if (configureDialog && needsConfiguration) {
    // TODO replace
    const configuration = await AbilityUseDialog.create(this);
    if (!configuration) {
      return;
    }

    // Determine consumption preferences
    createMeasuredTemplate = Boolean(configuration.placeTemplate);
    consumeUsage = Boolean(configuration.consumeUse);
    consumeRecharge = Boolean(configuration.consumeRecharge);
    consumeResource = Boolean(configuration.consumeResource);
    consumeSpellSlot = Boolean(configuration.consumeSlot);

    // Handle spell upcasting
    if ( requireSpellSlot ) {
      consumeSpellLevel = configuration.level === "pact" ? "pact" : `spell${configuration.level}`;
      if ( consumeSpellSlot === false ) {
        consumeSpellLevel = null;
      }
      const upcastLevel = configuration.level === "pact" ? ad.spells.pact.level : parseInt(configuration.level);
      if (upcastLevel !== id.level) {
        item = this.clone({data: {level: upcastLevel}}, {keepId: true});
        item.data.update({_id: this.id}); // Retain the original ID (needed until 0.8.2+)
        item.prepareFinalAttributes(); // Spell save DC, etc...
      }
    }
  }

  // Create or return the Chat Message data
  const message = await item.displayCard({rollMode, createMessage});

  // Initiate measured template creation
  if (createMeasuredTemplate) {
    const template = MyAbilityTemplate.fromItem({
      target: item.data.data.target,
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

  return await UtilsChatMessage.createCard(itemCardData, createMessage);
}

export function registerHooks(): void {
  Hooks.on('setup', () => {
    libWrapper.register(staticValues.moduleName, 'CONFIG.Item.documentClass.prototype.roll', roll, 'OVERRIDE');
    libWrapper.register(staticValues.moduleName, 'CONFIG.Item.documentClass.prototype.displayCard', displayCard, 'OVERRIDE');
  });
}