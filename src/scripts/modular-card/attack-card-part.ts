import { IAfterDmlContext, IDmlContext } from "../lib/db/dml-trigger";
import { UtilsDocument } from "../lib/db/utils-document";
import { RunOnce } from "../lib/decorator/run-once";
import { UtilsDiceSoNice } from "../lib/roll/utils-dice-so-nice";
import { RollData, UtilsRoll } from "../lib/roll/utils-roll";
import { MemoryStorageService } from "../service/memory-storage-service";
import { staticValues } from "../static-values";
import { MyActor, MyItem } from "../types/fixed-types";
import { DamageCardData, DamageCardPart } from "./damage-card-part";
import { ModularCard, ModularCardPartData, ModularCardTriggerData } from "./modular-card";
import { ClickEvent, createPermissionCheck, CreatePermissionCheckArgs, HtmlContext, ICallbackAction, KeyEvent, ModularCardPart } from "./modular-card-part";
import { StateContext, TargetCardData, TargetCardPart, VisualState } from "./target-card-part";

type RollPhase = 'mode-select' | 'bonus-input' | 'result';

interface TargetCache {
  targetUuid: string;
  ac: number;
}

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
    targetCaches: TargetCache[]
  }
}

export class AttackCardPart implements ModularCardPart<AttackCardData> {

  public static readonly instance = new AttackCardPart();
  private constructor(){}

  public generate({item, actor}: {item: MyItem, actor?: MyActor}): AttackCardData[] {
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
        targetCaches: [],
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
  public registerHooks(): void {
    ModularCard.registerModularCardPart(staticValues.moduleName, this);
    TargetCardPart.instance.registerIntegration({
      getVisualState: context => this.getTargetState(context),
    });
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

  //#region Front end
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

  private getTargetState(context: StateContext): VisualState[] {
    const visualStates: VisualState[] = [];

    const rolledAttacks: ModularCardPartData<AttackCardData>[] = context.allMessageParts.filter(part => this.isThisType(part));
    if (rolledAttacks.length === 0) {
      return [];
    }

    const cache = this.getTargetCache(rolledAttacks.map(attack => attack.data));
    for (let i = 0; i < rolledAttacks.length; i++) {
      const attack = rolledAttacks[i];
      // TODO either this should be a (mini) template to use permission check 
      //      or permissions should be configured via the columns
      for (const tokenUuid of context.selectedTokenUuids) {
        let rowValue: string;
        // TODO cache the hit/mis and why this is the state
        if (!attack.data.calc$.roll?.evaluated || !cache.has(tokenUuid)) {
          rowValue = '';
        } else if (attack.data.calc$.roll.terms[0].results.find(r => r.active)?.result === 20) {
          rowValue = `<span title="Crit!">HIT</span>`;
        } else if (attack.data.calc$.roll.terms[0].results.find(r => r.active)?.result === 1) {
          rowValue = `<span title="Crit miss!">MISS</span>`;
        } else {
          const isHit = cache.get(tokenUuid).ac <= attack.data.calc$.roll?.total;
          rowValue = `<span title="AC: ${cache.get(tokenUuid).ac} <= ${attack.data.calc$.roll?.total}">${isHit ? 'HIT' : 'MISS'}</span>`;
        }
        visualStates.push({
          tokenUuid: tokenUuid,
          columns: [{
            key: `${this.getType()}-attack-${i}`,
            label: `Attack ${(rolledAttacks.length === 1) ? '' : ` ${i+1}`}`,
            rowValue: rowValue,
          }],
        })
      }
    }

    return visualStates;
  }
  //#endregion

  //#region Back end
  public beforeUpsert(context: IDmlContext<ModularCardTriggerData<any>>): boolean | void {
    this.calcIsCrit(context);
    this.setDamageAsCrit(context);
  }

  public async upsert(context: IAfterDmlContext<ModularCardTriggerData>): Promise<void> {
    await this.calcAttackRoll(context);
    await this.rollAttack(context);
    await this.addTargetCache(context);
  }

  public afterUpdate(context: IAfterDmlContext<ModularCardTriggerData<any>>): void | Promise<void> {
    this.onBonusChange(context);
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
          for (const targetUuid of row.data.selectedTokenUuids) {
            allTargetUuids.add(targetUuid);
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
          for (const targetUuid of row.data.selectedTokenUuids) {
            allTargetUuids.add(targetUuid);
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
              row.data.calc$.targetCaches.push({
                targetUuid: expectedUuid,
                ac: (tokens.get(expectedUuid).getActor() as MyActor).data.data.attributes.ac.value,
              });
              cachedTargetUuids.add(expectedUuid);
            }
          }
        }
      }
    }
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
  //#endregion

  private isThisType(row: ModularCardPartData): row is ModularCardPartData<AttackCardData>
  private isThisType(row: ModularCardTriggerData): row is ModularCardTriggerData<AttackCardData>
  private isThisType(row: {type: string, typeHandler?: ModularCardPart}): boolean {
    if (row.type !== this.getType()) {
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

  private getTargetCache(caches: AttackCardData[]): Map<string, TargetCache> {
    const cacheByUuid = new Map<string, TargetCache>();
    for (const cache of caches) {
      for (const targetCache of cache.calc$.targetCaches) {
        cacheByUuid.set(targetCache.targetUuid, targetCache);
      }
    }
    return cacheByUuid;
  }

}