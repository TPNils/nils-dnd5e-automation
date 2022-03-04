import { IAfterDmlContext, IDmlContext } from "../lib/db/dml-trigger";
import { UtilsDocument } from "../lib/db/utils-document";
import { RunOnce } from "../lib/decorator/run-once";
import { UtilsDiceSoNice } from "../lib/roll/utils-dice-so-nice";
import { RollData, UtilsRoll } from "../lib/roll/utils-roll";
import { MemoryStorageService } from "../service/memory-storage-service";
import { staticValues } from "../static-values";
import { MyActor, MyItem } from "../types/fixed-types";
import { DamageCardData, DamageCardPart } from "./damage-card-part";
import { ModularCard, ModularCardTriggerData } from "./modular-card";
import { ClickEvent, createPermissionCheck, CreatePermissionCheckArgs, HtmlContext, ICallbackAction, KeyEvent, ModularCardPart } from "./modular-card-part";

type RollPhase = 'mode-select' | 'bonus-input' | 'result';

export interface AttackCardData {
  phase: RollPhase;
  mode: 'normal' | 'advantage' | 'disadvantage';
  userBonus: string;
  calc$: {
    actorUuid?: string;
    hasHalflingLucky: boolean;
    label?: string;
    rollBonus?: string;
    roll?: RollData;
    critTreshold: number;
    isCrit?: boolean;
  }
}

export class AttackCardPart implements ModularCardPart<AttackCardData> {

