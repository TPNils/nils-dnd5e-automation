import { ElementBuilder, ElementCallbackBuilder } from "../../elements/element-builder";
import { RollD20Element } from "../../elements/roll-d20-element";
import { UtilsElement } from "../../elements/utils-element";
import { ITrigger, IDmlContext, IAfterDmlContext } from "../../lib/db/dml-trigger";
import { UtilsDocument, PermissionCheck } from "../../lib/db/utils-document";
import { RunOnce } from "../../lib/decorator/run-once";
import { UtilsDiceSoNice } from "../../lib/roll/utils-dice-so-nice";
import { RollData, UtilsRoll } from "../../lib/roll/utils-roll";
import { MemoryStorageService } from "../../service/memory-storage-service";
import { staticValues } from "../../static-values";
import { MyActor } from "../../types/fixed-types";
import { ItemCardHelpers } from "../item-card-helpers";
import { ModularCard, ModularCardPartData, ModularCardTriggerData } from "../modular-card";
import { ModularCardPart, ModularCardCreateArgs, createPermissionCheck, CreatePermissionCheckArgs, HtmlContext } from "../modular-card-part";
import { DamageCardData, DamageCardPart } from "./damage-card-part";
import { StateContext, TargetCardData, TargetCardPart, VisualState } from "./target-card-part";

type RollPhase = 'mode-select' | 'bonus-input' | 'result';
const modeOrder: Array<AttackCardData['mode']> = ['disadvantage', 'normal', 'advantage'];

interface TargetCache {
  targetUuid$: string;
  actorUuid$: string;
  ac$: number;
  resultType$?: 'hit' | 'critical-hit' | 'mis' | 'critical-mis';
}

