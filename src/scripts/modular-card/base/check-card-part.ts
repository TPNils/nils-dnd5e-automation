import { RollD20EventData, RollMode } from "../../elements/roll-d20-element";
import { ITrigger, IDmlContext, IAfterDmlContext } from "../../lib/db/dml-trigger";
import { UtilsDocument, PermissionCheck } from "../../lib/db/utils-document";
import { RunOnce } from "../../lib/decorator/run-once";
import { Attribute, Component, OnInit, OnInitParam } from "../../lib/render-engine/component";
import { UtilsDiceSoNice } from "../../lib/roll/utils-dice-so-nice";
import { RollData, UtilsRoll } from "../../lib/roll/utils-roll";
import { ValueProvider } from "../../provider/value-provider";
import { staticValues } from "../../static-values";
import { MyActor, MyActorData } from "../../types/fixed-types";
import { Action } from "../action";
import { ItemCardHelpers, ChatPartIdData, ChatPartEnriched } from "../item-card-helpers";
import { ModularCard, ModularCardPartData, ModularCardTriggerData } from "../modular-card";
import { ModularCardPart, ModularCardCreateArgs, CreatePermissionCheckArgs, createPermissionCheckAction } from "../modular-card-part";
import { BaseCardComponent } from "./base-card-component";
import { StateContext, TargetCardData, TargetCardPart, VisualState } from "./target-card-part";

interface TargetCache {
  selectionId$: string;
  targetUuid$: string;
  actorUuid$?: string;
  
  mode: 'normal' | 'advantage' | 'disadvantage';
  phase: 'mode-select' | 'result';
  userBonus: string;
  resultType$?: 'pass' | 'fail'; // There is no critical pass/fail for ability|skill checks or saving throws (RAW) // TODO maybe this needs to be a setting
  actorBonus$: string;
  hasHalflingLucky$: boolean;
  minRoll$?: number;
  requestRollFormula$?: string;
  roll$?: RollData;
}

export interface CheckCardData {
  actorUuid$?: string;
  ability: keyof MyActor['data']['data']['abilities'];
  dc: number;
  skill?: keyof MyActorData['data']['skills'];
  iSave?: boolean;
  targetCaches$: TargetCache[];
}

function getTargetCache(cache: CheckCardData, selectionId: string): TargetCache | null {
  if (!cache?.targetCaches$) {
    return null;
  }
  for (const targetCache of cache.targetCaches$) {
    if (targetCache.selectionId$ === selectionId) {
      return targetCache;
    }
  }
  return null;
}

@Component({
  tag: CheckCardComponent.getSelector(),
  html: /*html*/`
    <nac-roll-d20
      *if="this.cache?.roll$ != null"
      class="hide-flavor snug"
      data-label-type="icon"
      [data-roll]="this.cache.roll$"
      [data-bonus-formula]="this.cache.userBonus"
      [data-show-bonus]="this.cache.phase !== 'mode-select'"

      [data-interaction-permission]="this.interactionPermission"
      [data-read-permission]="this.readPermission"
      [data-read-hidden-display-type]="this.readHiddenDisplayType"

      (doRoll)="this.onRollClick($event)"
      (rollMode)="this.onRollMode($event)"
      >
    </nac-roll-d20>
  `,
  style: /*css*/`
    :host-context(nac-target-part) :host {
      display: block;
      font-size: 12px;
      min-width: 6em;
    }
    
    nac-roll-d20 {
      font-size: 1em;
    }
  `
})
export class CheckCardComponent extends BaseCardComponent implements OnInit {
  //#region actions
  private static actionPermissionCheck = createPermissionCheckAction<{part: {data: CheckCardData}, targetId: string;}>(({part, targetId}) => {
    const cache = getTargetCache(part.data, targetId);
    if (!cache?.actorUuid$) {
      return {mustBeGm: true};
    }
    const documents: CreatePermissionCheckArgs['documents'] = [];
    documents.push({uuid: cache.actorUuid$, permission: 'OWNER', security: true});
    return {documents: documents};
  });

  
  private static getTargetCacheEnricher(this: null, data: ChatPartIdData & ChatPartEnriched<CheckCardData> & {targetId: string;}): {targetCache: TargetCache} {
    const cache = getTargetCache(data.part.data, data.targetId);
    if (!cache) {
      throw {
        success: false,
        errorType: 'warn',
        errorMessage: `Pressed an action button for message part ${data.messageId}.${data.partId} but no data was found for subtype: ${data.targetId}`,
      };
    }
    return {targetCache: cache};
  }

