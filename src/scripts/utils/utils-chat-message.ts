import { ChatMessageDataConstructorData } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/data/data.mjs/chatMessageData";
import { data } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/module.mjs";
import { MessageData } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/foundry.js/roll";
import { staticValues } from "../static-values";
import { DamageType, MyActor, MyItem } from "../types/fixed-types";
import { UtilsDocument } from "./utils-document";

export interface ItemCardActorData {
  uuid: string;
}

export interface ItemCardRollResult {
  total: number;
  parts: number[];
}

export interface ItemCardItemData {
  uuid: string;
  name: string;
  img: string;
  description?: string;
  materials?: string;
  targets?: {
    uuid: string;
    ac: number;
  }[];
  attack?: {
    label?: string;
    mode: 'normal' | 'advantage' | 'disadavantage';
    rollBonus: string;
    rollResult?: ItemCardRollResult;
  },
  damages?: {
    label?: string;
    modfierRule?: 'save-full-dmg' | 'save-halve-dmg' | 'save-no-dmg';
    rolls: {
      rollFormula: string;
      damageType: DamageType;
    }[];
    rollResults?: Array<ItemCardRollResult & {damageType: string;}>;
  }[];
  checks?: {
    label?: string;
    ability: keyof MyActor['data']['data']['abilities'];
    skill?: string;
    save?: boolean;
    dc: number;
    resultsPerTarget?: {
      [key: string]: ItemCardRollResult;
    }[]
  }[];
  template?: any;
  spell?: {
    level: number;
  }
}

export interface ItemCardTokenData {
  uuid: string;
}

export interface ItemCardData {
  actor?: ItemCardActorData;
  items: ItemCardItemData[];
  token?: ItemCardTokenData;
}

export class UtilsChatMessage {

  private static readonly actionMatches: Array<{regex: RegExp, execute(regexResult: RegExpExecArray, itemIndex: number, messageId: string, messageData: ItemCardData)}> = [
    {
      regex: /item-damage-([0-9]+)/,
      execute: (regexResult, itemIndex, messageId, messageData) => UtilsChatMessage.processItemDamage(Number(regexResult[1]), itemIndex, messageId, messageData),
    }
  ];

  private static healingDamageTypes: DamageType[] = ['healing', 'temphp'];

  public static registerHooks(): void {
    Hooks.on('renderChatLog', () => {
      const chatElement = document.getElementById('chat-log');
      chatElement.addEventListener('click', event => UtilsChatMessage.onClick(event));
    });
  }

  public static async createCard(data: ItemCardData): Promise<ChatMessage> {
    // I expect actor & token to sometimes include the whole actor/token document by accident
    // While I would prefer a full type validation, it is the realistic approach
    if (data.actor) {
      data.actor = {
        uuid: data.actor.uuid
      }
    }
    if (data.token) {
      data.token = {
        uuid: data.token.uuid
      }
    }

    const template = await UtilsChatMessage.generateTemplate(data);

    const chatMessageData: ChatMessageDataConstructorData = {
      content: template,
      flags: {
        [staticValues.moduleName]: {
          data: data
        }
      }
    };
    return await ChatMessage.create(chatMessageData)
  }