// TODO when expanding attack card, show the user bonus, which can be edited
//  UI => can probably solve this with slots
export interface AttackCardData {
  phase: RollPhase;
  mode: 'normal' | 'advantage' | 'disadvantage';
  userBonus: string;
  actorUuid$?: string;
  advantageSources$: Array<{$uuid: string, $name: string, $image: string}>;
  disadvantageSources$: Array<{$uuid: string, $name: string, $image: string}>;
  hasHalflingLucky$: boolean;
  elvenAccuracy$: boolean;
  rollBonus$?: string;
  requestRollFormula$?: string;
  roll$?: RollData;
  critTreshold$: number;
  isCrit$?: boolean;
  targetCaches$: TargetCache[]
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
      targetCaches$: [],
      advantageSources$: [],
      disadvantageSources$: [],
      elvenAccuracy$: actor?.getFlag("dnd5e", "elvenAccuracy") === true && ["dex", "int", "wis", "cha"].includes(item.abilityMod),
      hasHalflingLucky$: actor?.getFlag("dnd5e", "halflingLucky") === true,
      actorUuid$: actor?.uuid,
      rollBonus$: new Roll(bonus.filter(b => b !== '0' && b.length > 0).join(' + '), rollData).toJSON().formula,
      critTreshold$: 20
    };

    let critTreshold = item.data.data.critical?.threshold ?? attack.critTreshold$;
    const actorDnd5eFlags = actor?.data?.flags?.dnd5e;
    if (item.type === 'weapon' && actorDnd5eFlags?.weaponCriticalThreshold != null) {
      critTreshold = Math.min(critTreshold, actor.data.flags.dnd5e.weaponCriticalThreshold);
    }
    if (item.type === 'spell' && actorDnd5eFlags?.spellCriticalThreshold != null) {
      critTreshold = Math.min(critTreshold, actor.data.flags.dnd5e.spellCriticalThreshold);
    }
    attack.critTreshold$ = critTreshold;

    {
      let suffixes = ['all', item.data.data.actionType, item.abilityMod];
      if (actor) {
        if (actor.type === 'character') {
          suffixes.push('humanoid');
        } else if (actor.type === 'npc' && actor.data.data.details?.type) {
          suffixes.push(actor.data.data.details.type.custom);
          suffixes.push(actor.data.data.details.type.value);
        }
      }
      suffixes = suffixes.filter(suffix => !!suffix);
      
      {
        // TODO could also detect midi flags => should probably contact the author for permission
        let advantage = false;
        let disadvantage = false;
        for (const suffix of suffixes) {
          if (getProperty(actor.data._source, `flags.${staticValues.moduleName}.attack.advantage.${suffix}`) > 0) {
            advantage = true;
          }
          if (getProperty(actor.data._source, `flags.${staticValues.moduleName}.attack.disadvantage.${suffix}`) > 0) {
            disadvantage = true;
          }
        }
        
        if (advantage) {
          attack.advantageSources$.push({
            $uuid: actor.uuid,
            $image: actor.img,
            $name: actor.data.name,
          });
        }
        if (disadvantage) {
          attack.disadvantageSources$.push({
            $uuid: actor.uuid,
            $image: actor.img,
            $name: actor.data.name,
          });
        }
      }

      for (const effect of actor.getEmbeddedCollection(ActiveEffect.name) as any as Array<ActiveEffect>) {
        let advantage = false;
        let disadvantage = false;
  
        for (const suffix of suffixes) {
          for (const change of effect.data.changes) {
            if (change.key === `data.flags.${staticValues.moduleName}.attack.advantage.${suffix}`) {
              advantage = true;
            }
            if (change.key === `data.flags.${staticValues.moduleName}.attack.disadvantage.${suffix}`) {
              disadvantage = true;
            }
          }
        }
  
        if (advantage) {
          attack.advantageSources$.push({
            $uuid: effect.uuid,
            $image: effect.data.icon,
            $name: effect.sourceName ?? effect.name,
          });
        }
        if (disadvantage) {
          attack.disadvantageSources$.push({
            $uuid: effect.uuid,
            $image: effect.data.icon,
            $name: effect.sourceName ?? effect.name,
          });
        }
      }
    }

    return attack;
  }

  public refresh(oldData: AttackCardData, args: ModularCardCreateArgs): AttackCardData {
    const newData = this.create(args);

    if (!newData) {
      return null;
    }
    if (!oldData) {
      return newData;
    }

    const result: Partial<AttackCardData> = deepClone(oldData);
    const newKeys = new Set<keyof AttackCardData>();
    for (const key of Object.keys(oldData) as Array<keyof AttackCardData>) {
      if (key.startsWith('$')) {
        newKeys.add(key);
      }
    }
    newKeys.delete('roll$');// contains already rolled dice which should not be discarded
    
    const oldKeys = new Set<keyof AttackCardData>();
    for (const key of Object.keys(oldData) as Array<keyof AttackCardData>) {
      if (!newKeys.has(key)) {
        oldKeys.add(key);
      }
    }

    for (const key of newKeys as Set<string>) {
      if (newData.hasOwnProperty(key)) {
        result[key] = newData[key];
      } else {
        delete result[key];
      }
    }
    for (const key of oldKeys as Set<string>) {
      result[key] = deepClone(oldData[key]);
    }
    return result as AttackCardData;
  }

  @RunOnce()
  public registerHooks(): void {
    const permissionCheck = createPermissionCheck<{part: {data: AttackCardData}}>(({part}) => {
      const documents: CreatePermissionCheckArgs['documents'] = [];
      if (part.data.actorUuid$) {
        documents.push({uuid: part.data.actorUuid$, permission: 'OWNER', security: true});
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
          if (part.data.phase === 'bonus-input') {
            part.data.phase = 'mode-select';
          }
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
        .addSerializer(ItemCardHelpers.getActionSerializer())
        .addEnricher(ItemCardHelpers.getChatPartEnricher<AttackCardData>())
        .setPermissionCheck(permissionCheck)
        .setExecute(({messageId, allCardParts, part, click, action}) => {
          let modifier = action === 'mode-plus' ? 1 : -1;
          if (click.shiftKey && modifier > 0) {
            modifier++;
          } else if (click.shiftKey && modifier < 0) {
            modifier--;
          }
          
          const newIndex = Math.max(0, Math.min(modeOrder.length-1, modeOrder.indexOf(part.data.mode) + modifier));
          if (part.data.mode === modeOrder[newIndex]) {
            return;
          }
          part.data.mode = modeOrder[newIndex];

          if (click.shiftKey) {
            part.data.phase = 'result';
          }
          return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
        })
      )
      .addOnAttributeChange(async ({element, attributes}) => {
        return ItemCardHelpers.ifAttrData<AttackCardData>({attr: attributes, element, type: this, callback: async ({part}) => {
          const d20attributes = {
            ['data-roll']: part.data.roll$,
            ['data-bonus-formula']: part.data.userBonus,
            ['data-show-bonus']: part.data.phase !== 'mode-select',
            ['data-label']: 'DND5E.Attack',
            ['data-override-max-roll']: part.data.critTreshold$,
          };
          if (part.data.actorUuid$) {
            d20attributes['data-interaction-permission'] = `OwnerUuid:${part.data.actorUuid$}`;
            d20attributes['data-read-permission'] = `${staticValues.code}ReadAttackUuid:${part.data.actorUuid$}`;
            d20attributes['data-read-hidden-display-type'] = game.settings.get(staticValues.moduleName, 'attackHiddenRoll');
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
    ModularCard.registerModularCardTrigger(this, new AttackCardTrigger());
    ModularCard.registerModularCardTrigger(TargetCardPart.instance, new TargetCardTrigger());
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
    //  UI idea: unrolled keep it as is, once rolled (1 button for multiple rolls) show a list below for each target
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
      for (const selected of context.selected) {
        let rowValue: string;
        const canReadAttack = UtilsDocument.hasPermissions([{
          uuid: attack.data.actorUuid$,
          user: game.user,
          permission: `${staticValues.code}ReadAttack`,
        }], {sync: true}).every(permission => permission.result);
        let canSeeAc: boolean;
        if (cache.has(selected.tokenUuid)) {
          canSeeAc = UtilsDocument.hasPermissions([{
            uuid: cache.get(selected.tokenUuid).actorUuid$,
            user: game.user,
            permission: `Observer`,
          }], {sync: true}).every(permission => permission.result);
        } else {
          canSeeAc = false;
        }
        const canSeeTotal = game.settings.get(staticValues.moduleName, 'attackHiddenRoll') === 'total';
        if (!attack.data.roll$?.evaluated || !canSeeAc) {
          if (attack.data.roll$?.evaluated) {
            rowValue = '';
          } else {
            rowValue = '';
          }
        } else if (!canReadAttack && !canSeeTotal) {
          rowValue = '';
        } else {
          const styles = ['text-align: center'];
          let resultType = cache.get(selected.tokenUuid).resultType$;
          if (!canReadAttack && canSeeTotal) {
            if (resultType === 'critical-hit') {
              resultType = 'hit';
            } else if (resultType === 'critical-mis') {
              resultType = 'mis';
            }
          }
          switch (resultType) {
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
              rowValue = `<div style="${styles.join(';')};" title="${game.i18n.localize('DND5E.AC')}: ${cache.get(selected.tokenUuid).ac$} <= ${attack.data.roll$?.total}">✓</div>`;
              break;
            }
            case 'mis': {
              styles.push('color: red');
              rowValue = `<div style="${styles.join(';')};" title="${game.i18n.localize('DND5E.AC')}: ${cache.get(selected.tokenUuid).ac$} <= ${attack.data.roll$?.total}">✗</div>`;
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
      for (const targetCache of cache.targetCaches$) {
        cacheByUuid.set(targetCache.targetUuid$, targetCache);
      }
    }
    return cacheByUuid;
  }
  //#endregion

}

class TargetCardTrigger implements ITrigger<ModularCardTriggerData<TargetCardData>> {

  public async upsert(context: IAfterDmlContext<ModularCardTriggerData<TargetCardData>>): Promise<void> {
    await this.addTargetCache(context);
  }
  
  private async addTargetCache(context: IDmlContext<ModularCardTriggerData<TargetCardData>>): Promise<void> {
    const missingTargetUuids = new Set<string>();
    for (const {newRow} of context.rows) {
      const allTargetUuids = new Set<string>();
      const cachedTargetUuids = new Set<string>();
      for (const selected of newRow.part.data.selected) {
        allTargetUuids.add(selected.tokenUuid);
      }
      for (const part of newRow.allParts) {
        if (!ModularCard.isType<AttackCardData>(AttackCardPart.instance, part)) {
          continue;
        }
        for (const target of part.data.targetCaches$) {
          cachedTargetUuids.add(target.targetUuid$);
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
    for (const {newRow} of context.rows) {
      const allTargetUuids = new Set<string>();
      for (const selected of newRow.part.data.selected) {
        allTargetUuids.add(selected.tokenUuid);
      }

      for (const part of newRow.allParts) {
        if (!ModularCard.isType<AttackCardData>(AttackCardPart.instance, part)) {
          continue;
        }
        const cachedTargetUuids = new Set<string>();
        for (const target of part.data.targetCaches$) {
          cachedTargetUuids.add(target.targetUuid$);
        }

        for (const expectedUuid of allTargetUuids) {
          if (!cachedTargetUuids.has(expectedUuid)) {
            const actor = (tokens.get(expectedUuid).getActor() as MyActor);
            part.data.targetCaches$.push({
              targetUuid$: expectedUuid,
              actorUuid$: actor.uuid,
              ac$: actor.data.data.attributes.ac.value,
            });
            cachedTargetUuids.add(expectedUuid);
          }
        }
      }
    }
  }

}

class AttackCardTrigger implements ITrigger<ModularCardTriggerData<AttackCardData>> {

  //#region beforeUpsert
  public beforeUpsert(context: IDmlContext<ModularCardTriggerData<any>>): boolean | void {
    this.calcRollMode(context);
    this.calcIsCrit(context);
    this.setDamageAsCrit(context);
    this.calcResultCache(context);
  }

  private calcIsCrit(context: IDmlContext<ModularCardTriggerData<AttackCardData>>): void {
    for (const {newRow} of context.rows) {
      if (!newRow.part.data.roll$?.evaluated) {
        newRow.part.data.isCrit$ = false;
        continue;
      }

      const baseRollResult = newRow.part.data.roll$.terms[0].results.filter(result => result.active)[0];
      newRow.part.data.isCrit$ = baseRollResult?.result >= newRow.part.data.critTreshold$;
    }
  }

  private setDamageAsCrit(context: IDmlContext<ModularCardTriggerData<AttackCardData>>): void {
    for (const {newRow, oldRow} of context.rows) {
      if (newRow.part.data.isCrit$ !== oldRow?.part?.data?.isCrit$) {
        for (const part of newRow.allParts) {
          if (!ModularCard.isType<DamageCardData>(DamageCardPart.instance, part)) {
            continue;
          }
          
          if (part.data.phase === 'mode-select') {
            if (newRow.part.data.isCrit$) {
              part.data.mode = 'critical';
            } else {
              part.data.mode = 'normal';
            }
          }
        }
      }
    }
  }

  private calcResultCache(context: IDmlContext<ModularCardTriggerData<AttackCardData>>): void {
    for (const {newRow} of context.rows) {
      for (const targetCache of newRow.part.data.targetCaches$) {
        if (newRow.part.data.roll$?.evaluated) {
          const firstRoll = newRow.part.data.roll$.terms[0].results.find(r => r.active);
          if (firstRoll.result === 20 || targetCache.ac$ <= newRow.part.data.roll$.total) {
            // 20 always hits, lower crit treshold does not
            if (firstRoll.result >= newRow.part.data.critTreshold$) {
              targetCache.resultType$ = 'critical-hit';
            } else {
              targetCache.resultType$ = 'hit';
            }
          } else if (firstRoll.result === 1) {
            targetCache.resultType$ = 'critical-mis';
          } else {
            targetCache.resultType$ = 'mis';
          }
        } else if (targetCache.resultType$) {
          delete targetCache.resultType$;
        }
      }
    }
  }

  private calcRollMode(context: IDmlContext<ModularCardTriggerData<AttackCardData>>): void {
    for (const {newRow, oldRow} of context.rows) {
      const newMode = this.calcAutoMode(newRow.part.data);
      if (oldRow) {
        if (newMode !== this.calcAutoMode(oldRow.part.data)) {
          newRow.part.data.mode = newMode;
        }
      } else {
        newRow.part.data.mode = newMode;
      }
    }
  }

  private calcAutoMode(data: AttackCardData): AttackCardData['mode'] {
    let modeIndex = 1;
    if (data.advantageSources$.length > 0) {
      modeIndex++;
    }
    if (data.disadvantageSources$.length > 0) {
      modeIndex--;
    }
    return modeOrder[modeIndex];
  }
  //#endregion

  //#region upsert
  public async upsert(context: IAfterDmlContext<ModularCardTriggerData<AttackCardData>>): Promise<void> {
    await this.calcAttackRoll(context);
    await this.rollAttack(context);
  }

  private async calcAttackRoll(context: IDmlContext<ModularCardTriggerData<AttackCardData>>): Promise<void> {
    for (const {newRow} of context.rows) {
      let baseRoll = new Die({faces: 20, number: 1});
      if (newRow.part.data.hasHalflingLucky$) {
        // reroll a base roll 1 once
        // first 1 = maximum reroll 1 die not both at (dis)advantage (see PHB p173)
        // second 2 = reroll when the roll result is equal to 1 (=1)
        baseRoll.modifiers.push('r1=1');
      }
      switch (newRow.part.data.mode) {
        case 'advantage': {
          if (newRow.part.data.elvenAccuracy$) {
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
      if (newRow.part.data.rollBonus$) {
        parts.push(newRow.part.data.rollBonus$);
      }
      
      if (newRow.part.data.userBonus && Roll.validate(newRow.part.data.userBonus)) {
        parts.push(newRow.part.data.userBonus);
      }

      newRow.part.data.requestRollFormula$ = UtilsRoll.simplifyTerms(new Roll(parts.join(' + '))).formula;
    }
  }

  private async rollAttack(context: IDmlContext<ModularCardTriggerData<AttackCardData>>): Promise<void> {
    const showRolls: PermissionCheck<Roll>[] = [];
    for (const {newRow, oldRow} of context.rows) {
      if (newRow.part.data.requestRollFormula$ !== oldRow?.part?.data?.requestRollFormula$) {
        if (!newRow.part.data.roll$) {
          newRow.part.data.roll$ = UtilsRoll.toRollData(new Roll(newRow.part.data.requestRollFormula$));
        } else {
          const oldRoll = UtilsRoll.fromRollData(newRow.part.data.roll$);
          const result = await UtilsRoll.setRoll(oldRoll, newRow.part.data.requestRollFormula$);
          newRow.part.data.roll$ = UtilsRoll.toRollData(result.result);
          if (result.rollToDisplay) {
            // Auto rolls if original roll was already evaluated
            for (const user of game.users.values()) {
              if (user.active) {
                showRolls.push({
                  uuid: newRow.part.data.actorUuid$,
                  permission: `${staticValues.code}ReadCheck`,
                  user: user,
                  meta: result.rollToDisplay
                });
              }
            }
          }
        }
      }

      // Execute initial roll
      if ((newRow.part.data.phase === 'result') && newRow.part.data.roll$?.evaluated !== true) {
        const roll = UtilsRoll.fromRollData(newRow.part.data.roll$);
        newRow.part.data.roll$ = UtilsRoll.toRollData(await roll.roll({async: true}));
        for (const user of game.users.values()) {
          if (user.active) {
            showRolls.push({
              uuid: newRow.part.data.actorUuid$,
              permission: `${staticValues.code}ReadCheck`,
              user: user,
              meta: roll,
            });
          }
        }
      }
    }

    UtilsDocument.hasPermissions(showRolls).then(responses => {
      const rollsPerUser = new Map<string, Roll[]>()
      for (const response of responses) {
        if (response.result) {
          if (!rollsPerUser.has(response.requestedCheck.user.id)) {
            rollsPerUser.set(response.requestedCheck.user.id, []);
          }
          rollsPerUser.get(response.requestedCheck.user.id).push(response.requestedCheck.meta);
        }
      }

      const rollPromises: Promise<any>[] = [];
      for (const [userId, rolls] of rollsPerUser.entries()) {
        rollPromises.push(UtilsDiceSoNice.showRoll({roll: UtilsRoll.mergeRolls(...rolls), showUserIds: [userId]}));
      }
      return rollPromises;
    });
  }
  //#endregion

}