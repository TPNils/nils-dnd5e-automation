import { ChatMessageDataConstructorData } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/data/data.mjs/chatMessageData";
import { ActiveEffectData, ItemData } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/data/module.mjs";
import { IDmlContext, DmlTrigger, IDmlTrigger } from "../dml-trigger/dml-trigger";
import MyAbilityTemplate from "../pixi/ability-template";
import { provider } from "../provider/provider";
import { MemoryStorageService } from "../service/memory-storage-service";
import { staticValues } from "../static-values";
import { DamageType, MyActor, MyActorData, MyItem, MyItemData } from "../types/fixed-types";
import { UtilsDiceSoNice } from "./utils-dice-so-nice";
import { UtilsDocument } from "./utils-document";
import { UtilsRoll } from "./utils-roll";
import { UtilsTemplate } from "./utils-template";

export interface ItemCardActorData {
  uuid: string;
  level: number;
  pactLevel: number;
}

export type RollJson = ReturnType<Roll['toJSON']>

type RollPhase = 'mode-select' | 'bonus-input' | 'result';
export interface ItemCardItemData {
  uuid: string;
  name: string;
  img: string;
  type: string;
  level?: number;
  selectedlevel?: number | 'pact';
  description?: string;
  materials?: string;
  properties?: string[];
  targets?: {
    uuid: string;
    actorUuid: string;
    ac: number;
    img?: string;
    name?: string;
    hpSnapshot: {
      maxHp: number;
      hp: number;
      temp?: number;
    },
    immunities: string[];
    resistances: string[];
    vulnerabilities: string[];
    check?: {
      evaluatedRoll?: RollJson;
      phase: RollPhase;
      userBonus: string;
      mode: 'normal' | 'advantage' | 'disadvantage';
    }
    result: {
      hit?: boolean;
      checkPass?: boolean;
      applyDmg?: boolean;
      dmg?: {
        type: DamageType;
        rawNumber: number;
        calcNumber: number;
      },
      appliedActiveEffects: boolean; // The UUIDs of the newly created effects
    }
  }[];
  attack?: {
    label?: string;
    phase: RollPhase;
    mode: 'normal' | 'advantage' | 'disadvantage';
    rollBonus?: string;
    userBonus: string;
    evaluatedRoll?: RollJson
  },
  damages?: {
    label?: string;
    phase: RollPhase;
    modfierRule?: 'save-full-dmg' | 'save-halve-dmg' | 'save-no-dmg';
    mode: 'normal' | 'critical';
    baseRoll: RollJson;
    upcastRoll?: RollJson;
    actorBonusRoll?: RollJson;
    normalRoll?: RollJson;
    criticalRoll?: RollJson;
    userBonus: string;
    displayDamageTypes?: string;
    displayFormula?: string;
  }[];
  check?: {
    ability: keyof MyActor['data']['data']['abilities'];
    dc: number;
    label?: string;
    skill?: string;
    addSaveBonus?: boolean;
  };
  targetDefinition: {
    hasAoe: boolean,
    createdTemplateUuid?: string;
  } & MyItemData['data']['target'];
  allConsumeResourcesApplied: boolean;
  canChangeLevel: boolean;
  consumeResources: {
    uuid: string;
    path: string;
    amount: number;
    original: number;
    autoconsumeAfter?: 'init' | 'attack' | 'damage' | 'check' | 'template-placed';
    consumeResourcesAction?: 'undo' | 'manual-apply';
    applied: boolean;
  }[];
  canChangeTargets: boolean;
  activeEffectsData: ActiveEffectData[];
}

export interface ItemCardTokenData {
  uuid: string;
}

export interface ItemCardData {
  actor?: ItemCardActorData;
  items: ItemCardItemData[];
  token?: ItemCardTokenData;
  allDmgApplied?: boolean;
  targetAggregate?: {
    uuid: string;
    img?: string;
    name?: string;
    hpSnapshot: {
      maxHp: number;
      hp: number;
      temp?: number;
    },
    dmg?: {
      avoided: boolean;
      applied: boolean,
      appliedDmg: number,
      rawDmg: number;
      calcDmg: number;
      calcHp: number;
      calcTemp: number;
    },
  }[];
}

interface ClickEvent {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}
interface KeyEvent {
  readonly key: 'Enter' | 'Escape';
}
type InteractionResponse = {success: true;} | {success: false; errorMessage: string, errorType: 'warn' | 'error'}
interface ActionParam {clickEvent: ClickEvent, userId: string, keyEvent?: KeyEvent, regexResult: RegExpExecArray, messageId: string, messageData: ItemCardData, inputValue?: boolean | number | string};
type ActionPermissionCheck = ({}: ActionParam) => {actorUuid?: string, message?: boolean, gm?: boolean, onlyRunLocal?: boolean};
type ActionPermissionExecute = ({}: ActionParam) => Promise<void | ItemCardData>;

export class UtilsChatMessage {

  private static readonly actionMatches: Array<{regex: RegExp, permissionCheck: ActionPermissionCheck, execute: ActionPermissionExecute}> = [
    {
      regex: /^toggle-collapse$/,
      permissionCheck: () => {return {onlyRunLocal: true}},
      execute: ({messageId}) => UtilsChatMessage.toggleCollapse(messageId),
    },
    {
      regex: /^item-([0-9]+)-damage-([0-9]+)$/,
      permissionCheck: ({messageData}) => {return {actorUuid: messageData.actor?.uuid}},
      execute: ({clickEvent, regexResult, messageData, messageId}) => UtilsChatMessage.processItemDamage(clickEvent, Number(regexResult[1]), Number(regexResult[2]), messageData, messageId),
    },
    {
      regex: /^item-([0-9]+)-damage-([0-9]+)-mode-(minus|plus)$/,
      permissionCheck: ({messageData}) => {return {actorUuid: messageData.actor?.uuid}},
      execute: ({clickEvent, regexResult, messageData, messageId}) => UtilsChatMessage.processItemDamageMode(clickEvent, Number(regexResult[1]), Number(regexResult[2]), regexResult[3] as ('plus' | 'minus'), messageData, messageId),
    },
    {
      regex: /^item-([0-9]+)-damage-([0-9]+)-bonus$/,
      permissionCheck: ({messageData}) => {return {actorUuid: messageData.actor?.uuid}},
      execute: ({keyEvent, regexResult, inputValue, messageData, messageId}) => UtilsChatMessage.processItemDamageBonus(keyEvent, Number(regexResult[1]), Number(regexResult[2]), inputValue as string, messageData, messageId),
    },
    {
      regex: /^item-([0-9]+)-attack$/,
      permissionCheck: ({messageData}) => {return {actorUuid: messageData.actor?.uuid}},
      execute: ({clickEvent, regexResult, messageData}) => UtilsChatMessage.processItemAttack(clickEvent, Number(regexResult[1]), messageData),
    },
    {
      regex: /^item-([0-9]+)-attack-bonus$/,
      permissionCheck: ({messageData}) => {return {actorUuid: messageData.actor?.uuid}},
      execute: ({keyEvent, regexResult, inputValue, messageData}) => UtilsChatMessage.processItemAttackBonus(keyEvent, Number(regexResult[1]), inputValue as string, messageData),
    },
    {
      regex: /^item-([0-9]+)-upcastlevel$/,
      permissionCheck: ({messageData}) => {return {actorUuid: messageData.actor?.uuid}},
      execute: ({regexResult, inputValue, messageData}) => UtilsChatMessage.upcastlevelChange(Number(regexResult[1]), inputValue as string, messageData),
    },
    {
      regex: /^item-([0-9]+)-attack-mode-(minus|plus)$/,
      permissionCheck: ({messageData}) => {return {actorUuid: messageData.actor?.uuid}},
      execute: ({clickEvent, regexResult, messageData}) => UtilsChatMessage.processItemAttackMode(clickEvent, Number(regexResult[1]), regexResult[2] as ('plus' | 'minus'), messageData),
    },
    {
      regex: /^item-([0-9]+)-check-([a-zA-Z0-9\.]+)$/,
      permissionCheck: ({regexResult}) => {return {actorUuid: regexResult[2]}},
      execute: ({clickEvent, regexResult, messageData}) => UtilsChatMessage.processItemCheck(clickEvent, Number(regexResult[1]), regexResult[2], messageData),
    },
    {
      regex: /^item-([0-9]+)-check-([a-zA-Z0-9\.]+)-bonus$/,
      permissionCheck: ({regexResult}) => {return {actorUuid: regexResult[2]}},
      execute: ({keyEvent, regexResult, inputValue, messageData}) => UtilsChatMessage.processItemCheckBonus(keyEvent, Number(regexResult[1]), regexResult[2], inputValue as string, messageData),
    },
    {
      regex: /^item-([0-9]+)-check-([a-zA-Z0-9\.]+)-mode-(minus|plus)$/,
      permissionCheck: ({regexResult}) => {return {actorUuid: regexResult[2]}},
      execute: ({clickEvent, regexResult, messageData}) => UtilsChatMessage.processItemCheckMode(clickEvent, Number(regexResult[1]), regexResult[2], regexResult[3] as ('plus' | 'minus'), messageData),
    },
    {
      regex: /^item-([0-9]+)-template$/,
      permissionCheck: ({regexResult}) => {return {actorUuid: regexResult[2], onlyRunLocal: true, message: true}},
      execute: ({regexResult, messageData, messageId}) => UtilsChatMessage.processItemTemplate(Number(regexResult[1]), messageData, messageId),
    },
    {
      regex: /^apply-consume-resource-((?:[0-9]+)|\*)-((?:[0-9]+)|\*)$/,
      permissionCheck: ({regexResult}) => {return {message: true}},
      execute: ({regexResult, messageData}) => {
        let itemIndex: '*' | number = regexResult[1] === '*' ? '*' : Number.parseInt(regexResult[1]);
        let consumeResourceIndex: '*' | number = regexResult[2] === '*' ? '*' : Number.parseInt(regexResult[2]);
        return UtilsChatMessage.manualApplyConsumeResource(messageData, itemIndex, consumeResourceIndex);
      },
    },
    {
      regex: /^undo-consume-resource-((?:[0-9]+)|\*)-((?:[0-9]+)|\*)$/,
      permissionCheck: ({regexResult}) => {return {message: true}},
      execute: ({regexResult, messageData}) => {
        let itemIndex: '*' | number = regexResult[1] === '*' ? '*' : Number.parseInt(regexResult[1]);
        let consumeResourceIndex: '*' | number = regexResult[2] === '*' ? '*' : Number.parseInt(regexResult[2]);
        return UtilsChatMessage.manualUndoConsumeResource(messageData, itemIndex, consumeResourceIndex);
      },
    },
    {
      regex: /^apply-damage-((?:[a-zA-Z0-9\.]+)|\*)$/,
      permissionCheck: ({regexResult}) => {return {gm: true}},
      execute: ({regexResult, messageId, messageData}) => UtilsChatMessage.applyDamage([regexResult[1]], messageData, messageId),
    },
    {
      regex: /^undo-damage-((?:[a-zA-Z0-9\.]+)|\*)$/,
      permissionCheck: ({regexResult}) => {return {gm: true}},
      execute: ({regexResult, messageId, messageData}) => UtilsChatMessage.undoDamage(regexResult[1], messageData, messageId),
    },
  ];

  private static get spellUpcastModes(): Array<MyItemData['data']['preparation']['mode']> {
    return (CONFIG as any).DND5E.spellUpcastModes;
  }

