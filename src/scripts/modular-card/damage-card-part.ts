import { IAfterDmlContext, IDmlContext, ITrigger} from "../lib/db/dml-trigger";
import { FoundryDocument, UtilsDocument } from "../lib/db/utils-document";
import { RunOnce } from "../lib/decorator/run-once";
import { UtilsDiceSoNice } from "../lib/roll/utils-dice-so-nice";
import { RollData, TermData, UtilsRoll } from "../lib/roll/utils-roll";
import { UtilsObject } from "../lib/utils/utils-object";
import { MemoryStorageService } from "../service/memory-storage-service";
import { staticValues } from "../static-values";
import { DamageType, MyActor, MyItem } from "../types/fixed-types";
import { AttackCardData, AttackCardPart } from "./attack-card-part";
import { ClickEvent, createElement, ICallbackAction, KeyEvent } from "./card-part-element";
import { ItemCardHelpers } from "./item-card-helpers";
import { ModularCard, ModularCardPartData, ModularCardTriggerData } from "./modular-card";
import { createPermissionCheck, CreatePermissionCheckArgs, HtmlContext, ModularCardCreateArgs, ModularCardPart } from "./modular-card-part";
import { State, StateContext, TargetCallbackData, TargetCardData, TargetCardPart, VisualState } from "./target-card-part";

export interface AddedDamage {
  normalRoll: TermData[];
  additionalCriticalRoll?: TermData[];
}

interface TargetCache {
  targetUuid: string;
  smartState: State['state'];
  appliedState: State['state'];
  // What has actually been applied, accounting the current hp at the time when applied
  appliedFailedDeathSaved?: number;
  appliedHpChange?: number;
  appliedTmpHpChange?: number;
  // What a calculation thinks should be applied, not accounting for current hp
  calcFailedDeathSaved: number;
  calcHpChange: number;
  calcAddTmpHp: number;
}

export interface DamageCardData {
  phase: 'mode-select' | 'bonus-input' | 'result';
  mode: 'normal' | 'critical';
  userBonus?: RollData;
  calc$: {
    actorUuid?: string;
    label: string;
    modfierRule?: 'save-full-dmg' | 'save-halve-dmg' | 'save-no-dmg';
    baseRoll: TermData[];
    upcastRoll?: TermData[];
    actorBonusRoll?: TermData[];
    roll?: RollData;
    displayFormula?: string;
    displayDamageTypes?: string;
    targetCaches: TargetCache[]
  }
}

function setTargetCache(cache: DamageCardData, targetCache: TargetCache): void {
  if (!cache.calc$.targetCaches) {
    cache.calc$.targetCaches = [];
  }
  for (let i = 0; i < cache.calc$.targetCaches.length; i++) {
    if (cache.calc$.targetCaches[i].targetUuid === targetCache.targetUuid) {
      cache.calc$.targetCaches[i] = targetCache;
      return;
    }
  }
  cache.calc$.targetCaches.push(targetCache);
}

function getTargetCache(cache: DamageCardData, tokenUuid: string): TargetCache | null {
  if (!cache.calc$.targetCaches) {
    return null;
  }
  for (const targetCache of cache.calc$.targetCaches) {
    if (targetCache.targetUuid === tokenUuid) {
      return targetCache;
    }
  }
  return null;
}

export class DamageCardPart implements ModularCardPart<DamageCardData> {

  public static readonly instance = new DamageCardPart();
  private constructor(){}

