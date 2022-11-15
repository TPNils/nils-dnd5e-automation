
import { ElementBuilder, ElementCallbackBuilder } from "../../elements/element-builder";
import { ITrigger, IDmlContext, IAfterDmlContext } from "../../lib/db/dml-trigger";
import { UtilsDocument, PermissionCheck } from "../../lib/db/utils-document";
import { RunOnce } from "../../lib/decorator/run-once";
import { UtilsDiceSoNice } from "../../lib/roll/utils-dice-so-nice";
import { TermData, RollData, UtilsRoll } from "../../lib/roll/utils-roll";
import { UtilsObject } from "../../lib/utils/utils-object";
import { staticValues } from "../../static-values";
import { MyActor, DamageType } from "../../types/fixed-types";
import { ItemCardHelpers } from "../item-card-helpers";
import { ModularCard, ModularCardPartData, ModularCardTriggerData } from "../modular-card";
import { ModularCardPart, ModularCardCreateArgs, createPermissionCheck, CreatePermissionCheckArgs, HtmlContext } from "../modular-card-part";
import { AttackCardData, AttackCardPart } from "./attack-card-part";
import { State, StateContext, TargetCallbackData, TargetCardData, TargetCardPart, VisualState } from "./target-card-part";

interface TargetCache {
  selectionId: string;
  targetUuid: string;
  actorUuid: string;
  immunities?: string[];
  resistances?: string[];
  vulnerabilities?: string[];
  // TODO store requested action => can and should be used to auto apply when there is no attack or check
  smartState: State['state'];
  appliedState: State['state'];
  // What has actually been applied, accounting the current hp at the time when applied
  appliedFailedDeathSaved: number;
  appliedHpChange: number;
  appliedTmpHpChange: number;
  // What a calculation thinks should be applied, not accounting for current hp
  calcFailedDeathSaved: number;
  calcHpChange: number;
  calcAddTmpHp: number;
}

export interface DamageCardData {
  phase: 'mode-select' | 'bonus-input' | 'result';
  mode: 'normal' | 'critical';
  source: 'normal' | 'versatile';
  userBonus?: string;
  calc$: {
    actorUuid?: string;
    label: string;
    modfierRule?: 'save-full-dmg' | 'save-halve-dmg' | 'save-no-dmg';
    normalBaseRoll: TermData[];
    versatileBaseRoll?: TermData[];
    upcastRoll?: TermData[];
    actorBonusRoll?: TermData[];
    requestRollFormula: string;
    roll?: RollData;
    displayFormula?: string;
    displayDamageTypes?: string;
    targetCaches: TargetCache[]
  }
}

const rollBaseKeys = ['normalBaseRoll', 'versatileBaseRoll'] as const;

function setTargetCache(cache: DamageCardData, targetCache: TargetCache): void {
  if (!cache.calc$.targetCaches) {
    cache.calc$.targetCaches = [];
  }
  if (targetCache.smartState == null) {
    if (targetCache.appliedHpChange === targetCache.calcHpChange && targetCache.appliedTmpHpChange === targetCache.calcAddTmpHp) {
      targetCache.smartState = 'applied';
    } else if (targetCache.appliedHpChange === 0 && targetCache.appliedTmpHpChange === 0) {
      targetCache.smartState = 'not-applied';
    } else {
      targetCache.smartState = 'partial-applied';
    }
  }
  for (let i = 0; i < cache.calc$.targetCaches.length; i++) {
    if (cache.calc$.targetCaches[i].selectionId === targetCache.selectionId) {
      cache.calc$.targetCaches[i] = targetCache;
      return;
    }
  }
  cache.calc$.targetCaches.push(targetCache);
}

function getTargetCache(cache: DamageCardData, selectionId: string): TargetCache | null {
  if (!cache.calc$.targetCaches) {
    return null;
  }
  for (const targetCache of cache.calc$.targetCaches) {
    if (targetCache.selectionId === selectionId) {
      return targetCache;
    }
  }
  return null;
}