  public static registerHooks(): void {
    Hooks.on('renderChatLog', () => {
      const chatElement = document.getElementById('chat-log');
      chatElement.addEventListener('click', event => UtilsChatMessage.onClick(event));
      chatElement.addEventListener('focusout', event => UtilsChatMessage.onBlur(event));
      chatElement.addEventListener('keydown', event => UtilsChatMessage.onKeyDown(event));
      chatElement.addEventListener('change', event => UtilsChatMessage.onChange(event));
    });

    Hooks.on("init", () => {
      // register templates parts
      loadTemplates([
        'modules/nils-automated-compendium/templates/damage.hbs',
        'modules/nils-automated-compendium/templates/roll/roll.hbs',
        'modules/nils-automated-compendium/templates/roll/tooltip.hbs'
      ]);
    });
    
    DmlTrigger.registerTrigger(new DmlTriggerChatMessage());
    DmlTrigger.registerTrigger(new DmlTriggerTemplate());
    DmlTrigger.registerTrigger(new DmlTriggerUser());
    
    provider.getSocket().then(socket => {
      socket.register('onInteraction', (params: Parameters<typeof UtilsChatMessage['onInteractionProcessor']>[0]) => {
        return UtilsChatMessage.onInteractionProcessor(params);
      })
    });
  }

  //#region public conversion utils
  public static async createCard(data: {actor?: MyActor, token?: TokenDocument, items: ItemCardItemData[]}, insert: boolean = true): Promise<ChatMessage> {
    // I expect actor & token to sometimes include the whole actor/token document by accident
    // While I would prefer a full type validation, it is the realistic approach
    const card: ItemCardData = {
      items: data.items
    }
    if (data.actor) {
      let actorLevel = 0;
      if (data.actor.type === "character") {
        actorLevel = data.actor.data.data.details.level;
      } else {
        actorLevel = Math.ceil(data.actor.data.data.details.cr);
      }
      card.actor = {
        level: actorLevel,
        uuid: data.actor.uuid,
        pactLevel: data.actor.data.data?.spells?.pact?.level ?? 0,
      }
    }
    if (data.token) {
      card.token = {
        uuid: data.token.uuid
      }
    }

    const chatMessageData: ChatMessageDataConstructorData = {
      flags: {
        [staticValues.moduleName]: {
          clientTemplate: `modules/${staticValues.moduleName}/templates/item-card.hbs`,
          clientTemplateData: {
            staticValues: staticValues,
            data: card,
          }
        }
      }
    };

    if (insert) {
      return await ChatMessage.create(chatMessageData)
    } else {
      return new ChatMessage(chatMessageData);
    }
  }

  public static async createDefaultItemData({item, actor}: {item: MyItem, actor?: MyActor}): Promise<ItemCardItemData> {
    const itemCardData: ItemCardItemData = {
      uuid: item.uuid,
      name: item.data.name,
      img: item.img,
      type: item.type,
      level: item.data.data.level,
      selectedlevel: item.data.data?.preparation?.mode === 'pact' ? 'pact' : item.data.data.level,
      canChangeTargets: true,
      targetDefinition: {
        // @ts-expect-error
        hasAoe: CONFIG.DND5E.areaTargetTypes.hasOwnProperty(item.data.data.target.type),
        ...item.data.data.target,
      },
      allConsumeResourcesApplied: true,
      canChangeLevel: true,
      consumeResources: [],
      activeEffectsData:  Array.from(item.effects.values())
        .map(effect => {
          const data = deepClone(effect.data);
          delete data._id;
          return data;
        })
        .filter(effectData => !effectData.transfer),
    };
    const isSpell = item.type === "spell";
    if (item.uuid) {
      // Items passed by external sources (like external calls to Item.displayCard) may pass an upcasted version of the item.
      // Fetch the original item to know what the original level
      const queriedItem = await UtilsDocument.itemFromUuid(item.uuid);
      itemCardData.level = queriedItem.data.data.level;
    }

    if (item.data.data.description?.value) {
      itemCardData.description = item.data.data.description.value
    }
    if (item.data.data.materials?.value) {
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
        phase: 'mode-select',
        rollBonus: new Roll(bonus.filter(b => b !== '0' && b.length > 0).join(' + '), rollData).toJSON().formula,
        userBonus: "",
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
          mode: 'normal',
          phase: 'mode-select',
          baseRoll: UtilsRoll.damagePartsToRoll(damageParts, rollData).toJSON(),
          userBonus: "",
        }
        // Consider it healing if all damage types are healing
        const isHealing = damageParts.filter(roll => InternalFunctions.healingDamageTypes.includes(roll[1])).length === damageParts.length;
        if (isHealing) {
          mainDamage.label = game.i18n.localize('DND5E.Healing');
        }
        inputDamages.push(mainDamage);
      }

      // Versatile damage
      if (mainDamage && item.data.data.damage?.versatile) {
        const versatileDamage = deepClone(mainDamage);
        versatileDamage.label = game.i18n.localize('DND5E.Versatile');
        versatileDamage.baseRoll = new Roll(item.data.data.damage.versatile, rollData).toJSON();
        inputDamages.push(versatileDamage);
      }
  
      // Spell scaling
      const scaling = item.data.data.scaling;
      if (scaling?.mode === 'level' && scaling.formula) {
        const scalingRollJson: RollJson = new Roll(scaling.formula, rollData).toJSON();
        if (inputDamages.length === 0) {
          // when only dealing damage by upcasting? not sure if that ever happens
          inputDamages.push({
            mode: 'normal',
            phase: 'mode-select',
            baseRoll: new Roll('0').toJSON(),
            userBonus: "",
          });
        }
        for (const damage of inputDamages) {
          damage.upcastRoll = scalingRollJson;
        }
      } else if (scaling?.mode === 'cantrip' && actor) {
        let actorLevel = 0;
        if (actor.type === "character") {
          actorLevel = actor.data.data.details.level;
        } else if (item.data.data.preparation.mode === "innate") {
          actorLevel = Math.ceil(actor.data.data.details.cr);
        } else {
          actorLevel = actor.data.data.details.spellLevel;
        }
        const applyScalingXTimes = Math.floor((actorLevel + 1) / 6);

        if (applyScalingXTimes > 0) {
          if (inputDamages.length === 0) {
            // when only dealing damage by upcasting? not sure if that ever happens
            inputDamages.push({
              mode: 'normal',
              phase: 'mode-select',
              baseRoll: new Roll('0').toJSON(),
              userBonus: "",
            });
          }
  
          for (const damage of inputDamages) {
            // DND5e spell compendium has cantrip formula empty => default to the base damage formula
            const scalingRoll = new Roll(scaling.formula == null || scaling.formula.length === 0 ? damage.baseRoll.formula : scaling.formula, rollData).alter(applyScalingXTimes, 0, {multiplyNumeric: true});
            // Override normal roll since cantrip scaling is static, not dynamic like level scaling
            damage.baseRoll = UtilsRoll.mergeRolls(Roll.fromJSON(JSON.stringify(damage.baseRoll)), scalingRoll).toJSON();
          }
        }
      }
      
      // Add damage bonus formula
      if (inputDamages.length > 0) {
        const actorBonus = actor.data.data.bonuses?.[item.data.data.actionType];
        if (actorBonus?.damage && parseInt(actorBonus.damage) !== 0) {
          for (const damage of inputDamages) {
            damage.actorBonusRoll = new Roll(actorBonus.damage, rollData).toJSON();
          }
        }
      }
      
