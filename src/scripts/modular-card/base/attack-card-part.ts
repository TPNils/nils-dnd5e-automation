import { DynamicElement, ElementBuilder, ElementCallbackBuilder } from "../../elements/element-builder";
import { RollD20Element } from "../../elements/roll-d20-element";
import { TokenImgElement } from "../../elements/token-img-element";
import { UtilsElement } from "../../elements/utils-element";
import { ITrigger, IDmlContext, IAfterDmlContext } from "../../lib/db/dml-trigger";
import { UtilsDocument, PermissionCheck } from "../../lib/db/utils-document";
import { RunOnce } from "../../lib/decorator/run-once";
import { UtilsDiceSoNice } from "../../lib/roll/utils-dice-so-nice";
import { RollData, UtilsRoll } from "../../lib/roll/utils-roll";
import { MemoryStorageService } from "../../service/memory-storage-service";
import { staticValues } from "../../static-values";
import { MyActor } from "../../types/fixed-types";
import { ChatPartEnriched, ChatPartIdData, ItemCardHelpers } from "../item-card-helpers";
import { ModularCard, ModularCardPartData, ModularCardTriggerData } from "../modular-card";
import { ModularCardPart, ModularCardCreateArgs, createPermissionCheck, CreatePermissionCheckArgs, HtmlContext } from "../modular-card-part";
import { DamageCardData, DamageCardPart } from "./damage-card-part";
import { StateContext, TargetCardData, TargetCardPart, VisualState } from "./target-card-part";

type RollPhase = 'mode-select' | 'bonus-input' | 'result';
const modeOrder: Array<TargetCache['mode']> = ['disadvantage', 'normal', 'advantage'];

interface RollModifierSource {
  uuid$: string;
  name$: string;
  image$: string;
}

interface AttackRoll {
  initialSelectionId$: string;
  roll$: RollData;
  isCrit$?: boolean;
}

interface TargetCache {
  phase: RollPhase;
  mode: 'normal' | 'advantage' | 'disadvantage';
  userBonus: string;
  
  /** Is currently selected */
  isSelected$: boolean;
  selectedRoll$?: number;
  requestRollFormula$?: string;
  /** Advantage sources which apply to only this target */
  advantageSources$: Array<RollModifierSource>;
  /** Disdvantage sources which apply to only this target */
  disadvantageSources$: Array<RollModifierSource>;

  targetUuid$: string;
  selectionId$: string;
  name$: string;
  actorUuid$: string;
  ac$: number;
  resultType$?: 'hit' | 'critical-hit' | 'mis' | 'critical-mis';
}

export interface AttackCardData {
  actorUuid$?: string;
  /** Advantage sources which apply to all targets */
  advantageSources$: Array<RollModifierSource>;
  /** Disdvantage sources which apply to all targets */
  disadvantageSources$: Array<RollModifierSource>;
  hasHalflingLucky$: boolean;
  elvenAccuracy$: boolean;
  rollBonus$?: string;
  critTreshold$: number;
  rolls$: AttackRoll[];
  targetCaches$: TargetCache[]
}