  public async create({item, actor}: {item: MyItem, actor?: MyActor}): Promise<DamageCardData[]> {
    // TODO what about other interactions like spell scaling (modifier with html) and hunters mark (automatic, but only to a specific target)
    const rollData: {[key: string]: any} = actor == null ? {} : item.getRollData();
    if (item.data.data.prof?.hasProficiency) {
      rollData.prof = item.data.data.prof.term;
    }

    const inputDamages: Array<DamageCardData> = [];
    // Main damage
    const damageParts = item.data.data.damage?.parts;
    let mainDamage: typeof inputDamages[0];
    if (damageParts && damageParts.length > 0) {
      mainDamage = {
        mode: 'normal',
        phase: 'mode-select',
        calc$: {
          label: 'DND5E.Damage',
          baseRoll: UtilsRoll.toRollData(UtilsRoll.damagePartsToRoll(damageParts, rollData)).terms,
          targetCaches: [],
        }
      }
      // Consider it healing if all damage types are healing
      const isHealing = damageParts.filter(roll => ItemCardHelpers.healingDamageTypes.includes(roll[1])).length === damageParts.length;
      if (isHealing) {
        mainDamage.calc$.label = 'DND5E.Healing';
      }
      inputDamages.push(mainDamage);
    }

    // Versatile damage
    if (mainDamage && item.data.data.damage?.versatile) {
      const versatileDamage = deepClone(mainDamage);
      versatileDamage.calc$.label = 'DND5E.Versatile';
      versatileDamage.calc$.baseRoll = UtilsRoll.toRollData(new Roll(item.data.data.damage.versatile, rollData)).terms;
      inputDamages.push(versatileDamage);
    }

    // Spell scaling
    const scaling = item.data.data.scaling;
    if (scaling?.mode === 'level' && scaling.formula) {
      const originalItem = await UtilsDocument.itemFromUuid(item.uuid);
      if (originalItem && item.data.data.level > originalItem.data.data.level) {
        const upcastLevels = item.data.data.level - originalItem.data.data.level;
        const scalingRollJson: TermData[] = UtilsRoll.toRollData(new Roll(scaling.formula, rollData).alter(upcastLevels, 0)).terms;
        if (inputDamages.length === 0) {
          // when only dealing damage by upcasting? not sure if that ever happens
          inputDamages.push({
            mode: 'normal',
            phase: 'mode-select',
            calc$: {
              label: 'DND5E.Damage',
              baseRoll: UtilsRoll.toRollData(new Roll('0')).terms,
              targetCaches: [],
            }
          });
        }
        for (const damage of inputDamages) {
          damage.calc$.upcastRoll = scalingRollJson;
        }
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
            calc$: {
              label: 'DND5E.Damage',
              baseRoll: UtilsRoll.toRollData(new Roll('0')).terms,
              targetCaches: [],
            }
          });
        }