  private static rollClick = new Action<{event: CustomEvent<{userBonus?: string}>; targetId: string;} & ChatPartIdData>('CheckOnRollClick')
    .addSerializer(ItemCardHelpers.getRawSerializer('messageId'))
    .addSerializer(ItemCardHelpers.getRawSerializer('partId'))
    .addSerializer(ItemCardHelpers.getRawSerializer('targetId'))
    .addSerializer(ItemCardHelpers.getCustomEventSerializer())
    .addEnricher(ItemCardHelpers.getChatPartEnricher<CheckCardData>())
    .addEnricher(CheckCardComponent.getTargetCacheEnricher)
    .setPermissionCheck(CheckCardComponent.actionPermissionCheck)
    .build(({messageId, targetCache, event, allCardParts}) => {
      if (targetCache.userBonus === event.userBonus && targetCache.phase === 'result') {
        return;
      }
      targetCache.userBonus = event.userBonus;
      targetCache.phase = 'result';
      return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
    })
    
private static modeChange = new Action<{event: CustomEvent<RollD20EventData<RollMode>>; targetId: string;} & ChatPartIdData>('AttackOnModeChange')
  .addSerializer(ItemCardHelpers.getRawSerializer('messageId'))
  .addSerializer(ItemCardHelpers.getRawSerializer('partId'))
  .addSerializer(ItemCardHelpers.getRawSerializer('targetId'))
  .addSerializer(ItemCardHelpers.getCustomEventSerializer())
  .addEnricher(ItemCardHelpers.getChatPartEnricher<CheckCardData>())
  .addEnricher(CheckCardComponent.getTargetCacheEnricher)
  .setPermissionCheck(CheckCardComponent.actionPermissionCheck)
  .build(({messageId, allCardParts, targetCache, event}) => {
    if (targetCache.mode === event.data) {
      return;
    }

    targetCache.mode = event.data;
    if (event.quickRoll) {
      targetCache.phase = 'result';
    }
    return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
  });
  //#endregion

  public static getSelector(): string {
    return `${staticValues.code}-check-part`;
  }
  
  //#region input
  private _targetId = new ValueProvider<string>();
  @Attribute('data-target-id')
  public get targetId(): string {
    return this._targetId.get();
  }
  public set targetId(v: string) {
    this._targetId.set(v);
  }
  //#endregion
  
  public cache: TargetCache;
  public interactionPermission: string;
  public readPermission: string;
  public readHiddenDisplayType: string;

  public onInit(args: OnInitParam): void {
    args.addStoppable(
      this.getData<CheckCardData>(CheckCardPart.instance).switchMap(({part}) => {
        return ValueProvider.mergeObject({
          part,
          targetId: this._targetId
        })
      }).listen(({part, targetId}) => {
        this.cache = getTargetCache(part.data, targetId);
    
        if (this.cache != null) {
          this.interactionPermission = `OwnerUuid:${this.cache.actorUuid$}`;
          this.readPermission = `${staticValues.code}ReadCheckUuid:${this.cache.actorUuid$}`;
          this.readHiddenDisplayType = game.settings.get(staticValues.moduleName, 'checkHiddenRoll') as string;
        }
      })
    )
  }

  public onRollClick(event: CustomEvent<{userBonus?: string}>): void {
    if (this.cache.userBonus === event.detail.userBonus && this.cache.phase === 'result') {
      return;
    }
    CheckCardComponent.rollClick({event, partId: this.partId, messageId: this.messageId, targetId: this.targetId});
  }

  public onRollMode(event: CustomEvent<RollD20EventData<RollMode>>): void {
    CheckCardComponent.modeChange({event, partId: this.partId, messageId: this.messageId, targetId: this.targetId});
  }

}

export class CheckCardPart implements ModularCardPart<CheckCardData> {

  public static readonly instance = new CheckCardPart();
  private constructor(){}
  
