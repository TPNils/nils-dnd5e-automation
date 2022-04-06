import { ElementBuilder, ElementCallbackBuilder } from "../elements/element-builder";
import { RollD20Element } from "../elements/roll-d20-element";
import { UtilsElement } from "../elements/utils-element";
import { IAfterDmlContext, IDmlContext, ITrigger } from "../lib/db/dml-trigger";
import { UtilsDocument } from "../lib/db/utils-document";
import { RunOnce } from "../lib/decorator/run-once";
import { UtilsDiceSoNice } from "../lib/roll/utils-dice-so-nice";
import { RollData, UtilsRoll } from "../lib/roll/utils-roll";
import { MemoryStorageService } from "../service/memory-storage-service";
import { staticValues } from "../static-values";
import { MyActor } from "../types/fixed-types";
import { DamageCardData, DamageCardPart } from "./damage-card-part";
import { ItemCardHelpers } from "./item-card-helpers";
import { ModularCard, ModularCardPartData, ModularCardTriggerData } from "./modular-card";
import { createPermissionCheck, CreatePermissionCheckArgs, HtmlContext, ModularCardCreateArgs, ModularCardPart } from "./modular-card-part";
import { StateContext, TargetCardData, TargetCardPart, VisualState } from "./target-card-part";

type RollPhase = 'mode-select' | 'bonus-input' | 'result';

interface TargetCache {
  targetUuid: string;
  ac: number;
  resultType?: 'hit' | 'critical-hit' | 'mis' | 'critical-mis';
  visibleToUsers: string[];
}

// TODO when expanding attack card, show the user bonus, which can be edited
//  UI => can probably solve this with slots
export interface AttackCardData {
  phase: RollPhase;
  mode: 'normal' | 'advantage' | 'disadvantage';
  userBonus: string;
  calc$: {
    actorUuid?: string;
    hasHalflingLucky: boolean;
    elvenAccuracy: boolean;
    rollBonus?: string;
    requestRollFormula?: string;
    roll?: RollData;
    critTreshold: number;
    isCrit?: boolean;
    targetCaches: TargetCache[]
  }
}

export class AttackCardPart implements ModularCardPart<AttackCardData> {

  public static readonly instance = new AttackCardPart();
  private constructor(){}

  public create({item, actor}: ModularCardCreateArgs): AttackCardData {
    if (!['mwak', 'rwak', 'msak', 'rsak'].includes(item?.data?.data?.actionType)) {
      return null;
    }
    const bonus = ['@mod'];

    // Add proficiency bonus if an explicit proficiency flag is present or for non-item features
    if ( !["weapon", "consumable"].includes(item.data.data.type) || item.data.proficient ) {
      bonus.push("@prof");
    }

    const rollData: {[key: string]: any} = actor == null ? {} : item.getRollData();
    if (item.data.data.prof?.hasProficiency) {
      rollData.prof = item.data.data.prof.term;
    }

    // Item bonus
    if (item.data.data.attackBonus) {
      bonus.push(String(item.data.data.attackBonus));
    }

    // Actor bonus
    const actorBonus = actor?.data?.data?.bonuses?.[item.data.data.actionType]?.attack;
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
    const attack: AttackCardData = {
      mode: 'normal',
      phase: 'mode-select',
      userBonus: "",
      calc$: {
        targetCaches: [],
        elvenAccuracy: actor?.getFlag("dnd5e", "elvenAccuracy") === true && ["dex", "int", "wis", "cha"].includes(item.abilityMod),
        hasHalflingLucky: actor?.getFlag("dnd5e", "halflingLucky") === true,
        actorUuid: actor?.uuid,
        rollBonus: new Roll(bonus.filter(b => b !== '0' && b.length > 0).join(' + '), rollData).toJSON().formula,
        critTreshold: 20
      }
    };

    let critTreshold = item.data.data.critical?.threshold ?? attack.calc$.critTreshold;
    const actorDnd5eFlags = actor?.data?.flags?.dnd5e;
    if (item.type === 'weapon' && actorDnd5eFlags?.weaponCriticalThreshold != null) {
      critTreshold = Math.min(critTreshold, actor.data.flags.dnd5e.weaponCriticalThreshold);
    }
    if (item.type === 'spell' && actorDnd5eFlags?.spellCriticalThreshold != null) {
      critTreshold = Math.min(critTreshold, actor.data.flags.dnd5e.spellCriticalThreshold);
    }
    attack.calc$.critTreshold = critTreshold;

    return attack;
  }

