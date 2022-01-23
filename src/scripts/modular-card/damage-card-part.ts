import { DmlTrigger, IAfterDmlContext, IDmlContext, IDmlTrigger } from "../lib/db/dml-trigger";
import { RunOnce } from "../lib/decorator/run-once";
import { UtilsDiceSoNice } from "../lib/roll/utils-dice-so-nice";
import { UtilsRoll } from "../lib/roll/utils-roll";
import { UtilsCompare } from "../lib/utils/utils-compare";
import { UtilsObject } from "../lib/utils/utils-object";
import { MemoryStorageService } from "../service/memory-storage-service";
import { staticValues } from "../static-values";
import { DamageType, MyActor, MyItem } from "../types/fixed-types";
import { ItemCardHelpers } from "./item-card-helpers";
import { ModularCard, PartDmlContext } from "./modular-card";
import { ClickEvent, createPermissionCheck, CreatePermissionCheckArgs, ICallbackAction, KeyEvent, ModularCardPart } from "./modular-card-part";

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

interface DamageCardData {
  phase: 'mode-select' | 'bonus-input' | 'result';
  mode: 'normal' | 'critical';
  userBonus?: RollJson;
  addedDamages$?: {
    [key: string]: AddedDamage
  },
  calc$: {
    actorUuid?: string;
    label: string;
    modfierRule?: 'save-full-dmg' | 'save-halve-dmg' | 'save-no-dmg';
    baseRoll: RollJson;
    upcastRoll?: RollJson;
    actorBonusRoll?: RollJson;
    normalRoll?: RollJson;
    criticalRoll?: RollJson;
    displayDamageTypes?: string;
    displayFormula?: string;
  }
}

export class DamageCardPart implements ModularCardPart<DamageCardData> {