      itemCardData.damages = inputDamages;
    }

    // Saving throw
    if (item.data.data.save.dc != null && item.data.data.save.ability) {
      itemCardData.check = {
        ability: item.data.data.save.ability,
        dc: item.data.data.save.dc,
        addSaveBonus: true,
      }
    }

    // Damage modifier
    if (itemCardData.check && itemCardData.damages) {
      let modfierRule: ItemCardItemData['damages'][0]['modfierRule'] = 'save-halve-dmg';
      if (item.type === 'spell') {
        if (item.data.data.level === 0) {
          // Official cantrips never deal half damage
          modfierRule = 'save-no-dmg';
        }
      }

      // TODO be smart like midi-qol and inject add these type into the item sheet
      for (const damage of itemCardData.damages) {
        damage.modfierRule = modfierRule;
      }
    }

    // Consume actor resources
    if (actor) {
      const requireSpellSlot = isSpell && itemCardData.level > 0 && UtilsChatMessage.spellUpcastModes.includes(item.data.data.preparation.mode);
      if (requireSpellSlot) {
        let spellPropertyName = item.data.data.preparation.mode === "pact" ? "pact" : `spell${itemCardData.level}`;
        itemCardData.consumeResources.push({
          uuid: actor.uuid,
          path: `data.spells.${spellPropertyName}.value`,
          amount: 1,
          original: actor?.data?.data?.spells?.[spellPropertyName]?.value ?? 0,
          applied: false
        });
      }

      switch (item.data.data.consume.type) {
        case 'attribute': {
          if (item.data.data.consume.target && item.data.data.consume.amount > 0) {
            let propertyPath = `data.${item.data.data.consume.target}`;
            itemCardData.consumeResources.push({
              uuid: actor.uuid,
              path: propertyPath,
              amount: item.data.data.consume.amount,
              original: getProperty(actor.data, propertyPath) ?? 0,
              applied: false
            });
          }
          break;
        }
      }
    }

    // Consume item resources
    switch (item.data.data.consume.type) {
      case 'ammo':
      case 'material': {
        if (item.data.data.consume.target && item.data.data.consume.amount > 0) {
          const targetItem = item.actor.items.get(item.data.data.consume.target);
          let propertyPath = `data.quantity`;
          itemCardData.consumeResources.push({
            uuid: targetItem.uuid,
            path: propertyPath,
            amount: item.data.data.consume.amount,
            original: getProperty(targetItem.data, propertyPath) ?? 0,
            applied: false
          });
        }
        break;
      }
      case 'charges': {
        if (item.data.data.consume.target && item.data.data.consume.amount > 0) {
          const targetItem = item.actor.items.get(item.data.data.consume.target);
          let propertyPath = `data.uses.value`;
          itemCardData.consumeResources.push({
            uuid: targetItem.uuid,
            path: propertyPath,
            amount: item.data.data.consume.amount,
            original: getProperty(targetItem.data, propertyPath) ?? 0,
            applied: false
          });
        }
        break;
      }
    }
    
    if (item.data.data.uses?.per != null && item.data.data.uses?.per != '') {
      let propertyPath = `data.uses.value`;
      itemCardData.consumeResources.push({
        uuid: item.uuid,
        path: propertyPath,
        amount: 1,
        original: getProperty(item.data, propertyPath) ?? 0,
        applied: false
      });
    }

    for (const consumeResource of itemCardData.consumeResources) {
      if (consumeResource.autoconsumeAfter == null) {
        if (itemCardData.attack) {
          consumeResource.autoconsumeAfter = 'attack';
        } else if (itemCardData.damages?.length) {
          consumeResource.autoconsumeAfter = 'damage';
        } else if (itemCardData.targetDefinition?.hasAoe) {
          consumeResource.autoconsumeAfter = 'template-placed';
        } else if (itemCardData.check) {
          consumeResource.autoconsumeAfter = 'check';
        } else {
          consumeResource.autoconsumeAfter = 'init';
        }
      }
    }

    return itemCardData;
  }

  public static async setTargets(itemCardItemData: ItemCardItemData, targetUuids: string[]): Promise<ItemCardItemData> {
    const tokenMap = new Map<string, TokenDocument>();
    for (const token of UtilsDocument.tokenFromUuid(targetUuids, {sync: true, deduplciate: true})) {
      tokenMap.set(token.uuid, token);
    }
    
    itemCardItemData.targets = [];
    for (const targetUuid of targetUuids) {
      const token = tokenMap.get(targetUuid);
      const actor = (token.data.actorId ? game.actors.get(token.data.actorId) : token.getActor()) as MyActor;
      const target: ItemCardItemData['targets'][0] = {
        uuid: targetUuid,
        actorUuid: actor.uuid,
        ac: actor.data.data.attributes.ac.value,
        img: token.data.img,
        name: token.data.name,
        immunities: [...actor.data.data.traits.di.value, ...(actor.data.data.traits.di.custom === '' ? [] : actor.data.data.traits.di.custom.split(';'))],
        resistances: [...actor.data.data.traits.dr.value, ...(actor.data.data.traits.dr.custom === '' ? [] : actor.data.data.traits.dr.custom.split(';'))],
        vulnerabilities: [...actor.data.data.traits.dv.value, ...(actor.data.data.traits.dv.custom === '' ? [] : actor.data.data.traits.dv.custom.split(';'))],
        hpSnapshot: {
          maxHp: actor.data.data.attributes.hp.max,
          hp: actor.data.data.attributes.hp.value,
          temp: actor.data.data.attributes.hp.temp
        },
        result: {
          appliedActiveEffects: false
        }
      };
      if (itemCardItemData.check) {
        // Don't prefil the roll, generate that at the moment the roll is made
        target.check = {
          mode: 'normal',
          phase: 'mode-select',
          userBonus: "",
        };
      }
      itemCardItemData.targets.push(target);
    }
    itemCardItemData.targets = itemCardItemData.targets.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    return itemCardItemData;
  }
  //#endregion

  //#region routing
  private static async onClick(event: MouseEvent): Promise<void> {
    if (event.target instanceof HTMLInputElement) {
      // do not register clicks on inputs, except checkboxes
      const input = event.target as HTMLInputElement;
      if (input.type !== 'checkbox') {
        return;
      }
    }
    if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLOptionElement) {
      return;
    }
    if (event.target instanceof Node) {
      UtilsChatMessage.onInteraction({
        clickEvent: event,
        element: event.target as Node
      });
    }
  }

  private static async onBlur(event: FocusEvent): Promise<void> {
    if (event.target instanceof HTMLInputElement) {
      // blur does not work very well with checkboxes => listen to click event
      const input = event.target as HTMLInputElement;
      if (input.type === 'checkbox') {
        return;
      }
      if (event.target instanceof Node) {
        UtilsChatMessage.onInteraction({
          element: event.target as Node
        });
      }
    }
  }

  private static async onKeyDown(event: KeyboardEvent): Promise<void> {
    if (event.target instanceof HTMLInputElement && ['Enter', 'Escape'].includes(event.key)) {
      UtilsChatMessage.onInteraction({
        element: event.target as Node,
        keyEvent: {
          key: event.key as KeyEvent['key']
        },
      });
    }
  }

  private static async onChange(event: Event): Promise<void> {
    if (event.target instanceof Node) {
      UtilsChatMessage.onInteraction({
        element: event.target as Node
      });
    }
  }

  private static async onInteraction({clickEvent, element, keyEvent}: {element: Node, clickEvent?: ClickEvent, keyEvent?: KeyEvent}): Promise<void> {
    clickEvent = {
      altKey: clickEvent?.altKey === true,
      ctrlKey: clickEvent?.ctrlKey === true,
      metaKey: clickEvent?.metaKey === true,
      shiftKey: clickEvent?.shiftKey === true,
    }
    keyEvent = !keyEvent ? null : {
      key: keyEvent.key
    };

    let messageId: string;
    let action: string;
    let currentElement = element;
    let inputValue: boolean | number | string;
    while (currentElement != null) {
      if (currentElement instanceof HTMLElement) {
        if (currentElement.dataset.messageId != null) {
          messageId = currentElement.dataset.messageId;
        }
        if (currentElement.hasAttribute(`data-${staticValues.moduleName}-action`)) {
          action = currentElement.getAttribute(`data-${staticValues.moduleName}-action`);
          
          if (currentElement instanceof HTMLInputElement) {
            if (['radio', 'checkbox'].includes(currentElement.type)) {
              inputValue = currentElement.checked;
            } else if (['number'].includes(currentElement.type)) {
              inputValue = Number(currentElement.value);
            } else {
              inputValue = currentElement.value;
            }
          } else if (currentElement instanceof HTMLSelectElement) {
            inputValue = currentElement.value;
          }
        }
      }

      currentElement = currentElement.parentNode;
    }

    if (!action) {
      return;
    }
    if (messageId == null) {
      console.warn(`pressed a ${staticValues.moduleName} action button but no message was found`);
      return;
    }
    
    const message = game.messages.get(messageId);
    const messageData = InternalFunctions.getItemCardData(message);
    if (messageData == null) {
      console.warn(`pressed a ${staticValues.moduleName} action button for message ${messageId} but no data was found`);
      return;
    }

    const actions = await UtilsChatMessage.getActions(action, clickEvent, keyEvent, game.userId, messageId, messageData);
    if (actions.missingPermissions) {
      console.warn(`pressed a ${staticValues.moduleName} action button for message ${messageId} with action ${action} for current user but permissions are missing`)
      return;
    }
    if (actions.actionsToExecute.length === 0) {
      console.debug('no actions found')
      return;
    }

    const request: Parameters<typeof UtilsChatMessage['onInteractionProcessor']>[0] = {
      clickEvent: clickEvent,
      keyEvent: keyEvent,
      userId: game.userId,
      messageId: messageId,
      action: action,
      inputValue: inputValue,
    }

    let response: InteractionResponse;
    
    if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) {
      element.disabled = true;
    }
    try {
      if (actions.onlyRunLocal || message.canUserModify(game.user, 'update')) {
        // User has all required permissions, run locally
        response = await UtilsChatMessage.onInteractionProcessor(request);
      } else {
        response = await provider.getSocket().then(socket => socket.executeAsGM('onInteraction', request));
      }
    } finally {
      if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) {
        element.disabled = false;
      }
    }

    if (response.success === false) {
      if (response.errorType === 'warn') {
        console.warn(response.errorMessage);
        ui.notifications.warn(response.errorMessage);
      }
      if (response.errorType === 'error') {
        console.error(response.errorMessage);
        ui.notifications.error(response.errorMessage);
      }
    }
  }

  private static async onInteractionProcessor({clickEvent, keyEvent, userId, messageId, action, inputValue}: {
    clickEvent: ClickEvent,
    keyEvent: KeyEvent,
    userId: string,
    messageId: string,
    action: string,
    inputValue?: ActionParam['inputValue'];
  }): Promise<InteractionResponse> {
    const message = game.messages.get(messageId);
    const messageData = InternalFunctions.getItemCardData(message);
    if (messageData == null) {
      return {
        success: false,
        errorType: 'warn',
        errorMessage: `pressed a ${staticValues.moduleName} action button for message ${messageId} but no data was found`,
      };
    }

    const actions = await UtilsChatMessage.getActions(action, clickEvent, keyEvent, userId, messageId, messageData);
    if (action && actions.actionsToExecute.length === 0) {
      return {
        success: false,
        errorType: 'error',
        errorMessage: `pressed a ${staticValues.moduleName} action button for message ${messageId} with action ${action} for user ${userId} but permissions are missing`,
      };
    }
    
    let latestMessageData = deepClone(messageData);
    let doUpdate = false;
    
    for (const action of actions.actionsToExecute) {
      const param: ActionParam = {clickEvent: clickEvent, userId: userId, keyEvent: keyEvent, regexResult: action.regex, messageId: messageId, messageData: latestMessageData, inputValue: inputValue};
      try {
        let response = await action.action.execute(param);
        if (response) {
          doUpdate = true;
          latestMessageData = response;
        }
      } catch (err) {
        return {
          success: false,
          errorMessage: err instanceof Error ? err.message : String(err),
          errorType: 'error'
        }
      }
    }

    if (doUpdate) {
      // Don't use await so you can return a response faster to the client
      InternalFunctions.saveItemCardData(messageId, latestMessageData);
    }

    return {
      success: true,
    }
  }

  private static async getActions(action: string, clickEvent: ClickEvent, keyEvent: KeyEvent, userId: string, messageId: string, messageData: ItemCardData): Promise<{missingPermissions: boolean, onlyRunLocal: boolean, actionsToExecute: Array<{action: typeof UtilsChatMessage.actionMatches[0], regex: RegExpExecArray}>}> {
    if (!action) {
      return {
        missingPermissions: false,
        onlyRunLocal: true,
        actionsToExecute: []
      };
    }
    const response = {
      missingPermissions: false, 
      onlyRunLocal: false,
      actionsToExecute: [] as Array<{
        action: typeof UtilsChatMessage.actionMatches[0],
        regex: RegExpExecArray
      }>
    };

    const user = game.users.get(userId);
    for (const actionMatch of UtilsChatMessage.actionMatches) {
      const result = actionMatch.regex.exec(action);
      if (result) {
        const permissionCheck = actionMatch.permissionCheck({clickEvent: clickEvent, userId: userId, keyEvent: keyEvent, regexResult: result, messageId: messageId, messageData: messageData});
        if (permissionCheck.onlyRunLocal === true) {
          response.onlyRunLocal = true;
        }
        if (permissionCheck.message) {
          // Is not author and is no gm
          if (game.messages.get(messageId).data.user !== userId && !user.isGM) {
            response.missingPermissions = true;
            continue;
          }
        }
        if (permissionCheck.actorUuid) {
          const actor = await UtilsDocument.actorFromUuid(permissionCheck.actorUuid);
          if (actor && !actor.testUserPermission(user, 'OWNER')) {
            response.missingPermissions = true;
            continue;
          }
        }
        if (permissionCheck.gm) {
          if (!user.isGM) {
            response.missingPermissions = true;
            continue;
          }
        }

        response.actionsToExecute.push({
          action: actionMatch,
          regex: result
        });
      }
    }


    return response;
  }
  //#endregion

  //#region attack
  private static async processItemAttack(event: ClickEvent, itemIndex: number, messageData: ItemCardData): Promise<void | ItemCardData> {
    const attack = messageData.items?.[itemIndex]?.attack;
    if (!attack || attack.phase === 'result') {
      return;
    }

    const orderedPhases: RollPhase[] = ['mode-select', 'bonus-input', 'result'];
    if (event.shiftKey) {
      attack.phase = orderedPhases[orderedPhases.length - 1];
    } else {
      attack.phase = orderedPhases[orderedPhases.indexOf(attack.phase) + 1];
    }

    if (orderedPhases.indexOf(attack.phase) === orderedPhases.length - 1) {
      const response = await UtilsChatMessage.processItemAttackRoll(itemIndex, messageData);
      if (response) {
        return response;
      }
    }

    return messageData;
  }
  
  private static async processItemAttackBonus(keyEvent: KeyEvent | null, itemIndex: number, attackBonus: string, messageData: ItemCardData): Promise<void | ItemCardData> {
    const attack = messageData.items?.[itemIndex]?.attack;
    if (!attack || attack.evaluatedRoll?.evaluated || attack.phase === 'result') {
      return;
    }

    const oldPhase = attack.phase;
    const oldBonus = attack.userBonus;
    if (attackBonus) {
      attack.userBonus = attackBonus;
    } else {
      attack.userBonus = "";
    }

    if (attack.userBonus && !Roll.validate(attack.userBonus) && keyEvent) {
      // Only show error on key press
      throw new Error(game.i18n.localize('Error') + ': ' + game.i18n.localize('Roll Formula'));
    }

    if (keyEvent?.key === 'Enter') {
      const response = await UtilsChatMessage.processItemAttackRoll(itemIndex, messageData);
      if (response) {
        return response;
      }
    } else if (keyEvent?.key === 'Escape') {
      attack.phase = 'mode-select';
    }

    if (attack.userBonus !== oldBonus || attack.phase !== oldPhase) {
      return messageData;
    }
  }

  private static async processItemAttackRoll(itemIndex: number, messageData: ItemCardData): Promise<void | ItemCardData> {
    const attack = messageData.items?.[itemIndex]?.attack;
    if (!attack || attack.evaluatedRoll) {
      return;
    }
    
    const actor: MyActor = messageData.token?.uuid == null ? null : (await UtilsDocument.tokenFromUuid(messageData.token?.uuid)).getActor();
    let baseRoll = new Die();
    baseRoll.faces = 20;
    baseRoll.number = 1;
    switch (attack.mode) {
      case 'advantage': {
        baseRoll.number = 2;
        baseRoll.modifiers.push('kh');
        break;
      }
      case 'disadvantage': {
        baseRoll.number = 2;
        baseRoll.modifiers.push('kl');
        break;
      }
    }
    if (actor && actor.getFlag("dnd5e", "halflingLucky")) {
      // reroll a base roll 1 once
      // first 1 = maximum reroll 1 die not both at (dis)advantage (see PHB p173)
      // second 2 = reroll when the roll result is equal to 1 (=1)
      baseRoll.modifiers.push('r1=1');
    }
    const parts: string[] = [baseRoll.formula];
    if (attack.rollBonus) {
      parts.push(attack.rollBonus);
    }
    
    if (attack.userBonus && Roll.validate(attack.userBonus)) {
      parts.push(attack.userBonus);
    }

    const roll = await UtilsRoll.simplifyRoll(new Roll(parts.join(' + '))).roll({async: true});
    UtilsDiceSoNice.showRoll({roll: roll});
    attack.evaluatedRoll = roll.toJSON();
    attack.phase = 'result';

    return messageData;
  }

  private static async processItemAttackMode(event: ClickEvent, itemIndex: number, modName: 'plus' | 'minus', messageData: ItemCardData): Promise<void | ItemCardData> {
    const attack = messageData.items[itemIndex].attack;
    let modifier = modName === 'plus' ? 1 : -1;
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

    if (event.shiftKey) {
      const response = await UtilsChatMessage.processItemAttackRoll(itemIndex, messageData);
      if (response) {
        messageData = response;
      }
    }
    
    if (!attack.evaluatedRoll) {
      return messageData;
    }

    const originalRoll = Roll.fromJSON(JSON.stringify(attack.evaluatedRoll));
    attack.evaluatedRoll = (await UtilsRoll.setRollMode(originalRoll, attack.mode)).toJSON();

    return messageData;
  }
  //#endregion

  //#region check
  private static async processItemCheck(event: ClickEvent, itemIndex: number, targetUuid: string, messageData: ItemCardData): Promise<void | ItemCardData> {
    const itemCheck = messageData.items?.[itemIndex]?.check;
    if (!itemCheck) {
      console.warn('No check found')
      return;
    }
    
    let target: ItemCardItemData['targets'][0];
    if (messageData.items[itemIndex].targets) {
      for (const t of messageData.items[itemIndex].targets) {
        if (t.uuid === targetUuid) {
          target = t;
          break;
        }
      }
    }

    if (!target || target.check.phase === 'result') {
      return;
    }

    const orderedPhases: RollPhase[] = ['mode-select', 'bonus-input', 'result'];
    if (event.shiftKey) {
      target.check.phase = orderedPhases[orderedPhases.length - 1];
    } else {
      target.check.phase = orderedPhases[orderedPhases.indexOf(target.check.phase) + 1];
    }

    if (orderedPhases.indexOf(target.check.phase) === orderedPhases.length - 1) {
      const response = await UtilsChatMessage.processItemCheckRoll(itemIndex, targetUuid, messageData);
      if (response) {
        messageData = response;
      }
    }

    return messageData;
  }
  
  private static async processItemCheckBonus(keyEvent: KeyEvent | null, itemIndex: number, targetUuid: string, attackBonus: string, messageData: ItemCardData): Promise<void | ItemCardData> {
    const itemCheck = messageData.items?.[itemIndex]?.check;
    if (!itemCheck) {
      console.warn('No check found')
      return;
    }
    
    let target: ItemCardItemData['targets'][0];
    if (messageData.items[itemIndex].targets) {
      for (const t of messageData.items[itemIndex].targets) {
        if (t.uuid === targetUuid) {
          target = t;
          break;
        }
      }
    }

    if (!target || target.check.phase === 'result') {
      return;
    }

    const oldPhase = target.check.phase;
    const oldBonus = target.check.userBonus;
    if (attackBonus) {
      target.check.userBonus = attackBonus;
    } else {
      target.check.userBonus = "";
    }

    if (target.check.userBonus && !Roll.validate(target.check.userBonus) && keyEvent) {
      // Only show error on key press
      throw new Error(game.i18n.localize('Error') + ': ' + game.i18n.localize('Roll Formula'));
    }

    if (keyEvent?.key === 'Enter') {
      const response = await UtilsChatMessage.processItemCheckRoll(itemIndex, targetUuid, messageData);
      if (response) {
        return response;
      }
    } else if (keyEvent?.key === 'Escape') {
      target.check.phase = 'mode-select';
    }

    if (target.check.userBonus !== oldBonus || target.check.phase !== oldPhase) {
      return messageData;
    }
  }

  private static async processItemCheckMode(event: ClickEvent, itemIndex: number, targetUuid: string, modName: 'plus' | 'minus', messageData: ItemCardData): Promise<void | ItemCardData> {
    if (!messageData.items?.[itemIndex]?.check) {
      console.warn('No check found')
      return;
    }

    let target: ItemCardItemData['targets'][0];
    if (messageData.items[itemIndex].targets) {
      for (const t of messageData.items[itemIndex].targets) {
        if (t.uuid === targetUuid) {
          target = t;
          break;
        }
      }
    }
  
    let modifier = modName === 'plus' ? 1 : -1;
    if (event.shiftKey && modifier > 0) {
      modifier++;
    } else if (event.shiftKey && modifier < 0) {
      modifier--;
    }
    
    const order: Array<typeof target.check.mode> = ['disadvantage', 'normal', 'advantage'];
    const newIndex = Math.max(0, Math.min(order.length-1, order.indexOf(target.check.mode) + modifier));
    if (target.check.mode === order[newIndex]) {
      return;
    }
    target.check.mode = order[newIndex];
    if (!target.check.evaluatedRoll) {
      return messageData;
    }

    const originalRoll = Roll.fromJSON(JSON.stringify(target.check.evaluatedRoll));
    target.check.evaluatedRoll = (await UtilsRoll.setRollMode(originalRoll, target.check.mode)).toJSON();

    return messageData;
  }

  private static async processItemCheckRoll(itemIndex: number, targetUuid: string, messageData: ItemCardData): Promise<void | ItemCardData> {
    if (!messageData.items?.[itemIndex]?.check) {
      console.warn('No check found')
      return;
    }
    const targetActor = (await UtilsDocument.tokenFromUuid(targetUuid)).getActor() as MyActor;

    let target: ItemCardItemData['targets'][0];
    if (messageData.items[itemIndex].targets) {
      for (const t of messageData.items[itemIndex].targets) {
        if (t.uuid === targetUuid) {
          target = t;
          break;
        }
      }
    }
    if (!target || target.check?.evaluatedRoll?.evaluated) {
      return;
    }
    
    const check = messageData.items[itemIndex].check;

    let roll = UtilsRoll.getAbilityRoll(targetActor, {ability: check.ability, skill: check.skill, addSaveBonus: check.addSaveBonus});
    if (target.check.userBonus) {
      roll = new Roll(roll.formula + ' + ' + target.check.userBonus);
    }
    roll = await UtilsRoll.setRollMode(roll, target.check.mode);
    roll = await UtilsRoll.simplifyRoll(roll).roll({async: true});
    UtilsDiceSoNice.showRoll({roll: roll});

    target.check.evaluatedRoll = roll.toJSON();
    target.check.phase = 'result';

    return messageData;
  }
  //#endregion

  //#region damage
  private static async processItemDamage(event: ClickEvent, itemIndex: number, damageIndex: number, messageData: ItemCardData, messageId: string): Promise<void | ItemCardData> {
    const dmg = messageData.items?.[itemIndex]?.damages?.[damageIndex];
    if (!dmg || dmg.phase === 'result') {
      return;
    }

    const orderedPhases: RollPhase[] = ['mode-select', 'bonus-input', 'result'];
    if (event.shiftKey) {
      dmg.phase = orderedPhases[orderedPhases.length - 1];
    } else {
      dmg.phase = orderedPhases[orderedPhases.indexOf(dmg.phase) + 1];
    }

    if (orderedPhases.indexOf(dmg.phase) === orderedPhases.length - 1) {
      const response = await UtilsChatMessage.processItemDamageRoll(itemIndex, damageIndex, messageData, messageId);
      if (response) {
        return response;
      }
    }

    return messageData;
  }

  private static async processItemDamageMode(event: ClickEvent, itemIndex: number, damageIndex: number, modName: 'plus' | 'minus', messageData: ItemCardData, messageId: string): Promise<void | ItemCardData> {
    const dmg = messageData.items?.[itemIndex]?.damages?.[damageIndex];
    let modifier = modName === 'plus' ? 1 : -1;
    
    const order: Array<ItemCardItemData['damages'][0]['mode']> = ['normal', 'critical'];
    const newIndex = Math.max(0, Math.min(order.length-1, order.indexOf(dmg.mode) + modifier));
    if (dmg.mode === order[newIndex]) {
      return;
    }
    dmg.mode = order[newIndex];

    if (event.shiftKey || (dmg.normalRoll?.evaluated && (dmg.mode === 'critical' && !dmg.criticalRoll?.evaluated))) {
      const response = await UtilsChatMessage.processItemDamageRoll(itemIndex, damageIndex, messageData, messageId);
      if (response) {
        return response;
      }
    }
    return messageData;
  }
  
  private static async processItemDamageBonus(keyEvent: KeyEvent | null, itemIndex: number, damageIndex: number, damageBonus: string, messageData: ItemCardData, messageId: string): Promise<void | ItemCardData> {
    const dmg = messageData.items?.[itemIndex]?.damages?.[damageIndex];
    if (!dmg || dmg.normalRoll?.evaluated || dmg.phase === 'result') {
      return;
    }

    const oldPhase = dmg.phase;
    const oldBonus = dmg.userBonus;
    if (damageBonus) {
      dmg.userBonus = damageBonus;
    } else {
      dmg.userBonus = "";
    }

    if (dmg.userBonus && !Roll.validate(dmg.userBonus) && keyEvent) {
      // Only show error on key press
      throw new Error(game.i18n.localize('Error') + ': ' + game.i18n.localize('Roll Formula'));
    }

    if (keyEvent?.key === 'Enter') {
      const response = await UtilsChatMessage.processItemDamageRoll(itemIndex, damageIndex, messageData, messageId);
      if (response) {
        return response;
      }
    } else if (keyEvent?.key === 'Escape') {
      dmg.phase = 'mode-select';
    }

    if (dmg.userBonus !== oldBonus || dmg.phase !== oldPhase) {
      return messageData;
    }
  }

  private static async processItemDamageRoll(itemIndex: number, damageIndex: number, messageData: ItemCardData, messageId: string): Promise<void | ItemCardData> {
    const item = messageData.items?.[itemIndex];
    if (!item) {
      return;
    }
    const dmg = item.damages?.[damageIndex];
    if (!dmg) {
      return;
    }
    dmg.phase = 'result';
    
    const normalRollEvaluated = !!dmg.normalRoll?.evaluated;
    const criticalRollEvaluated = !!dmg.criticalRoll?.evaluated;
    let normalRollFormula: string;
    let normalRollPromise: Promise<Roll>;
    if (normalRollEvaluated) {
      normalRollFormula = dmg.normalRoll.formula;
      normalRollPromise = Promise.resolve(Roll.fromJSON(JSON.stringify(dmg.normalRoll)));
    } else {
      const dmgParts: MyItemData['data']['damage']['parts'] = UtilsRoll.rollToDamageParts(Roll.fromJSON(JSON.stringify(dmg.baseRoll)));
      const upcastLevel = Math.max(item.level, item.selectedlevel === 'pact' ? (messageData.actor?.pactLevel ?? 0) : item.selectedlevel);
      if (upcastLevel > item.level) {
        if (dmg.upcastRoll) {
          const upcastRoll = Roll.fromJSON(JSON.stringify(dmg.upcastRoll)).alter(upcastLevel - item.level, 0, {multiplyNumeric: true})
          dmgParts.push(...UtilsRoll.rollToDamageParts(upcastRoll));
        }
      }
      if (dmg.actorBonusRoll) {
        dmgParts.push(...UtilsRoll.rollToDamageParts(Roll.fromJSON(JSON.stringify(dmg.actorBonusRoll))))
      }
      if (dmg.userBonus) {
        dmgParts.push(...UtilsRoll.rollToDamageParts(Roll.fromJSON(JSON.stringify(dmg.userBonus))))
      }
      
      const normalRoll = UtilsRoll.simplifyRoll(UtilsRoll.damagePartsToRoll(dmgParts));
      normalRollFormula = normalRoll.formula;
      normalRollPromise = normalRoll.roll({async: true});
    }

    let criticalRollPromise: Promise<Roll | false>;
    if (criticalRollEvaluated) {
      criticalRollPromise = Promise.resolve(Roll.fromJSON(JSON.stringify(dmg.criticalRoll)));
    } else if (dmg.mode === 'critical') {
      criticalRollPromise = UtilsRoll.getCriticalBonusRoll(new Roll(normalRollFormula)).roll({async: true});
    } else {
      criticalRollPromise = Promise.resolve(false);
    }

    const [normalResolved, critBonusResolved] = await Promise.all([normalRollPromise, criticalRollPromise]);
    const newRolls: Roll[] = [];
    if (!normalRollEvaluated) {
      newRolls.push(normalResolved);
      dmg.normalRoll = normalResolved.toJSON();
    }
    if (!criticalRollEvaluated && critBonusResolved) {
      newRolls.push(critBonusResolved);
      dmg.criticalRoll = UtilsRoll.mergeRolls(normalResolved, critBonusResolved).toJSON();
    }

    if (newRolls.length > 0) {
      // Don't wait for the roll animation to finish
      UtilsDiceSoNice.showRoll({roll: UtilsRoll.mergeRolls(...newRolls)});
    }
    
    // Auto apply healing since it very rarely gets modified
    const damageTypes = UtilsRoll.rollToDamageResults(Roll.fromJSON(JSON.stringify(dmg.criticalRoll?.evaluated ? dmg.criticalRoll : dmg.normalRoll)));
    let isHealing = true;
    for (const type of damageTypes.keys()) {
      if (!InternalFunctions.healingDamageTypes.includes(type)) {
        isHealing = false;
        break;
      }
    }

    if (isHealing && item.targets) {
      messageData = await InternalFunctions.calculateTargetResult(messageData);
      const response = await UtilsChatMessage.applyDamage(item.targets.map(t => t.uuid), messageData, messageId);
      if (response) {
        messageData = response;
      }
    }

    return messageData;
  }
  
  private static async applyDamage(tokenUuid: (string | '*')[], messageData: ItemCardData, messageId: string): Promise<void | ItemCardData> {
    if (!messageData.targetAggregate) {
      return;
    }
    let targetAggregates: ItemCardData['targetAggregate'];
    if (tokenUuid.includes('*')) {
      targetAggregates = messageData.targetAggregate;
    } else {
      targetAggregates = messageData.targetAggregate.filter(aggr => tokenUuid.includes(aggr.uuid));
    }
    if (!targetAggregates.length) {
      console.warn(`Could not find an aggregate for token "${tokenUuid}" with messageId "${messageId}"`);
      return;
    }

    // TODO idea: popup to prompt a custom apply amount when applying to 1 token
    // TODO idea: apply all does not apply to tokens which have already received damage

    const tokenActorUpdates = new Map<string, DeepPartial<MyActorData>>();
    let appliedToTokenUuids: string[] = [];
    for (const aggregate of targetAggregates) {
      appliedToTokenUuids.push(aggregate.uuid);
      const token = await UtilsDocument.tokenFromUuid(aggregate.uuid);
      const actor = token.getActor() as MyActor;
      aggregate.dmg.appliedDmg = aggregate.dmg.calcDmg;
      
      tokenActorUpdates.set(token.uuid, {
        _id: actor.id,
        data: {
          attributes: {
            hp: {
              value: aggregate.dmg.calcHp,
              temp: aggregate.dmg.calcTemp,
            }
          }
        }
      });
    }
    for (const item of messageData.items) {
      for (const target of item.targets ?? []) {
        if (appliedToTokenUuids.includes(target.uuid)) {
          target.result.applyDmg = true;
        }
      }
    }
    await UtilsDocument.updateTokenActors(tokenActorUpdates);
    return messageData;
  }
  
  private static async undoDamage(tokenUuid: string, messageData: ItemCardData, messageId: string): Promise<void | ItemCardData> {
    if (!messageData.targetAggregate) {
      return;
    }
    let targetAggregates: ItemCardData['targetAggregate'];
    if (tokenUuid === '*') {
      targetAggregates = messageData.targetAggregate;
    } else {
      targetAggregates = messageData.targetAggregate.filter(aggr => aggr.uuid === tokenUuid);
    }
    if (!targetAggregates.length) {
      console.warn(`Could not find an aggregate for token "${tokenUuid}" with messageId "${messageId}"`);
      return;
    }

    
    const tokenActorUpdates = new Map<string, DeepPartial<MyActorData>>();
    let appliedToTokenUuids: string[] = [];
    for (const aggregate of targetAggregates) {
      appliedToTokenUuids.push(aggregate.uuid);
      const token = await UtilsDocument.tokenFromUuid(aggregate.uuid);
      const actor = token.getActor() as MyActor;
      aggregate.dmg.appliedDmg = 0;
      
      tokenActorUpdates.set(token.uuid, {
        _id: actor.id,
        data: {
          attributes: {
            hp: {
              value: aggregate.hpSnapshot.hp,
              temp: aggregate.hpSnapshot.temp,
            }
          }
        }
      });
    }
    for (const item of messageData.items) {
      for (const target of item.targets ?? []) {
        if (appliedToTokenUuids.includes(target.uuid)) {
          target.result.applyDmg = false;
        }
      }
    }
    await UtilsDocument.updateTokenActors(tokenActorUpdates);
    return messageData;
  }
  
  private static async upcastlevelChange(itemIndex: number, level: string, messageData: ItemCardData): Promise<void | ItemCardData> {
    const item = messageData.items?.[itemIndex];
    if (!item || !item.canChangeLevel) {
      return;
    }

    const oldLevel = item.selectedlevel;
    item.selectedlevel = level === 'pact' ? level : Number.parseInt(level);
    if (Number.isNaN(item.selectedlevel)) {
      item.selectedlevel = oldLevel;
    }

    if (item.selectedlevel !== oldLevel) {
      return messageData;
    }
  }
  //#endregion

  //#region targeting
  private static async processItemTemplate(itemIndex: number, messageData: ItemCardData, messageId: string): Promise<void> {
    const targetDefinition = messageData.items?.[itemIndex]?.targetDefinition;
    if (!targetDefinition || !targetDefinition.hasAoe) {
      return;
    }
    if (!InternalFunctions.canChangeTargets(messageData.items[itemIndex])) {
      return;
    }

    const template = MyAbilityTemplate.fromItem({
      target: targetDefinition,
      flags: {
        [staticValues.moduleName]: {
          dmlCallbackMessageId: messageId,
          dmlCallbackItemIndex: itemIndex,
        }
      }
    });
    template.drawPreview();
  }
  //#endregion

  //#region consume resources
  private static async manualApplyConsumeResource(messageData: ItemCardData, itemIndex: number | '*', resourceIndex: number | '*'): Promise<ItemCardData | void> {
    const consumeResources: ItemCardItemData['consumeResources'] = [];
    {
      const items = itemIndex === '*' ? messageData.items : [messageData.items[itemIndex]];
      for (const item of items) {
        if (resourceIndex === '*') {
          for (const consumeResource of item.consumeResources) {
            consumeResources.push(consumeResource)
          }
        } else if (item.consumeResources.length >= resourceIndex-1) {
          consumeResources.push(item.consumeResources[resourceIndex]);
        }
      }
    }

    let changed = false;
    for (const consumeResource of consumeResources) {
      if (consumeResource.consumeResourcesAction !== 'manual-apply') {
        consumeResource.consumeResourcesAction = 'manual-apply';
        changed = true;
      }
    }

    if (changed) {
      return messageData;
    }
  }

  private static async manualUndoConsumeResource(messageData: ItemCardData, itemIndex: number | '*', resourceIndex: number | '*'): Promise<ItemCardData | void> {
    const consumeResources: ItemCardItemData['consumeResources'] = [];
    {
      const items = itemIndex === '*' ? messageData.items : [messageData.items[itemIndex]];
      for (const item of items) {
        if (resourceIndex === '*') {
          for (const consumeResource of item.consumeResources) {
            consumeResources.push(consumeResource)
          }
        } else if (item.consumeResources.length >= resourceIndex-1) {
          consumeResources.push(item.consumeResources[resourceIndex]);
        }
      }
    }

    let changed = false;
    for (const consumeResource of consumeResources) {
      if (consumeResource.consumeResourcesAction !== 'undo') {
        consumeResource.consumeResourcesAction = 'undo';
        changed = true;
      }
    }

    if (changed) {
      return messageData;
    }
  }
  //#endregion

  //#region misc
  private static async toggleCollapse(messageId: string): Promise<ItemCardData | void> {
    MemoryStorageService.setCardCollapse(messageId, !MemoryStorageService.isCardCollapsed(messageId));
    ui.chat.updateMessage(game.messages.get(messageId));
  }
  //#endregion

}

