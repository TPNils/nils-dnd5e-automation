import { ChatMessageDataConstructorData } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/data/data.mjs/chatMessageData";
import * as path from "path";
import { staticValues } from "../static-values";
import { DamageType, MyActor, MyItem } from "../types/fixed-types";
import { UtilsDiceSoNice } from "./utils-dice-so-nice";
import { UtilsRoll } from "./utils-roll";

export interface ItemCardActorData {
  uuid: string;
}

export type RollJson = ReturnType<Roll['toJSON']>

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
    mode: 'normal' | 'advantage' | 'disadvantage';
    rollBonus?: string;
    evaluatedRoll?: RollJson
  },
  damages?: {
    label?: string;
    modfierRule?: 'save-full-dmg' | 'save-halve-dmg' | 'save-no-dmg';
    roll: RollJson;
    displayDamageTypes?: string;
    displayFormula?: string;
  }[];
  checks?: {
    label?: string;
    ability: keyof MyActor['data']['data']['abilities'];
    skill?: string;
    save?: boolean;
    dc: number;
    resultsPerTarget?: {
      [key: string]: RollJson;
    }[]
  }[];
  template?: any;
  spell?: {
    level: number;
  },
  properties?: string[];
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

  private static readonly actionMatches: Array<{regex: RegExp, execute(event: MouseEvent, regexResult: RegExpExecArray, itemIndex: number, messageId: string, messageData: ItemCardData): Promise<void | ItemCardData>}> = [
    {
      regex: /^item-damage-([0-9]+)$/,
      execute: (event, regexResult, itemIndex, messageId, messageData) => UtilsChatMessage.processItemDamage(event, Number(regexResult[1]), itemIndex, messageData),
    },
    {
      regex: /^item-attack$/,
      execute: (event, regexResult, itemIndex, messageId, messageData) => UtilsChatMessage.processItemAttack(event, itemIndex, messageData),
    },
    {
      regex: /^item-attack-mode-(minus|plus)$/,
      execute: (event, regexResult, itemIndex, messageId, messageData) => UtilsChatMessage.processItemAttackMode(event, itemIndex, regexResult, messageData),
    },
  ];

  private static healingDamageTypes: DamageType[] = ['healing', 'temphp'];

  public static registerHooks(): void {
    Hooks.on('renderChatLog', () => {
      const chatElement = document.getElementById('chat-log');
      chatElement.addEventListener('click', event => UtilsChatMessage.onClick(event));
    });

    Hooks.on("init", () => {
      // register templates parts
      loadTemplates([
        'modules/nils-automated-compendium/templates/roll/roll.hbs',
        'modules/nils-automated-compendium/templates/roll/tooltip.hbs'
      ]);
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

    {
      const chatData = item.getChatData();
      itemCardData.properties = chatData.properties;
    }

    const rollData = actor == null ? {} : actor.getRollData();
    // attack
    if (['mwak', 'rwak', 'msak', 'rsak'].includes(item?.data?.data?.actionType)) {
      const bonus = ['@mod'];

      // Proficienty bonus
      if (item.data.data.proficient) {
        bonus.push('@prof')
      }

      // Item bonus
      if (item.data.data.attackBonus) {
        bonus.push(String(item.data.data.attackBonus));
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
        rollBonus: new Roll(bonus.filter(b => b !== '0' && b.length > 0).join(' + '), rollData).toJSON().formula,
      };
    }

    // damage    
    {
      const inputDamages: Array<Omit<ItemCardItemData['damages'][0], 'damageTypes' | 'displayFormula'>> = [];
      // Main damage
      const damageParts = item.data.data.damage?.parts;
      let mainDamage: typeof inputDamages[0];
      if (damageParts && damageParts.length > 0) {
        mainDamage = {
          roll: UtilsRoll.damagePartsToRoll(damageParts, rollData).toJSON()
        }
        // Consider it healing if all damage types are healing
        const isHealing = damageParts.filter(roll => UtilsChatMessage.healingDamageTypes.includes(roll[1])).length === damageParts.length;
        if (isHealing) {
          mainDamage.label = game.i18n.localize('DND5E.Healing');
        }
        inputDamages.push(mainDamage);
      }

      // Versatile damage
      if (mainDamage && item.data.data.damage?.versatile) {
        const versatileDamage = deepClone(mainDamage);
        versatileDamage.label = game.i18n.localize('DND5E.Versatile');
        versatileDamage.roll = new Roll(item.data.data.damage.versatile, rollData).toJSON();
        inputDamages.push(versatileDamage);
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
        const scalingRollFormula = new Roll(scaling.formula, rollData).alter(applyScalingXTimes, 0, {multiplyNumeric: true}).formula;
  
        if (inputDamages.length === 0) {
          // when only dealing damage by upcasting? not sure if that ever happens
          inputDamages.push({
            roll: new Roll(scalingRollFormula, rollData).toJSON()
          });
        } else {
          for (const damage of inputDamages) {
            const originalDamageParts = UtilsRoll.rollToDamageParts(Roll.fromJSON(JSON.stringify(damage.roll)));
            const damageType: DamageType = originalDamageParts.length > 0 ? originalDamageParts[0][1] : ''
            const scalingParts = UtilsRoll.damageFormulaToDamageParts(scalingRollFormula);
            for (const part of scalingParts) {
              if (part[1] === '') {
                // Copy the first original damage type when a type is missing
                part[1] = damageType;
              }
            }
            
            damage.roll = UtilsRoll.damagePartsToRoll([...originalDamageParts, ...scalingParts], rollData).toJSON();
          }
        }
      }
      
      // Add damage bonus formula
      if (inputDamages.length > 0) {
        const actorBonus = actor.data.data.bonuses?.[item.data.data.actionType];
        if (actorBonus?.damage && parseInt(actorBonus.damage) !== 0) {
          for (const damage of inputDamages) {
            const originalDamageParts = UtilsRoll.rollToDamageParts(Roll.fromJSON(JSON.stringify(damage.roll)));
            const damageType: DamageType = originalDamageParts.length > 0 ? originalDamageParts[0][1] : ''
            damage.roll = UtilsRoll.damagePartsToRoll([...originalDamageParts, [String(actorBonus.damage), damageType]], rollData).toJSON();
          }
        }
      }

      itemCardData.damages = inputDamages.map(damage => {
        let displayFormula = damage.roll.formula;
        const damageTypes: DamageType[] = [];
        for (const damageType of UtilsRoll.getValidDamageTypes()) {
          if (displayFormula.match(`\\[${damageType}\\]`)) {
            damageTypes.push(damageType);
            displayFormula = displayFormula.replace(new RegExp(`\\[${damageType}\\]`, 'g'), '');
          }
        }

        return {
          ...damage,
          displayFormula: displayFormula,
          displayDamageTypes: damageTypes.length > 0 ? `(${damageTypes.sort().map(s => s.capitalize()).join(', ')})` : undefined
        };
      })
      
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

  private static async onClick(event: MouseEvent): Promise<void> {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }

    let messageId: string;
    let itemIndex: number;
    let action: string;
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
      if (element.hasAttribute(`data-${staticValues.moduleName}-action`)) {
        action = element.getAttribute(`data-${staticValues.moduleName}-action`);
      }
      
      if (messageId != null && itemIndex != null && action != null) {
        break;
      }
    }

    if (!action) {
      return;
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

    for (const actionMatch of UtilsChatMessage.actionMatches) {
      const result = actionMatch.regex.exec(action);
      if (result) {
        const response = await actionMatch.execute(event, result, itemIndex, messageId, deepClone(messageData));
        if (response) {
          const html = await UtilsChatMessage.generateTemplate(response);
          ChatMessage.updateDocuments([{
            _id: messageId,
            content: html,
            flags: {
              [staticValues.moduleName]: {
                data: response
              }
            }
          }])
        }
        // Don't break, maybe multiple actions need to be taken (though not used at the time of writing)
      }
    }
  }

  private static async processItemAttack(event: MouseEvent, itemIndex: number, messageData: ItemCardData): Promise<void | ItemCardData> {
    const attack = messageData.items[itemIndex].attack;
    if (attack.evaluatedRoll) {
      // If attack was already rolled, do nothing
      // TODO should create a new card (?)
      return;
    }
    
    let baseRoll: string;
    switch (attack.mode) {
      case 'advantage': {
        baseRoll = '2d20kh';
        break;
      }
      case 'disadvantage': {
        baseRoll = '2d20dl';
        break;
      }
      default: {
        baseRoll = '1d20';
      }
    }
    const parts: string[] = [baseRoll];
    if (attack.rollBonus) {
      parts.push(attack.rollBonus);
    }

    const roll = await new Roll(parts.join(' + ')).roll({async: true});
    UtilsDiceSoNice.showRoll({roll: roll});
    attack.evaluatedRoll = roll.toJSON();

    return messageData;
  }

  private static async processItemAttackMode(event: MouseEvent, itemIndex: number, regexResult: RegExpExecArray, messageData: ItemCardData): Promise<void | ItemCardData> {
    const attack = messageData.items[itemIndex].attack;
    let modifier = regexResult[1] === 'plus' ? 1 : -1;
    if (event.shiftKey && modifier > 0) {
      modifier++;
    } else if (event.shiftKey && modifier < 0) {
      modifier--;
    }
    
    const order: Array<typeof attack.mode> = ['disadvantage', 'normal', 'advantage'];
    const newIndex = Math.max(0, Math.min(order.length-1, order.indexOf(attack.mode) + modifier));
    if (attack.mode === order[newIndex]) {
      return;
    }
    attack.mode = order[newIndex];
    if (!attack.evaluatedRoll) {
      return messageData;
    }

    const terms = Roll.fromJSON(JSON.stringify(attack.evaluatedRoll)).terms;
    const d20Term: any = terms[0];
    const targetDiceNumber = attack.mode === 'normal' ? 1 : 2;
    while (d20Term.number < targetDiceNumber) {
      const d20 = await new Roll('1d20').roll({async: true});
      UtilsDiceSoNice.showRoll({roll: d20});
      d20Term.number++;
      d20Term.results.push({result: d20.total, active: true});
    }
    
    if (attack.mode === 'advantage') {
      d20Term.modifiers = d20Term.modifiers ? [...d20Term.modifiers.filter(mod => mod !== 'kl' && mod !== 'kh'), 'kh'] : ['kh'];
      let highestResult;
      for (const result of d20Term.results) {
        if (!highestResult || highestResult.result <= result.result) {
          highestResult = result;
        }
      }

      delete highestResult.discarded;
      highestResult.active = true;
      
      for (const result of d20Term.results) {
        if (result !== highestResult) {
          result.active = false;
          result.discarded = true;
        }
      }
    } else if (attack.mode === 'disadvantage') {
      d20Term.modifiers = d20Term.modifiers ? [...d20Term.modifiers.filter(mod => mod !== 'kl' && mod !== 'kh'), 'kl'] : ['kl'];
      let lowestResult;
      for (const result of d20Term.results) {
        if (!lowestResult || lowestResult.result >= result.result) {
          lowestResult = result;
        }
      }

      delete lowestResult.discarded;
      lowestResult.active = true;
      
      for (const result of d20Term.results) {
        if (result !== lowestResult) {
          result.active = false;
          result.discarded = true;
        }
      }
    } else {
      d20Term.modifiers = d20Term.modifiers ? [...d20Term.modifiers.filter(mod => mod !== 'kl' && mod !== 'kh')] : [];
      delete d20Term.results[0].discarded;
      d20Term.results[0].active = true;

      for (let i = 1; i < d20Term.results.length; i++) {
        d20Term.results[i].active = false;
        d20Term.results[i].discarded = true;
      }
    }
    attack.evaluatedRoll = Roll.fromTerms(terms).toJSON();
    return messageData;
  }

  private static async processItemDamage(event: MouseEvent, damageIndex: number, itemIndex: number, messageData: ItemCardData): Promise<void | ItemCardData> {
    // If damage was already rolled, do nothing
    // TODO should create a new card (?)
    const roll = messageData.items[itemIndex].damages[damageIndex].roll;
    if (roll.evaluated) {
      return;
    }

    const dmgRoll = await Roll.fromJSON(JSON.stringify(roll)).roll({async: true});
    UtilsDiceSoNice.showRoll({roll: dmgRoll});
    messageData.items[itemIndex].damages[damageIndex].roll = dmgRoll.toJSON();

    return messageData;
  }

  private static generateTemplate(data: ItemCardData): Promise<string> {
    return renderTemplate(`modules/${staticValues.moduleName}/templates/item-card.hbs`, {
      staticValues: staticValues,
      data: data
    });
  }

}