        for (const damage of inputDamages) {
          // DND5e spell compendium has cantrip formula empty => default to the base damage formula
          const scalingRoll = new Roll(scaling.formula == null || scaling.formula.length === 0 ? Roll.getFormula(damage.calc$.baseRoll.map(RollTerm.fromData)) : scaling.formula, rollData).alter(applyScalingXTimes, 0, {multiplyNumeric: true});
          // Override normal roll since cantrip scaling is static, not dynamic like level scaling
          damage.calc$.baseRoll = UtilsRoll.toRollData(UtilsRoll.mergeRolls(UtilsRoll.fromRollTermData(damage.calc$.baseRoll), scalingRoll)).terms;
        }
      }
    }
    
    // Add damage bonus formula
    if (inputDamages.length > 0) {
      const actorBonus = actor.data.data.bonuses?.[item.data.data.actionType];
      if (actorBonus?.damage && parseInt(actorBonus.damage) !== 0) {
        for (const damage of inputDamages) {
          damage.calc$.actorBonusRoll = UtilsRoll.toRollData(new Roll(actorBonus.damage, rollData)).terms;
        }
      }
    }

    if (actor) {
      for (const dmg of inputDamages) {
        dmg.calc$.actorUuid = actor.uuid;
      }
    }
    
    return inputDamages;
  }

  public async refresh(oldDatas: DamageCardData[], args: ModularCardCreateArgs): Promise<DamageCardData[]> {
    const results: DamageCardData[] = [];
    const newCreated = await this.create(args);
    for (let i = 0; i < newCreated.length; i++) {
      const newData = newCreated.length < i ? newCreated[i] : null;
      const oldData = oldDatas.length < i ? oldDatas[i] : null;

      if (!oldData) {
        results.push(newData);
        continue;
      }

      const result = deepClone(oldData);
      result.calc$ = newData.calc$;
      result.calc$.roll = oldData.calc$.roll;// contains already rolled dice which should not be discarded
      results.push(result);
    }
    return results;
  }

  @RunOnce()
  public registerHooks(): void {
    createElement({
      selector: this.getSelector(),
      getHtml: context => this.getElementHtml(context),
      getCallbackActions: () => this.getCallbackActions(),
    });
    ModularCard.registerModularCardPart(staticValues.moduleName, this);
    ModularCard.registerModularCardTrigger(new DamageCardTrigger());
    TargetCardPart.instance.registerIntegration({
      onChange: event => this.targetCallback(event),
      getState: context => this.getTargetState(context),
      getVisualState: context => this.getTargetState(context),
    })
  }

  public getType(): string {
    return this.constructor.name;
  }

  //#region Front end
  public getSelector(): string {
    return `${staticValues.code}-damage-part`;
  }

  public getHtml(data: HtmlContext): string {
    return `<${this.getSelector()} data-part-id="${data.partId}" data-message-id="${data.messageId}"></${this.getSelector()}>`
  }

  public getElementHtml({data}: HtmlContext<DamageCardData>): string | Promise<string> {
    return renderTemplate(
      `modules/${staticValues.moduleName}/templates/modular-card/damage-part.hbs`, {
        data: data,
        moduleName: staticValues.moduleName
      }
    );
  }

  public getCallbackActions(): ICallbackAction<DamageCardData>[] {
    const permissionCheck = createPermissionCheck<DamageCardData>(({data}) => {
      const documents: CreatePermissionCheckArgs['documents'] = [];
      if (data.calc$.actorUuid) {
        documents.push({uuid: data.calc$.actorUuid, permission: 'OWNER'});
      }
      return {documents: documents};
    })

    return [
      {
        regex: /^item-damage$/,
        permissionCheck: permissionCheck,
        execute: ({data, clickEvent}) => this.processNextPhase(data, clickEvent),
      },
      {
        regex: /^item-damage-bonus$/,
        permissionCheck: permissionCheck,
        execute: ({data, keyEvent, inputValue}) => this.processDamageBonus(data, keyEvent, inputValue as string),
      },
      {
        regex: /^item-damage-mode-(minus|plus)$/,
        permissionCheck: permissionCheck,
        execute: ({data, clickEvent, regexResult}) => this.processDamageMode(data, clickEvent, regexResult[1] as ('plus' | 'minus')),
      },
    ]
  }

  private async processNextPhase(data: DamageCardData,event: ClickEvent | null): Promise<void> {
    if (data.phase === 'result') {
      return;
    }

    const orderedPhases: DamageCardData['phase'][] = ['mode-select', 'bonus-input', 'result'];
    if (event?.shiftKey) {
      data.phase = orderedPhases[orderedPhases.length - 1];
    } else {
      data.phase = orderedPhases[orderedPhases.indexOf(data.phase) + 1];
    }
  }

  private async processDamageMode(data: DamageCardData, event: ClickEvent, modName: 'plus' | 'minus'): Promise<void> {
    let modifier = modName === 'plus' ? 1 : -1;
    
    const order: Array<DamageCardData['mode']> = ['normal', 'critical'];
    const newIndex = Math.max(0, Math.min(order.length-1, order.indexOf(data.mode) + modifier));
    if (data.mode === order[newIndex]) {
      return;
    }
    data.mode = order[newIndex];

    if (event.shiftKey) {
      data.phase = 'result';
    }
  }
  
  private async processDamageBonus(data: DamageCardData, keyEvent: KeyEvent | null, damageBonus: string): Promise<void> {
    if (keyEvent?.key === 'Escape') {
      data.phase = 'mode-select';
      return;
    }

    if (damageBonus) {
      if (!Roll.validate(damageBonus) && keyEvent) {
        // Only show error on key press
        throw new Error(game.i18n.localize('Error') + ': ' + game.i18n.localize('Roll Formula'));
      }
      data.userBonus = UtilsRoll.toRollData(new Roll(damageBonus));
    } else {
      delete data.userBonus;
    }

    if (keyEvent?.key === 'Enter') {
      data.phase = 'result';
    } 
  }
  //#endregion

  //#region Targeting
  private async targetCallback(targetEvents: TargetCallbackData[]): Promise<void> {
    const tokenDocuments = await UtilsDocument.tokenFromUuid(targetEvents.map(d => d.targetUuid));
    let tokenHpSnapshot = new Map<string, {hp: number; failedDeathSaves: number; maxHp: number; tempHp: number}>();
    for (const token of tokenDocuments.values()) {
      const actor: MyActor = token.getActor();
      tokenHpSnapshot.set(token.uuid, {
        hp: actor.data.data.attributes.hp.value,
        failedDeathSaves: actor.data.data.attributes.death.failure,
        maxHp: actor.data.data.attributes.hp.max,
        tempHp: actor.data.data.attributes.hp.temp ?? 0,
      });
    }
    for (const targetEvent of targetEvents) {
      const snapshot = tokenHpSnapshot.get(targetEvent.targetUuid);
      const tokenHp = deepClone(snapshot);
      
      const attackCards: ModularCardPartData<AttackCardData>[] = targetEvent.messageCardParts
        .filter(part => ModularCard.getTypeHandler(part.type) instanceof AttackCardPart)
      const damagesCards: ModularCardPartData<DamageCardData>[] = targetEvent.messageCardParts
        .filter(part => part.type === this.getType() && ModularCard.getTypeHandler(part.type) instanceof DamageCardPart)

      // Undo already applied damage
      for (const dmg of damagesCards) {
        const cache = getTargetCache(dmg.data, targetEvent.targetUuid);
        if (!cache) {
          continue;
        }
        if (cache.appliedHpChange) {
          tokenHp.hp -= cache.appliedHpChange;
        }
        if (cache.appliedTmpHpChange) {
          tokenHp.tempHp -= cache.appliedTmpHpChange;
        }
        if (cache.appliedFailedDeathSaved) {
          tokenHp.failedDeathSaves -= cache.appliedFailedDeathSaved;
        }
      }

      // Calculate (new) damage
      for (const dmg of damagesCards) {
        const cache = deepClone(getTargetCache(dmg.data, targetEvent.targetUuid));
        let apply = false;
        cache.smartState = 'not-applied';
        switch (targetEvent.apply) {
          case 'smart-apply': {
            const allHit = attackCards.every(attack => {
              const hitType = attack.data.calc$.targetCaches.find(target => target.targetUuid === targetEvent.targetUuid)?.resultType;
              return hitType === 'hit' || hitType === 'critical-hit';
            });
            cache.smartState = 'applied';
            if (!allHit) {
              apply = false;
              break;
            }
            apply = true;
            break;
          }
          case 'force-apply': {
            apply = true;
            break;
          }
          case 'undo': {
            apply = false;
            break;
          }
        }

        if (apply) {
          const maxHp = Math.max(snapshot.maxHp, snapshot.hp);
          const beforeApplyTokenHp = deepClone(tokenHp);

          tokenHp.tempHp += cache.calcAddTmpHp;
          let hpChange = cache.calcHpChange;
          if (tokenHp.tempHp > 0 && hpChange < 0) {
            const dmgTempHp = Math.min(tokenHp.tempHp, -hpChange);
            tokenHp.tempHp -= dmgTempHp;
            hpChange += dmgTempHp;
          }
          tokenHp.hp += hpChange;
          tokenHp.failedDeathSaves += cache.calcFailedDeathSaved;
          
          // Stay within the min/max bounderies
          tokenHp.hp = Math.max(0, Math.min(tokenHp.hp, maxHp));
          tokenHp.tempHp = Math.max(0, tokenHp.tempHp);
          
          const hpDiff = tokenHp.hp - beforeApplyTokenHp.hp;
          const tempHpDiff = tokenHp.tempHp - beforeApplyTokenHp.tempHp;
          const failedDeathSavesDiff = tokenHp.failedDeathSaves - beforeApplyTokenHp.failedDeathSaves;
          setTargetCache(dmg.data, {
            ...cache,
            targetUuid: targetEvent.targetUuid,
            appliedState: 'applied',
            appliedHpChange: hpDiff,
            appliedTmpHpChange: tempHpDiff,
            appliedFailedDeathSaved: failedDeathSavesDiff,
          });
        } else {
          // When undoing damage after a heal, it could over heal above max hp.
          const originalHp = tokenHp.hp;
          tokenHp.hp = Math.min(snapshot.maxHp, tokenHp.hp);
          setTargetCache(dmg.data, {
            ...cache,
            targetUuid: targetEvent.targetUuid,
            appliedState: 'not-applied',
            appliedHpChange: tokenHp.hp - originalHp,
            appliedTmpHpChange: 0,
            appliedFailedDeathSaved: 0,
          });
        }
      }

      tokenHpSnapshot.set(targetEvent.targetUuid, tokenHp);
    }

    // Apply healing/damage/death saves to the token
    const updateActors: Parameters<(typeof UtilsDocument)['bulkUpdate']>[0] = [];
    for (const [uuid, tokenHp] of tokenHpSnapshot.entries()) {
      const token = tokenDocuments.get(uuid);
      const actor: MyActor = token.getActor();
      const hpDiff = tokenHp.hp - actor.data.data.attributes.hp.value;
      const tempHpDiff = tokenHp.tempHp - actor.data.data.attributes.hp.temp;
      const failedDeathSavesDiff = tokenHp.failedDeathSaves - (actor.data.data.attributes.death?.failure ?? 0);
      if (hpDiff || tempHpDiff || failedDeathSavesDiff) {
        updateActors.push({document: actor as any, data: {
          'data.attributes.hp.value': tokenHp.hp,
          'data.attributes.hp.temp': tokenHp.tempHp,
          'data.attributes.death.failure': tokenHp.failedDeathSaves
        }});
      }
    }

    if (updateActors.length > 0) {
      await UtilsDocument.bulkUpdate(updateActors);
    }
  }

  private getTargetState(context: StateContext): VisualState[] {
    const states = new Map<string, Omit<VisualState, 'columns'> & {hpDiff?: number}>();
    for (const uuid of context.selectedTokenUuids) {
      states.set(uuid, {tokenUuid: uuid, state: 'not-applied', smartState: 'not-applied'});
    }
    for (const part of context.allMessageParts) {
      if (!this.isThisPartType(part)) {
        continue;
      }

      for (const targetCache of part.data.calc$.targetCaches) {
        if (!states.has(targetCache.targetUuid)) {
          states.set(targetCache.targetUuid, {tokenUuid: targetCache.targetUuid, state: 'not-applied', smartState: 'not-applied'});
        }
        const state = states.get(targetCache.targetUuid);
        if (state.hpDiff == null) {
          state.hpDiff = 0;
          state.state = targetCache.appliedState;
          state.smartState = targetCache.smartState;
        }
        
        if (state.state !== targetCache.appliedState) {
          state.state === 'partial-applied';
        }
        if (state.smartState !== targetCache.smartState) {
          state.smartState === 'partial-applied';
        }
        state.hpDiff += (targetCache.calcHpChange ?? 0);
        state.hpDiff += (targetCache.calcAddTmpHp ?? 0);
      }
    }

    return Array.from(states.values())
      .filter(state => state.state !== 'not-applied' || context.selectedTokenUuids.includes(state.tokenUuid))
      .map(state => {
        const visualState: VisualState = {
          tokenUuid: state.tokenUuid,
          columns: [],
        };
        if (state.state != null) {
          visualState.state = state.state;
        }
        if (state.smartState != null) {
          visualState.smartState = state.smartState;
        }
      
        if (state.hpDiff == null) {
          return visualState;
        }

        const column: VisualState['columns'][0] = {
          key: 'dmg',
          label: `<i class="fas fa-heart" title="${game.i18n.localize('DND5E.Damage')}"></i>`,
          rowValue: '',
        };
        if (state.hpDiff === 0) {
          column.rowValue = '0';
        } else if (state.hpDiff > 0) /* heal */ {
          column.rowValue = `<span style="color: green">+${state.hpDiff}</span>`;
        } else /* damage */ {
          column.rowValue = `<span style="color: red">${state.hpDiff}</span>`;
        }
        visualState.columns.push(column);

        return visualState;
      }
    );
  }

  private isThisPartType(row: ModularCardPartData): row is ModularCardPartData<DamageCardData> {
    return row.type === this.getType() && ModularCard.getTypeHandler(row.type) instanceof DamageCardPart;
  }
  //#endregion

}