class DmlTriggerUser implements IDmlTrigger<User> {

  get type(): typeof User {
    return User;
  }

  public async afterUpdate(context: IDmlContext<User>): Promise<void> {
    await this.recalcTargets(context);
  }

  private async recalcTargets(context: IDmlContext<User>): Promise<void> {
    let thisUserChanged = false;
    for (const user of context.rows) {
      if (user.id === game.userId) {
        thisUserChanged = true;
        break;
      }
    }
    if (!thisUserChanged) {
      return;
    }

    // Specifically the last general message, not of the user.
    // There needs to be some way of cutting off the ability to retarget when they are not relevant anymore
    // TODO this should probably be improved
    const chatMessage = InternalFunctions.getLatestMessage();
    if (!chatMessage && chatMessage.data.user === context.userId) {
      return;
    }

    let messageData = InternalFunctions.getItemCardData(chatMessage);
    for (let itemIndex = messageData.items.length - 1; itemIndex >= 0; itemIndex--) {
      const item = messageData.items[itemIndex];
      if (item.canChangeTargets) {
        // Re-evaluate the targets, the user may have changed targets
        const currentTargetUuids = new Set<string>(Array.from(game.user.targets).map(token => token.document.uuid));

        // Assume targets did not changes when non are selected at this time
        if (currentTargetUuids.size !== 0) {
          const itemTargetUuids = new Set<string>();
          if (messageData.items[itemIndex].targets) {
            for (const target of messageData.items[itemIndex].targets) {
              itemTargetUuids.add(target.uuid);
            }
          }

          let targetsChanged = itemTargetUuids.size !== currentTargetUuids.size;
          
          if (!targetsChanged) {
            for (const uuid of itemTargetUuids.values()) {
              if (!currentTargetUuids.has(uuid)) {
                targetsChanged = true;
                break;
              }
            }
          }

          if (targetsChanged) {
            const targetsUuids: string[] = [];
            if (messageData.items[itemIndex].targets) {
              for (const target of messageData.items[itemIndex].targets) {
                // The same target could have been originally targeted twice, keep that amount
                if (currentTargetUuids.has(target.uuid)) {
                  targetsUuids.push(target.uuid);
                }
              }
            }
            for (const currentTargetUuid of currentTargetUuids) {
              if (!targetsUuids.includes(currentTargetUuid)) {
                targetsUuids.push(currentTargetUuid);
              }
            }
            
            messageData.items[itemIndex] = await UtilsChatMessage.setTargets(messageData.items[itemIndex], targetsUuids)
            await InternalFunctions.saveItemCardData(chatMessage.id, messageData);
            // Only retarget 1 item
            return;
          }
        }
      }
    }
  }
}