  public static create({item, actor}: {item: MyItem, actor?: MyActor}): AttackCardData[] {
    if (!['mwak', 'rwak', 'msak', 'rsak'].includes(item?.data?.data?.actionType)) {
      return [];
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

    return [attack];
  }

  @RunOnce()
  public static registerHooks(): void {
    ModularCard.registerModularCardPart(staticValues.moduleName, new AttackCardPart());
  }

  public getType(): string {
    return this.constructor.name;
  }

  public getHtml({data}: HtmlContext<AttackCardData>): string | Promise<string> {
    return renderTemplate(
      `modules/${staticValues.moduleName}/templates/modular-card/attack-part.hbs`, {
        data: data,
        moduleName: staticValues.moduleName
      }
    );
  }

  public getCallbackActions(): ICallbackAction<AttackCardData>[] {
    const permissionCheck = createPermissionCheck<AttackCardData>(({data}) => {
      const documents: CreatePermissionCheckArgs['documents'] = [];
      if (data.calc$.actorUuid) {
        documents.push({uuid: data.calc$.actorUuid, permission: 'OWNER'});
      }
      return {documents: documents};
    })

    return [
      {
        regex: /^item-attack$/,
        permissionCheck: permissionCheck,
        execute: ({data, clickEvent}) => AttackCardPart.processItemAttack(data, clickEvent),
      },
      {
        regex: /^item-attack-bonus$/,
        permissionCheck: permissionCheck,
        execute: ({data, keyEvent, inputValue}) => AttackCardPart.processItemAttackBonus(data, keyEvent, inputValue as string),
      },
      {
        regex: /^item-attack-mode-(minus|plus)$/,
        permissionCheck: permissionCheck,
        execute: ({data, clickEvent, regexResult}) => AttackCardPart.processItemAttackMode(data, clickEvent, regexResult[1] as ('plus' | 'minus')),
      },
    ]
  }

  private static processItemAttack(data: AttackCardData, clickEvent: ClickEvent | null): void {
    if (data.phase === 'result') {
      return;
    }

    const orderedPhases: RollPhase[] = ['mode-select', 'bonus-input', 'result'];
    if (clickEvent?.shiftKey) {
      data.phase = orderedPhases[orderedPhases.length - 1];
    } else {
      data.phase = orderedPhases[orderedPhases.indexOf(data.phase) + 1];
    }
  }
  
  private static processItemAttackBonus(data: AttackCardData, keyEvent: KeyEvent | null, attackBonus: string): void {
    if (attackBonus) {
      data.userBonus = attackBonus;
    } else {
      data.userBonus = "";
    }

    if (data.userBonus && !Roll.validate(data.userBonus) && keyEvent) {
      // Only show error on key press
      throw new Error(game.i18n.localize('Error') + ': ' + game.i18n.localize('Roll Formula'));
    }

    if (keyEvent?.key === 'Enter') {
      data.phase = 'result';
    } else if (keyEvent?.key === 'Escape' && data.phase === 'bonus-input') {
      data.phase = 'mode-select';
    }
  }

  private static async processItemAttackMode(data: AttackCardData, event: ClickEvent | null, modName: 'plus' | 'minus'): Promise<void> {
    let modifier = modName === 'plus' ? 1 : -1;
    if (event?.shiftKey && modifier > 0) {
      modifier++;
    } else if (event?.shiftKey && modifier < 0) {
      modifier--;
    }
    
    const order: Array<AttackCardData['mode']> = ['disadvantage', 'normal', 'advantage'];
    const newIndex = Math.max(0, Math.min(order.length-1, order.indexOf(data.mode) + modifier));
    if (data.mode === order[newIndex]) {
      return;
    }
    data.mode = order[newIndex];

    if (event?.shiftKey) {
      data.phase = 'result';
    }
  }

  public beforeUpsert(context: IDmlContext<ModularCardTriggerData<any>>): boolean | void {
    this.calcIsCrit(context);
    this.setDamageAsCrit(context);
  }

  public async upsert(context: IAfterDmlContext<ModularCardTriggerData>): Promise<void> {
    await this.calcAttackRoll(context);
    await this.rollAttack(context);
  }

  public afterUpdate(context: IAfterDmlContext<ModularCardTriggerData<any>>): void | Promise<void> {
    this.onBonusChange(context);
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

      const baseRollResult = (newRow.data.calc$.roll.terms[0] as RollTerm & DiceTerm.TermData).results.filter(result => result.active)[0];
      newRow.data.calc$.isCrit = baseRollResult.result >= newRow.data.calc$.critTreshold;
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

  private async calcAttackRoll(context: IDmlContext<ModularCardTriggerData>): Promise<void> {
    for (const {newRow} of context.rows) {
      if (!this.isThisType(newRow)) {
        continue;
      }

      let baseRoll = new Die({faces: 20, number: 1});
      switch (newRow.data.mode) {
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
      if (newRow.data.calc$.hasHalflingLucky) {
        // reroll a base roll 1 once
        // first 1 = maximum reroll 1 die not both at (dis)advantage (see PHB p173)
        // second 2 = reroll when the roll result is equal to 1 (=1)
        baseRoll.modifiers.push('r1=1');
      }
      const parts: string[] = [baseRoll.formula];
      if (newRow.data.calc$.rollBonus) {
        parts.push(newRow.data.calc$.rollBonus);
      }
      
      if (newRow.data.userBonus && Roll.validate(newRow.data.userBonus)) {
        parts.push(newRow.data.userBonus);
      }

      const formula = parts.join(' + ');
      if (newRow.data.calc$.roll?.formula !== formula) {
        // Rolling the attack happens automatically in rollAttack and retains previous rolled dice
        newRow.data.calc$.roll = UtilsRoll.toRollData(new Roll(formula));
      }
    }
  }

  private async rollAttack(context: IDmlContext<ModularCardTriggerData>): Promise<void> {
    for (const {newRow, oldRow} of context.rows) {
      if (!this.isThisType(newRow) || !this.assumeThisType(oldRow)) {
        continue;
      }
      
      const oldRoll: RollData = oldRow?.data?.calc$?.roll;
      const shouldEvaluate = newRow.data.phase === 'result';

      if (shouldEvaluate !== newRow.data.calc$.roll?.evaluated && !oldRoll?.evaluated) {
        // Make new roll
        const newRoll = UtilsRoll.fromRollData(newRow.data.calc$.roll);
        newRow.data.calc$.roll = UtilsRoll.toRollData(await newRoll.roll({async: true}));
        UtilsDiceSoNice.showRoll({roll: newRoll});
      } else if (newRow.data.calc$.roll.formula !== oldRoll?.formula && oldRoll) {
        // Roll changed => reroll
        const newRoll = UtilsRoll.fromRollData(newRow.data.calc$.roll);
        const result = await UtilsRoll.setRoll(UtilsRoll.fromRollData(oldRoll).terms, newRoll.terms);
        newRow.data.calc$.roll = UtilsRoll.toRollData(Roll.fromTerms(result.result));
        if (result.rollToDisplay) {
          UtilsDiceSoNice.showRoll({roll: result.rollToDisplay});
        }
      }
    }
  }
  
  private onBonusChange(context: IDmlContext<ModularCardTriggerData>): void {
    for (const {newRow, oldRow, changedByUserId} of context.rows) {
      if (changedByUserId !== game.userId || !this.isThisType(newRow)) {
        continue;
      }
      if (newRow.data.phase === 'bonus-input' && (oldRow?.data as AttackCardData)?.phase !== 'bonus-input') {
        MemoryStorageService.setFocusedElementSelector(`[data-message-id="${newRow.messageId}"] [data-${staticValues.moduleName}-card-part="${newRow.id}"] input.${staticValues.moduleName}-bonus`);
        return;
      }
    }
  }

  private isThisType(row: ModularCardTriggerData): row is ModularCardTriggerData<AttackCardData> {
    return row.type === this.getType() && row.typeHandler instanceof AttackCardPart;
  }

  private isAnyDamageType(row: ModularCardTriggerData): row is ModularCardTriggerData<DamageCardData> {
    return row.typeHandler instanceof DamageCardPart;
  }

  private assumeThisType(row: ModularCardTriggerData): row is ModularCardTriggerData<DamageCardData> {
    return true;
  }

}