class DamageCardTrigger implements ITrigger<ModularCardTriggerData> {

  //#region upsert
  public async upsert(context: IAfterDmlContext<ModularCardTriggerData>): Promise<void> {
    // TODO recalc whole item on level change to support custom scaling level scaling formulas
    await this.calcDamageFormulas(context);
    await this.calcTargetCache(context);
    // TODO auto apply healing, but it needs to be sync?
  }
  
  private async calcTargetCache(context: IDmlContext<ModularCardTriggerData>): Promise<void> {
    const selectedTokensByMessageId = new Map<string, Set<string>>();
    const newSelectedTokensByMessageId = new Map<string, Set<string>>();
    for (const {newRow, oldRow} of context.rows) {
      if (!this.isTargetTriggerType(newRow)) {
        continue;
      }

      if (!newSelectedTokensByMessageId.has(newRow.messageId)) {
        newSelectedTokensByMessageId.set(newRow.messageId, new Set());
      }
      if (!selectedTokensByMessageId.has(newRow.messageId)) {
        selectedTokensByMessageId.set(newRow.messageId, new Set());
      }
      const newTokenUuids = newSelectedTokensByMessageId.get(newRow.messageId);
      const tokenUuids = selectedTokensByMessageId.get(newRow.messageId);
      const oldSelectedTokens = (oldRow as ModularCardTriggerData<TargetCardData>)?.data?.selectedTokenUuids ?? [];
      for (const target of newRow.data.selectedTokenUuids) {
        tokenUuids.add(target);
        if (!oldSelectedTokens.includes(target)) {
          newTokenUuids.add(target);
        }
      }
    }

    const recalcTokens: Array<{tokenUuid: string, data: DamageCardData}> = [];
    for (const {newRow, oldRow} of context.rows) {
      if (!this.isThisTriggerType(newRow) || !this.assumeThisType(oldRow)) {
        continue;
      }
      // Recalc all caches if damage changes
      if (
        (newRow.data.calc$.roll?.evaluated !== oldRow?.data?.calc$?.roll?.evaluated) || 
        (newRow.data.calc$.roll?.evaluated && newRow.data.calc$.roll.formula !== oldRow?.data?.calc$?.roll?.formula)
      ) {
        if (selectedTokensByMessageId.has(newRow.messageId)) {
          for (const targetedUuid of selectedTokensByMessageId.get(newRow.messageId)) {
            recalcTokens.push({data: newRow.data, tokenUuid: targetedUuid});
          }
        }
        continue;
      }

      // Calc new targets
      if (newSelectedTokensByMessageId.has(newRow.messageId)) {
        for (const targetedUuid of newSelectedTokensByMessageId.get(newRow.messageId)) {
          // Ignore what is already cached, always fetch when a new target has been selected
          recalcTokens.push({data: newRow.data, tokenUuid: targetedUuid});
        }
      }
    }

    if (recalcTokens.length === 0) {
      return;
    }

    const fetchTokenUuids = new Set<string>();
    for (const recalcToken of recalcTokens) {
      fetchTokenUuids.add(recalcToken.tokenUuid);
    }
    const tokenDocuments = await UtilsDocument.tokenFromUuid(fetchTokenUuids);
    for (const recalcToken of recalcTokens) {
      const actor: MyActor = tokenDocuments.get(recalcToken.tokenUuid).getActor();
      const currentCache = getTargetCache(recalcToken.data, recalcToken.tokenUuid);
      const cache: TargetCache = {
        ...currentCache ?? {targetUuid: recalcToken.tokenUuid, appliedState: 'not-applied', smartState: 'not-applied'},
        calcHpChange: 0,
        calcAddTmpHp: 0,
        calcFailedDeathSaved: 0,
      };
      const immunities = [...actor.data.data.traits.di.value, ...(actor.data.data.traits.di.custom === '' ? [] : actor.data.data.traits.di.custom.split(';'))];
      const resistances = [...actor.data.data.traits.dr.value, ...(actor.data.data.traits.dr.custom === '' ? [] : actor.data.data.traits.dr.custom.split(';'))];
      const vulnerabilities = [...actor.data.data.traits.dv.value, ...(actor.data.data.traits.dv.custom === '' ? [] : actor.data.data.traits.dv.custom.split(';'))];

      if (recalcToken.data.calc$.roll?.evaluated) {
        for (let [dmgType, amount] of UtilsRoll.rollToDamageResults(UtilsRoll.fromRollData(recalcToken.data.calc$.roll)).entries()) {
          if (immunities.includes(dmgType)) {
            continue;
          }
          if (resistances.includes(dmgType)) {
            amount /= 2;
          }
          if (vulnerabilities.includes(dmgType)) {
            amount *= 2;
          }
          amount = Math.ceil(amount);
          // Assume that negative amounts are from negative modifiers => should be 0.
          //  Negative healing does not become damage & negative damage does no become healing.
          amount = Math.max(0, amount);
          if (ItemCardHelpers.tmpHealingDamageTypes.includes(dmgType)) {
            cache.calcAddTmpHp += amount;
          } else if (ItemCardHelpers.healingDamageTypes.includes(dmgType)) {
            cache.calcHpChange += amount;
          } else /* damage */ {
            cache.calcHpChange -= amount;

            // TODO calculate seath saves.
            //  RAW: Crit = 2 fails
            //  RAW: magic missile = 1 damage source => 1 failed save
            //  RAW: Scorching Ray = multiple damage sources => multiple failed saves
          }
        }
      }

      if ((cache.appliedHpChange + cache.appliedTmpHpChange) === (cache.calcHpChange + cache.calcAddTmpHp) &&
        cache.appliedFailedDeathSaved === cache.calcFailedDeathSaved
      ) {
        cache.appliedState = 'applied';
      } else if (cache.appliedHpChange !== 0 ||
        cache.appliedTmpHpChange !== 0 ||
        cache.appliedFailedDeathSaved !== 0
      ) {
        cache.appliedState = 'partial-applied';
      }

      setTargetCache(recalcToken.data, cache);
    }
  }
  