  public refresh(oldData: AttackCardData, args: ModularCardCreateArgs): AttackCardData {
    const results: AttackCardData[] = [];
    const newData = this.create(args);

    if (!newData) {
      return null;
    }
    if (!oldData) {
      return newData;
    }

    const result = deepClone(oldData);
    result.calc$ = newData.calc$;
    result.calc$.roll = oldData.calc$.roll;// contains already rolled dice which should not be discarded
    results.push(result);
    return result;
  }

  @RunOnce()
  public registerHooks(): void {
    const permissionCheck = createPermissionCheck<{part: {data: AttackCardData}}>(({part}) => {
      const documents: CreatePermissionCheckArgs['documents'] = [];
      if (part.data.calc$.actorUuid) {
        documents.push({uuid: part.data.calc$.actorUuid, permission: 'OWNER', security: true});
      }
      return {documents: documents};
    })
    new ElementBuilder()
      .listenForAttribute('data-part-id', 'string')
      .listenForAttribute('data-message-id', 'string')
      .addListener(new ElementCallbackBuilder()
        .setEvent('click')
        .addSelectorFilter('[data-action="roll"]')
        .addSerializer(ItemCardHelpers.getChatPartIdSerializer())
        .addSerializer(ItemCardHelpers.getUserIdSerializer())
        .addSerializer(ItemCardHelpers.getMouseEventSerializer())
        .addEnricher(ItemCardHelpers.getChatPartEnricher<AttackCardData>())
        .setPermissionCheck(permissionCheck)
        .setExecute(({messageId, part, click, allCardParts}) => {
          if (part.data.phase === 'result') {
            return;
          }
      
          const orderedPhases: RollPhase[] = ['mode-select', 'bonus-input', 'result'];
          if (click.shiftKey) {
            part.data.phase = orderedPhases[orderedPhases.length - 1];
          } else {
            part.data.phase = orderedPhases[orderedPhases.indexOf(part.data.phase) + 1];
          }
          return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
        })
      )
      .addListener(new ElementCallbackBuilder()
        .setEvent('focusout')
        .addSelectorFilter('input[data-action="user-bonus"]')
        .addFilter(({event}) => {
          if (event.relatedTarget instanceof HTMLElement) {
            // Do not fire this if roll is pressed (focusout triggers first)
            return event.relatedTarget.closest(`[data-action="roll"]`) != null;
          }
          return false;
        })
        .addSerializer(ItemCardHelpers.getChatPartIdSerializer())
        .addSerializer(ItemCardHelpers.getUserIdSerializer())
        .addSerializer(context => ({inputValue: (context.event.target as HTMLInputElement).value}))
        .addEnricher(ItemCardHelpers.getChatPartEnricher<AttackCardData>())
        .setPermissionCheck(permissionCheck)
        .setExecute(({messageId, allCardParts, part, inputValue}) => {
          if (inputValue && !Roll.validate(inputValue)) {
            // Only show error on key press
            throw new Error(game.i18n.localize('Error') + ': ' + game.i18n.localize('Roll Formula'));
          }
          part.data.phase = 'mode-select';
          part.data.userBonus = inputValue ?? '';
          return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
        })
      )
      .addListener(new ElementCallbackBuilder()
        .setEvent('keyup')
        .addSelectorFilter('input[data-action="user-bonus"]')
        .addSerializer(ItemCardHelpers.getChatPartIdSerializer())
        .addSerializer(ItemCardHelpers.getUserIdSerializer())
        .addSerializer(ItemCardHelpers.getKeyEventSerializer())
        .addSerializer(ItemCardHelpers.getInputSerializer())
        .addEnricher(ItemCardHelpers.getChatPartEnricher<AttackCardData>())
        .setPermissionCheck(permissionCheck)
        .setExecute(({messageId, allCardParts, part, keyEvent, inputValue}) => {
          if (keyEvent.key === 'Enter') {
            const userBonus = inputValue == null ? '' : inputValue;
            if (userBonus && !Roll.validate(userBonus)) {
              // Only show error on key press
              throw new Error(game.i18n.localize('Error') + ': ' + game.i18n.localize('Roll Formula'));
            }
            part.data.phase = 'result';
            part.data.userBonus = userBonus;
            return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
          } else if (keyEvent.key === 'Escape' && part.data.phase === 'bonus-input') {
            part.data.phase = 'mode-select';
            return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
          }
        })
      )
      .addListener(new ElementCallbackBuilder()
        .setEvent('click')
        .addSelectorFilter('[data-action="mode-minus"], [data-action="mode-plus"]')
        .addSerializer(ItemCardHelpers.getChatPartIdSerializer())
        .addSerializer(ItemCardHelpers.getUserIdSerializer())
        .addSerializer(ItemCardHelpers.getMouseEventSerializer())
        .addSerializer(ItemCardHelpers.getActionSrializer())
        .addEnricher(ItemCardHelpers.getChatPartEnricher<AttackCardData>())
        .setPermissionCheck(permissionCheck)
        .setExecute(({messageId, allCardParts, part, click, action}) => {
          let modifier = action === 'mode-plus' ? 1 : -1;
          if (click.shiftKey && modifier > 0) {
            modifier++;
          } else if (click.shiftKey && modifier < 0) {
            modifier--;
          }
          
          const order: Array<AttackCardData['mode']> = ['disadvantage', 'normal', 'advantage'];
          const newIndex = Math.max(0, Math.min(order.length-1, order.indexOf(part.data.mode) + modifier));
          if (part.data.mode === order[newIndex]) {
            return;
          }
          part.data.mode = order[newIndex];

          if (click.shiftKey) {
            part.data.phase = 'result';
          }
          return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
        })
      )
      .addOnAttributeChange(async ({element, attributes}) => {
        return ItemCardHelpers.ifAttrData({attr: attributes, element, type: this, callback: async ({part}) => {
          const d20attributes = {
            ['data-roll']: part.data.calc$.roll,
            ['data-bonus-formula']: part.data.userBonus,
            ['data-show-bonus']: part.data.phase === 'bonus-input',
            ['data-label']: 'DND5E.Attack',
            ['data-override-max-roll']: part.data.calc$.critTreshold,
          };
          if (part.data.calc$.actorUuid) {
            d20attributes['data-interaction-permission'] = `OwnerUuid:${part.data.calc$.actorUuid}`
          }
          const attributeArray: string[] = [];
          for (let [attr, value] of Object.entries(d20attributes)) {
            attributeArray.push(`${attr}="${UtilsElement.serializeAttr(value)}"`);
          }
          element.innerHTML = `<${RollD20Element.selector()} ${attributeArray.join(' ')}></${RollD20Element.selector()}>`;
        }});
      })
      .build(this.getSelector())
    
    ModularCard.registerModularCardPart(staticValues.moduleName, this);
    ModularCard.registerModularCardTrigger(new AttackCardTrigger());
    TargetCardPart.instance.registerIntegration({
      getVisualState: context => this.getTargetState(context),
    });
  }

