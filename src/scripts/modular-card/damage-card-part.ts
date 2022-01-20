import { IAfterDmlContext, IDmlContext, IDmlTrigger } from "../lib/db/dml-trigger";
import { UtilsDiceSoNice } from "../lib/roll/utils-dice-so-nice";
import { UtilsRoll } from "../lib/roll/utils-roll";
import { MemoryStorageService } from "../service/memory-storage-service";
import { staticValues } from "../static-values";
import { DamageType, MyActor, MyItem, MyItemData } from "../types/fixed-types";
import { ItemCardHelpers } from "./item-card-helpers";
import { ModularCard } from "./modular-card";
import { ClickEvent, createPermissionCheck, CreatePermissionCheckArgs, ICallbackAction, KeyEvent, ModularCardPart } from "./modular-card-part";

type RollJson = ReturnType<Roll['toJSON']>

export interface AddedDamage {
  normalRoll: RollJson;
  additionalCriticalRoll?: RollJson;
}

interface DamageCardData {
  phase: 'mode-select' | 'bonus-input' | 'result';
  mode: 'normal' | 'critical';
  userBonus: string;
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

export class DamageCardPart extends ModularCardPart<DamageCardData> {

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
        userBonus: "",
        calc$: {
          label: 'DND5E.Damage',
          baseRoll: UtilsRoll.damagePartsToRoll(damageParts, rollData).toJSON(),
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
      versatileDamage.calc$.baseRoll = new Roll(item.data.data.damage.versatile, rollData).toJSON();
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
          userBonus: "",
          calc$: {
            label: 'DND5E.Damage',
            baseRoll: new Roll('0').toJSON(),
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
            userBonus: "",
            calc$: {
              label: 'DND5E.Damage',
              baseRoll: new Roll('0').toJSON(),
            }
          });
        }