/**
 * Most attack items only have 1 target.
 * However there are a few with multiple targets and I could not find a written rule to handle those.
 * So I decided that you need to roll an attack for each target based on multiple spells/feats RAW
 * - Ranger (Hunter): Multiattack
 * - Scorching Ray
 * - Eldritch Blast
 */
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
      targetCaches$: [],
      rolls$: [],
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
      const modeSources = this.getModeSources({
        actor: actor,
        suffixes: ['all', null, item.data.data.actionType, item.abilityMod]
      });
      attack.advantageSources$ = modeSources.advantage;
      attack.disadvantageSources$ = modeSources.disadvantage;
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
      if (key.endsWith('$')) {
        newKeys.add(key);
      }
    }
    newKeys.delete('rolls$');// contains already rolled dice which should not be discarded
    newKeys.delete('targetCaches$'); // will be handled seperately
    
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

    for (const targetCache of result.targetCaches$) {
      for (const key of Object.keys(targetCache)) {
        if (key.endsWith('$')) {
          delete targetCache[key];
        }
      }
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
      .listenForAttribute('data-target-id', 'string')
      .setCss(/*css*/`
        ${TokenImgElement.selector()} {
          margin-right: 2px;
          width: 1em;
          height: 1em;
        }
      `)
      .addListener(new ElementCallbackBuilder()
        .setEvent('click')
        .addSelectorFilter('[data-action="roll"]')
        .addSerializer(ItemCardHelpers.getChatPartIdSerializer())
        .addSerializer(ItemCardHelpers.getUserIdSerializer())
        .addSerializer(ItemCardHelpers.getMouseEventSerializer())
        .addSerializer(this.getTargetSerializer)
        .addEnricher(ItemCardHelpers.getChatPartEnricher<AttackCardData>())
        .addEnricher(this.getTargetCacheEnricher)
        .setPermissionCheck(permissionCheck)
        .setExecute(({messageId, click, allCardParts, targetCaches}) => {
          for (const targetCache of targetCaches) {
            const orderedPhases: RollPhase[] = ['mode-select', 'bonus-input', 'result'];
            if (click.shiftKey) {
              targetCache.phase = orderedPhases[orderedPhases.length - 1];
            } else {
              targetCache.phase = orderedPhases[orderedPhases.indexOf(targetCache.phase) + 1];
            }
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
        .addSerializer(this.getTargetSerializer)
        .addSerializer(context => ({inputValue: (context.event.target as HTMLInputElement).value}))
        .addEnricher(ItemCardHelpers.getChatPartEnricher<AttackCardData>())
        .addEnricher(this.getTargetCacheEnricher)
        .setPermissionCheck(permissionCheck)
        .setExecute(({messageId, allCardParts, targetCaches, inputValue}) => {
          if (inputValue && !Roll.validate(inputValue)) {
            // Only show error on key press
            throw new Error(game.i18n.localize('Error') + ': ' + game.i18n.localize('Roll Formula'));
          }
          for (const targetCache of targetCaches) {
            if (targetCache.phase === 'bonus-input') {
              targetCache.phase = 'mode-select';
            }
            targetCache.userBonus = inputValue ?? '';
          }
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
        .addSerializer(this.getTargetSerializer)
        .addEnricher(ItemCardHelpers.getChatPartEnricher<AttackCardData>())
        .addEnricher(this.getTargetCacheEnricher)
        .setPermissionCheck(permissionCheck)
        .setExecute(({messageId, allCardParts, targetCaches, keyEvent, inputValue}) => {
          if (keyEvent.key === 'Enter') {
            for (const targetCache of targetCaches) {
              const userBonus = inputValue == null ? '' : inputValue;
              if (userBonus && !Roll.validate(userBonus)) {
                // Only show error on key press
                throw new Error(game.i18n.localize('Error') + ': ' + game.i18n.localize('Roll Formula'));
              }
              targetCache.phase = 'result';
              targetCache.userBonus = userBonus;
            }
            return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
          } else if (keyEvent.key === 'Escape') {
            for (const targetCache of targetCaches) {
              if (targetCache.phase === 'bonus-input') {
                targetCache.phase = 'mode-select';
              }
            }
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
        .addSerializer(this.getTargetSerializer)
        .addSerializer(ItemCardHelpers.getActionSerializer())
        .addEnricher(ItemCardHelpers.getChatPartEnricher<AttackCardData>())
        .addEnricher(this.getTargetCacheEnricher)
        .setPermissionCheck(permissionCheck)
        .setExecute(({messageId, allCardParts, targetCaches, click, action}) => {
          let modifier = action === 'mode-plus' ? 1 : -1;
          if (click.shiftKey && modifier > 0) {
            modifier++;
          } else if (click.shiftKey && modifier < 0) {
            modifier--;
          }
          
          for (const targetCache of targetCaches) {
            const newIndex = Math.max(0, Math.min(modeOrder.length-1, modeOrder.indexOf(targetCache.mode) + modifier));
            if (targetCache.mode === modeOrder[newIndex]) {
              return;
            }
            targetCache.mode = modeOrder[newIndex];
  
            if (click.shiftKey) {
              targetCache.phase = 'result';
            }
          }
          return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
        })
      )
      .addOnAttributeChange(async ({element, attributes}) => {
        return ItemCardHelpers.ifAttrData<AttackCardData>({attr: attributes, element, type: this, callback: async ({part}) => {
          const elements: Element[] = [];
          for (const targetCache of part.data.targetCaches$.sort((a, b) => a.name$.localeCompare(b.name$))) {
            if (!targetCache.isSelected$) {
              continue;
            }
            const d20attributes = {
              ['data-roll']: part.data.rolls$[targetCache.selectedRoll$].roll$,
              ['data-bonus-formula']: targetCache.userBonus,
              ['data-show-bonus']: targetCache.phase !== 'mode-select',
              ['data-override-max-roll']: part.data.critTreshold$,
            };
            if (part.data.actorUuid$) {
              d20attributes['data-interaction-permission'] = `OwnerUuid:${part.data.actorUuid$}`;
              d20attributes['data-read-permission'] = `${staticValues.code}ReadAttackUuid:${part.data.actorUuid$}`;
              d20attributes['data-read-hidden-display-type'] = game.settings.get(staticValues.moduleName, 'attackHiddenRoll');
            }

            const d20Element = document.createElement(RollD20Element.selector()) as DynamicElement;
            const label = document.createElement('div');
            label.style.display = 'contents';
            label.setAttribute('slot', 'label');
            let labelText: string;
            switch (targetCache.mode) {
              case 'disadvantage':
              case 'advantage': {
                labelText = `DND5E.${targetCache.mode.capitalize()}`;
                break;
              }
              default: {
                labelText = `DND5E.Attack`;
                break;
              }
            }
            const tokenImg = document.createElement(TokenImgElement.selector()) as DynamicElement;
            tokenImg.setInput({
              'data-token-uuid': targetCache.targetUuid$
            })
            label.append(tokenImg, game.i18n.localize(labelText));
            d20Element.appendChild(label);
            d20Element.setAttribute('data-selection-id', targetCache.selectionId$);
            d20Element.setAttribute('data-memory-context', targetCache.selectionId$);
            await d20Element.setInput(d20attributes);
            elements.push(d20Element);
          }
          
          element.innerText = '';
          element.append(...elements)
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

  private getModeSources({actor, prefixes, suffixes}: {actor: MyActor, prefixes?: Array<string | null>, suffixes?: Array<string | null>}): {advantage: RollModifierSource[], disadvantage: RollModifierSource[]} {
    if (prefixes == null) {
      prefixes = [null];
    }
    if (suffixes == null) {
      suffixes = [null];
    }
    const advantageSources: RollModifierSource[] = [];
    const disadvantageSources: RollModifierSource[] = [];

    if (actor) {
      if (actor.type === 'character') {
        suffixes.push('humanoid');
      } else if (actor.type === 'npc' && actor.data.data.details?.type) {
        suffixes.push(actor.data.data.details.type.custom);
        suffixes.push(actor.data.data.details.type.value);
      }
    }
    prefixes = prefixes.map(prefix => prefix ? `${prefix}.` : '');
    suffixes = suffixes.map(suffix => suffix ? `.${suffix}` : '');
    
    {
      // TODO could also detect midi flags => should probably contact the author for permission
      let advantage = false;
      let disadvantage = false;
      for (const prefix of prefixes) {
        for (const suffix of suffixes) {
          if (getProperty(actor.data._source, `flags.${staticValues.moduleName}.attack.${prefix}advantage${suffix}`) > 0) {
            advantage = true;
          }
          if (getProperty(actor.data._source, `flags.${staticValues.moduleName}.attack.${prefix}disadvantage${suffix}`) > 0) {
            disadvantage = true;
          }
        }
      }
      
      if (advantage) {
        advantageSources.push({
          uuid$: actor.uuid,
          image$: actor.img,
          name$: actor.data.name,
        });
      }
      if (disadvantage) {
        disadvantageSources.push({
          uuid$: actor.uuid,
          image$: actor.img,
          name$: actor.data.name,
        });
      }
    }

    for (const effect of actor.getEmbeddedCollection(ActiveEffect.name) as any as Array<ActiveEffect>) {
      let advantage = false;
      let disadvantage = false;

      for (const prefix of prefixes) {
        for (const suffix of suffixes) {
          for (const change of effect.data.changes) {
            if (change.key === `data.flags.${staticValues.moduleName}.attack.${prefix}advantage${suffix}`) {
              advantage = true;
            }
            if (change.key === `data.flags.${staticValues.moduleName}.attack.${prefix}disadvantage${suffix}`) {
              disadvantage = true;
            }
          }
        }
      }

      if (advantage) {
        advantageSources.push({
          uuid$: effect.uuid,
          image$: effect.data.icon,
          name$: effect.sourceName ?? effect.name,
        });
      }
      if (disadvantage) {
        disadvantageSources.push({
          uuid$: effect.uuid,
          image$: effect.data.icon,
          name$: effect.sourceName ?? effect.name,
        });
      }
    }

    return {
      advantage: advantageSources,
      disadvantage: disadvantageSources,
    }
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
  
  private getTargetSerializer({event}: {event: Event}): {selectionId: string} {
    return {
      selectionId: (event.target as Element).closest('[data-selection-id]')?.getAttribute('data-selection-id'),
    }
  }
  
  private readonly getTargetCacheEnricher = (data: ChatPartIdData & ChatPartEnriched<AttackCardData> & {selectionId: string}): {targetCaches: TargetCache[]} => {
    if (data.selectionId === '*') {
      return {targetCaches: Array.from(this.getTargetCache([data.part.data]).values())};
    }
    return {targetCaches: [this.getTargetCache([data.part.data]).get(data.selectionId)]};
  }
  //#endregion

  //#region Targeting
  private getTargetState(context: StateContext): VisualState[] {
    const visualStates: VisualState[] = [];

    const attackParts: ModularCardPartData<AttackCardData>[] = context.allMessageParts.filter(part => part.type === this.getType() && ModularCard.getTypeHandler(part.type) instanceof AttackCardPart);
    if (attackParts.length === 0) {
      return [];
    }

    const cache = this.getTargetCache(attackParts.map(attack => attack.data));
    for (let i = 0; i < attackParts.length; i++) {
      const attack = attackParts[i];
      for (const selected of context.selected) {
        let rowValue: string;
        const canReadAttack = UtilsDocument.hasPermissions([{
          uuid: attack.data.actorUuid$,
          user: game.user,
          permission: `${staticValues.code}ReadAttack`,
        }], {sync: true}).every(permission => permission.result);
        let canSeeAc: boolean;
        const targetCache = cache.get(selected.selectionId);
        if (targetCache) {
          canSeeAc = UtilsDocument.hasPermissions([{
            uuid: targetCache.actorUuid$,
            user: game.user,
            permission: `Observer`,
          }], {sync: true}).every(permission => permission.result);
        } else {
          canSeeAc = false;
        }
        const canSeeTotal = game.settings.get(staticValues.moduleName, 'attackHiddenRoll') === 'total';
        if (!attack.data.rolls$[targetCache?.selectedRoll$]?.roll$?.evaluated || !canSeeAc) {
          rowValue = '';
        } else if (!canReadAttack && !canSeeTotal) {
          rowValue = '';
        } else {
          const styles = ['text-align: center'];
          let resultType = targetCache?.resultType$;
          if (!canReadAttack && canSeeTotal) {
            if (resultType === 'critical-hit') {
              resultType = 'hit';
            } else if (resultType === 'critical-mis') {
              resultType = 'mis';
            }
          }
          const roll = attack.data.rolls$[targetCache?.selectedRoll$]?.roll$;
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
              rowValue = `<div style="${styles.join(';')};" title="${game.i18n.localize('DND5E.AC')}: ${cache.get(selected.selectionId).ac$} <= ${roll?.total}">✓</div>`;
              break;
            }
            case 'mis': {
              styles.push('color: red');
              rowValue = `<div style="${styles.join(';')};" title="${game.i18n.localize('DND5E.AC')}: ${cache.get(selected.selectionId).ac$} <= ${roll?.total}">✗</div>`;
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
            </div> ${(attackParts.length === 1) ? '' : ` ${i+1}`}`,
            rowValue: rowValue,
          }],
        })
      }
    }

    return visualStates;
  }

  private getTargetCache(caches: AttackCardData[]): Map<string, TargetCache> {
    const cacheMap = new Map<string, TargetCache>();
    for (const cache of caches) {
      for (const targetCache of cache.targetCaches$) {
        cacheMap.set(targetCache.selectionId$, targetCache);
      }
    }
    return cacheMap;
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
      const allSelectionIds = new Set<string>();
      const cachedSelectionIds = new Set<string>();
      for (const selected of newRow.part.data.selected) {
        allSelectionIds.add(selected.selectionId);
      }
      for (const part of newRow.allParts) {
        if (!ModularCard.isType<AttackCardData>(AttackCardPart.instance, part)) {
          continue;
        }
        for (const target of part.data.targetCaches$) {
          target.isSelected$ = allSelectionIds.has(target.selectionId$);
          cachedSelectionIds.add(target.selectionId$);
        }
      }

      for (const selected of newRow.part.data.selected) {
        if (!cachedSelectionIds.has(selected.selectionId)) {
          missingTargetUuids.add(selected.tokenUuid);
        }
      }
    }

    if (missingTargetUuids.size === 0) {
      return;
    }

    // Cache the values of the tokens
    const tokens = await UtilsDocument.tokenFromUuid(missingTargetUuids);
    for (const {newRow} of context.rows) {

      for (const part of newRow.allParts) {
        if (!ModularCard.isType<AttackCardData>(AttackCardPart.instance, part)) {
          continue;
        }
        const cachedSelectionIds = new Set<string>();
        for (const target of part.data.targetCaches$) {
          cachedSelectionIds.add(target.selectionId$);
        }

        for (const selected of newRow.part.data.selected) {
          if (!cachedSelectionIds.has(selected.selectionId)) {
            const actor = (tokens.get(selected.tokenUuid).getActor() as MyActor);
            part.data.targetCaches$.push({
              phase: 'mode-select',
              mode: 'normal',
              userBonus: '',
              isSelected$: true,
              advantageSources$: [],
              disadvantageSources$: [],
              targetUuid$: selected.tokenUuid,
              selectionId$: selected.selectionId,
              actorUuid$: actor.uuid,
              ac$: actor.data.data.attributes.ac.value,
              name$: tokens.get(selected.tokenUuid).name,
            });
            cachedSelectionIds.add(selected.selectionId);
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
    this.linkTargetsWithRolls(context);
  }

  private calcIsCrit(context: IDmlContext<ModularCardTriggerData<AttackCardData>>): void {
    for (const {newRow} of context.rows) {
      for (const roll of newRow.part.data.rolls$) {
        if (!roll.roll$.evaluated) {
          roll.isCrit$ = false;
        } else {
          const baseRollResult = roll.roll$.terms[0].results.filter(result => result.active)[0];
          roll.isCrit$ = baseRollResult?.result >= newRow.part.data.critTreshold$;
        }
      }

    }
  }

  private setDamageAsCrit(context: IDmlContext<ModularCardTriggerData<AttackCardData>>): void {
    for (const {newRow, oldRow} of context.rows) {
      // TODO change when damage is also per target
      const isCrit = newRow.part.data.rolls$.every(roll => roll.isCrit$);
      const wasCrit = oldRow == null ? false : oldRow.part.data.rolls$.every(roll => roll.isCrit$);
      if (isCrit !== wasCrit) {
        for (const part of newRow.allParts) {
          if (!ModularCard.isType<DamageCardData>(DamageCardPart.instance, part)) {
            continue;
          }
          
          if (part.data.phase === 'mode-select') {
            if (isCrit) {
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
        const roll = newRow.part.data.rolls$[targetCache.selectedRoll$];
        if (roll?.roll$?.evaluated) {
          const firstRoll = roll.roll$.terms[0].results.find(r => r.active);
          if (firstRoll.result === 20 || targetCache.ac$ <= roll.roll$.total) {
            // 20 always hits, lower crit treshold does not
            if (roll.isCrit$) {
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
      for (const targetCache of newRow.part.data.targetCaches$) {
        const newMode = this.calcAutoMode(newRow.part.data, targetCache);
        if (oldRow) {
          if (newMode !== this.calcAutoMode(oldRow.part.data, targetCache)) {
            targetCache.mode = newMode;
          }
        } else {
          targetCache.mode = newMode;
        }
      }
    }
  }

  private calcAutoMode(data: AttackCardData, target: TargetCache): TargetCache['mode'] {
    let modeIndex = 1;
    const advantageSources = data.advantageSources$.length + target.advantageSources$.length;
    if (advantageSources > 0) {
      modeIndex++;
    }
    const disadvantageSources = data.disadvantageSources$.length + target.disadvantageSources$.length;
    if (disadvantageSources > 0) {
      modeIndex--;
    }
    return modeOrder[modeIndex];
  }

  private linkTargetsWithRolls(context: IDmlContext<ModularCardTriggerData<AttackCardData>>): void {
    for (const {newRow} of context.rows) {
      const matchWithRolls: TargetCache[] = [];
      const activeCacheIds = [];
      for (const cache of newRow.part.data.targetCaches$) {
        if (cache.isSelected$) {
          matchWithRolls.push(cache);
          activeCacheIds.push(cache.selectionId$);
        } else {
          delete cache.selectedRoll$;
        }
      }

      const rollPriorityMap = new Map<number, string>();
      // Prio 1: initial roll
      for (let i = 0; i < newRow.part.data.rolls$.length; i++) {
        if (activeCacheIds.includes(newRow.part.data.rolls$[i].initialSelectionId$)) {
          rollPriorityMap.set(i, newRow.part.data.rolls$[i].initialSelectionId$);
        }
      }
      // Prio 2: retain if already linked
      let assignedSelectionIds = Array.from(rollPriorityMap.values());
      let pendingRollMatches = matchWithRolls.filter(cache => !assignedSelectionIds.includes(cache.selectionId$));
      for (const cache of pendingRollMatches) {
        if (cache.selectedRoll$ == null) {
          continue;
        }
        if (!rollPriorityMap.has(cache.selectedRoll$)) {
          rollPriorityMap.set(cache.selectedRoll$, cache.selectionId$);
        }
      }
      // Prio 3: Find any remaining rolls
      assignedSelectionIds = Array.from(rollPriorityMap.values());
      pendingRollMatches = matchWithRolls.filter(cache => !assignedSelectionIds.includes(cache.selectionId$));
      for (let i = 0; i < newRow.part.data.rolls$.length; i++) {
        if (pendingRollMatches.length === 0) {
          break;
        }
        if (rollPriorityMap.has(i)) {
          continue;
        }
        rollPriorityMap.set(i, pendingRollMatches.splice(0, 1)[0].selectionId$);
      }

      // Prio 4: No rolls can be reused => new roll
      for (const cache of pendingRollMatches) {
        const roll: AttackRoll = {
          initialSelectionId$: cache.selectionId$,
          roll$: UtilsRoll.toRollData(new Roll('0')), // placeholder
        };
        newRow.part.data.rolls$.push(roll);
        rollPriorityMap.set(newRow.part.data.rolls$.length-1, cache.selectionId$);
      }

      // Assign rolls
      const rollPriorityInvertedMap = new Map<string, number>();
      for (const [key, value] of rollPriorityMap.entries()) {
        rollPriorityInvertedMap.set(value, key);
      }

      for (const cache of matchWithRolls) {
        cache.selectedRoll$ = rollPriorityInvertedMap.get(cache.selectionId$);
      }
    }
  }
  //#endregion

  //#region upsert
  public async upsert(context: IAfterDmlContext<ModularCardTriggerData<AttackCardData>>): Promise<void> {
    await this.calcAttackRoll(context);
    await this.rollAttack(context);
  }

  private async calcAttackRoll(context: IDmlContext<ModularCardTriggerData<AttackCardData>>): Promise<void> {
    for (const {newRow} of context.rows) {
      for (const targetCache of newRow.part.data.targetCaches$) {
        if (!targetCache.isSelected$) {
          delete targetCache.requestRollFormula$;
          continue;
        }

        let baseRoll = new Die({faces: 20, number: 1});
        if (newRow.part.data.hasHalflingLucky$) {
          // reroll a base roll 1 once
          // first 1 = maximum reroll 1 die not both at (dis)advantage (see PHB p173)
          // second 2 = reroll when the roll result is equal to 1 (=1)
          baseRoll.modifiers.push('r1=1');
        }
        switch (targetCache.mode) {
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
        
        if (targetCache.userBonus && Roll.validate(targetCache.userBonus)) {
          parts.push(targetCache.userBonus);
        }

        targetCache.requestRollFormula$ = UtilsRoll.simplifyTerms(new Roll(parts.join(' + '))).formula;
      }
    }
  }

  private async rollAttack(context: IDmlContext<ModularCardTriggerData<AttackCardData>>): Promise<void> {
    const showRolls: PermissionCheck<Roll>[] = [];
    for (const {newRow, oldRow} of context.rows) {
      const oldTargets = new Map<string, TargetCache>();
      for (const targetCache of oldRow?.part?.data?.targetCaches$ ?? []) {
        oldTargets.set(targetCache.selectionId$, targetCache)
      }
      for (const targetCache of newRow.part.data.targetCaches$) {
        const attackRoll = newRow.part.data.rolls$[targetCache.selectedRoll$];
        if (!attackRoll) {
          continue;
        }
        if (targetCache.requestRollFormula$ !== oldTargets.get(targetCache.selectionId$)?.requestRollFormula$) {
          const oldRoll = UtilsRoll.fromRollData(attackRoll.roll$);
          const result = await UtilsRoll.setRoll(oldRoll, targetCache.requestRollFormula$);
          attackRoll.roll$ = UtilsRoll.toRollData(result.result);
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

        // Execute initial roll
        if ((targetCache.phase === 'result') && attackRoll.roll$.evaluated !== true) {
          const roll = UtilsRoll.fromRollData(attackRoll.roll$);
          attackRoll.roll$ = UtilsRoll.toRollData(await roll.roll({async: true}));
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

  //#region afterUpdate
  public afterUpdate(context: IAfterDmlContext<ModularCardTriggerData<AttackCardData>>): void | Promise<void> {
    this.onBonusChange(context);
  }
  
  private onBonusChange(context: IDmlContext<ModularCardTriggerData<AttackCardData>>): void {
    for (const {newRow, oldRow, changedByUserId} of context.rows) {
      if (changedByUserId !== game.userId) {
        continue;
      }
      const oldTargets = new Map<string, TargetCache>();
      for (const targetCache of oldRow?.part?.data?.targetCaches$ ?? []) {
        oldTargets.set(targetCache.selectionId$, targetCache)
      }
      for (const targetCache of newRow.part.data.targetCaches$) {
        const oldTargetCache = oldTargets.get(targetCache.selectionId$);
        if (targetCache.phase === 'bonus-input' && oldTargetCache?.phase !== 'bonus-input') {
          MemoryStorageService.setFocusedElementSelector(`${AttackCardPart.instance.getSelector()}[data-message-id="${newRow.messageId}"][data-part-id="${newRow.part.id}"] [data-selection-id="${targetCache.selectionId$}"] input.user-bonus`);
          return;
        }
      }
    }
  }
  //#endregion 

}