export class DamageCardPart implements ModularCardPart<DamageCardData> {

  public static readonly instance = new DamageCardPart();
  protected constructor(){}

  public async create({item, actor}: ModularCardCreateArgs): Promise<DamageCardData> {
    // TODO what about other interactions like hunters mark (automatic, but only to a specific target)
    const rollData: {[key: string]: any} = item.getRollData();
    if (item.data.data.prof?.hasProficiency) {
      rollData.prof = item.data.data.prof.term;
    }

    let hasDamage = false;
    const inputDamages: DamageCardData = {
      mode: 'normal',
      phase: 'mode-select',
      source: 'normal',
      calc$: {
        label: 'DND5E.Damage',
        normalBaseRoll: UtilsRoll.toRollData(new Roll('0')).terms,
        requestRollFormula: '',
        targetCaches: [],
      }
    };
    // Main damage
    {
      const damageParts = item.data.data.damage?.parts;
      if (damageParts && damageParts.length > 0) {
        hasDamage = true;
        inputDamages.calc$.normalBaseRoll = UtilsRoll.toRollData(UtilsRoll.damagePartsToRoll(damageParts, rollData)).terms;
      }
    }

    // Versatile damage => this is hidden when no damage parts are shown
    //  => Ignore versatile damage if no 'primary' damage is specified
    if (hasDamage && item.data.data.damage?.versatile) {
      hasDamage = true;
      inputDamages.calc$.versatileBaseRoll = UtilsRoll.toRollData(new Roll(item.data.data.damage.versatile, rollData)).terms;
      const versatileTermWithDamageType = inputDamages.calc$.versatileBaseRoll.find(term => UtilsRoll.toDamageType(term.options?.flavor));
      if (!versatileTermWithDamageType) {
        const noramlTermWithDamageType = inputDamages.calc$.versatileBaseRoll.find(term => UtilsRoll.toDamageType(term.options?.flavor));
        if (noramlTermWithDamageType) {
          for (const term of inputDamages.calc$.versatileBaseRoll) {
            term.options = term.options ?? {};
            term.options.flavor = noramlTermWithDamageType.options.flavor;
          }
        }
      }
    }

    // Spell scaling
    const scaling = item.data.data.scaling;
    if (scaling?.mode === 'level' && scaling.formula) {
      const originalItem = await UtilsDocument.itemFromUuid(item.uuid);
      if (originalItem && item.data.data.level > originalItem.data.data.level) {
        const upcastLevels = item.data.data.level - originalItem.data.data.level;
        const scalingRollJson: TermData[] = UtilsRoll.toRollData(new Roll(scaling.formula, rollData).alter(upcastLevels, 0)).terms;
        inputDamages.calc$.upcastRoll = scalingRollJson;
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
        for (const rollBaseKey of rollBaseKeys) {
          // DND5e spell compendium has cantrip formula empty => default to the base damage formula
          const currentValue: TermData[] = inputDamages.calc$[rollBaseKey];
          if (!currentValue) {
            continue;
          }
          const currentRoll = UtilsRoll.fromRollTermData(currentValue);
          let scalingFormula = scaling.formula == null || scaling.formula.length === 0 ? Roll.getFormula(currentValue.map(RollTerm.fromData)) : scaling.formula;
          let scalingDamageType: DamageType = '';
          for (let i = currentValue.length - 1; i >= 0; i--) {
            const flavor = currentValue[i].options.flavor;
            const damageType = UtilsRoll.toDamageType(flavor);
            if (damageType != null) {
              scalingDamageType = damageType;
              break;
            }
          }
          if (scalingDamageType) {
            scalingFormula += `[${scalingDamageType}]`;
          }
          const scalingRoll = new Roll(scalingFormula, rollData, deepClone(currentRoll.options)).alter(applyScalingXTimes, 0, {multiplyNumeric: true});
          // Override normal roll since cantrip scaling is static, not dynamic like level scaling
          inputDamages.calc$[rollBaseKey] = UtilsRoll.toRollData(UtilsRoll.mergeRolls(currentRoll, scalingRoll)).terms;
        }
      }
    }
    
    if (!hasDamage) {
      for (const rollBaseKey of rollBaseKeys) {
        const currentValue: TermData[] = inputDamages.calc$[rollBaseKey];
        if (!currentValue) {
          continue;
        }
        if (currentValue.length === 0) {
          continue;
        }
        if (currentValue.length === 1 && currentValue[0].class === NumericTerm.name && (currentValue[0] as any).number === 0) {
          continue;
        }
        hasDamage = true;
      }
    }

    if (!hasDamage) {
      return null;
    }
    
    // Add damage bonus formula
    {
      const actorBonus = actor.data.data.bonuses?.[item.data.data.actionType];
      if (actorBonus?.damage && parseInt(actorBonus.damage) !== 0) {
        inputDamages.calc$.actorBonusRoll = UtilsRoll.toRollData(new Roll(actorBonus.damage, rollData)).terms;
      }
    }

    if (actor) {
      inputDamages.calc$.actorUuid = actor.uuid;
    }
    
    return inputDamages;
  }