  public create({item, actor}: ModularCardCreateArgs): CheckCardData {
    if (item.data.data.save?.dc == null || !item.data.data.save?.ability) {
      return null;
    }

    return {
      actorUuid$: actor?.uuid,
      ability: item.data.data.save?.ability,
      dc: item.data.data.save.dc,
      iSave: true,
      targetCaches$: []
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

    const newTargetCaches = new Map<string, TargetCache>();
    for (const cache of newData.targetCaches$) {
      newTargetCaches.set(cache.selectionId$, cache);
    }
    const oldTargetCaches = new Map<string, TargetCache>();
    for (const cache of oldData.targetCaches$) {
      if (!newTargetCaches.has(cache.selectionId$)) {
        newTargetCaches.set(cache.selectionId$, cache);
      } else {
        const newCache = newTargetCaches.get(cache.selectionId$);
        newCache.mode = cache.mode;
        newCache.phase = cache.phase;
        newCache.userBonus = cache.userBonus;
        newCache.roll$ = cache.roll$;
      }
    }
    newData.targetCaches$ = Array.from(newTargetCaches.values());
    return newData;
  }

  @RunOnce()
  public registerHooks(): void {
    TargetCardPart.instance.registerIntegration({
      getVisualState: context => this.getTargetState(context),
    });
    ModularCard.registerModularCardPart(staticValues.moduleName, this);
    ModularCard.registerModularCardTrigger<TargetCardData>(TargetCardPart.instance, new TargetCardTrigger());
    ModularCard.registerModularCardTrigger(this, new CheckCardTrigger());
  }

  public getType(): string {
    return this.constructor.name;
  }
  
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
          
          const canReadCheckDc = part.data.actorUuid$ != null && UtilsDocument.hasAllPermissions([{
            uuid: part.data.actorUuid$,
            user: game.user,
            permission: `${staticValues.code}ReadCheckDc`,
          }], {sync: true});
          const visualState = visualStatesBySelectionId.get(selected.selectionId);
          visualState.columns.push({
            key: `${this.getType()}-check-${partNr}`,
            label: game.i18n.format('DND5E.SaveDC', {dc: canReadCheckDc ? part.data.dc : '?', ability: ''}),
            rowValue: `<${CheckCardComponent.getSelector()} data-part-id="${part.id}" data-message-id="${context.messageId}" data-target-id="${selected.selectionId}"></${CheckCardComponent.getSelector()}>`
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


class TargetCardTrigger implements ITrigger<ModularCardTriggerData<TargetCardData>> {

  //#region upsert
  public async upsert(context: IAfterDmlContext<ModularCardTriggerData<TargetCardData>>): Promise<void> {
    await this.addTargetCache(context);
  }
  
  private async addTargetCache(context: IDmlContext<ModularCardTriggerData<TargetCardData>>): Promise<void> {
    const missingTargetUuids = new Set<string>();
    for (const {newRow} of context.rows) {
      const allTargetIds = new Set<string>();
      const cachedSelectionIds = new Set<string>();
      for (const selected of newRow.part.data.selected) {
        allTargetIds.add(selected.selectionId);
      }
      for (const part of newRow.allParts) {
        if (ModularCard.isType(CheckCardPart.instance, part)) {
          for (const target of part.data.targetCaches$) {
            cachedSelectionIds.add(target.selectionId$);
          }
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
      const allSelected = newRow.part.data.selected;

      for (const part of newRow.allParts) {
        if (ModularCard.isType(CheckCardPart.instance, part)) {
          const cachedBySelectionId = new Set<string>();
          for (const target of part.data.targetCaches$) {
            cachedBySelectionId.add(target.selectionId$);
          }

          for (const selected of allSelected) {
            if (!cachedBySelectionId.has(selected.selectionId)) {
              const actor = (tokens.get(selected.tokenUuid).getActor() as MyActor);
              const targetCache: TargetCache = {
                targetUuid$: selected.tokenUuid,
                selectionId$: selected.selectionId,
                mode: 'normal',
                phase: 'mode-select',
                actorBonus$: '',
                userBonus: '',
                hasHalflingLucky$: false,
              };
              if (actor) {
                const actorAbility = actor.data.data.abilities[part.data.ability];
                const actorSkill = actor.data.data.skills[part.data.skill];
                targetCache.actorUuid$ = actor.uuid;
                targetCache.hasHalflingLucky$ = actor?.getFlag("dnd5e", "halflingLucky") === true;
                // Reliable Talent applies to any skill check we have full or better proficiency in
                if (actor?.getFlag("dnd5e", "reliableTalent") === true && actorSkill?.value >= 1) {
                  targetCache.minRoll$ = 10;
                }

                const bonuses = getProperty(actor.data.data, 'bonuses.abilities') || {};
                const parts: string[] = [];
            
                // Compose roll parts and data
                const data: {[key: string]: any} = {};
            
                parts.push('@abilityMod');
                data.abilityMod = actorAbility.mod;
            
                if (part.data.iSave && actorAbility.prof !== 0) {
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

                targetCache.actorBonus$ = Roll.replaceFormulaData(parts.join('+'), data);
              }

              part.data.targetCaches$.push(targetCache);
              cachedBySelectionId.add(selected.selectionId);
            }
          }
        }
      }
    }
  }
  //#endregion

}

class CheckCardTrigger implements ITrigger<ModularCardTriggerData<CheckCardData>> {

  //#region beforeUpsert
  public beforeUpsert(context: IDmlContext<ModularCardTriggerData<CheckCardData>>): boolean | void {
    this.calcResultCache(context);
  }

  private calcResultCache(context: IDmlContext<ModularCardTriggerData<CheckCardData>>): void {
    for (const {newRow} of context.rows) {
      for (const targetCache of newRow.part.data.targetCaches$) {
        if (targetCache.roll$?.evaluated) {
          // Checks & saves are a success on a match
          if (targetCache.roll$.total >= newRow.part.data.dc) {
            targetCache.resultType$ = 'pass';
          } else {
            targetCache.resultType$ = 'fail';
          }
        } else if (targetCache.resultType$) {
          delete targetCache.resultType$;
        }
      }
    }
  }
  //#endregion

  //#region upsert
  public async upsert(context: IAfterDmlContext<ModularCardTriggerData<CheckCardData>>): Promise<void> {
    await this.calcTargetRoll(context);
    await this.rollTargetRoll(context);
  }

  private async calcTargetRoll(context: IDmlContext<ModularCardTriggerData<CheckCardData>>): Promise<void> {
    for (const {newRow} of context.rows) {
      for (const target of newRow.part.data.targetCaches$) {
        let baseRoll = new Die({faces: 20, number: 1});
        if (target.minRoll$ != null) {
          // reroll a base roll 1 once
          // first 1 = maximum reroll 1 die not both at (dis)advantage (see PHB p173)
          // second 2 = reroll when the roll result is equal to 1 (=1)
          baseRoll.modifiers.push(`min${target.minRoll$}`);
        }
        if (target.hasHalflingLucky$) {
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
        if (target.actorBonus$) {
          parts.push(target.actorBonus$);
        }
        
        if (target.userBonus && Roll.validate(target.userBonus)) {
          parts.push(target.userBonus);
        }

        target.requestRollFormula$ = UtilsRoll.simplifyTerms(new Roll(parts.join(' + '))).formula;
      }
    }
  }

  private async rollTargetRoll(context: IDmlContext<ModularCardTriggerData<CheckCardData>>): Promise<void> {
    const showRolls: PermissionCheck<Roll>[] = [];
    for (const {newRow, oldRow} of context.rows) {
      const oldTargets = new Map<string, TargetCache>();
      if (oldRow) {
        for (const target of oldRow.part.data.targetCaches$) {
          oldTargets.set(target.selectionId$, target);
        }
      }

      for (const target of newRow.part.data.targetCaches$) {
        const oldTarget = oldTargets.get(target.selectionId$);
        if (target.requestRollFormula$ !== oldTarget?.requestRollFormula$) {
          if (!target.roll$) {
            target.roll$ = UtilsRoll.toRollData(new Roll(target.requestRollFormula$));
          } else {
            const oldRoll = UtilsRoll.fromRollData(target.roll$);
            const result = await UtilsRoll.setRoll(oldRoll, target.requestRollFormula$);
            target.roll$ = UtilsRoll.toRollData(result.result);
            if (result.rollToDisplay) {
              // Auto rolls if original roll was already evaluated
              for (const user of game.users.values()) {
                if (user.active) {
                  showRolls.push({
                    uuid: target.actorUuid$ ?? target.targetUuid$, // Players don't seem to have owner permission of their own token
                    permission: `${staticValues.code}ReadCheck`,
                    user: user,
                    meta: result.rollToDisplay,
                  });
                }
              }
            }
          }
        }

        // Execute initial roll
        if ((target.phase === 'result') && target.roll$?.evaluated !== true) {
          const roll = UtilsRoll.fromRollData(target.roll$);
          target.roll$ = UtilsRoll.toRollData(await roll.roll({async: true}));
          for (const user of game.users.values()) {
            if (user.active) {
              showRolls.push({
                uuid: target.actorUuid$ ?? target.targetUuid$, // Players don't seem to have owner permission of their own token
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

}