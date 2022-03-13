import { IAfterDmlContext, IDmlContext, ITrigger } from "../lib/db/dml-trigger";
import { UtilsDocument } from "../lib/db/utils-document";
import { RunOnce } from "../lib/decorator/run-once";
import { UtilsDiceSoNice } from "../lib/roll/utils-dice-so-nice";
import { RollData, UtilsRoll } from "../lib/roll/utils-roll";
import { MemoryStorageService } from "../service/memory-storage-service";
import { staticValues } from "../static-values";
import { MyActor, MyItem } from "../types/fixed-types";
import { DamageCardData, DamageCardPart } from "./damage-card-part";
import { ModularCard, ModularCardPartData, ModularCardTriggerData } from "./modular-card";
import { ClickEvent, createPermissionCheck, CreatePermissionCheckArgs, HtmlContext, ICallbackAction, KeyEvent, ModularCardCreateArgs, ModularCardPart } from "./modular-card-part";
import { StateContext, TargetCardData, TargetCardPart, VisualState } from "./target-card-part";

type RollPhase = 'mode-select' | 'bonus-input' | 'result';

// TODO probably want to register SVGs once
// https://stackoverflow.com/questions/34225008/how-to-reuse-an-embedded-svg-element-in-the-same-page
// svg source: https://www.svgrepo.com/svg/103610/sword
const svg = `<svg version="1.1" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 454.635 454.635" style="enable-background:new 0 0 454.635 454.635;" xml:space="preserve">
<path fill="currentColor" d="M286.306,301.929h-17.472L295.141,82.85c0.708-5.89-1.709-13.694-5.621-18.155L236.506,4.255 C234.134,1.551,230.785,0,227.317,0s-6.816,1.551-9.188,4.255l-53.015,60.439c-3.912,4.461-6.328,12.266-5.621,18.155 l26.307,219.079h-17.472c-8.412,0-15.256,6.844-15.256,15.256v18.984c0,8.412,6.844,15.256,15.256,15.256h37.118v33.143 c-10.014,6.95-16.588,18.523-16.588,31.609c0,21.206,17.252,38.458,38.458,38.458s38.458-17.252,38.458-38.458 c0-13.086-6.574-24.659-16.588-31.609v-33.143h37.118c8.412,0,15.256-6.844,15.256-15.256v-18.984 C301.562,308.772,294.718,301.929,286.306,301.929z"/>
</svg>`

interface TargetCache {
  targetUuid: string;
  ac: number;
  resultType?: 'hit' | 'critical-hit' | 'mis' | 'critical-mis';
  visibleToUsers: string[];
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

  public create({item, actor}: {item: MyItem, actor?: MyActor}): AttackCardData[] {
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

  public refresh(oldDatas: AttackCardData[], args: ModularCardCreateArgs): AttackCardData[] {
    const results: AttackCardData[] = [];
    const newCreated = this.create(args);
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
    ModularCard.registerModularCardPart(staticValues.moduleName, this);
    ModularCard.registerModularCardTrigger(new AttackCardTrigger());
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
        execute: ({data, clickEvent}) => this.processItemAttack(data, clickEvent),
      },
      {
        regex: /^item-attack-bonus$/,
        permissionCheck: permissionCheck,
        execute: ({data, keyEvent, inputValue}) => this.processItemAttackBonus(data, keyEvent, inputValue as string),
      },
      {
        regex: /^item-attack-mode-(minus|plus)$/,
        permissionCheck: permissionCheck,
        execute: ({data, clickEvent, regexResult}) => this.processItemAttackMode(data, clickEvent, regexResult[1] as ('plus' | 'minus')),
      },
    ]
  }

  //#region Card callbacks
  private processItemAttack(data: AttackCardData, clickEvent: ClickEvent | null): void {
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
  
  private processItemAttackBonus(data: AttackCardData, keyEvent: KeyEvent | null, attackBonus: string): void {
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

  private async processItemAttackMode(data: AttackCardData, event: ClickEvent | null, modName: 'plus' | 'minus'): Promise<void> {
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
      for (const tokenUuid of context.selectedTokenUuids) {
        let rowValue: string;
        // TODO cache the hit/mis and why this is the state
        if (!attack.data.calc$.roll?.evaluated || !cache.has(tokenUuid) || !cache.get(tokenUuid).visibleToUsers.includes(game.userId)) {
          if (attack.data.calc$.roll?.evaluated) {
            rowValue = '';
          } else {
            rowValue = '';
          }
        } else {
          const styles = ['text-align: center'];
          switch (cache.get(tokenUuid).resultType) {
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
              rowValue = `<div style="${styles.join(';')};" title="${game.i18n.localize('DND5E.AC')}: ${cache.get(tokenUuid).ac} <= ${attack.data.calc$.roll?.total}">✓</div>`;
              break;
            }
            case 'mis': {
              styles.push('color: red');
              rowValue = `<div style="${styles.join(';')};" title="${game.i18n.localize('DND5E.AC')}: ${cache.get(tokenUuid).ac} <= ${attack.data.calc$.roll?.total}">✗</div>`;
              break;
            }
          }
        }
        visualStates.push({
          tokenUuid: tokenUuid,
          columns: [{
            key: `${this.getType()}-attack-${i}`,
            label: `<div style="font-size: 16px;" title="${game.i18n.localize('DND5E.Attack')}">${svg}</div> ${(rolledAttacks.length === 1) ? '' : ` ${i+1}`}`,
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
        MemoryStorageService.setFocusedElementSelector(`[data-message-id="${newRow.messageId}"] [data-${staticValues.moduleName}-card-part="${newRow.id}"] input.${staticValues.moduleName}-bonus`);
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