  public getType(): string {
    return this.constructor.name;
  }

  //#region Front end
  public getSelector(): string {
    return `${staticValues.code}-attack-part`;
  }

  public getHtml(data: HtmlContext): string {
    // TODO technically, you would roll an attack for each target
    return `<${this.getSelector()} data-part-id="${data.partId}" data-message-id="${data.messageId}"></${this.getSelector()}>`
  }
  //#endregion

  //#region Targeting
  private getTargetState(context: StateContext): VisualState[] {
    const visualStates: VisualState[] = [];

    const rolledAttacks: ModularCardPartData<AttackCardData>[] = context.allMessageParts.filter(part => part.type === this.getType() && ModularCard.getTypeHandler(part.type) instanceof AttackCardPart);
    if (rolledAttacks.length === 0) {
      return [];
    }

    const cache = this.getTargetCache(rolledAttacks.map(attack => attack.data));
    for (let i = 0; i < rolledAttacks.length; i++) {
      const attack = rolledAttacks[i];
      // TODO either this should be a (mini) template to use permission check 
      //      or permissions should be configured via the columns
      for (const selected of context.selected) {
        let rowValue: string;
        if (!attack.data.calc$.roll?.evaluated || !cache.has(selected.tokenUuid) || !cache.get(selected.tokenUuid).visibleToUsers.includes(game.userId)) {
          if (attack.data.calc$.roll?.evaluated) {
            rowValue = '';
          } else {
            rowValue = '';
          }
        } else {
          const styles = ['text-align: center'];
          switch (cache.get(selected.tokenUuid).resultType) {
            case 'critical-hit': {
              styles.push('color: green');
              rowValue = `<div style="${styles.join(';')};" title="${game.i18n.localize('DND5E.CriticalHit')}!">✓</div>`;
              break;
            }
            case 'critical-mis': {
              // TODO not great localization, should probably add my own
              styles.push('color: red');
              rowValue = `<div style="${styles.join(';')};" title="${game.i18n.localize('Minimum')}!">✗</div>`;
              break;
            }
            case 'hit': {
              styles.push('color: green');
              rowValue = `<div style="${styles.join(';')};" title="${game.i18n.localize('DND5E.AC')}: ${cache.get(selected.tokenUuid).ac} <= ${attack.data.calc$.roll?.total}">✓</div>`;
              break;
            }
            case 'mis': {
              styles.push('color: red');
              rowValue = `<div style="${styles.join(';')};" title="${game.i18n.localize('DND5E.AC')}: ${cache.get(selected.tokenUuid).ac} <= ${attack.data.calc$.roll?.total}">✗</div>`;
              break;
            }
          }
        }
        visualStates.push({
          selectionId: selected.selectionId,
          tokenUuid: selected.tokenUuid,
          columns: [{
            key: `${this.getType()}-attack-${i}`,
            label: `<div style="font-size: 16px;" title="${game.i18n.localize('DND5E.Attack')}">
            <svg height="1em" width="1em">
              <use xlink:href="/modules/${staticValues.moduleName}/assets/icons/sword.svg#sword"/>
            </svg>
            </div> ${(rolledAttacks.length === 1) ? '' : ` ${i+1}`}`,
            rowValue: rowValue,
          }],
        })
      }
    }

    return visualStates;
  }

