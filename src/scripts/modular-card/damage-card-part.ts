import { IAfterDmlContext, IDmlContext} from "../lib/db/dml-trigger";
import { RunOnce } from "../lib/decorator/run-once";
import { UtilsDiceSoNice } from "../lib/roll/utils-dice-so-nice";
import { RollData, UtilsRoll } from "../lib/roll/utils-roll";
import { UtilsObject } from "../lib/utils/utils-object";
import { MemoryStorageService } from "../service/memory-storage-service";
import { staticValues } from "../static-values";
import { DamageType, MyActor, MyItem } from "../types/fixed-types";
import { ItemCardHelpers } from "./item-card-helpers";
import { ModularCard, ModularCardTriggerData } from "./modular-card";
import { ClickEvent, createPermissionCheck, CreatePermissionCheckArgs, HtmlContext, ICallbackAction, KeyEvent, ModularCardPart } from "./modular-card-part";

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
        execute: ({data, clickEvent}) => DamageCardPart.processNextPhase(data, clickEvent),
      },
      {
        regex: /^item-damage-bonus$/,
        permissionCheck: permissionCheck,
        execute: ({data, keyEvent, inputValue}) => DamageCardPart.processDamageBonus(data, keyEvent, inputValue as string),
      },
      {
        regex: /^item-damage-mode-(minus|plus)$/,
        permissionCheck: permissionCheck,
        execute: ({data, clickEvent, regexResult}) => DamageCardPart.processDamageMode(data, clickEvent, regexResult[1] as ('plus' | 'minus')),
      },
    ]
  }

  private static async processNextPhase(data: DamageCardData,event: ClickEvent | null): Promise<void> {
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

  private static async processDamageMode(data: DamageCardData, event: ClickEvent, modName: 'plus' | 'minus'): Promise<void> {
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
  
  private static async processDamageBonus(data: DamageCardData, keyEvent: KeyEvent | null, damageBonus: string): Promise<void> {
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
  
  private async calcDamageFormulas(context: IDmlContext<ModularCardTriggerData>): Promise<void> {
    for (const {newRow, oldRow} of context.rows) {
      if (!this.isThisType(newRow) || !this.assumeThisType(oldRow)) {
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
  
  private isThisType(row: ModularCardTriggerData): row is ModularCardTriggerData<DamageCardData> {
    return row.type === this.getType() && row.typeHandler instanceof DamageCardPart;
  }
  
  private assumeThisType(row: ModularCardTriggerData): row is ModularCardTriggerData<DamageCardData> {
    return true;
  }
  //#endregion
}