  private async calcDamageFormulas(context: IDmlContext<ModularCardTriggerData>): Promise<void> {
    for (const {newRow, oldRow} of context.rows) {
      if (!this.isThisTriggerType(newRow) || !this.assumeThisType(oldRow)) {
        continue;
      }

      const newRollTerms: TermData[] = [];
      for (const rollProperty of this.getRollProperties(newRow.data)) {
        if (newRollTerms.length > 0) {
          newRollTerms.push(new OperatorTerm({operator: '+'}).toJSON() as TermData);
        }
        newRollTerms.push(...(UtilsObject.getProperty(newRow.data, rollProperty)));
      }
      if (newRow.data.userBonus) {
        if (newRollTerms.length > 0) {
          newRollTerms.push(new OperatorTerm({operator: '+'}).toJSON() as TermData);
        }
        newRollTerms.push(...newRow.data.userBonus.terms);
      }
      if (newRollTerms.length === 0) {
        newRollTerms.push(new NumericTerm({number: 0}).toJSON() as TermData);
      }
      
      const newRoll = UtilsRoll.createDamageRoll(newRollTerms.map(t => RollTerm.fromData(t)), {critical: newRow.data.mode === 'critical'});

      // Calc roll
      if (newRoll.formula !== newRow?.data?.calc$?.roll?.formula) {
        if (!newRow.data.calc$.roll) {
          newRow.data.calc$.roll = UtilsRoll.toRollData(newRoll);
        } else if (!newRow.data.calc$.roll.evaluated) {
          const oldRoll = UtilsRoll.fromRollData(newRow.data.calc$.roll);
          const result = await UtilsRoll.setRoll(oldRoll, newRoll.formula);
          newRow.data.calc$.roll = UtilsRoll.toRollData(result.result);
          if (result.rollToDisplay) {
            // Auto rolls if original roll was already evaluated
            UtilsDiceSoNice.showRoll({roll: result.rollToDisplay});
          }
        }
        

        const damageTypes: DamageType[] = [];
        let shortenedFormula = newRow.data.calc$.roll.formula;
        for (const damageType of UtilsRoll.getValidDamageTypes()) {
          if (shortenedFormula.match(`\\[${damageType}\\]`)) {
            damageTypes.push(damageType);
            shortenedFormula = shortenedFormula.replace(new RegExp(`\\[${damageType}\\]`, 'g'), '');
          }
        }

        // formula without damage comments
        newRow.data.calc$.displayFormula = shortenedFormula;
        newRow.data.calc$.displayDamageTypes = damageTypes.length > 0 ? `(${damageTypes.sort().map(s => s.capitalize()).join(', ')})` : undefined;
      }
      
      // Execute initial roll
      if ((newRow.data.phase === 'result') !== newRow.data.calc$.roll?.evaluated) {
        const roll = UtilsRoll.fromRollData(newRow.data.calc$.roll);
        newRow.data.calc$.roll = UtilsRoll.toRollData(await roll.roll({async: true}));
        UtilsDiceSoNice.showRoll({roll: roll});
      }
    }
  }
  //#endregion