  public static createDefaultItemData({item, level, overrideItemScaling, actor}: {item: MyItem, level?: number, overrideItemScaling?: MyItem['data']['data']['scaling'], actor?: MyActor}): ItemCardItemData {
    const itemCardData: ItemCardItemData = {
      uuid: item.uuid,
      name: item.data.name,
      img: item.img,
    };

    if (item.data.data.description.value) {
      itemCardData.description =item.data.data.description.value
    }
    if (item.data.data.materials.value) {
      itemCardData.materials = item.data.data.materials.value
    }

    // attack
    if (['mwak', 'rwak', 'msak', 'rsak'].includes(item.data.data.actionType)) {
      const bonus = ['@mod'];

      // Proficiantie bonus
      if (item.data.data.proficient) {
        bonus.push('@prof')
      }

      // Item bonus
      if (item.data.data.attackBonus) {
        bonus.push(String(item.data.data.actionBonus));
      }

      // Actor bonus
      const actorBonus = actor?.data.data.bonuses?.[item.data.data.actionType]?.attack;
      if (actorBonus) {
        bonus.push(actorBonus);
      }

      // One-time bonus provided by consumed ammunition
      if ( (item.data.data.consume?.type === 'ammo') && !!actor?.items ) {
        const ammoItemData = actor.items.get(item.data.data.consume.target)?.data;

        if (ammoItemData) {
          const ammoItemQuantity = ammoItemData.data.quantity;
          const ammoCanBeConsumed = ammoItemQuantity && (ammoItemQuantity - (item.data.data.consume.amount ?? 0) >= 0);
          const ammoItemAttackBonus = ammoItemData.data.attackBonus;
          const ammoIsTypeConsumable = ammoItemData.type === "consumable" && ammoItemData.data.consumableType === "ammo";
          if ( ammoCanBeConsumed && ammoItemAttackBonus && ammoIsTypeConsumable ) {
            bonus.push(`${ammoItemAttackBonus}[ammo]`);
          }
        }
      }

      itemCardData.attack = {
        mode: 'normal',
        rollBonus: bonus.join(' + '),
      };
    }

    // damage    
    {
      // Main damage
      const damageParts = item.data.data.damage?.parts;
      let mainDamage: ItemCardItemData['damages'][0];
      if (damageParts && damageParts.length > 0) {
        itemCardData.damages = itemCardData.damages || [];
        mainDamage = {
          rolls: damageParts.map(part => {
            return {
              rollFormula: part[0],
              damageType: part[1]
            }
          }),
        }
        // Consider it healing if all damage types are healing
        const isHealing = mainDamage.rolls.filter(roll => UtilsChatMessage.healingDamageTypes.includes(roll.damageType)).length === mainDamage.rolls.length;
        if (isHealing) {
          mainDamage.label = game.i18n.localize('DND5E.Healing');
        }
        itemCardData.damages.push(mainDamage);
      }

      // Versatile damage
      if (mainDamage && item.data.data.damage?.versatile) {
        const versatileDamage = deepClone(mainDamage);
        versatileDamage.label = game.i18n.localize('DND5E.Versatile');
        versatileDamage.rolls[0].rollFormula = item.data.data.damage?.versatile;
        itemCardData.damages.push(versatileDamage);
      }
  
      // Spell scaling
      const scaling = overrideItemScaling || item.data.data.scaling;
      let applyScalingXTimes = 0;
      if (scaling?.mode === 'level') {
        applyScalingXTimes = item.data.data.level - level;
      } else if (scaling?.mode === 'cantrip' && actor) {
        let actorLevel = 0;
        if (actor.type === "character") {
          actorLevel = actor.data.data.details.level;
        } else if (item.data.data.preparation.mode === "innate") {
          actorLevel = Math.ceil(actor.data.data.details.cr);
        } else {
          actorLevel = actor.data.data.details.spellLevel;
        }
        applyScalingXTimes = Math.floor((actorLevel + 1) / 6);
      }
      if (applyScalingXTimes > 0) {
        const scalingRollFormula = new Roll(scaling.formula).alter(applyScalingXTimes, 0, {multiplyNumeric: true}).formula;
  
        itemCardData.damages = itemCardData.damages || [];
        if (itemCardData.damages.length === 0) {
          // when only dealing damage by upcasting? not sure if that ever happens
          itemCardData.damages.push({
            rolls: [{
              rollFormula: scalingRollFormula,
              damageType: ''
            }]
          });
        } else {
          for (const damage of itemCardData.damages) {
            damage.rolls.push({
              rollFormula: scalingRollFormula,
              damageType: damage.rolls[0].damageType
            });
          }
        }
      }
      
      // Add damage bonus formula
      if (itemCardData.damages) {
        const actorBonus = actor.data.data.bonuses?.[item.data.data.actionType];
        if (actorBonus?.damage && parseInt(actorBonus.damage) !== 0) {
          for (const damage of itemCardData.damages) {
            damage.rolls.push({
              rollFormula: actorBonus.damage,
              damageType: damage.rolls[0].damageType
            })
          }
        }
      }

      
    }

    // Saving throw
    if (item.data.data.save.dc != null && item.data.data.save.ability) {
      itemCardData.checks = itemCardData.checks || [];
      itemCardData.checks.push({
        ability: item.data.data.save.ability,
        dc: item.data.data.save.dc,
        save: true,
      });
    }

    // TODO template

    return itemCardData;
  }