        for (const damage of inputDamages) {
          // DND5e spell compendium has cantrip formula empty => default to the base damage formula
          const scalingRoll = new Roll(scaling.formula == null || scaling.formula.length === 0 ? damage.calc$.baseRoll.formula : scaling.formula, rollData).alter(applyScalingXTimes, 0, {multiplyNumeric: true});
          // Override normal roll since cantrip scaling is static, not dynamic like level scaling
          damage.calc$.baseRoll = UtilsRoll.mergeRolls(Roll.fromJSON(JSON.stringify(damage.calc$.baseRoll)), scalingRoll).toJSON();
        }
      }
    }
    
    // Add damage bonus formula
    if (inputDamages.length > 0) {
      const actorBonus = actor.data.data.bonuses?.[item.data.data.actionType];
      if (actorBonus?.damage && parseInt(actorBonus.damage) !== 0) {
        for (const damage of inputDamages) {
          damage.calc$.actorBonusRoll = new Roll(actorBonus.damage, rollData).toJSON();
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

  public getType(): string {
    return DamageCardPart.name;
  }

  public getHtml(): string | Promise<string> {
    return renderTemplate(
      // TODO make the template
      `modules/${staticValues.moduleName}/templates/modular-card/damage-part.hbs`, {
        data: this.data,
        moduleName: staticValues.moduleName
      }
    );
  }

  public getCallbackActions(): ICallbackAction[] {
    const permissionCheck = createPermissionCheck(() => {
      const documents: CreatePermissionCheckArgs['documents'] = [];
      if (this.data.calc$.actorUuid) {
        documents.push({uuid: this.data.calc$.actorUuid, permission: 'OWNER'});
      }
      return {documents: documents};
    })

    return [
      {
        regex: /^item-damage$/,
        permissionCheck: permissionCheck,
        execute: ({clickEvent}) => this.processNextPhase(clickEvent),
      },
      {
        regex: /^item-damage-bonus$/,
        permissionCheck: permissionCheck,
        execute: ({keyEvent, inputValue}) => this.processItemDamageBonus(keyEvent, inputValue as string),
      },
      {
        regex: /^item-damage-mode-(minus|plus)$/,
        permissionCheck: permissionCheck,
        execute: ({clickEvent, regexResult}) => this.processItemDamageMode(clickEvent, regexResult[2] as ('plus' | 'minus')),
      },
    ]
  }

  public setPartDamage(part: ModularCardPart, addedDamage: AddedDamage | null): void {
    if (!this.data.addedDamages$) {
      this.data.addedDamages$ = {};
    }
    if (addedDamage == null) {
      delete this.data[part.getId()]
    } else {
      this.data[part.getId()] = addedDamage;
    }
  }

  private async processNextPhase(event: ClickEvent | null): Promise<void> {
    const dmg = this.data;
    if (this.data.phase === 'result') {
      return;
    }

    const orderedPhases: DamageCardData['phase'][] = ['mode-select', 'bonus-input', 'result'];
    if (event?.shiftKey) {
      dmg.phase = orderedPhases[orderedPhases.length - 1];
    } else {
      dmg.phase = orderedPhases[orderedPhases.indexOf(dmg.phase) + 1];
    }
  }

  private async processItemDamageMode(event: ClickEvent, modName: 'plus' | 'minus'): Promise<void> {
    let modifier = modName === 'plus' ? 1 : -1;
    
    const order: Array<DamageCardData['mode']> = ['normal', 'critical'];
    const newIndex = Math.max(0, Math.min(order.length-1, order.indexOf(this.data.mode) + modifier));
    if (this.data.mode === order[newIndex]) {
      return;
    }
    this.data.mode = order[newIndex];

    if (event.shiftKey || (this.data.calc$?.normalRoll?.evaluated && (this.data.mode === 'critical' && !this.data.calc$?.criticalRoll?.evaluated))) {
      this.data.phase = 'result';
    }
  }
  
  private async processItemDamageBonus(keyEvent: KeyEvent | null, damageBonus: string): Promise<void> {
    if (this.data.calc$?.normalRoll?.evaluated || this.data.phase === 'result') {
      return;
    }

    if (damageBonus) {
      this.data.userBonus = damageBonus;
    } else {
      this.data.userBonus = "";
    }

    if (this.data.userBonus && !Roll.validate(this.data.userBonus) && keyEvent) {
      // Only show error on key press
      throw new Error(game.i18n.localize('Error') + ': ' + game.i18n.localize('Roll Formula'));
    }

    if (keyEvent?.key === 'Enter') {
      this.data.phase = 'result';
    } else if (keyEvent?.key === 'Escape') {
      this.data.phase = 'mode-select';
    }
  }

}

class DmlTriggerChatMessage implements IDmlTrigger<ChatMessage> {

  get type(): typeof ChatMessage {
    return ChatMessage;
  }

  public afterUpdate(context: IDmlContext<ChatMessage>): void {
    this.onBonusChange(context);
  }

  public async upsert(context: IAfterDmlContext<ChatMessage>): Promise<void> {
    // TODO recalc whole item on level change to support custom scaling level scaling formulas
    this.calcItemCardDamageFormulas(context);
    await this.calcDamageRoll(context);
  }
  
  private calcItemCardDamageFormulas(context: IDmlContext<ChatMessage>): void {
    for (const data of this.getDamageParts(context)) {
      let displayFormula = data.mode === 'critical' ? data.calc$.criticalRoll?.formula : data?.calc$.normalRoll?.formula;
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

  private async calcDamageRoll(context: IDmlContext<ChatMessage>): Promise<void> {
    for (const dmg of this.getDamageParts(context)) {
      if (dmg.phase === 'result') {
        const normalRollEvaluated = !!dmg.calc$.normalRoll?.evaluated;
        const criticalRollEvaluated = !!dmg.calc$.criticalRoll?.evaluated;
        let normalRollFormula: string;
        let normalRollPromise: Promise<Roll>;
        if (normalRollEvaluated) {
          normalRollFormula = dmg.calc$.normalRoll.formula;
          normalRollPromise = Promise.resolve(Roll.fromJSON(JSON.stringify(dmg.calc$.normalRoll)));
        } else {
          const dmgParts: MyItemData['data']['damage']['parts'] = UtilsRoll.rollToDamageParts(Roll.fromJSON(JSON.stringify(dmg.calc$.baseRoll)));
          // TODO upcasting (should be a different card)
          /*const upcastLevel = Math.max(item.calc$?.level, item.selectedlevel === 'pact' ? (data.actor?.calc$?.pactLevel ?? 0) : item.selectedlevel);
          if (upcastLevel > item.calc$.level) {
            if (dmg.calc$?.upcastRoll) {
              const upcastRoll = Roll.fromJSON(JSON.stringify(dmg.calc$?.upcastRoll)).alter(upcastLevel - item.calc$?.level, 0, {multiplyNumeric: true})
              dmgParts.push(...UtilsRoll.rollToDamageParts(upcastRoll));
            }
          }*/
          if (dmg.calc$.actorBonusRoll) {
            dmgParts.push(...UtilsRoll.rollToDamageParts(Roll.fromJSON(JSON.stringify(dmg.calc$.actorBonusRoll))))
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
          criticalRollPromise = Promise.resolve(Roll.fromJSON(JSON.stringify(dmg.calc$.criticalRoll)));
        } else if (dmg.mode === 'critical') {
          criticalRollPromise = UtilsRoll.getCriticalBonusRoll(new Roll(normalRollFormula)).roll({async: true});
        } else {
          criticalRollPromise = Promise.resolve(false);
        }
    
        const [normalResolved, critBonusResolved] = await Promise.all([normalRollPromise, criticalRollPromise]);
        const newRolls: Roll[] = [];
        if (!normalRollEvaluated) {
          newRolls.push(normalResolved);
          dmg.calc$.normalRoll = normalResolved.toJSON();
        }
        if (!criticalRollEvaluated && critBonusResolved instanceof Roll) {
          newRolls.push(critBonusResolved);
          dmg.calc$.criticalRoll = UtilsRoll.mergeRolls(normalResolved, critBonusResolved).toJSON();
        }
    
        if (newRolls.length > 0) {
          // Don't await for the roll animation to finish
          UtilsDiceSoNice.showRoll({roll: UtilsRoll.mergeRolls(...newRolls)});
        }
        
        // Auto apply healing since it very rarely gets modified
        const damageTypes = UtilsRoll.rollToDamageResults(Roll.fromJSON(JSON.stringify(dmg.calc$.criticalRoll?.evaluated ? dmg.calc$.criticalRoll : dmg.calc$.normalRoll)));
        let isHealing = true;
        for (const type of damageTypes.keys()) {
          if (!ItemCardHelpers.healingDamageTypes.includes(type)) {
            isHealing = false;
            break;
          }
        }
    
        //if (isHealing && item.targets) {
          // TODO auto apply healing, but it needs to be sync?
        //}
      }
    }
  }
  
  private onBonusChange(context: IDmlContext<ChatMessage>): void {
    for (const {newRow, oldRow, changedByUserId} of context.rows) {
      if (changedByUserId !== game.userId) {
        continue;
      }
      const parts = ModularCard.getCardPartDatas(newRow);
      if (!Array.isArray(parts)) {
        continue;
      }
      const oldParts = ModularCard.getCardPartDatas(oldRow);
      
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (part.type !== DamageCardPart.name) {
          continue;
        }
        const oldPart = oldParts?.[i];

        if ((part.data as DamageCardData).phase === 'bonus-input' && (oldPart?.data as DamageCardData)?.phase !== 'bonus-input') {
          MemoryStorageService.setFocusedElementSelector(`[data-message-id="${newRow.id}"] [data-${staticValues.moduleName}-card-part="${part.id}"] input.${staticValues.moduleName}-bonus`);
          return;
        }
      }
    }
  }

  private getDamageParts(context: IDmlContext<ChatMessage>): DamageCardData[] {
    const parts: DamageCardData[] = [];

    for (const {newRow} of context.rows) {
      const parts = ModularCard.getCardPartDatas(newRow);
      if (!Array.isArray(parts)) {
        continue;
      }
      
      for (const part of parts) {
        if (part.type === DamageCardPart.name) {
          parts.push(part.data);
        }
      }
    }

    return parts;
  }
  
}