  public async refresh(oldData: DamageCardData, args: ModularCardCreateArgs): Promise<DamageCardData> {
    const newData = await this.create(args);

    if (!newData) {
      return null;
    }
    if (!oldData) {
      return newData;
    }

    const result = deepClone(oldData);
    result.calc$ = newData.calc$;
    result.calc$.roll = oldData.calc$.roll;// contains already rolled dice which should not be discarded
    result.calc$.targetCaches = oldData.calc$.targetCaches;// contains already applied damage values
    return result;
  }

  @RunOnce()
  public registerHooks(): void {
    const permissionCheck = createPermissionCheck<{part: {data: DamageCardData}}>(({part}) => {
      const documents: CreatePermissionCheckArgs['documents'] = [];
      if (part.data.calc$.actorUuid) {
        documents.push({uuid: part.data.calc$.actorUuid, permission: 'OWNER', security: true});
      }
      return {documents: documents};
    })
    new ElementBuilder()
      .listenForAttribute('data-part-id', 'string')
      .listenForAttribute('data-message-id', 'string')
      .addListener(new ElementCallbackBuilder()
        .setEvent('click')
        .addSelectorFilter('[data-action="item-damage"]')
        .addSerializer(ItemCardHelpers.getChatPartIdSerializer())
        .addSerializer(ItemCardHelpers.getUserIdSerializer())
        .addSerializer(ItemCardHelpers.getMouseEventSerializer())
        .addEnricher(ItemCardHelpers.getChatPartEnricher<DamageCardData>())
        .setPermissionCheck(permissionCheck)
        .setExecute(({messageId, part, click, allCardParts}) => {
          if (part.data.phase === 'result') {
            return;
          }
      
          const orderedPhases: DamageCardData['phase'][] = ['mode-select', 'bonus-input', 'result'];
          if (click.shiftKey) {
            part.data.phase = orderedPhases[orderedPhases.length - 1];
          } else {
            part.data.phase = orderedPhases[orderedPhases.indexOf(part.data.phase) + 1];
          }
          return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
        })
      )
      .addListener(new ElementCallbackBuilder()
        .setEvent('click')
        .addSelectorFilter('[data-action="item-damage-source-toggle"]')
        .addSerializer(ItemCardHelpers.getChatPartIdSerializer())
        .addSerializer(ItemCardHelpers.getUserIdSerializer())
        .addSerializer(ItemCardHelpers.getMouseEventSerializer())
        .addEnricher(ItemCardHelpers.getChatPartEnricher<DamageCardData>())
        .setPermissionCheck(permissionCheck)
        .setExecute(({messageId, part, allCardParts, click}) => {
          if (part.data.source === 'normal' && part.data.calc$.versatileBaseRoll != null) {
            part.data.source = 'versatile';
          } else {
            part.data.source = 'normal';
          }
          if (click.shiftKey) {
            part.data.phase = 'result';
          }
          return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
        })
      )
      .addListener(new ElementCallbackBuilder()
        .setEvent('focusout')
        .addSelectorFilter('input[data-action="item-damage-bonus"]')
        .addSerializer(ItemCardHelpers.getChatPartIdSerializer())
        .addSerializer(ItemCardHelpers.getUserIdSerializer())
        .addSerializer(context => ({inputValue: (context.event.target as HTMLInputElement).value}))
        .addEnricher(ItemCardHelpers.getChatPartEnricher<DamageCardData>())
        .setPermissionCheck(permissionCheck)
        .setExecute(({messageId, allCardParts, part, inputValue}) => {
          if (inputValue && !Roll.validate(inputValue)) {
            // Only show error on key press
            throw new Error(game.i18n.localize('Error') + ': ' + game.i18n.localize('Roll Formula'));
          }
          part.data.phase = 'mode-select';
          part.data.userBonus = inputValue ?? '';
          return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
        })
      )
      .addListener(new ElementCallbackBuilder()
        .setEvent('keypress')
        .addSelectorFilter('input[data-action="item-damage-bonus"]')
        .addSerializer(ItemCardHelpers.getChatPartIdSerializer())
        .addSerializer(ItemCardHelpers.getUserIdSerializer())
        .addSerializer(ItemCardHelpers.getKeyEventSerializer())
        .addSerializer(ItemCardHelpers.getInputSerializer())
        .addEnricher(ItemCardHelpers.getChatPartEnricher<DamageCardData>())
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
        .addEnricher(ItemCardHelpers.getChatPartEnricher<DamageCardData>())
        .setPermissionCheck(permissionCheck)
        .setExecute(({messageId, allCardParts, part, click, action}) => {
          let modifier = action === 'mode-plus' ? 1 : -1;
          if (click.shiftKey && modifier > 0) {
            modifier++;
          } else if (click.shiftKey && modifier < 0) {
            modifier--;
          }
          
          const order: Array<DamageCardData['mode']> = ['normal', 'critical'];
          const newIndex = Math.max(0, Math.min(order.length-1, order.indexOf(part.data.mode) + modifier));
          if (part.data.mode === order[newIndex]) {
            return;
          }
          part.data.mode = order[newIndex];

          if (click.shiftKey) {
            part.data.phase = 'result';
          }
          return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
        })
      )
      .addOnAttributeChange(async ({element, attributes}) => {
        return ItemCardHelpers.ifAttrData({attr: attributes, element, type: this, callback: async ({part}) => {
          element.innerHTML = await renderTemplate(
            `modules/${staticValues.moduleName}/templates/modular-card/damage-part.hbs`, {
              data: part.data,
              moduleName: staticValues.moduleName
            }
          );
        }});
      })
      .build(this.getSelector())

    ModularCard.registerModularCardPart(staticValues.moduleName, this);
    ModularCard.registerModularCardTrigger(this, new DamageCardTrigger());
    ModularCard.registerModularCardTrigger(TargetCardPart.instance, new TargetCardTrigger());
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
  //#endregion

  //#region Targeting
  private async targetCallback(targetEvents: TargetCallbackData[]): Promise<void> {
    // TODO seems bugged, smart apply applies when check has succeeded
    //  Also: when succeeded cantrip save => no damage, otherwise halve
    const tokenDocuments = await UtilsDocument.tokenFromUuid(targetEvents.map(d => d.selected.tokenUuid));
    let tokenHpSnapshot = new Map<string, {hp: number; failedDeathSaves: number; maxHp: number; tempHp: number}>();
    for (const token of tokenDocuments.values()) {
      const actor: MyActor = token.getActor();
      tokenHpSnapshot.set(token.uuid, {
        hp: actor.data.data.attributes.hp.value,
        failedDeathSaves: actor.data.data.attributes.death?.failure,
        maxHp: actor.data.data.attributes.hp.max,
        tempHp: actor.data.data.attributes.hp.temp ?? 0,
      });
    }
    for (const targetEvent of targetEvents) {
      const snapshot = tokenHpSnapshot.get(targetEvent.selected.tokenUuid);
      const tokenHp = deepClone(snapshot);
      
      const attackCards: ModularCardPartData<AttackCardData>[] = targetEvent.messageCardParts
        .filter(part => ModularCard.isType<AttackCardData>(AttackCardPart.instance, part));
      const damagesCards: ModularCardPartData<DamageCardData>[] = targetEvent.messageCardParts
        .filter(part => ModularCard.isType<DamageCardData>(DamageCardPart.instance, part));

      // Undo already applied damage
      for (const dmg of damagesCards) {
        const cache = getTargetCache(dmg.data, targetEvent.selected.selectionId);
        if (!cache) {
          continue;
        }
        tokenHp.hp -= cache.appliedHpChange;
        tokenHp.tempHp -= cache.appliedTmpHpChange;
        tokenHp.failedDeathSaves -= cache.appliedFailedDeathSaved;
      }

      // Calculate (new) damage
      for (const dmg of damagesCards) {
        const cache = deepClone(getTargetCache(dmg.data, targetEvent.selected.selectionId));
        let apply = false;
        delete cache.smartState;
        switch (targetEvent.apply) {
          case 'smart-apply': {
            const allHit = attackCards.every(attack => {
              const hitType = attack.data.targetCaches$.find(target => target.targetUuid$ === targetEvent.selected.tokenUuid)?.resultType$;
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

          // PHB p198. Temp HP does not stack => take the highest
          tokenHp.tempHp = Math.max(cache.calcAddTmpHp, tokenHp.tempHp);
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
            selectionId: targetEvent.selected.selectionId,
            targetUuid: targetEvent.selected.tokenUuid,
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
            selectionId: targetEvent.selected.selectionId,
            targetUuid: targetEvent.selected.tokenUuid,
            appliedState: 'not-applied',
            appliedHpChange: tokenHp.hp - originalHp,
            appliedTmpHpChange: 0,
            appliedFailedDeathSaved: 0,
          });
        }
      }

      tokenHpSnapshot.set(targetEvent.selected.tokenUuid, tokenHp);
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
    const states = new Map<string, Omit<VisualState, 'columns'> & {hpDiff: number, hidden: boolean}>();
    for (const selected of context.selected) {
      states.set(selected.selectionId, {selectionId: selected.selectionId, tokenUuid: selected.tokenUuid, hpDiff: 0, hidden: false});
    }
    for (const part of context.allMessageParts) {
      if (!ModularCard.isType<DamageCardData>(this, part)) {
        continue;
      }

      for (const targetCache of part.data.calc$.targetCaches) {
        if (!states.has(targetCache.selectionId)) {
          states.set(targetCache.selectionId, {selectionId: targetCache.selectionId, tokenUuid: targetCache.targetUuid, hpDiff: 0, hidden: false});
        }
        const state = states.get(targetCache.selectionId);
        if (state.state == null) {
          state.state = targetCache.appliedState;
        }
        if (state.smartState == null) {
          state.smartState = targetCache.smartState;
        }
        
        if (state.state !== targetCache.appliedState) {
          state.state === 'partial-applied';
        }
        if (state.smartState !== targetCache.smartState) {
          state.smartState === 'partial-applied';
        }

        // TODO this is weird right now, if damage is hidden you cant see it
        //      but you can apply it to yourself, this should be improved
        let canSeeDamage: boolean;
        if (part.data.calc$.actorUuid) {
          canSeeDamage = game.settings.get(staticValues.moduleName, 'damageHiddenRoll') === 'total';
          if (!canSeeDamage) {
            UtilsDocument.hasAllPermissions([{
              uuid: part.data.calc$.actorUuid,
              permission: `${staticValues.code}ReadDamage`,
              user: game.user,
            }], {sync: true});
          }
        } else {
          canSeeDamage = game.user.isGM;
        }
        const canSeeTarget = UtilsDocument.hasAllPermissions([{
          uuid: targetCache.actorUuid,
          permission: `${staticValues.code}ReadImmunity`,
          user: game.user,
        }], {sync: true});
        if (canSeeDamage && canSeeTarget) {
          state.hpDiff += (targetCache.calcHpChange ?? 0);
          state.hpDiff += (targetCache.calcAddTmpHp ?? 0);
        } else {
          state.hpDiff = null;
          state.hidden = true;
        }
      }
    }

    const contextSelectionIds = context.selected.map(s => s.selectionId);
    return Array.from(states.values())
      .filter(state => state.state !== 'not-applied' || contextSelectionIds.includes(state.selectionId))
      .map(state => {
        const visualState: VisualState = {
          selectionId: state.selectionId,
          tokenUuid: state.tokenUuid,
          columns: [],
        };
        if (state.state != null) {
          visualState.state = state.state;
        }
        if (state.smartState != null) {
          visualState.smartState = state.smartState;
        }

        const column: VisualState['columns'][0] = {
          key: 'dmg',
          label: `<i class="fas fa-heart" title="${game.i18n.localize('DND5E.Damage')}"></i>`,
          rowValue: '',
        };
        if (state.hidden) {
          column.rowValue = '?';
        } else if (state.hpDiff === 0) {
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
  //#endregion

}

class TargetCardTrigger implements ITrigger<ModularCardTriggerData<TargetCardData>> {
  
  //#region upsert
  public async upsert(context: IAfterDmlContext<ModularCardTriggerData<TargetCardData>>): Promise<void> {
    await this.calcTargetCache(context);
  }

  private async calcTargetCache(context: IDmlContext<ModularCardTriggerData<TargetCardData>>): Promise<void> {
    const recalcTokens: Array<{selectionId: string, tokenUuid: string, data: DamageCardData}> = [];
    for (const {newRow, oldRow} of context.rows) {
      const damageParts: DamageCardData[] = newRow.allParts
        .filter(part => ModularCard.isType<DamageCardData>(DamageCardPart.instance, part))
        .map(part => part.data);
      if (damageParts.length === 0) {
        continue;
      }
      const oldSelectionIds = (oldRow as ModularCardTriggerData<TargetCardData>)?.part?.data?.selected.map(s => s.selectionId) ?? [];
      for (const target of newRow.part.data.selected) {
        if (!oldSelectionIds.includes(target.selectionId)) {
          for (const dmg of damageParts) {
            recalcTokens.push({selectionId: target.selectionId, tokenUuid: target.tokenUuid, data: dmg});
          }
        }
      }
    }

    const allTokenUuids = new Set<string>();
    for (const token of recalcTokens) {
      allTokenUuids.add(token.tokenUuid);
    }

    if (allTokenUuids.size === 0) {
      return;
    }

    const tokenMap = await UtilsDocument.tokenFromUuid(allTokenUuids);

    for (const recalcToken of recalcTokens) {
      const token = tokenMap.get(recalcToken.tokenUuid);
      const actor = (token.getActor() as MyActor);
      if (!token) {
        continue;
      }
      let cache: TargetCache = getTargetCache(recalcToken.data, recalcToken.selectionId);
      if (cache === null) {
        cache = {
          selectionId: recalcToken.selectionId,
          targetUuid: recalcToken.tokenUuid,
          actorUuid: actor?.uuid,
          smartState: 'not-applied',
          appliedState: 'not-applied',
          calcAddTmpHp: 0,
          calcFailedDeathSaved: 0,
          calcHpChange: 0,
          appliedTmpHpChange: 0,
          appliedFailedDeathSaved: 0,
          appliedHpChange: 0,
        }
      }

      if (actor) {
        cache.immunities = [...actor.data.data.traits.di.value, ...(actor.data.data.traits.di.custom === '' ? [] : actor.data.data.traits.di.custom.split(';'))];
        cache.resistances = [...actor.data.data.traits.dr.value, ...(actor.data.data.traits.dr.custom === '' ? [] : actor.data.data.traits.dr.custom.split(';'))];
        cache.vulnerabilities = [...actor.data.data.traits.dv.value, ...(actor.data.data.traits.dv.custom === '' ? [] : actor.data.data.traits.dv.custom.split(';'))];
      } else {
        cache.immunities = [];
        cache.resistances = [];
        cache.vulnerabilities = [];
      }
      
      setTargetCache(recalcToken.data, cache);
    }
  }
  //#endregion

}

class DamageCardTrigger implements ITrigger<ModularCardTriggerData<DamageCardData>> {

  //#region beforeUpsert
  public beforeUpsert(context: IDmlContext<ModularCardTriggerData<DamageCardData>>): boolean | void {
    this.calculateLabel(context);
    this.calculateRollDisplay(context);
    this.calcTargetCache(context);
  }

  private calculateLabel(context: IDmlContext<ModularCardTriggerData<DamageCardData>>): void {
    for (const {newRow} of context.rows) {
      if (newRow.part.data.mode === 'critical') {
        newRow.part.data.calc$.label = 'DND5E.Critical';
        continue;
      }

      const baseRoll = newRow.part.data.source === 'versatile' ? newRow.part.data.calc$.versatileBaseRoll : newRow.part.data.calc$.normalBaseRoll;
      const damageTypes: DamageType[] = baseRoll.map(roll => roll.options?.flavor).map(flavor => UtilsRoll.toDamageType(flavor)).filter(type => type != null);
      const isHealing = damageTypes.length > 0 && damageTypes.every(damageType => ItemCardHelpers.healingDamageTypes.includes(damageType));
      if (isHealing) {
        newRow.part.data.calc$.label = 'DND5E.Healing';
      } else {
        if (newRow.part.data.source === 'versatile') {
          newRow.part.data.calc$.label = 'DND5E.Versatile';
        } else {
          newRow.part.data.calc$.label = 'DND5E.Damage';
        }
      }
    }
  }

  private calculateRollDisplay(context: IDmlContext<ModularCardTriggerData<DamageCardData>>): void {
    for (const {newRow} of context.rows) {
      if (!newRow.part.data.calc$.roll) {
        newRow.part.data.calc$.displayFormula = null;
        newRow.part.data.calc$.displayDamageTypes = null;
        continue;
      }
    
      const damageTypes: DamageType[] = [];
      let shortenedFormula = newRow.part.data.calc$.roll.formula;
      for (const damageType of UtilsRoll.getValidDamageTypes()) {
        if (shortenedFormula.match(`\\[${damageType}\\]`)) {
          damageTypes.push(damageType);
          shortenedFormula = shortenedFormula.replace(new RegExp(`\\[${damageType}\\]`, 'g'), '');
        }
      }

      // formula without damage comments
      newRow.part.data.calc$.displayFormula = shortenedFormula;
      newRow.part.data.calc$.displayDamageTypes = damageTypes.length > 0 ? `(${damageTypes.sort().map(s => s.capitalize()).join(', ')})` : undefined;
    }
  }
  
  private calcTargetCache(context: IDmlContext<ModularCardTriggerData<DamageCardData>>): void {
    for (const {newRow} of context.rows) {
      for (const cache of newRow.part.data.calc$.targetCaches) {
        cache.calcAddTmpHp = 0;
        cache.calcHpChange = 0;
        cache.calcFailedDeathSaved = 0;
        if (newRow.part.data.calc$.roll?.evaluated) {
          for (let [dmgType, amount] of UtilsRoll.rollToDamageResults(UtilsRoll.fromRollData(newRow.part.data.calc$.roll)).entries()) {
            if (cache.immunities.includes(dmgType)) {
              continue;
            }
            if (cache.resistances.includes(dmgType)) {
              amount /= 2;
            }
            if (cache.vulnerabilities.includes(dmgType)) {
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

              // TODO calculate death saves.
              //  RAW: Crit = 2 fails
              //  RAW: magic missile = 1 damage source => 1 failed save
              //  RAW: Scorching Ray = multiple damage sources => multiple failed saves
            }
          }
        }
      }
    }
  }
  //#endregion

  //#region upsert
  public async upsert(context: IAfterDmlContext<ModularCardTriggerData<DamageCardData>>): Promise<void> {
    await this.calcDamageFormulas(context);
    // TODO auto apply healing, but it needs to be sync?
  }
  
  private async calcDamageFormulas(context: IDmlContext<ModularCardTriggerData<DamageCardData>>): Promise<void> {
    const showRolls: PermissionCheck<Roll>[] = [];
    for (const {newRow, oldRow} of context.rows) {
      const newRollTerms: TermData[] = [];
      for (const rollProperty of this.getRollProperties(newRow.part.data)) {
        if (newRollTerms.length > 0) {
          newRollTerms.push(new OperatorTerm({operator: '+'}).toJSON() as TermData);
        }
        newRollTerms.push(...(UtilsObject.getProperty(newRow.part.data, rollProperty)));
      }
      if (newRow.part.data.userBonus) {
        if (newRollTerms.length > 0) {
          newRollTerms.push(new OperatorTerm({operator: '+'}).toJSON() as TermData);
        }
        newRollTerms.push(...new Roll(newRow.part.data.userBonus).terms.map(t => t.toJSON() as TermData));
      }
      if (newRollTerms.length === 0) {
        newRollTerms.push(new NumericTerm({number: 0}).toJSON() as TermData);
      }
      
      // Store the requested formula seperatly since the UtilsRoll.setRoll may change it, causing an infinite loop to changing the formula
      newRow.part.data.calc$.requestRollFormula = UtilsRoll.createDamageRoll(newRollTerms.map(t => RollTerm.fromData(t)), {critical: newRow.part.data.mode === 'critical'}).formula;

      // Calc roll
      if (newRow.part.data.calc$.requestRollFormula !== oldRow?.part?.data?.calc$?.requestRollFormula) {
        if (!newRow.part.data.calc$.roll) {
          newRow.part.data.calc$.roll = UtilsRoll.toRollData(new Roll(newRow.part.data.calc$.requestRollFormula));
        } else {
          const oldRoll = UtilsRoll.fromRollData(newRow.part.data.calc$.roll);
          const result = await UtilsRoll.setRoll(oldRoll, newRow.part.data.calc$.requestRollFormula);
          newRow.part.data.calc$.roll = UtilsRoll.toRollData(result.result);
          if (result.rollToDisplay) {
            // Auto rolls if original roll was already evaluated
            for (const user of game.users.values()) {
              if (user.active) {
                showRolls.push({
                  uuid: newRow.part.data.calc$.actorUuid,
                  permission: `${staticValues.code}ReadDamage`,
                  user: user,
                  meta: result.rollToDisplay
                });
              }
            }
          }
        }
      }
      
      // Execute initial roll
      if ((newRow.part.data.phase === 'result') && newRow.part.data.calc$.roll?.evaluated !== true) {
        const roll = UtilsRoll.fromRollData(newRow.part.data.calc$.roll);
        newRow.part.data.calc$.roll = UtilsRoll.toRollData(await roll.roll({async: true}));
        for (const user of game.users.values()) {
          if (user.active) {
            showRolls.push({
              uuid: newRow.part.data.calc$.actorUuid,
              permission: `${staticValues.code}ReadDamage`,
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

  //#region helpers
  private getRollProperties(data: DamageCardData): string[][] {
    const rollProperties: string[][] = [];
    if (data.source === 'versatile') {
      rollProperties.push(['calc$', 'versatileBaseRoll']);
    } else {
      rollProperties.push(['calc$', 'normalBaseRoll']);
    }
    if (data.calc$.upcastRoll) {
      rollProperties.push(['calc$', 'upcastRoll']);
    }
    if (data.calc$.actorBonusRoll) {
      rollProperties.push(['calc$', 'actorBonusRoll']);
    }
    return rollProperties;
  }
  //#endregion

}