  public static create({item, actor}: {item: MyItem, actor?: MyActor}): DamageCardData[] {
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
  public static registerHooks(): void {
    ModularCard.registerModularCardPart(staticValues.moduleName, new DamageCardPart());
    DmlTrigger.registerTrigger(new DmlTriggerChatMessage());
  }

  public getType(): string {
    return DamageCardPart.name;
  }

  public getHtml({data}): string | Promise<string> {
    return renderTemplate(
      // TODO make the template
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
        execute: ({data, clickEvent, regexResult}) => DamageCardPart.processDamageMode(data, clickEvent, regexResult[2] as ('plus' | 'minus')),
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
}

class DmlTriggerChatMessage implements IDmlTrigger<ChatMessage> {

  get type(): typeof ChatMessage {
    return ChatMessage;
  }

  public beforeUpdate(context: IDmlContext<ChatMessage>): void {
    const partContext = ModularCard.toPartDmlContext(context);
    this.rolledTermsAreFinal(partContext)
  }

  public afterUpdate(context: IDmlContext<ChatMessage>): void {
    const partContext = ModularCard.toPartDmlContext(context);
    this.onBonusChange(partContext);
  }

  public async upsert(context: IAfterDmlContext<ChatMessage>): Promise<void> {
    // TODO recalc whole item on level change to support custom scaling level scaling formulas
    const partContext = ModularCard.toPartDmlContext(context);
    this.calcDamageFormulas(partContext);
    await this.calcDamageRoll(partContext);
  }
  
  private calcDamageFormulas(context: PartDmlContext): void {
    for (const {newPart} of context.parts) {
      if (newPart.type !== DamageCardPart.name) {
        continue;
      }
      const data: DamageCardData = newPart.data;
      let displayFormula: string;
      const displayRoll: RollJson = data.mode === 'critical' ? data.calc$.criticalRoll : data?.calc$.normalRoll;
      if (displayRoll) {
        displayFormula = Roll.getFormula(displayRoll.map(RollTerm.fromData));
      }

      const damageTypes: DamageType[] = [];
      if (displayFormula) {
        for (const damageType of UtilsRoll.getValidDamageTypes()) {
          if (displayFormula.match(`\\[${damageType}\\]`)) {
            damageTypes.push(damageType);
            displayFormula = displayFormula.replace(new RegExp(`\\[${damageType}\\]`, 'g'), '');
          }
        }
      }

      data.calc$.displayFormula = displayFormula;
      data.calc$.displayDamageTypes = damageTypes.length > 0 ? `(${damageTypes.sort().map(s => s.capitalize()).join(', ')})` : undefined;
    }
  }

  private async calcDamageRoll(context: PartDmlContext): Promise<void> {
    for (const {newPart} of context.parts) {
      if (newPart.type !== DamageCardPart.name) {
        continue
      }
      const dmg: DamageCardData = newPart.data;
      if (dmg.phase === 'result') {
        const newNormalTerms: RollTerm[] = [];
        //#region Normal roll
        {
          const termsToEvaluate: Array<{
            rollProperty: string[];
            index: number;
            term: TermJson;
          }> = [];
          for (const rollProperty of this.getRollProperties(dmg)) {
            const rollJson: RollJson = UtilsObject.getProperty(dmg, rollProperty);
            for (let i = 0; i < rollJson.length; i++) {
              if (!rollJson[i].evaluated) {
                termsToEvaluate.push({
                  rollProperty: rollProperty,
                  index: i,
                  term: rollJson[i],
                });
              }
            }
          }

          const unevaluatedTerms: RollTerm[] = [];
          for (const rollToEvaluate of termsToEvaluate) {
            unevaluatedTerms.push(RollTerm.fromData(rollToEvaluate.term));
          }

          if (unevaluatedTerms.length > 0) {
            const result = await UtilsRoll.rollUnrolledTerms(unevaluatedTerms, {async: true});

            for (let i = 0; i < result.results.length; i++) {
              UtilsObject.getProperty(dmg, termsToEvaluate[i].rollProperty)[termsToEvaluate[i].index] = result.results[i].toJSON();
            }

            if (result.newRolls) {
              // Don't await for the roll animation to finish
              newNormalTerms.push(...result.newRolls)
            }
            
            const normalRollTerms: RollJson = [];
            for (const rollProperty of this.getRollProperties(dmg)) {
              normalRollTerms.push(...(UtilsObject.getProperty(dmg, rollProperty) as RollJson));
            }
            dmg.calc$.normalRoll = normalRollTerms;
          }
        }
        //#endregion

        //#region Crit roll
        // TODO I would prefer a method which can recalc the crit roll from 0 and retain the already rolled dice
        const newCriticalTerms: RollTerm[] = [];
        {
          const unevaluatedTerms: RollTerm[] = [];
          if (newNormalTerms.length > 0) {
            unevaluatedTerms.push(...UtilsRoll.getCriticalBonusRoll(Roll.fromTerms(newNormalTerms)).terms);
          }
          if (dmg.addedDamages$) {
            for (const key in dmg.addedDamages$) {
              const additionalDamage = dmg.addedDamages$[key];
              for (const termJson of additionalDamage.additionalCriticalRoll || []) {
                if (!termJson.evaluated) {
                  unevaluatedTerms.push(RollTerm.fromData(termJson));
                }
              }
            }
          }

          if (unevaluatedTerms.length > 0) {
            if (dmg.calc$.criticalRoll == null) {
              dmg.calc$.criticalRoll = [];
            }
            const result = await UtilsRoll.rollUnrolledTerms(unevaluatedTerms, {async: true});
            
            for (const term of result.results) {
              dmg.calc$.criticalRoll.push(term.toJSON() as TermJson);
            }

            if (result.newRolls) {
              // Don't await for the roll animation to finish
              newCriticalTerms.push(...result.newRolls);
            }
          }
        }
        //#endregion
    
        if (newNormalTerms.length > 0 || newCriticalTerms.length > 0) {
          // Don't await for the roll animation to finish
          UtilsDiceSoNice.showRoll({roll: Roll.fromTerms([...newNormalTerms, ...newCriticalTerms])});
        }
        
        // Auto apply healing since it very rarely gets modified
        /*const damageTypes = UtilsRoll.rollToDamageResults(Roll.fromJSON(JSON.stringify(dmg.calc$.criticalRoll?.evaluated ? dmg.calc$.criticalRoll : dmg.calc$.normalRoll)));
        let isHealing = true;
        for (const type of damageTypes.keys()) {
          if (!ItemCardHelpers.healingDamageTypes.includes(type)) {
            isHealing = false;
            break;
          }
        }
    
        if (isHealing && item.targets) {
           TODO auto apply healing, but it needs to be sync?
        }*/
      }
    }
  }
  
  /**
   * When a roll term was already rolled and then changed, revert it back to the way it was.
   */
  private rolledTermsAreFinal(context: PartDmlContext): void {
    for (const {newPart, oldPart, messageId} of context.parts) {
      if (!newPart || !oldPart) {
        continue;
      }
      if (newPart.type !== DamageCardPart.name) {
        continue
      }
      const newData: DamageCardData = newPart.data;
      const oldData: DamageCardData = oldPart.data;

      for (const property of this.getRollProperties(oldData)) {
        const newTerms: RollJson = UtilsObject.getProperty(newData, property);
        const oldTerms: RollJson = UtilsObject.getProperty(oldData, property);
        
        for (let i = 0; i < oldTerms.length; i++) {
          const oldTerm = RollTerm.fromData(oldTerms[i]);
          if (oldTerm.total == null) {
            continue;
          }

          // TODO allow dice terms to increase their nr of dice (for simplifying crits)
          if (!UtilsCompare.deepEquals(oldTerms[i], newTerms[i])) {
            console.error(`Not allowed to edit already rolled terms.`, {
              context: {
                entity: 'Message',
                entityId: messageId,
                module: staticValues.moduleName,
                moduleSubSystem: ['DamageCardPart', oldPart.id, property, i],
              },
              oldValue: oldTerms[i],
              newValue: newTerms[i],
            })
            newTerms[i] = deepClone(oldTerms[i]);
          }
        }
      }
    }
  }
  
  private onBonusChange(context: PartDmlContext): void {
    for (const {newPart, oldPart, changedByUserId, messageId} of context.parts) {
      if (changedByUserId !== game.userId) {
        continue;
      }
      if ((newPart.data as DamageCardData).phase === 'bonus-input' && (oldPart?.data as DamageCardData)?.phase !== 'bonus-input') {
        MemoryStorageService.setFocusedElementSelector(`[data-message-id="${messageId}"] [data-${staticValues.moduleName}-card-part="${newPart.id}"] input.${staticValues.moduleName}-bonus`);
        return;
      }
    }
  }

  private getRollProperties(data: DamageCardData): string[][] {
    const rollProperties: string[][] = [
      ['calc$', 'baseRoll'],
      ,
    ];
    if (data.calc$.actorBonusRoll) {
      rollProperties.push(['userBonus']);
    }
    if (data.userBonus) {
      rollProperties.push(['userBonus']);
    }
    if (data.addedDamages$) {
      for (const key in data.addedDamages$) {
        rollProperties.push(['addedDamages$', key]);
      }
    }
    return rollProperties;
  }
  
}