  //#region afterUpdate
  public afterUpdate(context: IDmlContext<ModularCardTriggerData>): void {
    this.onBonusChange(context);
  }
  
  private onBonusChange(context: IDmlContext<ModularCardTriggerData>): void {
    for (const {newRow, oldRow, changedByUserId} of context.rows) {
      if (changedByUserId !== game.userId) {
        continue;
      }
      if ((newRow.data as DamageCardData).phase === 'bonus-input' && (oldRow?.data as DamageCardData)?.phase !== 'bonus-input') {
        MemoryStorageService.setFocusedElementSelector(`[data-message-id="${newRow.messageId}"] [data-${staticValues.moduleName}-card-part="${newRow.id}"] input.${staticValues.moduleName}-bonus`);
        return;
      }
    }
  }
  //#endregion

  //#region helpers
  private getRollProperties(data: DamageCardData): string[][] {
    const rollProperties: string[][] = [
      ['calc$', 'baseRoll'],
    ];
    if (data.calc$.actorBonusRoll) {
      rollProperties.push(['calc$', 'actorBonusRoll']);
    }
    if (data.calc$.upcastRoll) {
      rollProperties.push(['calc$', 'upcastRoll']);
    }
    return rollProperties;
  }
  
  private isThisTriggerType(row: ModularCardTriggerData): row is ModularCardTriggerData<DamageCardData> {
    return row.typeHandler instanceof DamageCardPart;
  }
  
  private isTargetTriggerType(row: ModularCardTriggerData): row is ModularCardTriggerData<TargetCardData> {
    return row.typeHandler instanceof TargetCardPart;
  }
  
  private assumeThisType(row: ModularCardTriggerData): row is ModularCardTriggerData<DamageCardData> {
    return true;
  }
  //#endregion

}