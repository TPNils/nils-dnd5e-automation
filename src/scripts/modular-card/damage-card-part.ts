import { IAfterDmlContext, IDmlContext} from "../lib/db/dml-trigger";
import { FoundryDocument, UtilsDocument } from "../lib/db/utils-document";
import { RunOnce } from "../lib/decorator/run-once";
import { UtilsDiceSoNice } from "../lib/roll/utils-dice-so-nice";
import { RollData, UtilsRoll } from "../lib/roll/utils-roll";
import { UtilsObject } from "../lib/utils/utils-object";
import { MemoryStorageService } from "../service/memory-storage-service";
import { staticValues } from "../static-values";
import { DamageType, MyActor, MyItem } from "../types/fixed-types";
import { ItemCardHelpers } from "./item-card-helpers";
import { ModularCard, ModularCardPartData, ModularCardTriggerData } from "./modular-card";
import { ClickEvent, createPermissionCheck, CreatePermissionCheckArgs, HtmlContext, ICallbackAction, KeyEvent, ModularCardPart } from "./modular-card-part";
import { State, StateContext, TargetCallbackData, TargetCardPart, VisualState } from "./target-card-part";

type TermJson = ReturnType<RollTerm['toJSON']> & {
  class: string;
  options: any;
  evaluated: boolean;
};
type RollJson = TermJson[];

export interface AddedDamage {
  normalRoll: RollJson;
  additionalCriticalRoll?: RollJson;
}

interface TargetCache {
  targetUuid: string;
  appliedState: State['state'];
  appliedFailedDeathSaved?: number;
  appliedHpChange?: number;
  appliedTmpHpChange?: number;
}

export interface DamageCardData {
  phase: 'mode-select' | 'bonus-input' | 'result';
  mode: 'normal' | 'critical';
  userBonus?: RollJson;
  calc$: {
    actorUuid?: string;
    label: string;
    modfierRule?: 'save-full-dmg' | 'save-halve-dmg' | 'save-no-dmg';
    baseRoll: RollJson;
    upcastRoll?: RollJson;
    actorBonusRoll?: RollJson;
    roll?: RollData;
    displayFormula?: string;
    displayDamageTypes?: string;
    targetCaches: TargetCache[]
  }
}

export class DamageCardPart implements ModularCardPart<DamageCardData> {

  public static readonly instance = new DamageCardPart();
  private constructor(){}

  public generate({item, actor}: {item: MyItem, actor?: MyActor}): DamageCardData[] {
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
          baseRoll: UtilsRoll.damagePartsToRoll(damageParts, rollData).terms.map(t => t.toJSON() as TermJson),
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
      versatileDamage.calc$.baseRoll = new Roll(item.data.data.damage.versatile, rollData).terms.map(t => t.toJSON() as TermJson);
      inputDamages.push(versatileDamage);
    }