class DmlTriggerChatMessage implements IDmlTrigger<ChatMessage> {

  get type(): typeof ChatMessage {
    return ChatMessage;
  }

  public async afterUpsert(context: IDmlContext<ChatMessage>): Promise<void> {
    if (context.userId !== game.userId) {
      // Only one user needs to do this operation
      // TODO should happen before when async is possible
      return;
    }
    const chatMessages = this.filterItemCardsOnly(context);
    if (chatMessages.length > 0) {
      this.applyActiveEffects(chatMessages);
    }
    for (const chatMessage of chatMessages) {
      let clonedMessageData = deepClone(InternalFunctions.getItemCardData(chatMessage));
      let changed = false;
      {
        const response = await this.applyConsumeResources(clonedMessageData);
        if (response) {
          clonedMessageData = response;
          changed = true;
        }
      }

      if (changed) {
        await InternalFunctions.saveItemCardData(chatMessage.id, clonedMessageData);
      }
    }
  }

  public afterUpdate(context: IDmlContext<ChatMessage>): void {
    const log = document.querySelector("#chat-log");
    const isAtBottom = Math.abs(log.scrollHeight - (log.scrollTop + log.getBoundingClientRect().height)) < 2;
    if (isAtBottom) {
      setTimeout(() => {
        (ui.chat as any).scrollBottom();
      }, 0);
    }
  }