  private getTargetCache(caches: AttackCardData[]): Map<string, TargetCache> {
    const cacheByUuid = new Map<string, TargetCache>();
    for (const cache of caches) {
      for (const targetCache of cache.calc$.targetCaches) {
        cacheByUuid.set(targetCache.targetUuid, targetCache);
      }
    }
    return cacheByUuid;
  }
  //#endregion

}

class AttackCardTrigger implements ITrigger<ModularCardTriggerData> {

  //#region beforeUpsert
  public beforeUpsert(context: IDmlContext<ModularCardTriggerData<any>>): boolean | void {
    this.calcIsCrit(context);
    this.setDamageAsCrit(context);
    this.calcResultCache(context);
  }

  private calcIsCrit(context: IDmlContext<ModularCardTriggerData>): void {
    for (const {newRow} of context.rows) {
      if (!this.isThisType(newRow)) {
        continue;
      }

      if (!newRow.data.calc$.roll?.evaluated) {
        newRow.data.calc$.isCrit = false;
        continue;
      }

      const baseRollResult = newRow.data.calc$.roll.terms[0].results.filter(result => result.active)[0];
      newRow.data.calc$.isCrit = baseRollResult?.result >= newRow.data.calc$.critTreshold;
    }
  }

  private setDamageAsCrit(context: IDmlContext<ModularCardTriggerData>): void {
    const messagesBecameCrit = new Set<string>();
    const messagesBecameNormal = new Set<string>();
    for (const {newRow, oldRow} of context.rows) {
      if (!this.isThisType(newRow)) {
        continue;
      }
      if (newRow.data.calc$.isCrit !== oldRow?.data?.calc$?.isCrit) {
        if (newRow.data.calc$.isCrit) {
          messagesBecameCrit.add(newRow.messageId);
        } else {
          messagesBecameNormal.add(newRow.messageId);
        }
      }
    }
    messagesBecameCrit.delete(null);
    messagesBecameCrit.delete(undefined);
    messagesBecameNormal.delete(null);
    messagesBecameNormal.delete(undefined);

    if (messagesBecameCrit.size === 0 && messagesBecameNormal.size === 0) {
      return;
    }

    for (const {newRow} of context.rows) {
      if (!messagesBecameCrit.has(newRow.messageId) && !messagesBecameNormal.has(newRow.messageId)) {
        continue;
      }

      if (!this.isAnyDamageType(newRow)) {
        continue;
      }

      if (newRow.data.phase === 'mode-select') {
        if (messagesBecameCrit.has(newRow.messageId)) {
          newRow.data.mode = 'critical';
        } else {
          newRow.data.mode = 'normal';
        }
      }
    }
  }

