import { RollD20Element } from "../elements/roll-d20-element";
import { UtilsElement } from "../elements/utils-element";
import { IAfterDmlContext, IDmlContext, ITrigger } from "../lib/db/dml-trigger";
import { UtilsDocument } from "../lib/db/utils-document";
import { RunOnce } from "../lib/decorator/run-once";
import { UtilsDiceSoNice } from "../lib/roll/utils-dice-so-nice";
import { RollData, UtilsRoll } from "../lib/roll/utils-roll";
import { MemoryStorageService } from "../service/memory-storage-service";
import { staticValues } from "../static-values";
import { MyActor, MyActorData } from "../types/fixed-types";
import { RollJson } from "../utils/utils-chat-message";
import { ClickEvent, createElement, HtmlContext, ICallbackAction, KeyEvent } from "./card-part-element";
import { ModularCard, ModularCardPartData, ModularCardTriggerData } from "./modular-card";
import { createPermissionCheck, CreatePermissionCheckArgs, ModularCardCreateArgs, ModularCardPart } from "./modular-card-part";
import { StateContext, TargetCardData, TargetCardPart, VisualState } from "./target-card-part";

interface TargetCache {
  selectionId: string;
  targetUuid: string;
  actorUuid?: string;
  
  mode: 'normal' | 'advantage' | 'disadvantage';
  phase: 'mode-select' | 'bonus-input' | 'result';
  actorBonus: string;
  userBonus: string;
  hasHalflingLucky: boolean;
  minRoll?: number;
  requestRollFormula?: string;
  roll?: RollData;
  visibleToUsers: string[];
}

export interface CheckCardData {
  ability: keyof MyActor['data']['data']['abilities'];
  dc: number;
  skill?: keyof MyActorData['data']['skills'];
  iSave?: boolean;
  calc$: {
    targetCaches: TargetCache[];
  }
}