  public beforeUpdate(context: IDmlContext<ChatMessage>): void {
    this.onBonusChange(context);
    // TODO recalc whole item on level change to support custom scaling level scaling formulas
  }

  public beforeUpsert(context: IDmlContext<ChatMessage>): boolean | void {
    const itemCards = this.filterItemCardsOnly(context);
    if (itemCards.length > 0) {
      for (const itemCard of itemCards) {
        itemCard.data.content = `The ${staticValues.moduleName} module is required to render this message.`;
      }
      this.calcItemCardDamageFormulas(itemCards);
      this.calcItemCardCanChangeTargets(itemCards);
      this.calcCanChangeSpellLevel(itemCards);
      this.calcConsumeResources(context);
      this.calculateTargetResult(itemCards)
    }
  }

  public async afterDelete(context: IDmlContext<ChatMessage>): Promise<void> {
    const chatMessages = this.filterItemCardsOnly(context);
    if (context.userId === game.userId) {
      const deleteTemplateUuids = new Set<string>();
      for (const chatMessage of chatMessages) {
        const data: ItemCardData = InternalFunctions.getItemCardData(chatMessage);
        for (const item of data.items) {
          deleteTemplateUuids.add(item.targetDefinition?.createdTemplateUuid);
        }
      }
      deleteTemplateUuids.delete(null);
      deleteTemplateUuids.delete(undefined);
  
      if (deleteTemplateUuids.size > 0) {
        UtilsDocument.bulkDelete(((await UtilsDocument.templateFromUuid(deleteTemplateUuids)).map(doc => {return {document: doc}})))
      }
    }
  }

  private calculateTargetResult(chatMessages: ChatMessage[]): void {
    for (const chatMessage of chatMessages) {
      const messageData = InternalFunctions.getItemCardData(chatMessage);
      let update = InternalFunctions.calculateTargetResult(messageData);
      if (update) {
        InternalFunctions.setItemCardData(chatMessage, update);
      }
    }
  }
  
  private calcItemCardDamageFormulas(chatMessages: ChatMessage[]): void {
    for (const chatMessage of chatMessages) {
      const data: ItemCardData = InternalFunctions.getItemCardData(chatMessage);
      for (const item of data.items) {
        if (!item.damages) {
          continue;
        }

        item.damages = item.damages.map(damage => {
          // Diplay formula
          let displayFormula = damage.mode === 'critical' ? damage.criticalRoll?.formula : damage.normalRoll?.formula;
          const damageTypes: DamageType[] = [];
          if (displayFormula) {
            for (const damageType of UtilsRoll.getValidDamageTypes()) {
              if (displayFormula.match(`\\[${damageType}\\]`)) {
                damageTypes.push(damageType);
                displayFormula = displayFormula.replace(new RegExp(`\\[${damageType}\\]`, 'g'), '');
              }
            }
          }
    
          return {
            ...damage,
            displayFormula: displayFormula,
            displayDamageTypes: damageTypes.length > 0 ? `(${damageTypes.sort().map(s => s.capitalize()).join(', ')})` : undefined
          };
        });
      }
      InternalFunctions.setItemCardData(chatMessage, data);
    }
  }
  
  private calcItemCardCanChangeTargets(chatMessages: ChatMessage[]): void {
    for (const chatMessage of chatMessages) {
      const data: ItemCardData = InternalFunctions.getItemCardData(chatMessage);
      for (const item of data.items) {
        item.canChangeTargets = InternalFunctions.canChangeTargets(item);
      }
      InternalFunctions.setItemCardData(chatMessage, data);
    }
  }
  
  private calcCanChangeSpellLevel(chatMessages: ChatMessage[]): void {
    for (const chatMessage of chatMessages) {
      const data: ItemCardData = InternalFunctions.getItemCardData(chatMessage);
      for (const item of data.items) {
        item.canChangeLevel = item.level > 0;
        if (!item.canChangeLevel) {
          continue;
        }

        for (const damage of item.damages ?? []) {
          if (damage.normalRoll?.evaluated || damage.criticalRoll?.evaluated) {
            item.canChangeLevel = false;
            break;
          }
        }
        if (!item.canChangeLevel) {
          continue;
        }
        
        for (const consumeResource of item.consumeResources) {
          if (consumeResource.applied) {
            item.canChangeLevel = false;
            break;
          }
        }
        if (!item.canChangeLevel) {
          continue;
        }
      }
    }
  }
  
  private calcConsumeResources(context: IDmlContext<ChatMessage>): void {
    for (let rowIndex = 0; rowIndex < context.rows.length; rowIndex++) {
      const data = InternalFunctions.getItemCardData(context.rows[rowIndex]);
      if (context.oldRows) {
        const oldData = InternalFunctions.getItemCardData(context.oldRows[rowIndex]);
        
        for (let itemIndex = 0; itemIndex < data.items.length; itemIndex++) {
          const item = data.items[itemIndex];
          const oldItem = oldData.items[itemIndex];
          
          let effectiveSelectedLevel = item.selectedlevel === 'pact' ? (data.actor?.pactLevel ?? 0) : item.selectedlevel;
          if (item.level > effectiveSelectedLevel) {
            effectiveSelectedLevel = item.level;
            item.selectedlevel = effectiveSelectedLevel;
          }
          
          if (item.selectedlevel !== oldItem.selectedlevel) {
            const newSpellPropertyName = item.selectedlevel === 'pact' ? item.selectedlevel : `spell${item.selectedlevel}`;
            const oldSpellPropertyName = oldItem.selectedlevel === 'pact' ? oldItem.selectedlevel : `spell${oldItem.selectedlevel}`;
            for (const consumedResource of item.consumeResources) {
              if (!consumedResource.applied && consumedResource.uuid === data.actor?.uuid && consumedResource.path === `data.spells.${oldSpellPropertyName}.value`) {
                consumedResource.path = `data.spells.${newSpellPropertyName}.value`;
                consumedResource.original = UtilsDocument.actorFromUuid(consumedResource.uuid, {sync: true}).data.data.spells[newSpellPropertyName].value;
              }
            }
          }
        }
      }

      for (const item of data.items) {
        item.allConsumeResourcesApplied = true;
        for (const consumedResource of item.consumeResources) {
          if (!consumedResource.applied) {
            item.allConsumeResourcesApplied = false;
            break;
          }
        }
      }
      InternalFunctions.setItemCardData(context.rows[rowIndex], data);
    }
  }
  
  private onBonusChange(context: IDmlContext<ChatMessage>): void {
    if (context.userId !== game.userId || !context.oldRows) {
      return;
    }
    for (let rowIndex = 0; rowIndex < context.rows.length; rowIndex++) {
      const data: ItemCardData = InternalFunctions.getItemCardData(context.rows[rowIndex]);
      const oldData: ItemCardData = InternalFunctions.getItemCardData(context.oldRows[rowIndex]);
      for (let itemIndex = 0; itemIndex < data.items.length; itemIndex++) {
        const item = data.items[itemIndex];
        const oldItem = oldData.items.length <= itemIndex ? null : oldData.items[itemIndex];
        
        if (item.attack?.phase === 'bonus-input' && oldItem?.attack?.phase !== 'bonus-input') {
          MemoryStorageService.setFocusedElementSelector(`.${staticValues.moduleName}-attack input.${staticValues.moduleName}-bonus`);
          return;
        }

        for (let dmgIndex = 0; dmgIndex < item.damages?.length; dmgIndex++) {
          const dmg = item.damages[dmgIndex];
          const oldDmg = oldItem?.damages?.[dmgIndex];
          
          if (dmg?.phase === 'bonus-input' && oldDmg?.phase !== 'bonus-input') {
            MemoryStorageService.setFocusedElementSelector(`.${staticValues.moduleName}-item-${itemIndex}-damage-${dmgIndex} input.${staticValues.moduleName}-bonus`);
            return;
          }
        }
        for (let targetIndex = 0; targetIndex < item.targets?.length; targetIndex++) {
          const target = item.targets[targetIndex];
          const oldTarget = oldItem?.targets?.[targetIndex];
          
          if (target?.check?.phase === 'bonus-input' && oldTarget?.check?.phase !== 'bonus-input') {
            MemoryStorageService.setFocusedElementSelector(`.${staticValues.moduleName}-item-${itemIndex}-check-target-${targetIndex} input.${staticValues.moduleName}-bonus`);
            return;
          }
        }
      }
    }

    // No focus found => reset
    MemoryStorageService.setFocusedElementSelector(null);
  }