  private calcResultCache(context: IDmlContext<ModularCardTriggerData>): void {
    for (const {newRow} of context.rows) {
      if (!this.isThisType(newRow) || !this.assumeThisType(newRow)) {
        continue;
      }

      for (const targetCache of newRow.data.calc$.targetCaches) {
        if (newRow.data.calc$.roll?.evaluated) {
          const firstRoll = newRow.data.calc$.roll.terms[0].results.find(r => r.active);
          if (firstRoll.result === 20 || targetCache.ac <= newRow.data.calc$.roll.total) {
            // 20 always hits, lower crit treshold does not
            if (firstRoll.result >= newRow.data.calc$.critTreshold) {
              targetCache.resultType = 'critical-hit';
            } else {
              targetCache.resultType = 'hit';
            }
          } else if (firstRoll.result === 1) {
            targetCache.resultType = 'critical-mis';
          } else {
            targetCache.resultType = 'mis';
          }
        } else if (targetCache.resultType) {
          delete targetCache.resultType;
        }
      }
    }
  }
  //#endregion

  //#region upsert
  public async upsert(context: IAfterDmlContext<ModularCardTriggerData>): Promise<void> {
    await this.calcAttackRoll(context);
    await this.rollAttack(context);
    await this.addTargetCache(context);
  }

  private async calcAttackRoll(context: IDmlContext<ModularCardTriggerData>): Promise<void> {
    for (const {newRow} of context.rows) {
      if (!this.isThisType(newRow)) {
        continue;
      }

      let baseRoll = new Die({faces: 20, number: 1});
      if (newRow.data.calc$.hasHalflingLucky) {
        // reroll a base roll 1 once
        // first 1 = maximum reroll 1 die not both at (dis)advantage (see PHB p173)
        // second 2 = reroll when the roll result is equal to 1 (=1)
        baseRoll.modifiers.push('r1=1');
      }
      switch (newRow.data.mode) {
        case 'advantage': {
          if (newRow.data.calc$.elvenAccuracy) {
            baseRoll.number = 3;
          } else {
            baseRoll.number = 2;
          }
          baseRoll.modifiers.push('kh');
          break;
        }
        case 'disadvantage': {
          baseRoll.number = 2;
          baseRoll.modifiers.push('kl');
          break;
        }
      }
      const parts: string[] = [baseRoll.formula];
      if (newRow.data.calc$.rollBonus) {
        parts.push(newRow.data.calc$.rollBonus);
      }
      
      if (newRow.data.userBonus && Roll.validate(newRow.data.userBonus)) {
        parts.push(newRow.data.userBonus);
      }

      newRow.data.calc$.requestRollFormula = UtilsRoll.simplifyTerms(new Roll(parts.join(' + '))).formula;
    }
  }

  private async rollAttack(context: IDmlContext<ModularCardTriggerData>): Promise<void> {
    for (const {newRow, oldRow} of context.rows) {
      if (!this.isThisType(newRow) || !this.assumeThisType(oldRow)) {
        continue;
      }

      if (newRow.data.calc$.requestRollFormula !== oldRow?.data?.calc$?.requestRollFormula) {
        if (!newRow.data.calc$.roll) {
          newRow.data.calc$.roll = UtilsRoll.toRollData(new Roll(newRow.data.calc$.requestRollFormula));
        } else {
          const oldRoll = UtilsRoll.fromRollData(newRow.data.calc$.roll);
          const result = await UtilsRoll.setRoll(oldRoll, newRow.data.calc$.requestRollFormula);
          newRow.data.calc$.roll = UtilsRoll.toRollData(result.result);
          if (result.rollToDisplay) {
            // Auto rolls if original roll was already evaluated
            UtilsDiceSoNice.showRoll({roll: result.rollToDisplay});
          }
        }
      }

      // Execute initial roll
      if ((newRow.data.phase === 'result') !== newRow.data.calc$.roll?.evaluated) {
        const roll = UtilsRoll.fromRollData(newRow.data.calc$.roll);
        newRow.data.calc$.roll = UtilsRoll.toRollData(await roll.roll({async: true}));
        UtilsDiceSoNice.showRoll({roll: roll});
      }
    }
  }
  
