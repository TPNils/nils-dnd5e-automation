import { ChatMessageDataConstructorData } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/data/data.mjs/chatMessageData";
import { MessageData } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/foundry.js/roll";
import { provider } from "../provider/provider";
import { staticValues } from "../static-values";
import { DamageType, MyActor, MyActorData, MyItem } from "../types/fixed-types";
import { UtilsDiceSoNice } from "./utils-dice-so-nice";
import { UtilsDocument } from "./utils-document";
import { UtilsInput } from "./utils-input";
import { UtilsRoll } from "./utils-roll";

export interface ItemCardActorData {
  uuid: string;
}

export type RollJson = ReturnType<Roll['toJSON']>

type RollPhase = 'mode-select' | 'bonus-input' | 'result';
export interface ItemCardItemData {
  uuid: string;
  name: string;
  img: string;
  description?: string;
  materials?: string;
  targets?: {
    uuid: string;
    actorUuid: string;
    ac: number;
    img?: string;
    name?: string;
    hpSnapshot: {
      hp: number;
      temp?: number;
    },
    immunities: string[];
    resistances: string[];
    vulnerabilities: string[];
    check?: {
      evaluatedRoll?: RollJson;
      mode: 'normal' | 'advantage' | 'disadvantage';
    }
    result: {
      hit?: boolean;
      checkPass?: boolean;
      dmg?: {
        rawDmg: number;
        calcDmg: number;
      },
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
    modfierRule?: 'save-full-dmg' | 'save-halve-dmg' | 'save-no-dmg';
    mode: 'normal' | 'critical';
    normalRoll: RollJson;
    criticalRoll?: RollJson;
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
  allDmgApplied?: boolean;
  targetAggregate?: {
    uuid: string;
    img?: string;
    name?: string;
    hpSnapshot: {
      hp: number;
      temp?: number;
    },
    dmg?: {
      applied: boolean,
      appliedDmg: number,
      rawDmg: number;
      calcDmg: number;
      calcHp: number;
      calcTemp: number;
    },
  }[]
}

interface ClickEvent {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}
type InteractionResponse = {success: true;} | {success: false; errorMessage: string, errorType: 'warn' | 'error'}
interface ActionParam {event: ClickEvent, regexResult: RegExpExecArray, messageId: string, messageData: ItemCardData, inputValue?: boolean | number | string};
type ActionPermissionCheck = ({}: ActionParam) => {actorUuid?: string, message?: boolean, gm?: boolean};
type ActionPermissionExecute = ({}: ActionParam) => Promise<void | ItemCardData>;

// TODO bonus dmg/save input
export class UtilsChatMessage {

  private static readonly actionMatches: Array<{regex: RegExp, permissionCheck: ActionPermissionCheck, execute: ActionPermissionExecute}> = [
    {
      regex: /^refresh$/, // used for testing during dev
      permissionCheck: () => {return {message: true}},
      execute: ({messageData}) => Promise.resolve(messageData),
    },
    {
      regex: /^item-([0-9]+)-damage-([0-9]+)$/,
      permissionCheck: ({messageData}) => {return {actorUuid: messageData.actor?.uuid}},
      execute: ({regexResult, messageData}) => UtilsChatMessage.processItemDamage(Number(regexResult[2]), Number(regexResult[1]), messageData),
    },
    {
      regex: /^item-([0-9]+)-damage-([0-9]+)-mode-(minus|plus)$/,
      permissionCheck: ({messageData}) => {return {actorUuid: messageData.actor?.uuid}},
      execute: ({regexResult, messageData}) => UtilsChatMessage.processItemDamageMode(Number(regexResult[1]), Number(regexResult[2]), regexResult[3] as ('plus' | 'minus'), messageData),
    },
    {
      regex: /^item-([0-9]+)-attack$/,
      permissionCheck: ({messageData}) => {return {actorUuid: messageData.actor?.uuid}},
      execute: ({event, regexResult, messageData}) => UtilsChatMessage.processItemAttack(event, Number(regexResult[1]), messageData),
    },
    {
      regex: /^item-([0-9]+)-attack-bonus$/,
      permissionCheck: ({messageData}) => {return {actorUuid: messageData.actor?.uuid}},
      execute: ({regexResult, inputValue, messageData}) => UtilsChatMessage.processItemAttackBonus(Number(regexResult[1]), inputValue as string, messageData),
    },
    {
      regex: /^item-([0-9]+)-attack-mode-(minus|plus)$/,
      permissionCheck: ({messageData}) => {return {actorUuid: messageData.actor?.uuid}},
      execute: ({event, regexResult, messageData}) => UtilsChatMessage.processItemAttackMode(event, Number(regexResult[1]), regexResult[2] as ('plus' | 'minus'), messageData),
    },
    {
      regex: /^item-([0-9]+)-check-([a-zA-Z0-9\.]+)$/,
      permissionCheck: ({messageData}) => {return {actorUuid: messageData.actor?.uuid}},
      execute: ({regexResult, messageData}) => UtilsChatMessage.processItemCheck(Number(regexResult[1]), regexResult[2], messageData),
    },
    {
      regex: /^item-([0-9]+)-check-([a-zA-Z0-9\.]+)-mode-(minus|plus)$/,
      permissionCheck: ({messageData}) => {return {actorUuid: messageData.actor?.uuid}},
      execute: ({event, regexResult, messageData}) => UtilsChatMessage.processItemCheckMode(event, Number(regexResult[1]), regexResult[2], regexResult[3] as ('plus' | 'minus'), messageData),
    },
    {
      regex: /^apply-damage-((?:[a-zA-Z0-9\.]+)|\*)$/,
      permissionCheck: ({regexResult}) => {return {gm: true}},
      execute: ({regexResult, messageId, messageData}) => UtilsChatMessage.applyDamage(regexResult[1], messageData, messageId),
    },
    {
      regex: /^undo-damage-((?:[a-zA-Z0-9\.]+)|\*)$/,
      permissionCheck: ({regexResult}) => {return {gm: true}},
      execute: ({regexResult, messageId, messageData}) => UtilsChatMessage.undoDamage(regexResult[1], messageData, messageId),
    },
  ];

  private static get healingDamageTypes(): DamageType[] {
    return Object.keys((CONFIG as any).DND5E.healingTypes) as any;
  }

  public static registerHooks(): void {
    Hooks.on('renderChatLog', () => {
      const chatElement = document.getElementById('chat-log');
      chatElement.addEventListener('click', event => UtilsChatMessage.onClick(event));
      chatElement.addEventListener('focusout', event => UtilsChatMessage.onBlur(event));
    });

    Hooks.on("init", () => {
      // register templates parts
      loadTemplates([
        'modules/nils-automated-compendium/templates/damage.hbs',
        'modules/nils-automated-compendium/templates/roll/roll.hbs',
        'modules/nils-automated-compendium/templates/roll/tooltip.hbs'
      ]);
    });

    
    provider.getSocket().then(socket => {
      socket.register('onInteraction', (params: Parameters<typeof UtilsChatMessage['onInteractionProcessor']>[0]) => {
        return UtilsChatMessage.onInteractionProcessor(params);
      })
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

    const chatMessageData: ChatMessageDataConstructorData = {
      content: `The ${staticValues.moduleName} module is required to render this message.`,
      flags: {
        [staticValues.moduleName]: {
          clientTemplate: `modules/${staticValues.moduleName}/templates/item-card.hbs`,
          clientTemplateData: {
            staticValues: staticValues,
            data: data,
          }
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

    if (item.data.data.description?.value) {
      itemCardData.description =item.data.data.description.value
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
          normalRoll: UtilsRoll.damagePartsToRoll(damageParts, rollData).toJSON(),
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
        versatileDamage.normalRoll = new Roll(item.data.data.damage.versatile, rollData).toJSON();
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
            mode: 'normal',
            normalRoll: new Roll(scalingRollFormula, rollData).toJSON(),
          });
        } else {
          for (const damage of inputDamages) {
            const originalDamageParts = UtilsRoll.rollToDamageParts(Roll.fromJSON(JSON.stringify(damage.normalRoll)));
            const damageType: DamageType = originalDamageParts.length > 0 ? originalDamageParts[0][1] : ''
            const scalingParts = UtilsRoll.damageFormulaToDamageParts(scalingRollFormula);
            for (const part of scalingParts) {
              if (part[1] === '') {
                // Copy the first original damage type when a type is missing
                part[1] = damageType;
              }
            }
            
            damage.normalRoll = UtilsRoll.damagePartsToRoll([...originalDamageParts, ...scalingParts], rollData).toJSON();
          }
        }
      }
      
      // Add damage bonus formula
      if (inputDamages.length > 0) {
        const actorBonus = actor.data.data.bonuses?.[item.data.data.actionType];
        if (actorBonus?.damage && parseInt(actorBonus.damage) !== 0) {
          for (const damage of inputDamages) {
            const originalDamageParts = UtilsRoll.rollToDamageParts(Roll.fromJSON(JSON.stringify(damage.normalRoll)));
            const damageType: DamageType = originalDamageParts.length > 0 ? originalDamageParts[0][1] : ''
            damage.normalRoll = UtilsRoll.damagePartsToRoll([...originalDamageParts, [String(actorBonus.damage), damageType]], rollData).toJSON();
          }
        }
      }
      
      itemCardData.damages = UtilsChatMessage.calculateDamageFormulas(inputDamages);
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

    // TODO template

    return itemCardData;
  }

  public static async setTargets(itemCardItemData: ItemCardItemData, targetUuids: string[]): Promise<ItemCardItemData> {
    const tokenMap = new Map<string, TokenDocument>();
    for (const token of await UtilsDocument.tokensFromUuid(targetUuids, {deduplciate: true})) {
      tokenMap.set(token.uuid, token);
    }
    
    itemCardItemData.targets = [];
    for (const targetUuid of targetUuids) {
      const token = tokenMap.get(targetUuid);
      const actor = token.getActor() as MyActor;
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
          hp: actor.data.data.attributes.hp.value,
          temp: actor.data.data.attributes.hp.temp
        },
        result: {}
      };
      if (itemCardItemData.check) {
        // Don't prefil the roll, generate that at the moment the roll is made
        target.check = {mode: 'normal'};
      }
      itemCardItemData.targets.push(target);
    }
    itemCardItemData.targets = itemCardItemData.targets.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    return itemCardItemData;
  }

  private static async onClick(event: MouseEvent): Promise<void> {
    if (event.target instanceof HTMLInputElement) {
      // do not register clicks on inputs, except checkboxes
      const input = event.target as HTMLInputElement;
      if (input.type !== 'checkbox') {
        return;
      }
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
    }
    if (event.target instanceof Node) {
      UtilsChatMessage.onInteraction({
        element: event.target as Node
      });
    }
  }

  private static async onInteraction({clickEvent, element}: {element: Node, clickEvent?: ClickEvent}): Promise<void> {
    clickEvent = {
      altKey: clickEvent?.altKey === true,
      ctrlKey: clickEvent?.ctrlKey === true,
      metaKey: clickEvent?.metaKey === true,
      shiftKey: clickEvent?.shiftKey === true,
    }

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
    const messageData = UtilsChatMessage.getItemCardData(message);
    if (messageData == null) {
      console.warn(`pressed a ${staticValues.moduleName} action button for message ${messageId} but no data was found`);
      return;
    }

    const actions = await UtilsChatMessage.getActions(action, clickEvent, game.userId, messageId, messageData);
    if (actions.missingPermissions) {
      console.warn(`pressed a ${staticValues.moduleName} action button for message ${messageId} with action ${action} for current user but permissions are missing`)
      return;
    }
    if (actions.actionsToExecute.length === 0) {
      console.debug('no actions found')
      return;
    }

    const request: Parameters<typeof UtilsChatMessage['onInteractionProcessor']>[0] = {
      event: clickEvent,
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
      if (message.canUserModify(game.user, 'update')) {
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
      }
      if (response.errorType === 'error') {
        console.error(response.errorMessage);
      }
    }
  }

  private static async onInteractionProcessor({event, userId, messageId, action, inputValue}: {
    event: ClickEvent,
    userId: string,
    messageId: string,
    action: string,
    inputValue?: ActionParam['inputValue'];
  }): Promise<InteractionResponse> {
    const message = game.messages.get(messageId);
    const messageData = UtilsChatMessage.getItemCardData(message);
    if (messageData == null) {
      return {
        success: false,
        errorType: 'warn',
        errorMessage: `pressed a ${staticValues.moduleName} action button for message ${messageId} but no data was found`,
      };
    }

    const actions = await UtilsChatMessage.getActions(action, event, userId, messageId, messageData);
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
      const param: ActionParam = {event: event, regexResult: action.regex, messageId: messageId, messageData: latestMessageData, inputValue: inputValue};
      let response = await action.action.execute(param);
      if (response) {
        doUpdate = true;
        latestMessageData = response;
      }
    }

    if (doUpdate) {
      // TODO add "go to bottom" logic to a chat message update hook
      const log = document.querySelector("#chat-log");
      const isAtBottom = Math.abs(log.scrollHeight - (log.scrollTop + log.getBoundingClientRect().height)) < 2;

      // Don't use await so you can return a response faster to the client
      UtilsChatMessage.calculateTargetResult(latestMessageData)
        .then(mData => {
          for (const item of latestMessageData.items) {
            item.damages = UtilsChatMessage.calculateDamageFormulas(item.damages);
          }
          return mData;
        })
        .then(mData => {
          return ChatMessage.updateDocuments([{
            _id: messageId,
            flags: {
              [staticValues.moduleName]: {
                clientTemplateData: {
                  staticValues: staticValues,
                  data: mData,
                }
              }
            }
          }]);
      }).then(message => {
        if (isAtBottom) {
          (ui.chat as any).scrollBottom();
        }
      });
    }

    return {
      success: true,
    }
  }

  private static async getActions(action: string, event: ClickEvent, userId: string, messageId: string, messageData: ItemCardData): Promise<{missingPermissions: boolean, actionsToExecute: Array<{action: typeof UtilsChatMessage.actionMatches[0], regex: RegExpExecArray}>}> {
    if (!action) {
      return {
        missingPermissions: false,
        actionsToExecute: []
      };
    }
    const response = {
      missingPermissions: false, 
      actionsToExecute: [] as Array<{
        action: typeof UtilsChatMessage.actionMatches[0],
        regex: RegExpExecArray
      }>
    };

    const user = game.users.get(userId);
    for (const actionMatch of UtilsChatMessage.actionMatches) {
      const result = actionMatch.regex.exec(action);
      if (result) {
        const permissionCheck = actionMatch.permissionCheck({event: event, regexResult: result, messageId: messageId, messageData: messageData});
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
  
  private static async processItemAttackBonus(itemIndex: number, attackBonus: string, messageData: ItemCardData): Promise<void | ItemCardData> {
    const attack = messageData.items?.[itemIndex]?.attack;
    console.log(deepClone({
      attack,
      attackBonus
    }))
    if (!attack || attack.evaluatedRoll?.evaluated || attack.phase === 'result' || attack.userBonus === attackBonus) {
      return;
    }

    if (attackBonus) {
      attack.userBonus = attackBonus;
    } else {
      attack.userBonus = "";
    }

    if (attack.userBonus && !Roll.validate(attack.userBonus)) {
      // TODO warning
    }

    return messageData;
  }

  private static async processItemAttackRoll(itemIndex: number, messageData: ItemCardData): Promise<void | ItemCardData> {
    const attack = messageData.items?.[itemIndex]?.attack;
    if (!attack || attack.evaluatedRoll) {
      return;
    }

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
        const response = await UtilsInput.targets(Array.from(currentTargetUuids), {
          nrOfTargets: messageData.items[itemIndex].targets == null ? 0 : messageData.items[itemIndex].targets.length,
          allowSameTarget: true, // TODO
          allPossibleTargets: game.scenes.get(game.user.viewedScene).getEmbeddedCollection('Token').map(token => {
            return {
              uuid: (token as any).uuid,
              type: 'within-range'
            }
          }),
        });

        if (response.cancelled == true) {
          return;
        }
        messageData.items[itemIndex] = await UtilsChatMessage.setTargets(messageData.items[itemIndex], response.data.tokenUuids)
      }
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
    
    if (!Roll.validate(attack.userBonus)) {
      // TODO error
    } else {
      if (attack.userBonus) {
        parts.push(attack.userBonus);
      }
    }
    

    const roll = await new Roll(parts.join(' + ')).roll({async: true});
    UtilsDiceSoNice.showRoll({roll: roll});
    attack.evaluatedRoll = roll.toJSON();
    attack.phase = 'result';

    return messageData;
  }

  private static async processItemCheck(itemIndex: number, targetUuid: string, messageData: ItemCardData): Promise<void | ItemCardData> {
    if (!messageData.items?.[itemIndex]?.check) {
      console.warn('No check found')
      return;
    }
    const targetActor = (await UtilsDocument.tokenFromUuid(targetUuid)).getActor() as MyActor;
    if (!targetActor.isOwner) {
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
    if (!target || target.check?.evaluatedRoll?.evaluated) {
      return;
    }
    
    const check = messageData.items[itemIndex].check;
    if (!target.check) {
      target.check = {
        mode: 'normal'
      }
    }

    let roll = UtilsRoll.getAbilityRoll(targetActor, {ability: check.ability, skill: check.skill, addSaveBonus: check.addSaveBonus});
    roll = await UtilsRoll.setRollMode(roll, target.check.mode);
    roll = await roll.roll({async: true});
    UtilsDiceSoNice.showRoll({roll: roll});

    target.check.evaluatedRoll = roll.toJSON();

    return messageData;
  }

  private static async processItemAttackMode(event: ClickEvent, itemIndex: number, modName: 'plus' | 'minus', messageData: ItemCardData): Promise<void | ItemCardData> {
    {
      const actor = messageData.actor?.uuid == null ? null : (await UtilsDocument.actorFromUuid(messageData.actor.uuid));
      if (actor && !actor.isOwner) {
        return;
      }
    }
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
    if (!attack.evaluatedRoll) {
      return messageData;
    }

    const originalRoll = Roll.fromJSON(JSON.stringify(attack.evaluatedRoll));
    attack.evaluatedRoll = (await UtilsRoll.setRollMode(originalRoll, attack.mode)).toJSON();

    return messageData;
  }

  private static async processItemCheckMode(event: ClickEvent, itemIndex: number, targetUuid: string, modName: 'plus' | 'minus', messageData: ItemCardData): Promise<void | ItemCardData> {
    if (!messageData.items?.[itemIndex]?.check) {
      console.warn('No check found')
      return;
    }
    const targetActor = (await UtilsDocument.tokenFromUuid(targetUuid)).getActor() as MyActor;
    if (!targetActor.isOwner) {
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

  private static async processItemDamage(damageIndex: number, itemIndex: number, messageData: ItemCardData): Promise<void | ItemCardData> {
    {
      const actor = messageData.actor?.uuid == null ? null : (await UtilsDocument.actorFromUuid(messageData.actor.uuid));
      if (actor && !actor.isOwner) {
        return;
      }
    }

    const dmg = messageData.items[itemIndex].damages[damageIndex];
    if (dmg.mode === 'critical') {
      if (dmg.criticalRoll?.evaluated) {
        return;
      }

      const normalRoll = Roll.fromJSON(JSON.stringify(dmg.normalRoll));
      const normalRollEvaluated = dmg.normalRoll.evaluated;
      const normalPromise = normalRollEvaluated ? Promise.resolve(normalRoll) : normalRoll.roll({async: true});
      const critBonusPromise = UtilsRoll.getCriticalBonusRoll(new Roll(normalRoll.formula)).roll({async: true});

      const [normalResolved, critBonusResolved] = await Promise.all([normalPromise, critBonusPromise]);
      const critResolved = UtilsRoll.mergeRolls(normalResolved, critBonusResolved);
      if (!normalRollEvaluated) {
        dmg.normalRoll = normalResolved.toJSON();
      }
      dmg.criticalRoll = critResolved.toJSON();
      if (normalRollEvaluated) {
        // If normal was already rolled, only roll crit die
        UtilsDiceSoNice.showRoll({roll: critBonusResolved});
      } else {
        // If normal was not yet rolled, roll all dice
        UtilsDiceSoNice.showRoll({roll: critResolved});
      }
      return messageData;
    } else {
      if (dmg.normalRoll.evaluated) {
        return;
      }
  
      const dmgRoll = await Roll.fromJSON(JSON.stringify(dmg.normalRoll)).roll({async: true});
      UtilsDiceSoNice.showRoll({roll: dmgRoll});
      dmg.normalRoll = dmgRoll.toJSON();
  
      return messageData;
    }
  }

  private static async processItemDamageMode(itemIndex: number, damageIndex: number, modName: 'plus' | 'minus', messageData: ItemCardData): Promise<void | ItemCardData> {
    const dmg = messageData.items?.[itemIndex]?.damages?.[damageIndex];
    let modifier = modName === 'plus' ? 1 : -1;
    
    const order: Array<ItemCardItemData['damages'][0]['mode']> = ['normal', 'critical'];
    const newIndex = Math.max(0, Math.min(order.length-1, order.indexOf(dmg.mode) + modifier));
    if (dmg.mode === order[newIndex]) {
      return;
    }
    dmg.mode = order[newIndex];

    if (dmg.normalRoll.evaluated && (dmg.mode === 'critical' && !dmg.criticalRoll?.evaluated)) {
      const response = await UtilsChatMessage.processItemDamage(itemIndex, damageIndex, messageData);
      if (response) {
        return response;
      }
    }
    return messageData;
  }
  
  private static async applyDamage(tokenUuid: string | '*', messageData: ItemCardData, messageId: string): Promise<void | ItemCardData> {
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

    // TODO idea: popup to prompt a custom apply amount when applying to 1 token
    // TODO idea: apply all does not apply to tokens which have already received damage

    const tokenActorUpdates = new Map<string, DeepPartial<MyActorData>>();
    for (const aggregate of targetAggregates) {
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
    for (const aggregate of targetAggregates) {
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
    await UtilsDocument.updateTokenActors(tokenActorUpdates);
    return messageData;
  }

  private static calculateDamageFormulas(damages: ItemCardItemData['damages']): ItemCardItemData['damages'] {
    if (!damages) {
      return damages;
    }
    return damages.map(damage => {
      let displayFormula = damage.mode === 'critical' ? damage.criticalRoll?.formula : damage.normalRoll.formula;
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
    })
  }

  private static async calculateTargetResult(messageData: ItemCardData): Promise<ItemCardData> {
    const items = messageData.items.filter(item => item.targets?.length);

    // Prepare data
    const tokenUuidToName = new Map<string, string>();
    const rawHealthModByTargetUuid = new Map<string, number>();
    const calculatedHealthModByTargetUuid = new Map<string, number>();
    for (const item of items) {
      for (const target of item.targets) {
        target.result = {};
        tokenUuidToName.set(target.uuid, target.name || '');
        rawHealthModByTargetUuid.set(target.uuid, 0);
        calculatedHealthModByTargetUuid.set(target.uuid, 0);
      }
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
      const evaluatedDamageRolls = item.damages ? item.damages.filter(dmg => dmg.mode === 'critical' ? dmg.criticalRoll?.evaluated : dmg.normalRoll.evaluated) : [];
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

              if (UtilsChatMessage.healingDamageTypes.includes(dmgType)) {
                target.result.dmg = {
                  rawDmg: -baseDmg,
                  calcDmg: -Math.floor(baseDmg * modifier),
                }
              } else {
                target.result.dmg = {
                  rawDmg: baseDmg,
                  calcDmg: Math.floor(baseDmg * modifier),
                }
              }
            }
          }
        }
      }
    }

    // Aggregate
    const aggregates = new Map<string, ItemCardData['targetAggregate'][0]>();
    if (messageData.targetAggregate) {
      // If an aggregate was shown, make sure it will always be shown to make sure it can be reset back to the original state
      for (const oldAggregate of messageData.targetAggregate) {
        aggregates.set(oldAggregate.uuid, {
          uuid: oldAggregate.uuid,
          name: oldAggregate.name,
          img: oldAggregate.img,
          hpSnapshot: oldAggregate.hpSnapshot,
          dmg: {
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
        if (target.result.dmg) {
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
              applied: false,
              appliedDmg: 0,
              rawDmg: target.result.dmg.rawDmg,
              calcDmg: target.result.dmg.calcDmg,
              calcHp: 0,
              calcTemp: 0,
            }
          } else {
            aggregate.dmg.rawDmg = aggregate.dmg.rawDmg + target.result.dmg.rawDmg;
            aggregate.dmg.calcDmg = aggregate.dmg.calcDmg + target.result.dmg.calcDmg;
          }
        }
      }
    }

    messageData.targetAggregate = Array.from(aggregates.values()).sort((a, b) => (a.name || '').localeCompare((b.name || '')));
    for (const aggregate of messageData.targetAggregate) {
      if (aggregate.dmg) {
        let calcHp = Number(aggregate.hpSnapshot.hp);
        let calcTemp = Number(aggregate.hpSnapshot.temp);
        let calcDmg = Math.min(aggregate.dmg.calcDmg, calcHp + calcTemp);
        let calcTempDmg = Math.min(calcTemp, calcDmg);
        calcTemp -= calcTempDmg;
        calcHp = Math.max(0, calcHp - (calcDmg - calcTempDmg));
        
        aggregate.dmg = {
          applied: calcDmg === aggregate.dmg.appliedDmg,
          appliedDmg: aggregate.dmg.appliedDmg,
          rawDmg: aggregate.dmg.rawDmg,
          calcDmg: calcDmg,
          calcHp: calcHp,
          calcTemp: calcTemp,
        }
      }
    }

    messageData.allDmgApplied = messageData.targetAggregate != null && messageData.targetAggregate.filter(aggr => aggr.dmg?.applied).length === messageData.targetAggregate.length;

    return messageData;
  }

  private static getItemCardData(message: ChatMessage): ItemCardData {
    return (message.getFlag(staticValues.moduleName, 'clientTemplateData') as any)?.data;
  }

  private static generateTemplate(data: ItemCardData): Promise<string> {
    return renderTemplate(`modules/${staticValues.moduleName}/templates/item-card.hbs`, {
      staticValues: staticValues,
      data: data
    });
  }

}