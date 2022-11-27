import { RollD20EventData, RollMode } from "../../elements/roll-d20-element";
import { ITrigger, IDmlContext, IAfterDmlContext } from "../../lib/db/dml-trigger";
import { UtilsDocument, PermissionCheck } from "../../lib/db/utils-document";
import { RunOnce } from "../../lib/decorator/run-once";
import { Attribute, Component, OnInit, OnInitParam } from "../../lib/render-engine/component";
import { UtilsDiceSoNice } from "../../lib/roll/utils-dice-so-nice";
import { RollData, UtilsRoll } from "../../lib/roll/utils-roll";
import { UtilsCompare } from "../../lib/utils/utils-compare";
import { ValueProvider } from "../../provider/value-provider";
import { staticValues } from "../../static-values";
import { MyActor, MyActorData } from "../../types/fixed-types";
import { Action } from "../action";
import { ItemCardHelpers, ChatPartIdData, ChatPartEnriched } from "../item-card-helpers";
import { ModularCard, ModularCardPartData, ModularCardTriggerData } from "../modular-card";
import { ModularCardPart, ModularCardCreateArgs, CreatePermissionCheckArgs, createPermissionCheckAction } from "../modular-card-part";
import { BaseCardComponent } from "./base-card-component";
import { StateContext, TargetCardData, TargetCardPart, VisualState } from "./target-card-part";

export interface TargetCache {
  selectionId$: string;
  targetUuid$: string;
  actorUuid$?: string;
  
  mode: 'normal' | 'advantage' | 'disadvantage';
  phase: 'mode-select' | 'result';
  userBonus: string;
  resultType$?: 'pass' | 'fail'; // There is no critical pass/fail for ability|skill checks or saving throws (RAW) // TODO maybe this needs to be a setting
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
      *if="this.cache"
      class="snug"
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
                userBonus: '',
              };
              if (actor) {
                targetCache.actorUuid$ = actor.uuid;
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
    await this.doRoll(context);
  }

  private async doRoll(context: IAfterDmlContext<ModularCardTriggerData<CheckCardData>>): Promise<void> {
    for (const {newRow, oldRow} of context.rows) {
      const oldCacheBySelectionId = new Map<string, TargetCache>();
      if (oldRow) {
        for (const target of oldRow.part.data.targetCaches$) {
          oldCacheBySelectionId.set(target.selectionId$, target);
        }
      }
      
      for (const target of newRow.part.data.targetCaches$) {
        if (target.phase !== 'result') {
          continue;
        }
        // Only do roll when changed is detected
        const oldTarget = oldCacheBySelectionId.get(target.selectionId$);

        let shouldModifyRoll = oldTarget == null || !target.roll$?.evaluated;
        if (!shouldModifyRoll) {
          const newChangeDetectData: DeepPartial<TargetCache> = {
            mode: target.mode,
            phase: target.phase,
            userBonus: target.userBonus,
          }
          
          const oldChangeDetectData: DeepPartial<TargetCache> = {
            mode: oldTarget.mode,
            phase: oldTarget.phase,
            userBonus: oldTarget.userBonus,
          }
          shouldModifyRoll = !UtilsCompare.deepEquals(newChangeDetectData, oldChangeDetectData);
        }

        if (shouldModifyRoll) {
          // Get the token actor which might be different than the "root" actor
          let actor: MyActor = await (await UtilsDocument.tokenFromUuid(target.targetUuid$))?.getActor();
          if (!actor && target.actorUuid$ !== target.targetUuid$) {
            actor = await UtilsDocument.actorFromUuid(target.actorUuid$);
          }
          if (actor) {
            const newRoll = async () => {
              const rollPromises: Promise<Roll>[] = [];
              if (newRow.part.data.skill) {
                rollPromises.push(actor.rollSkill(newRow.part.data.skill, {
                  advantage: target.mode === 'advantage',
                  disadvantage: target.mode === 'disadvantage',
                  fastForward: true,
                  chatMessage: false,
                }));
              } else if (newRow.part.data.iSave) {
                rollPromises.push(actor.rollAbilitySave(newRow.part.data.ability, {
                  advantage: target.mode === 'advantage',
                  disadvantage: target.mode === 'disadvantage',
                  fastForward: true,
                  chatMessage: false,
                }));
              } else {
                rollPromises.push(actor.rollAbilityTest(newRow.part.data.ability, {
                  advantage: target.mode === 'advantage',
                  disadvantage: target.mode === 'disadvantage',
                  fastForward: true,
                  chatMessage: false,
                }));
              }

              if (target.userBonus) {
                rollPromises.push(new Roll(target.userBonus).roll({async: true}));
              }
              return UtilsRoll.mergeRolls(...await Promise.all(rollPromises));
            };
            const oldRoll = oldTarget.roll$ == null ? null : UtilsRoll.fromRollData(oldTarget.roll$);
            target.roll$ = UtilsRoll.toRollData((await UtilsRoll.modifyRoll(oldRoll, newRoll)).result);
          }
        }
      }
    }
  }
  //#endregion

  //#region afterUpsert
  public async afterUpsert(context: IAfterDmlContext<ModularCardTriggerData<CheckCardData>>): Promise<void> {
    await this.diceSoNiceHook(context);
  }
  
  private async diceSoNiceHook(context: IDmlContext<ModularCardTriggerData<CheckCardData>>): Promise<void> {
    const showRolls: PermissionCheck<Roll>[] = [];
    for (const {newRow, oldRow} of context.rows) {
      // Detect new rolled dice
      const oldRollsBySelectionId = new Map<string, RollData>();
      if (oldRow) {
        for (const target of oldRow.part.data.targetCaches$) {
          oldRollsBySelectionId.set(target.selectionId$, target.roll$);
        }
      }
      for (const target of newRow.part.data.targetCaches$) {
        if (target.roll$?.evaluated) {
          const roll = UtilsRoll.getNewRolledTerms(oldRollsBySelectionId.get(target.selectionId$), target.roll$);
          if (roll) {
            showRolls.push({
              uuid: newRow.part.data.actorUuid$,
              permission: `${staticValues.code}ReadCheck`,
              user: game.user,
              meta: roll,
            });
          }
        }
      }
    }
    
    UtilsDocument.hasPermissions(showRolls).then(responses => {
      const rolls: Roll[] = [];
      for (const response of responses) {
        if (response.result) {
          rolls.push(response.requestedCheck.meta);
        }
      }

      if (rolls.length > 0) {
        return UtilsDiceSoNice.showRoll({roll: UtilsRoll.mergeRolls(...rolls), showUserIds: [game.userId]});
      }
    });
  }
  //#endregion

}