function getTargetCache(cache: CheckCardData, selectionId: string): TargetCache | null {
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

export class CheckCardPart implements ModularCardPart<CheckCardData> {

  public static readonly instance = new CheckCardPart();
  private constructor(){}
  
  public create({item, actor}: ModularCardCreateArgs): CheckCardData {
    if (!actor || item.data.data.save?.dc == null || !item.data.data.save?.ability) {
      return null;
    }

    return {
      ability: item.data.data.save?.ability,
      dc: item.data.data.save.dc,
      iSave: true,
      calc$: {
        targetCaches: []
      }
    };
  }

  public refresh(oldData: CheckCardData, args: ModularCardCreateArgs): CheckCardData {
    const newData = this.create(args);

    if (!newData) {
      return null;
    }
    if (!oldData) {
      return newData;
    }

    const result = deepClone(oldData);
    result.calc$ = newData.calc$;
    return result;
  }

  @RunOnce()
  public registerHooks(): void {
    createElement({
      selector: this.getSelector(),
      hasSubType: true,
      getHtml: context => this.getElementHtml(context),
      getCallbackActions: () => this.getCallbackActions(),
    });
    TargetCardPart.instance.registerIntegration({
      getVisualState: context => this.getTargetState(context),
    });
    ModularCard.registerModularCardPart(staticValues.moduleName, this);
    ModularCard.registerModularCardTrigger(new CheckCardTrigger());
  }

  public getType(): string {
    return this.constructor.name;
  }

  //#region Front end
  public getSelector(): string {
    return `${staticValues.code}-check-part`;
  }

  public getElementHtml({data, subType}: HtmlContext<CheckCardData>): string | Promise<string> {
    const cache = getTargetCache(data, subType);
    if (!cache) {
      return '';
    }
    const attributes = {
      ['data-roll']: cache.roll,
      ['data-bonus-formula']: cache.userBonus,
      ['data-show-bonus']: cache.phase === 'bonus-input',
    };
    if (data.iSave) {
      attributes['data-label'] = `DND5E.Ability${data.ability}`;
    } else {
      attributes['data-label'] = `DND5E.Skill${data.skill}`;
    }
    if (cache.actorUuid) {
      attributes['data-interaction-permission'] = `OwnerUuid:${cache.actorUuid}`
    }
    const attributeArray: string[] = [];
    for (let [attr, value] of Object.entries(attributes)) {
      attributeArray.push(`${attr}="${UtilsElement.serializeAttr(value)}"`);
    }
    return `<${RollD20Element.selector()} class="hide-flavor" ${attributeArray.join(' ')}></${RollD20Element.selector()}>`
  }


  public getCallbackActions(): ICallbackAction<CheckCardData>[] {
    const permissionCheck = createPermissionCheck<CheckCardData>(({data, subType}) => {
      const cache = getTargetCache(data, subType);
      if (!cache?.actorUuid) {
        return {mustBeGm: true};
      }
      const documents: CreatePermissionCheckArgs['documents'] = [];
      documents.push({uuid: cache.actorUuid, permission: 'OWNER'});
      return {documents: documents};
    })

    return [
      {
        regex: /^roll$/,
        permissionCheck: permissionCheck,
        execute: ({data, subType, clickEvent}) => this.doRoll(data, subType, clickEvent),
      },
      {
        regex: /^user-bonus$/,
        permissionCheck: permissionCheck,
        execute: ({data, subType, keyEvent, inputValue}) => this.onBonus(data, subType, keyEvent, inputValue as string),
      },
      {
        regex: /^mode-(minus|plus)$/,
        permissionCheck: permissionCheck,
        execute: ({data, subType, clickEvent, regexResult}) => this.changeMode(data, subType, clickEvent, regexResult[1] as ('plus' | 'minus')),
      },
    ]
  }

  private doRoll(data: CheckCardData, selectionId: string, clickEvent: ClickEvent | null): void {
    const cache = getTargetCache(data, selectionId);
    if (!cache || cache.phase === 'result') {
      return;
    }

    const orderedPhases: TargetCache['phase'][] = ['mode-select', 'bonus-input', 'result'];
    if (clickEvent?.shiftKey) {
      cache.phase = orderedPhases[orderedPhases.length - 1];
    } else {
      cache.phase = orderedPhases[orderedPhases.indexOf(cache.phase) + 1];
    }
  }
  
  private onBonus(data: CheckCardData, selectionId: string, keyEvent: KeyEvent | null, bonusFormula: string): void {
    const cache = getTargetCache(data, selectionId);
    if (!cache) {
      return;
    }

    if (bonusFormula && !Roll.validate(bonusFormula) && keyEvent) {
      // Only show error on key press
      throw new Error(game.i18n.localize('Error') + ': ' + game.i18n.localize('Roll Formula'));
    }
    if (bonusFormula) {
      cache.userBonus = bonusFormula;
    } else {
      cache.userBonus = "";
    }

    if (keyEvent?.key === 'Enter') {
      cache.phase = 'result';
    } else if (keyEvent?.key === 'Escape' && cache.phase === 'bonus-input') {
      cache.phase = 'mode-select';
    }
  }

  private async changeMode(data: CheckCardData, selectionId: string, event: ClickEvent | null, modName: 'plus' | 'minus'): Promise<void> {
    const cache = getTargetCache(data, selectionId);
    if (!cache) {
      return;
    }
    let modifier = modName === 'plus' ? 1 : -1;
    if (event?.shiftKey && modifier > 0) {
      modifier++;
    } else if (event?.shiftKey && modifier < 0) {
      modifier--;
    }
    
    const order: Array<TargetCache['mode']> = ['disadvantage', 'normal', 'advantage'];
    const newIndex = Math.max(0, Math.min(order.length-1, order.indexOf(cache.mode) + modifier));
    if (cache.mode === order[newIndex]) {
      return;
    }
    cache.mode = order[newIndex];

    if (event?.shiftKey) {
      cache.phase = 'result';
    }
  }
  //#endregion
  
  //#region Targeting
  private getTargetState(context: StateContext): VisualState[] {
    const visualStatesBySelectionId = new Map<string, VisualState>();

    let partNr = 0;
    for (const part of context.allMessageParts) {
      if (this.isThisPartType(part)) {
        for (const selected of context.selected) {
          if (!visualStatesBySelectionId.get(selected.selectionId)) {
            visualStatesBySelectionId.set(selected.selectionId, {
              selectionId: selected.selectionId,
              tokenUuid: selected.tokenUuid,
              columns: [],
            })
          }
          const visualState = visualStatesBySelectionId.get(selected.selectionId);
          visualState.columns.push({
            key: `${this.getType()}-check-${partNr}`,
            label: `Save`, // TODO label
            rowValue: `<${this.getSelector()} data-part-id="${part.id}" data-message-id="${context.messageId}" data-sub-type="${selected.selectionId}"></${this.getSelector()}>`
          });
        }

        partNr++;
      }
    }

    return Array.from(visualStatesBySelectionId.values());
  }

  private isThisPartType(row: ModularCardPartData): row is ModularCardPartData<CheckCardData> {
    return row.type === this.getType() && ModularCard.getTypeHandler(row.type) instanceof CheckCardPart;
  }
  //#endregion

}


class CheckCardTrigger implements ITrigger<ModularCardTriggerData> {

  //#region beforeUpsert
  public beforeUpsert(context: IDmlContext<ModularCardTriggerData<any>>): boolean | void {
    this.calcResultCache(context);
  }

  private calcResultCache(context: IDmlContext<ModularCardTriggerData>): void {
    /*for (const {newRow} of context.rows) {
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
    }*/
  }
  //#endregion

  //#region upsert
  public async upsert(context: IAfterDmlContext<ModularCardTriggerData>): Promise<void> {
    await this.addTargetCache(context);
    await this.calcTargetRoll(context);
    await this.rollTargetRoll(context);
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
      const allTargetIds = new Set<string>();
      const cachedSelectionIds = new Set<string>();
      for (const row of rows) {
        if (this.isAnyTargetType(row)) {
          for (const selected of row.data.selected) {
            allTargetIds.add(selected.selectionId);
          }
        }

        if (this.isThisType(row) && this.assumeThisType(row)) {
          for (const target of row.data.calc$.targetCaches) {
            cachedSelectionIds.add(target.selectionId);
          }
        }
      }

      for (const row of rows) {
        if (this.isAnyTargetType(row)) {
          for (const selected of row.data.selected) {
            if (!cachedSelectionIds.has(selected.selectionId)) {
              missingTargetUuids.add(selected.tokenUuid);
            }
          }
        }
      }
    }

    if (missingTargetUuids.size === 0) {
      return;
    }

    // Cache the values of the tokens
    const tokens = await UtilsDocument.tokenFromUuid(missingTargetUuids);
    for (const rows of partsByMessageId.values()) {
      const allSelected: TargetCardData['selected'] = [];
      for (const row of rows) {
        if (this.isAnyTargetType(row)) {
          allSelected.push(...row.data.selected);
        }
      }

      for (const row of rows) {
        if (this.isThisType(row) && this.assumeThisType(row)) {
          const cachedBySelectionId = new Set<string>();
          for (const target of row.data.calc$.targetCaches) {
            cachedBySelectionId.add(target.selectionId);
          }

          for (const selected of allSelected) {
            if (!cachedBySelectionId.has(selected.selectionId)) {
              const actor = (tokens.get(selected.tokenUuid).getActor() as MyActor);
              const targetCache: TargetCache = {
                targetUuid: selected.tokenUuid,
                selectionId: selected.selectionId,
                mode: 'normal',
                phase: 'mode-select',
                actorBonus: '',
                userBonus: '',
                hasHalflingLucky: false,
                visibleToUsers: Array.from(game.users.values()).filter(user => actor.testUserPermission(user, 'OWNER')).map(user => user.id),
              };
              if (actor) {
                const actorAbility = actor.data.data.abilities[row.data.ability];
                const actorSkill = actor.data.data.skills[row.data.skill];
                targetCache.actorUuid = actor.uuid;
                targetCache.hasHalflingLucky = actor?.getFlag("dnd5e", "halflingLucky") === true;
                // Reliable Talent applies to any skill check we have full or better proficiency in
                if (actor?.getFlag("dnd5e", "reliableTalent") === true && actorSkill?.value >= 1) {
                  targetCache.minRoll = 10;
                }

                const bonuses = getProperty(actor.data.data, 'bonuses.abilities') || {};
                const parts: string[] = [];
            
                // Compose roll parts and data
                const data: {[key: string]: any} = {};
            
                parts.push('@abilityMod');
                data.abilityMod = actorAbility.mod;
            
                if (row.data.iSave && actorAbility.prof !== 0) {
                  parts.push('@abilitySaveProf');
                  data.abilitySaveProf = actorAbility.prof;
                  
                  if (bonuses.save) {
                    parts.push("@abilitySaveBonus");
                    data.abilitySaveBonus = bonuses.save;
                  }
                }
                
                // Ability test bonus
                if (bonuses.check) {
                  data.abilityBonus = bonuses.check;
                  parts.push("@abilityBonus");
                }
            
                if (actorSkill) {
                  parts.push('@skillProf');
                  data.skillProf = actorSkill.prof;
                  
                  // Skill check bonus
                  if (bonuses.skill) {
                    data["skillBonus"] = bonuses.skill;
                    parts.push("@skillBonus");
                  }
                }

                targetCache.actorBonus = Roll.replaceFormulaData(parts.join('+'), data);
              }

              row.data.calc$.targetCaches.push(targetCache);
              cachedBySelectionId.add(selected.selectionId);
            }
          }
        }
      }
    }
  }

  private async calcTargetRoll(context: IDmlContext<ModularCardTriggerData>): Promise<void> {
    for (const {newRow} of context.rows) {
      if (!this.isThisType(newRow)) {
        continue;
      }

      for (const target of newRow.data.calc$.targetCaches) {
        let baseRoll = new Die({faces: 20, number: 1});
        if (target.minRoll != null) {
          // reroll a base roll 1 once
          // first 1 = maximum reroll 1 die not both at (dis)advantage (see PHB p173)
          // second 2 = reroll when the roll result is equal to 1 (=1)
          baseRoll.modifiers.push(`min${target.minRoll}`);
        }
        if (target.hasHalflingLucky) {
          // reroll a base roll 1 once
          // first 1 = maximum reroll 1 die not both at (dis)advantage (see PHB p173)
          // second 2 = reroll when the roll result is equal to 1 (=1)
          baseRoll.modifiers.push('r1=1');
        }
        switch (target.mode) {
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
        if (target.actorBonus) {
          parts.push(target.actorBonus);
        }
        
        if (target.userBonus && Roll.validate(target.userBonus)) {
          parts.push(target.userBonus);
        }

        target.requestRollFormula = UtilsRoll.simplifyTerms(new Roll(parts.join(' + '))).formula;
      }
    }
  }

  private async rollTargetRoll(context: IDmlContext<ModularCardTriggerData>): Promise<void> {
    for (const {newRow, oldRow} of context.rows) {
      if (!this.isThisType(newRow) || !this.assumeThisType(oldRow)) {
        continue;
      }

      const oldTargets = new Map<string, TargetCache>();
      if (oldRow) {
        for (const target of oldRow.data.calc$.targetCaches) {
          oldTargets.set(target.selectionId, target);
        }
      }

      for (const target of newRow.data.calc$.targetCaches) {
        const oldTarget = oldTargets.get(target.selectionId);
        if (target.requestRollFormula !== oldTarget?.requestRollFormula) {
          if (!target.roll) {
            target.roll = UtilsRoll.toRollData(new Roll(target.requestRollFormula));
          } else {
            const oldRoll = UtilsRoll.fromRollData(target.roll);
            const result = await UtilsRoll.setRoll(oldRoll, target.requestRollFormula);
            target.roll = UtilsRoll.toRollData(result.result);
            if (result.rollToDisplay) {
              // Auto rolls if original roll was already evaluated
              UtilsDiceSoNice.showRoll({roll: result.rollToDisplay});
            }
          }
        }

        // Execute initial roll
        if ((target.phase === 'result') !== target.roll?.evaluated) {
          const roll = UtilsRoll.fromRollData(target.roll);
          target.roll = UtilsRoll.toRollData(await roll.roll({async: true}));
          UtilsDiceSoNice.showRoll({roll: roll});
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
      if (changedByUserId !== game.userId || !this.isThisType(newRow) || !this.assumeThisType(oldRow)) {
        continue;
      }
      for (let i = 0; i < newRow.data.calc$.targetCaches.length; i++) {
        const newCache = newRow.data.calc$.targetCaches[i];
        const oldCache = oldRow?.data?.calc$?.targetCaches?.[i];
        if (newCache.phase === 'bonus-input' && oldCache.phase !== 'bonus-input') {
          MemoryStorageService.setFocusedElementSelector(`${CheckCardPart.instance.getSelector()}[data-message-id="${newRow.messageId}"][data-part-id="${newRow.id}"] input.user-bonus`);
          return;
        }
      }
    }
  }
  //#endregion 
  
  //#region helpers
  private isThisType(row: ModularCardTriggerData): row is ModularCardTriggerData<CheckCardData> {
    if (row.type !== CheckCardPart.instance.getType()) {
      return false;
    }
    if (row.typeHandler) {
      return row.typeHandler instanceof CheckCardPart;
    }
    return ModularCard.getTypeHandler(row.type) instanceof CheckCardPart;
  }

  private isAnyTargetType(row: ModularCardTriggerData): row is ModularCardTriggerData<TargetCardData> {
    return row.typeHandler instanceof TargetCardPart;
  }

  private assumeThisType(row: ModularCardTriggerData): row is ModularCardTriggerData<CheckCardData> {
    return true;
  }
  //#endregion

}