    // Spell scaling
    const scaling = item.data.data.scaling;
    if (scaling?.mode === 'level' && scaling.formula) {
      // TODO level scaling should be migrated to a its own card
      const scalingRollJson: RollJson = new Roll(scaling.formula, rollData).terms.map(t => t.toJSON() as TermJson);
      if (inputDamages.length === 0) {
        // when only dealing damage by upcasting? not sure if that ever happens
        inputDamages.push({
          mode: 'normal',
          phase: 'mode-select',
          calc$: {
            label: 'DND5E.Damage',
            baseRoll: new Roll('0').terms.map(t => t.toJSON() as TermJson),
            targetCaches: [],
          }
        });
      }
      for (const damage of inputDamages) {
        damage.calc$.upcastRoll = scalingRollJson;
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
              baseRoll: new Roll('0').terms.map(t => t.toJSON() as TermJson),
              targetCaches: [],
            }
          });
        }

        for (const damage of inputDamages) {
          // DND5e spell compendium has cantrip formula empty => default to the base damage formula
          const scalingRoll = new Roll(scaling.formula == null || scaling.formula.length === 0 ? Roll.getFormula(damage.calc$.baseRoll.map(RollTerm.fromData)) : scaling.formula, rollData).alter(applyScalingXTimes, 0, {multiplyNumeric: true});
          // Override normal roll since cantrip scaling is static, not dynamic like level scaling
          damage.calc$.baseRoll = UtilsRoll.mergeRolls(Roll.fromJSON(JSON.stringify(damage.calc$.baseRoll)), scalingRoll).terms.map(t => t.toJSON() as TermJson);
        }
      }
    }
    
    // Add damage bonus formula
    if (inputDamages.length > 0) {
      const actorBonus = actor.data.data.bonuses?.[item.data.data.actionType];
      if (actorBonus?.damage && parseInt(actorBonus.damage) !== 0) {
        for (const damage of inputDamages) {
          damage.calc$.actorBonusRoll = new Roll(actorBonus.damage, rollData).terms.map(t => t.toJSON() as TermJson);
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

  @RunOnce()
  public registerHooks(): void {
    ModularCard.registerModularCardPart(staticValues.moduleName, this);
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
  public getHtml({data}: HtmlContext<DamageCardData>): string | Promise<string> {
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

    const canOverride = data.userBonus == null || data.userBonus.every(t => !t.evaluated);
    if (canOverride) {
      if (damageBonus) {
        if (!Roll.validate(damageBonus) && keyEvent) {
          // Only show error on key press
          throw new Error(game.i18n.localize('Error') + ': ' + game.i18n.localize('Roll Formula'));
        }
        data.userBonus = new Roll(damageBonus).terms.map(t => t.toJSON() as TermJson);
      } else {
        delete data.userBonus;
      }
    } else {
      if (damageBonus) {
        if (!Roll.validate(damageBonus) && keyEvent) {
          // Only show error on key press
          throw new Error(game.i18n.localize('Error') + ': ' + game.i18n.localize('Roll Formula'));
        }
        if (data.userBonus == null) {
          data.userBonus = [];
        }
        data.userBonus.push(...new Roll(damageBonus).terms.map(t => t.toJSON() as TermJson));
      }
    }

    if (keyEvent?.key === 'Enter') {
      data.phase = 'result';
    } 
  }
  //#endregion

  //#region Backend
  public afterUpdate(context: IDmlContext<ModularCardTriggerData>): void {
    this.onBonusChange(context);
  }

  public async upsert(context: IAfterDmlContext<ModularCardTriggerData>): Promise<void> {
    // TODO recalc whole item on level change to support custom scaling level scaling formulas
    await this.calcDamageFormulas(context);
    // TODO auto apply healing, but it needs to be sync?
  }

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
      const actor: MyActor = tokenDocuments.get(targetEvent.targetUuid).getActor();
      const immunities = [...actor.data.data.traits.di.value, ...(actor.data.data.traits.di.custom === '' ? [] : actor.data.data.traits.di.custom.split(';'))];
      const resistances = [...actor.data.data.traits.dr.value, ...(actor.data.data.traits.dr.custom === '' ? [] : actor.data.data.traits.dr.custom.split(';'))];
      const vulnerabilities = [...actor.data.data.traits.dv.value, ...(actor.data.data.traits.dv.custom === '' ? [] : actor.data.data.traits.dv.custom.split(';'))];
      const snapshot = tokenHpSnapshot.get(targetEvent.targetUuid);
      const tokenHp = deepClone(snapshot);
      
      const damagesCards: ModularCardPartData<DamageCardData>[] = targetEvent.messageCardParts
        .filter(part => part.type === this.getType() && ModularCard.getTypeHandler(part.type) instanceof DamageCardPart)

      // Undo already applied damage
      for (const dmg of damagesCards) {
        const cache = this.getTargetCache(dmg.data, targetEvent.targetUuid);
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

      const beforeApplyTokenHp = deepClone(tokenHp);

      // Calculate (new) damage
      for (const dmg of damagesCards) {
        if (dmg.data.calc$.roll?.evaluated && targetEvent.apply) {
          // hp could have gone over the max with some homebrew or manual changes
          const maxHp = Math.max(snapshot.maxHp, snapshot.hp);
          for (let [dmgType, amount] of UtilsRoll.rollToDamageResults(UtilsRoll.fromRollData(dmg.data.calc$.roll)).entries()) {
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
              tokenHp.tempHp += amount;
            } else if (ItemCardHelpers.healingDamageTypes.includes(dmgType)) {
              tokenHp.hp += amount;
            } else /* damage */ {
              if (tokenHp.tempHp > 0) {
                const dmgTempHp = Math.min(tokenHp.tempHp, amount);
                tokenHp.tempHp -= dmgTempHp;
                amount -= dmgTempHp;
              }
              tokenHp.hp -= amount;

              // TODO calculate seath saves.
              //  RAW: Crit = 2 fails
              //  RAW: magic missile = 1 damage source => 1 failed save
              //  RAW: Scorching Ray = multiple damage sources => multiple failed saves
            }
          }
          
          // Stay within the min/max bounderies
          tokenHp.hp = Math.max(0, Math.min(tokenHp.hp, maxHp));
          tokenHp.tempHp = Math.max(0, tokenHp.tempHp);
          
          const hpDiff = tokenHp.hp - beforeApplyTokenHp.hp;
          const tempHpDiff = tokenHp.tempHp - beforeApplyTokenHp.tempHp;
          const failedDeathSavesDiff = tokenHp.failedDeathSaves - beforeApplyTokenHp.failedDeathSaves;
          this.setTargetCache(dmg.data, {
            targetUuid: targetEvent.targetUuid,
            appliedState: 'applied',
            appliedHpChange: hpDiff,
            appliedTmpHpChange: tempHpDiff,
            appliedFailedDeathSaved: failedDeathSavesDiff,
          });
        } else {
          this.setTargetCache(dmg.data, {
            targetUuid: targetEvent.targetUuid,
            appliedState: 'not-applied',
            appliedHpChange: 0,
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
    const states = new Map<string, State & {hpDiff?: number}>();
    for (const uuid of context.selectedTokenUuids) {
      states.set(uuid, {tokenUuid: uuid, state: 'not-applied'});
    }
    for (const part of context.allMessageParts) {
      if (!this.isThisPartType(part)) {
        continue;
      }

      for (const targetCache of part.data.calc$.targetCaches) {
        if (!states.has(targetCache.targetUuid)) {
          states.set(targetCache.targetUuid, {tokenUuid: targetCache.targetUuid, state: 'not-applied'});
        }
        const state = states.get(targetCache.targetUuid);
        if (state.hpDiff == null) {
          state.hpDiff = 0;
          state.state = targetCache.appliedState;
        }
        
        if (state.state !== targetCache.appliedState) {
          state.state === 'partial-applied';
        }
        state.hpDiff += (targetCache.appliedHpChange ?? 0);
        state.hpDiff += (targetCache.appliedTmpHpChange ?? 0);
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
      
        if (state.hpDiff == null) {
          return visualState;
        }

        const column: VisualState['columns'][0] = {
          key: 'dmg',
          label: 'dmg', // TODO icon
          rowValue: '',
        };
        // TODO this is wrong, should display the amount it will deal, not what has been applied
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
  
  private async calcDamageFormulas(context: IDmlContext<ModularCardTriggerData>): Promise<void> {
    for (const {newRow, oldRow} of context.rows) {
      if (!this.isThisTriggerType(newRow) || !this.assumeThisType(oldRow)) {
        continue;
      }

      const newRollTerms: RollJson = [];
      for (const rollProperty of this.getRollProperties(newRow.data)) {
        newRollTerms.push(...(UtilsObject.getProperty(newRow.data, rollProperty) as RollJson));
      }
      if (newRollTerms.length === 0) {
        newRollTerms.push(new NumericTerm({number: 0}).toJSON() as TermJson);
      }
      
      const newRoll = UtilsRoll.createDamageRoll(newRollTerms.map(t => RollTerm.fromData(t)), {critical: newRow.data.mode === 'critical'});

      // Calc roll
      if (newRoll.formula !== newRow?.data?.calc$?.roll?.formula) {
        if (!newRow.data.calc$.roll) {
          newRow.data.calc$.roll = UtilsRoll.toRollData(newRoll);
        } else {
          const oldRollTerms = UtilsRoll.fromRollData(newRow.data.calc$.roll).terms;
          const result = await UtilsRoll.setRoll(oldRollTerms, newRoll.terms);
          newRow.data.calc$.roll = UtilsRoll.toRollData(Roll.fromTerms(result.result));
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

  private getRollProperties(data: DamageCardData): string[][] {
    const rollProperties: string[][] = [
      ['calc$', 'baseRoll'],
    ];
    if (data.calc$.actorBonusRoll) {
      rollProperties.push(['calc$', 'actorBonusRoll']);
    }
    if (data.userBonus) {
      rollProperties.push(['userBonus']);
    }
    return rollProperties;
  }
  
  private isThisPartType(row: ModularCardPartData): row is ModularCardPartData<DamageCardData> {
    return row.type === this.getType() && ModularCard.getTypeHandler(row.type) instanceof DamageCardPart;
  }
  
  private isThisTriggerType(row: ModularCardTriggerData): row is ModularCardTriggerData<DamageCardData> {
    return row.type === this.getType() && row.typeHandler instanceof DamageCardPart;
  }
  
  private assumeThisType(row: ModularCardTriggerData): row is ModularCardTriggerData<DamageCardData> {
    return true;
  }

  private setTargetCache(cache: DamageCardData, targetCache: TargetCache): void {
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

  private getTargetCache(cache: DamageCardData, tokenUuid: string): TargetCache | null {
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
  //#endregion
}