  private async applyActiveEffects(chatMessages: ChatMessage[]): Promise<void> {
    const chatMessageDatas: ItemCardData[] = [];
    const chatMessageDatasByUuid = new Map<string, ItemCardData>();
    for (const chatMessage of chatMessages) {
      const data = InternalFunctions.getItemCardData(chatMessage);
      chatMessageDatas.push(data);
      chatMessageDatasByUuid.set(chatMessage.uuid, data);
    }
    const shouldApply = (item: ItemCardItemData, target: ItemCardItemData['targets'][0]): boolean => {
      if (item.damages?.length) {
        if (!target.result.applyDmg) {
          return false;
        }
      }
      return target.result.checkPass === false || target.result.hit === true;
    }
    const effectsByTargetUuid = new Map<string, {chatMessageIndex: number, itemIndex: number, apply: boolean}[]>();
    for (let chatMessageIndex = 0; chatMessageIndex < chatMessageDatas.length; chatMessageIndex++) {
      const messageData = chatMessageDatas[chatMessageIndex];
      for (let itemIndex = 0; itemIndex < messageData.items.length; itemIndex++) {
        const item = messageData.items[itemIndex];
        if (item.activeEffectsData.length > 0 && item.targets?.length > 0) {
          for (const target of item.targets) {
            // TODO I am not happy with this, maybe this should be user input? but there is already enough user input
            let shouldApplyResult = shouldApply(item, target);
            if (shouldApplyResult === target.result.appliedActiveEffects) {
              continue;
            }

            if (!effectsByTargetUuid.has(target.uuid)) {
              effectsByTargetUuid.set(target.uuid, []);
            }
            effectsByTargetUuid.get(target.uuid).push({
              chatMessageIndex: chatMessageIndex,
              itemIndex: itemIndex,
              apply: shouldApplyResult
            });
          }
        }
      }
    }

    // This _should_ prevent infinit loops
    if (effectsByTargetUuid.size === 0) {
      return;
    }

    const actorsByTokenUuid = new Map<string, MyActor>();
    for (const token of (await UtilsDocument.tokenFromUuid(effectsByTargetUuid.keys()))) {
      actorsByTokenUuid.set(token.uuid, token.getActor());
    }

    const getOriginKey = (origin: any): string => {
      return `${origin.messageUuid}.${origin.itemIndex}.${origin.activeEffectsIndex}`;
    }

    for (const targetUuid of effectsByTargetUuid.keys()) {
      const actor = actorsByTokenUuid.get(targetUuid);
      const effects = effectsByTargetUuid.get(targetUuid);
      const createActiveEffects: ActiveEffectData[] = [];
      const updateActiveEffects: ActiveEffectData[] = [];
      const deleteActiveEffects: ActiveEffectData[] = [];

      const activeEffectsByKey = new Map<string, ActiveEffect[]>();
      for (const effect of actor.getEmbeddedCollection(ActiveEffect.name).values()) {
        const origin = (effect.data.flags?.[staticValues.moduleName] as any)?.origin;
        if (origin) {
          const key = getOriginKey(origin);
          if (!activeEffectsByKey.has(key)) {
            activeEffectsByKey.set(key, []);
          }
          activeEffectsByKey.get(key).push(effect as ActiveEffect);
        }
      }

      for (const effect of effects) {
        if (!effect.apply) {
          const item = chatMessageDatas[effect.chatMessageIndex].items[effect.itemIndex];
          for (let activeEffectsIndex = 0; activeEffectsIndex < item.activeEffectsData.length; activeEffectsIndex++) {
            const origin = {
              messageUuid: chatMessages[effect.chatMessageIndex].uuid,
              itemIndex: effect.itemIndex,
              activeEffectsIndex: activeEffectsIndex
            };
            const key = getOriginKey(origin);
            if (activeEffectsByKey.has(key)) {
              deleteActiveEffects.push(...activeEffectsByKey.get(key).map(row => row.data));
            }
          }
        }
      }
      for (const effect of effects) {
        if (effect.apply) {
          const item = chatMessageDatas[effect.chatMessageIndex].items[effect.itemIndex];
          for (let activeEffectsIndex = 0; activeEffectsIndex < item.activeEffectsData.length; activeEffectsIndex++) {
            const activeEffectData = deepClone(item.activeEffectsData[activeEffectsIndex]);
            activeEffectData.flags = activeEffectData.flags ?? {};
            activeEffectData.flags[staticValues.moduleName] = activeEffectData.flags[staticValues.moduleName] ?? {};
            (activeEffectData.flags[staticValues.moduleName] as any).origin = {
              messageUuid: chatMessages[effect.chatMessageIndex].uuid,
              itemIndex: effect.itemIndex,
              activeEffectsIndex: activeEffectsIndex
            };
            delete activeEffectData._id
            if (deleteActiveEffects.length > 0) {
              activeEffectData._id = deleteActiveEffects[0]._id;
              deleteActiveEffects.splice(0, 1)
              updateActiveEffects.push(activeEffectData);
            } else {
              createActiveEffects.push(activeEffectData);
            }
          }
        }
      }

      if (createActiveEffects.length > 0) {
        await actor.createEmbeddedDocuments(ActiveEffect.name, createActiveEffects);
      }
      if (updateActiveEffects.length > 0) {
        await actor.updateEmbeddedDocuments(ActiveEffect.name, updateActiveEffects as any);
      }
      if (deleteActiveEffects.length > 0) {
        await actor.deleteEmbeddedDocuments(ActiveEffect.name, deleteActiveEffects.map(effect => effect._id));
      }
    }

    // TODO smarter change detection
    for (const chatMessage of chatMessages) {
      const data = chatMessageDatasByUuid.get(chatMessage.uuid);
      for (const item of data.items) {
        for (const target of item.targets ?? []) {
          // It should be applied by now
          target.result.appliedActiveEffects = shouldApply(item, target);
        }
      }
      InternalFunctions.setItemCardData(chatMessage, chatMessageDatasByUuid.get(chatMessage.uuid));
    }
    ChatMessage.updateDocuments(chatMessages.map(message => message.data));
  }

  private async applyConsumeResources(messageData: ItemCardData): Promise<ItemCardData> {
    // TODO try to do dmls across all functions in a central place
    const documentsByUuid = new Map<string, foundry.abstract.Document<any, any>>();
    const consumeResourcesToToggle: ItemCardData['items'][0]['consumeResources'] = [];
    const bulkUpdate: Parameters<typeof UtilsDocument['bulkUpdate']>[0] = [];
    {
      const promisesByUuid = new Map<string, Promise<{uuid: string, document: foundry.abstract.Document<any, any>}>>();
      for (const item of messageData.items) {
        for (const consumeResource of item.consumeResources) {
          let shouldApply = false;
          if (consumeResource.consumeResourcesAction === 'undo') {
            shouldApply = false;
          } else if (consumeResource.consumeResourcesAction === 'manual-apply') {
            shouldApply = true;
          } else {
            switch (consumeResource.autoconsumeAfter) {
              case 'init': {
                shouldApply = true;
                break;
              }
              case 'attack': {
                shouldApply = item.attack?.evaluatedRoll?.evaluated === true;
                break;
              }
              case 'template-placed': {
                shouldApply = item.targetDefinition?.createdTemplateUuid != null;
                break;
              }
              case 'damage': {
                for (const damage of (item.damages ?? [])) {
                  if (damage.normalRoll?.evaluated === true || damage.criticalRoll?.evaluated === true) {
                    shouldApply = true;
                    break;
                  }
                }
                break;
              }
              case 'check': {
                for (const target of (item.targets ?? [])) {
                  if (target.check?.evaluatedRoll?.evaluated === true) {
                    shouldApply = true;
                    break;
                  }
                }
                break;
              }
            }
          }
          
          if (shouldApply !== consumeResource.applied) {
            consumeResourcesToToggle.push(consumeResource);
            if (!promisesByUuid.has(consumeResource.uuid)) {
              promisesByUuid.set(consumeResource.uuid, fromUuid(consumeResource.uuid).then(doc => {return {uuid: consumeResource.uuid, document: doc}}));
            }
          }
        }
      }

      const rows = await Promise.all(Array.from(promisesByUuid.values()));
      for (const row of rows) {
        documentsByUuid.set(row.uuid, row.document);
      }
    }

    if (consumeResourcesToToggle.length === 0) {
      return null;
    }

    const updatesByUuid = new Map<string, any>();
    for (const consumeResource of consumeResourcesToToggle) {
      if (!updatesByUuid.has(consumeResource.uuid)) {
        updatesByUuid.set(consumeResource.uuid, {});
      }
      const updates = updatesByUuid.get(consumeResource.uuid);
      if (consumeResource.applied) {
        // toggle => refund to original
        setProperty(updates, consumeResource.path, consumeResource.original);
      } else {
        // toggle => apply
        setProperty(updates, consumeResource.path, Math.max(0, consumeResource.original - consumeResource.amount));
      }
      consumeResource.applied = !consumeResource.applied;
    }

    for (const uuid of documentsByUuid.keys()) {
      if (updatesByUuid.has(uuid)) {
        bulkUpdate.push({
          document: documentsByUuid.get(uuid) as any,
          data: updatesByUuid.get(uuid)
        })
      }
    }

    await UtilsDocument.bulkUpdate(bulkUpdate);

    return messageData;
  }
  
  private filterItemCardsOnly(context: IDmlContext<ChatMessage>): ChatMessage[] {
    const itemCards: ChatMessage[] = [];
    for (const row of context.rows) {
      if (row.getFlag(staticValues.moduleName, 'clientTemplate') === `modules/${staticValues.moduleName}/templates/item-card.hbs`) {
        itemCards.push(row);
      }
    }
    return itemCards;
  }
  
}

class DmlTriggerTemplate implements IDmlTrigger<MeasuredTemplateDocument> {

  get type(): typeof MeasuredTemplateDocument {
    return MeasuredTemplateDocument;
  }
  
  public async afterCreate(context: IDmlContext<MeasuredTemplateDocument>): Promise<void> {
    if (game.userId !== context.userId) {
      return;
    }
    for (const template of context.rows) {
      const messageId = template.getFlag(staticValues.moduleName, 'dmlCallbackMessageId') as string;
      if (!messageId || !game.messages.has(messageId)) {
        continue;
      }
      const message = game.messages.get(messageId);
      const messageData = InternalFunctions.getItemCardData(message);
      if (!messageData) {
        continue;
      }

      const itemIndex = template.getFlag(staticValues.moduleName, 'dmlCallbackItemIndex') as number;
      let item = messageData.items[itemIndex];
      if (!item) {
        continue;
      }

      if (item.targetDefinition.createdTemplateUuid && item.targetDefinition.createdTemplateUuid !== template.uuid) {
        fromUuid(item.targetDefinition.createdTemplateUuid).then(doc => {
          if (doc != null) {
            doc.delete();
          }
        });
      }

      item.targetDefinition.createdTemplateUuid = template.uuid;

      item = await this.setTargetsFromTemplate(item);
      messageData.items[itemIndex] = item;
      // Game seems buggy when unetting targets, this however does work
      if (game.user.targets.size > 0) {
        Array.from(game.user.targets)[0].setTarget(false, {releaseOthers: true})
      }
      if (item.targets) {
        const targetCanvasIds = (await UtilsDocument.tokenFromUuid(item.targets.map(t => t.uuid))).map(t => t.object.id)
        game.user.updateTokenTargets(targetCanvasIds);
        game.user.broadcastActivity({targets: targetCanvasIds});
      }

      await InternalFunctions.saveItemCardData(messageId, messageData);
    }
  }

  public async afterUpdate(context: IDmlContext<MeasuredTemplateDocument>): Promise<void> {
    if (game.userId !== context.userId) {
      return;
    }

    for (const template of context.rows) {
      const messageId = template.getFlag(staticValues.moduleName, 'dmlCallbackMessageId') as string;
      if (!messageId || !game.messages.has(messageId)) {
        continue;
      }
      const message = game.messages.get(messageId);
      const messageData = InternalFunctions.getItemCardData(message);
      if (!messageData) {
        continue;
      }

      const itemIndex = template.getFlag(staticValues.moduleName, 'dmlCallbackItemIndex') as number;
      let item = messageData.items[itemIndex];
      if (!item) {
        continue;
      }

      if (!InternalFunctions.canChangeTargets(item)) {
        continue;
      }

      item = await this.setTargetsFromTemplate(item);
      messageData.items[itemIndex] = item;
      // Game seems buggy when unetting targets, this however does work
      if (game.user.targets.size > 0) {
        Array.from(game.user.targets)[0].setTarget(false, {releaseOthers: true})
      }
      if (item.targets) {
        const targetCanvasIds = (await UtilsDocument.tokenFromUuid(item.targets.map(t => t.uuid))).map(t => t.object.id)
        game.user.updateTokenTargets(targetCanvasIds);
        game.user.broadcastActivity({targets: targetCanvasIds});
      }

      await InternalFunctions.saveItemCardData(messageId, messageData);
    }
  }
  