  private async addTargetCache(context: IDmlContext<ModularCardTriggerData>): Promise<void> {
    const partsByMessageId = new Map<string, ModularCardTriggerData[]>();
    for (const {newRow} of context.rows) {
      if (!partsByMessageId.has(newRow.messageId)) {
        partsByMessageId.set(newRow.messageId, []);
      }
      partsByMessageId.get(newRow.messageId).push(newRow);
    }

    const missingTargetUuids = new Set<string>();
    for (const rows of partsByMessageId.values()) {
      const allTargetUuids = new Set<string>();
      const cachedTargetUuids = new Set<string>();
      for (const row of rows) {
        if (this.isAnyTargetType(row)) {
          for (const selected of row.data.selected) {
            allTargetUuids.add(selected.tokenUuid);
          }
        }

        if (this.isThisType(row) && this.assumeThisType(row)) {
          for (const target of row.data.calc$.targetCaches) {
            cachedTargetUuids.add(target.targetUuid);
          }
        }
      }

      for (const expectedUuid of allTargetUuids) {
        if (!cachedTargetUuids.has(expectedUuid)) {
          missingTargetUuids.add(expectedUuid);
        }
      }
    }

    if (missingTargetUuids.size === 0) {
      return;
    }

    // Cache the values of the tokens
    const tokens = await UtilsDocument.tokenFromUuid(missingTargetUuids);
    for (const rows of partsByMessageId.values()) {
      const allTargetUuids = new Set<string>();
      for (const row of rows) {
        if (this.isAnyTargetType(row)) {
          for (const selected of row.data.selected) {
            allTargetUuids.add(selected.tokenUuid);
          }
        }
      }

      for (const row of rows) {
        if (this.isThisType(row) && this.assumeThisType(row)) {
          const cachedTargetUuids = new Set<string>();
          for (const target of row.data.calc$.targetCaches) {
            cachedTargetUuids.add(target.targetUuid);
          }

          for (const expectedUuid of allTargetUuids) {
            if (!cachedTargetUuids.has(expectedUuid)) {
              const actor = (tokens.get(expectedUuid).getActor() as MyActor);
              row.data.calc$.targetCaches.push({
                targetUuid: expectedUuid,
                ac: actor.data.data.attributes.ac.value,
                visibleToUsers: Array.from(game.users.values()).filter(user => actor.testUserPermission(user, 'OWNER')).map(user => user.id),
              });
              cachedTargetUuids.add(expectedUuid);
            }
          }
        }
      }
    }
  }
  //#endregion

  //#region afterUpdate
  public afterUpdate(context: IAfterDmlContext<ModularCardTriggerData<any>>): void | Promise<void> {
    this.onBonusChange(context);
  }
  
  private onBonusChange(context: IDmlContext<ModularCardTriggerData>): void {
    for (const {newRow, oldRow, changedByUserId} of context.rows) {
      if (changedByUserId !== game.userId || !this.isThisType(newRow)) {
        continue;
      }
      if (newRow.data.phase === 'bonus-input' && (oldRow?.data as AttackCardData)?.phase !== 'bonus-input') {
        MemoryStorageService.setFocusedElementSelector(`${AttackCardPart.instance.getSelector()}[data-message-id="${newRow.messageId}"][data-part-id="${newRow.id}"] input.user-bonus`);
        return;
      }
    }
  }
  //#endregion 
  
  //#region helpers
  private isThisType(row: ModularCardTriggerData): row is ModularCardTriggerData<AttackCardData> {
    if (row.type !== AttackCardPart.instance.getType()) {
      return false;
    }
    if (row.typeHandler) {
      return row.typeHandler instanceof AttackCardPart;
    }
    return ModularCard.getTypeHandler(row.type) instanceof AttackCardPart;
  }

  private isAnyTargetType(row: ModularCardTriggerData): row is ModularCardTriggerData<TargetCardData> {
    return row.typeHandler instanceof TargetCardPart;
  }

  private isAnyDamageType(row: ModularCardTriggerData): row is ModularCardTriggerData<DamageCardData> {
    return row.typeHandler instanceof DamageCardPart;
  }

  private assumeThisType(row: ModularCardTriggerData): row is ModularCardTriggerData<AttackCardData> {
    return true;
  }
  //#endregion

}