  private static onClick(event: MouseEvent): void {
    if (!(event.target instanceof HTMLElement) || !event.target.hasAttribute(`data-${staticValues.moduleName}-action`)) {
      return;
    }

    let messageId: string;
    let itemIndex: number;
    const path = event.composedPath();
    for (let i = path.length - 1; i >= 0; i--) {
      const element = path[i];
      if (!(element instanceof HTMLElement)) {
        continue;
      }
      if (element.dataset.messageId != null) {
        messageId = element.dataset.messageId;
      }
      if (element.hasAttribute(`data-${staticValues.moduleName}-item-index`)) {
        itemIndex = Number(element.getAttribute(`data-${staticValues.moduleName}-item-index`));
      }
      
      if (messageId != null && itemIndex != null) {
        break;
      }
    }

    if (messageId == null) {
      console.warn(`pressed a ${staticValues.moduleName} action button but no message was found`);
      return;
    }
    if (itemIndex == null) {
      console.warn(`pressed a ${staticValues.moduleName} action button for message ${messageId} but no item index was found`);
      return;
    }
    
    const messageData = game.messages.get(messageId).getFlag(staticValues.moduleName, 'data') as ItemCardData;
    if (messageData == null) {
      console.warn(`pressed a ${staticValues.moduleName} action button for message ${messageId} but no data was found`);
      return;
    }

    const action = event.target.getAttribute(`data-${staticValues.moduleName}-action`);
    for (const actionMatch of UtilsChatMessage.actionMatches) {
      const result = actionMatch.regex.exec(action);
      if (result) {
        actionMatch.execute(result, itemIndex, messageId, deepClone(messageData));
        // Don't break, maybe multiple actions need to be taken (though not used at the time of writing)
      }
    }
  }

  private static async processItemDamage(damageIndex: number, itemIndex: number, messageId: string, messageData: ItemCardData): Promise<void> {
    // If damage was already rolled, do nothing
    // TODO should create a new card (?)
    if (messageData.items[itemIndex].damages[damageIndex].rollResults) {
      return;
    }

    const rollData = messageData.actor == null ? {} : (await UtilsDocument.actorFromUuid(messageData.actor.uuid)).getRollData();
    const damageInstance = messageData.items[itemIndex].damages[damageIndex];
    const damageRolls = await Promise.all(damageInstance.rolls.map(dmgRoll => new Roll(dmgRoll.rollFormula, rollData).roll({async: true})));

    const rollResults: ItemCardData['items'][0]['damages'][0]['rollResults'] = [];
    for (let i = 0; i < damageRolls.length; i++) {
      // I assume Promise.all() results keep the same order
      const damageRollRequest = messageData.items[itemIndex].damages[damageIndex].rolls[i];
      const damageRollResult = damageRolls[i];
      const parts: number[] = [];
      for (const term of damageRollResult.terms as any[]) {
        if (Array.isArray(term.results)) {
          for (const result of (term as {results: { result: number }[]}).results) {
            parts.push(result.result);
          }
        } else if (typeof term.number === 'number') {
          parts.push(term.number);
        }
      }

      rollResults.push({
        damageType: damageRollRequest.damageType,
        total: damageRollResult.total,
        parts: parts
      })
    }
    messageData.items[itemIndex].damages[damageIndex].rollResults = rollResults;
    console.log(rollResults);

    const html = await UtilsChatMessage.generateTemplate(messageData);
    //const message = game.messages.get(messageId);
    //await message.setFlag(staticValues.moduleName, 'data', messageData);
    //ChatMessage.updateDocuments([{
    //  _id: messageId,
    //  content: html
    //}])
  }

  private static generateTemplate(data: ItemCardData): Promise<string> {
    return renderTemplate(`modules/${staticValues.moduleName}/templates/item-card.hbs`, {
      staticValues: staticValues,
      data: data
    });
  }

}