  private async setTargetsFromTemplate(item: ItemCardItemData): Promise<ItemCardItemData> {
    if (!item.targetDefinition?.createdTemplateUuid) {
      return item;
    }

    if (!InternalFunctions.canChangeTargets(item)) {
      return item;
    }

    const template = await UtilsDocument.templateFromUuid(item.targetDefinition.createdTemplateUuid);
    if (!template) {
      return item;
    }
    
    const templateDetails = UtilsTemplate.getTemplateDetails(template);
    const scene = template.parent;
    const newTargets: string[] = [];
    // @ts-ignore
    for (const token of scene.getEmbeddedCollection('Token') as Iterable<TokenDocument>) {
      if (UtilsTemplate.isTokenInside(templateDetails, token, true)) {
        newTargets.push(token.uuid);
      }
    }

    return UtilsChatMessage.setTargets(item, newTargets);
  }

}

class InternalFunctions {
  
  public static get healingDamageTypes(): DamageType[] {
    return Object.keys((CONFIG as any).DND5E.healingTypes) as any;
  }

  public static calculateTargetResult(messageData: ItemCardData): ItemCardData {
    const items = messageData.items.filter(item => item.targets?.length);

    // Prepare data
    const tokenUuidToName = new Map<string, string>();
    const rawHealthModByTargetUuid = new Map<string, number>();
    const calculatedHealthModByTargetUuid = new Map<string, number>();
    for (const item of items) {
      for (const target of item.targets) {
        target.result = !target.result ? {appliedActiveEffects: false} : {...target.result}
        delete target.result.checkPass;
        delete target.result.dmg;
        delete target.result.hit;
        tokenUuidToName.set(target.uuid, target.name || '');
        rawHealthModByTargetUuid.set(target.uuid, 0);
        calculatedHealthModByTargetUuid.set(target.uuid, 0);
      }
    }

    
    // Reset aggregate
    const aggregates = new Map<string, ItemCardData['targetAggregate'][0]>();
    if (messageData.targetAggregate) {
      // If an aggregate was shown, make sure it will always be shown to make sure it can be reset back to the original state
      for (const oldAggregate of messageData.targetAggregate) {
        if (!oldAggregate.dmg?.appliedDmg) {
          continue;
        }
        aggregates.set(oldAggregate.uuid, {
          uuid: oldAggregate.uuid,
          name: oldAggregate.name,
          img: oldAggregate.img,
          hpSnapshot: oldAggregate.hpSnapshot,
          dmg: {
            avoided: true,
            applied: false,
            appliedDmg: oldAggregate.dmg?.appliedDmg || 0,
            rawDmg: 0,
            calcDmg: 0,
            calcHp: oldAggregate.hpSnapshot.hp,
            calcTemp: oldAggregate.hpSnapshot.temp,
          }
        })
      }
    }

    for (const item of items) {
      for (const target of item.targets) {
        if (!aggregates.has(target.uuid)) {
          aggregates.set(target.uuid, {
            uuid: target.uuid,
            name: target.name,
            img: target.img,
            hpSnapshot: target.hpSnapshot,
            dmg: {
              avoided: true,
              applied: false,
              appliedDmg: 0,
              rawDmg: 0,
              calcDmg: 0,
              calcHp: Number(target.hpSnapshot.hp),
              calcTemp: Number(target.hpSnapshot.temp),
            }
          });
        }
      }
    }

    const applyDmg = (aggregate: ItemCardData['targetAggregate'][0], amount: number) => {
      if (aggregate.dmg == null) {
        aggregate.dmg = {
          avoided: true,
          applied: false,
          appliedDmg: 0,
          rawDmg: 0,
          calcDmg: 0,
          calcHp: Number(aggregate.hpSnapshot.hp),
          calcTemp: Number(aggregate.hpSnapshot.temp),
        }
      }

      const maxDmg = aggregate.hpSnapshot.hp + Number(aggregate.hpSnapshot.temp);
      const minDmg = 0;
      let dmg = Math.min(maxDmg, Math.max(minDmg, amount));
      
      aggregate.dmg.calcDmg += dmg;
      if (dmg > 0) {
        let tempDmg = Math.min(Number(aggregate.dmg.calcTemp), dmg);
        aggregate.dmg.calcTemp -= tempDmg;
        dmg -= tempDmg;
      }
      aggregate.dmg.calcHp -= dmg;
    }
    
    const applyHeal = (aggregate: ItemCardData['targetAggregate'][0], amount: number) => {
      if (aggregate.dmg == null) {
        aggregate.dmg = {
          avoided: true,
          applied: false,
          appliedDmg: 0,
          rawDmg: 0,
          calcDmg: 0,
          calcHp: Number(aggregate.hpSnapshot.hp),
          calcTemp: Number(aggregate.hpSnapshot.temp),
        }
      }

      // Get the current max HP since the max HP may have changed with active effects
      // In the rare usecase where sync actor fetching is not possible, fallback to the snapshot
      const tokenActor = UtilsDocument.actorFromUuid(aggregate.uuid, {sync: true});
      const maxHeal = Math.max(0, tokenActor == null ? aggregate.hpSnapshot.maxHp : tokenActor.data.data.attributes.hp.max - aggregate.hpSnapshot.hp);
      const minHeal = 0;
      const heal = Math.min(maxHeal, Math.max(minHeal, amount));
      aggregate.dmg.calcDmg -= heal;
      aggregate.dmg.calcHp += heal;
    }

    // Calculate
    for (const item of items) {
      // Attack
      if (item.attack?.evaluatedRoll) {
        const attackResult = item.attack.evaluatedRoll.total;
        for (const target of item.targets) {
          target.result.hit = target.ac <= attackResult;
        }
      }

      // Check
      if (item.check) {
        for (const target of item.targets) {
          if (!target.check?.evaluatedRoll?.evaluated) {
            target.result.checkPass = null;
          } else {
            target.result.checkPass = target.check.evaluatedRoll.total >= item.check.dc;
          }
        }
      }

      // Include when no attack has happend (null) and when hit (true)
      // Include when no check is present in the item or the check happend (check passed/failed is handled later)
      const calcDmgForTargets = item.targets.filter(target => target.result.hit !== false && (!item.check || target.check?.evaluatedRoll?.evaluated));

      // Damage
      const evaluatedDamageRolls = item.damages ? item.damages.filter(dmg => dmg.mode === 'critical' ? dmg.criticalRoll?.evaluated : dmg.normalRoll?.evaluated) : [];
      if (calcDmgForTargets.length > 0 && evaluatedDamageRolls.length > 0) {
        for (const damage of evaluatedDamageRolls) {
          const damageResults = UtilsRoll.rollToDamageResults(Roll.fromJSON(JSON.stringify(damage.mode === 'critical' ? damage.criticalRoll : damage.normalRoll)));
          for (const target of calcDmgForTargets) {
            for (const [dmgType, dmg] of damageResults.entries()) {
              let baseDmg = dmg;
              if (item.check && target.result.checkPass) {
                // If a creature or an object has resistance to a damage type, damage of that type is halved against it.
                // I read that as, first apply the save modifier, not at the same time or not after res/vuln
                switch (damage.modfierRule) {
                  case 'save-full-dmg': {
                    break;
                  }
                  case 'save-no-dmg': {
                    baseDmg = 0;
                    break;
                  }
                  case 'save-halve-dmg':
                  default: {
                    baseDmg = baseDmg * .5;
                    break;
                  }
                }
              }
              let modifier = 1;
              if (target.immunities.includes(dmgType)) {
                modifier = 0;
              } else {
                if (target.resistances.includes(dmgType)) {
                  modifier -= .5;
                }
                if (target.vulnerabilities.includes(dmgType)) {
                  modifier += .5;
                }
              }

              target.result.dmg = {
                type: dmgType,
                rawNumber: baseDmg,
                calcNumber: Math.floor(baseDmg * modifier),
              }

              if (!aggregates.get(target.uuid)) {
                aggregates.set(target.uuid, {
                  uuid: target.uuid,
                  hpSnapshot: target.hpSnapshot,
                  name: target.name,
                  img: target.img,
                })
              }
              const aggregate = aggregates.get(target.uuid);
              if (aggregate.dmg == null) {
                aggregate.dmg = {
                  avoided: true,
                  applied: false,
                  appliedDmg: 0,
                  rawDmg: 0,
                  calcDmg: 0,
                  calcHp: Number(aggregate.hpSnapshot.hp),
                  calcTemp: Number(aggregate.hpSnapshot.temp),
                }
              }

              // Apply healing & dmg aggregate in the same order as the items
              if (target.result.dmg.type === 'temphp') {
                aggregate.dmg.calcTemp += target.result.dmg.calcNumber;
              } else if (InternalFunctions.healingDamageTypes.includes(target.result.dmg.type)) {
                applyHeal(aggregate, target.result.dmg.calcNumber);
              } else {
                applyDmg(aggregate, target.result.dmg.calcNumber);
              }
            }
          }
        }
      }
    }

    for (const item of items) {
      for (const target of item.targets ?? []) {
        if ((item.attack && target.result.hit) || (item.check && !target.result.checkPass)) {
          if (aggregates.get(target.uuid).dmg) {
            aggregates.get(target.uuid).dmg.avoided = false;
          }
        }
      }
    }

    messageData.targetAggregate = Array.from(aggregates.values()).sort((a, b) => (a.name || '').localeCompare((b.name || '')));
    for (const aggregate of messageData.targetAggregate) {
      if (aggregate.dmg) {
        aggregate.dmg.applied = aggregate.dmg.calcDmg === aggregate.dmg.appliedDmg;
      }
    }

    messageData.allDmgApplied = messageData.targetAggregate != null && messageData.targetAggregate.filter(aggr => aggr.dmg?.applied).length === messageData.targetAggregate.length;
    const appliedDmgTo = new Set<string>();
    if (messageData.targetAggregate != null) {
      for (const aggr of messageData.targetAggregate) {
        if (aggr.dmg?.applied) {
          appliedDmgTo.add(aggr.uuid);
        }
      }
    }
    for (const item of messageData.items) {
      if (!item.targets) {
        continue;
      }
    }

    return messageData;
  }

  public static async saveItemCardData(messageId: string, data: ItemCardData): Promise<void> {
    await ChatMessage.updateDocuments([{
      _id: messageId,
      flags: {
        [staticValues.moduleName]: {
          clientTemplateData: {
            data: data,
          }
        }
      }
    }]);
  }

  public static getItemCardData(message: ChatMessage): ItemCardData {
    return (message.getFlag(staticValues.moduleName, 'clientTemplateData') as any)?.data;
  }

  public static setItemCardData(message: ChatMessage, data: ItemCardData): void {
    setProperty(message.data, `flags.${staticValues.moduleName}.clientTemplateData.data`, data);
  }
  
  public static canChangeTargets(itemData: ItemCardItemData): boolean {
    if (!itemData.targets) {
      return true;
    }

    // A target has rolled a save or damage has been applied
    if (itemData.targets) {
      for (const target of itemData.targets) {
        if (target.result.checkPass != null) {
          return false;
        }
        if (target.result.applyDmg) {
          return false;
        }
        if (target.result.appliedActiveEffects) {
          return false;
        }
      }
    }
    return true;
  }
  
  public static getLatestMessage(): ChatMessage | null {
    for (let messageIndex = game.messages.contents.length - 1; messageIndex >= 0; messageIndex--) {
      const chatMessage = game.messages.contents[messageIndex];
      const data = InternalFunctions.getItemCardData(chatMessage);
      if (!data) {
        continue;
      }
      return chatMessage;
    }
    return null;
  }

}