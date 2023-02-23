import { ActiveEffectData } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/data/module.mjs";
import { IAfterDmlContext, IDmlContext, ITrigger } from "../../lib/db/dml-trigger";
import { UtilsDocument } from "../../lib/db/utils-document";
import { RunOnce } from "../../lib/decorator/run-once";
import { staticValues } from "../../static-values";
import { MyActor } from "../../types/fixed-types";
import { AttackCardData, AttackCardPart } from "./attack-card-part";
import { CheckCardData, CheckCardPart } from "./check-card-part";
import { ModularCard, ModularCardInstance, ModularCardTriggerData } from "../modular-card";
import { ModularCardCreateArgs, ModularCardPart } from "../modular-card-part";
import { StateContext, TargetCallbackData, TargetCardData, TargetCardPart, VisualState } from "./target-card-part";

interface TargetCache {
  actorUuid$: string;
  selections$: Array<{
    selectionId$: string;
    tokenUuid$: string;
  }>;
  appliedEffects$: Array<{
    originalIndex$: number;
    createdUuid$: string;
  }>;
}

export interface ActiveEffectCardData {
  activeEffects: Array<ActiveEffectData>;
  targetCaches$: TargetCache[];
}

function setTargetCache(cache: ActiveEffectCardData, targetCache: TargetCache): void {
  if (!cache.targetCaches$) {
    cache.targetCaches$ = [];
  }
  for (let i = 0; i < cache.targetCaches$.length; i++) {
    if (cache.targetCaches$[i].actorUuid$ === targetCache.actorUuid$) {
      cache.targetCaches$[i] = targetCache;
      return;
    }
  }
  cache.targetCaches$.push(targetCache);
}

function getTargetCache(cache: ActiveEffectCardData, actorUuid: string): TargetCache | null {
  if (!cache.targetCaches$) {
    return null;
  }
  for (const targetCache of cache.targetCaches$) {
    if (targetCache.actorUuid$ === actorUuid) {
      return targetCache;
    }
  }
  return null;
}

export class ActiveEffectCardPart implements ModularCardPart<ActiveEffectCardData> {

  public static readonly instance = new ActiveEffectCardPart();
  protected constructor(){}

  public async create({item}: ModularCardCreateArgs): Promise<ActiveEffectCardData> {
    const activeEffects: ActiveEffectData[] = Array.from(item.effects.values())
      .filter((effectData: ActiveEffect) => !effectData.data.transfer)
      .map((effect: ActiveEffect) => {
        const data = deepClone(effect.data);
        delete data._id;
        return data;
      });

    if (activeEffects.length === 0) {
      return null;
    }

    return {
      activeEffects: activeEffects,
      targetCaches$: [],
    }
  }

  public async refresh(oldData: ActiveEffectCardData, args: ModularCardCreateArgs): Promise<ActiveEffectCardData> {
    // since active effects (3 parents deep) have no id => no uuid, we can't really recalculate
    // We need to know which effects are them same and which have been added/removed, can't do that
    // TODO maybe this is solved in foundry v10?
    //  Also this might be bullshit, I did come to this conclustion around 02h in the morning
    return oldData;
  }

  @RunOnce()
  public registerHooks(): void {
    ModularCard.registerModularCardPart(staticValues.moduleName, this);
    TargetCardPart.instance.registerIntegration({
      onChange: event => this.targetCallback(event),
      getState: context => this.getTargetState(context),
      getVisualState: context => this.getTargetState(context),
    })

    ModularCard.registerModularCardTrigger(TargetCardPart.instance, new TargetCardTrigger());
  }

  public getType(): string {
    return 'ActiveEffectCardPart';
  }

  //#region Targeting
  private smartApplyActors(messages: Array<ModularCardInstance>): Set<string> {
    const shouldApplyToActors = new Map<string, boolean>();
    const processedMessages = [];
    for (const message of messages) {
      if (processedMessages.includes(message)) {
        // Deduplicate
        continue;
      }
      processedMessages.push(message);

      const activeEffect = message.getTypeData<ActiveEffectCardData>(ActiveEffectCardPart.instance);
      const attack = message.getTypeData<AttackCardData>(AttackCardPart.instance);
      const check = message.getTypeData<CheckCardData>(CheckCardPart.instance);
      if (activeEffect == null) {
        continue;
      }

      const actorsByTokenUuid = new Map<string, string>();
      for (const cache of activeEffect.targetCaches$) {
        if (!shouldApplyToActors.has(cache.actorUuid$)) {
          shouldApplyToActors.set(cache.actorUuid$, true);
        }
        for (const selection of cache.selections$) {
          actorsByTokenUuid.set(selection.tokenUuid$, cache.actorUuid$);
        }
      }

      for (const cache of attack.targetCaches$) {
        if (cache.resultType$ == null || cache.resultType$ === 'critical-mis' || cache.resultType$ === 'mis') {
          shouldApplyToActors.set(cache.actorUuid$, false);
        }
      }
      
      for (const cache of check.targetCaches$) {
        if (cache.resultType$ === 'pass') {
          shouldApplyToActors.set(cache.actorUuid$, false);
        }
      }
    }

    const applyToUuids = new Set<string>();
    for (const [uuid, shouldApply] of shouldApplyToActors.entries()) {
      if (shouldApply) {
        applyToUuids.add(uuid);
      }
    }
    return applyToUuids;
  }

  private async targetCallback(targetEvents: TargetCallbackData[]): Promise<void> {
    const tokenDocuments = await UtilsDocument.tokenFromUuid(targetEvents.map(d => d.selected.tokenUuid));
    let actorsByTokenUuid = new Map<string, MyActor>();
    let applySmartStateByActor = this.smartApplyActors(targetEvents.map(event => event.messageCardParts));
    for (const token of tokenDocuments.values()) {
      const actor = token.getActor() as MyActor;
      actorsByTokenUuid.set(token.uuid, actor);
    }
    const allRelevantActiveEffectUuids = new Set<string>();
    for (const targetEvent of targetEvents) {
      const activeEffect = targetEvent.messageCardParts.getTypeData(ActiveEffectCardPart.instance);
      if (activeEffect != null) {
        for (const targetCache of activeEffect.targetCaches$) {
          for (const effect of targetCache.appliedEffects$) {
            allRelevantActiveEffectUuids.add(effect.createdUuid$);
          }
          
        }
      }
    }
    const activeEffectsMap = await UtilsDocument.activeEffectFromUuid(allRelevantActiveEffectUuids);

    const processedActorUuids = new Set<string>();
    const createActiveEffects: ActiveEffect[] = [];
    const deleteActiveEffectUuids = new Set<string>();
    for (const targetEvent of targetEvents) {
      const actor = tokenDocuments.get(targetEvent.selected.tokenUuid)?.getActor() as MyActor;
      if (!actor || processedActorUuids.has(actor.uuid)) {
        continue;
      }

      const activeEffectCard = targetEvent.messageCardParts.getTypeData(ActiveEffectCardPart.instance);
      const expectedActiveEffectIndexes: number[] = [];
      const appliedActiveEffectIndexes: number[] = [];
      const cache = getTargetCache(activeEffectCard, actor.uuid);
      if (targetEvent.apply === 'force-apply' || (targetEvent.apply === 'smart-apply' && applySmartStateByActor.has(cache.actorUuid$))) {
        for (let i = 0; i < activeEffectCard.activeEffects.length; i++) {
          expectedActiveEffectIndexes.push(i);
        }
      }
      for (const applied of cache.appliedEffects$) {
        if (expectedActiveEffectIndexes.includes(applied.originalIndex$)) {
          if (activeEffectsMap.has(applied.createdUuid$)) {
            appliedActiveEffectIndexes.push(applied.originalIndex$);
          }
        } else {
          deleteActiveEffectUuids.add(applied.createdUuid$);
        }
      }

      for (let i = 0; i < activeEffectCard.activeEffects.length; i++) {
        if (appliedActiveEffectIndexes.includes(i) || !expectedActiveEffectIndexes.includes(i)) {
          continue;
        }
        const effect = activeEffectCard.activeEffects[i];
        const activeEffectData = deepClone(effect);
        activeEffectData.origin = null; // TODO
        activeEffectData.flags = activeEffectData.flags ?? {};
        activeEffectData.flags[staticValues.moduleName] = activeEffectData.flags[staticValues.moduleName] ?? {};
        (activeEffectData.flags[staticValues.moduleName] as any).origin = {
          messageId: targetEvent.messageId,
          activeEffectIndex: i,
        };
        delete activeEffectData._id;
        // @ts-ignore
        createActiveEffects.push(new ActiveEffect(activeEffectData, {parent: actor}));
      }
    }

    const createdUuidsByOriginKey = new Map<string, string>();
    if (deleteActiveEffectUuids.size > 0) {
      await UtilsDocument.bulkDelete(deleteActiveEffectUuids)
    }
    for (const effectDocument of await UtilsDocument.bulkCreate(createActiveEffects)) {
      const origin = (effectDocument.data.flags[staticValues.moduleName] as any).origin;
      createdUuidsByOriginKey.set(`${origin.messageId}/${origin.partId}/${effectDocument.parent.uuid}/${origin.activeEffectIndex}`, effectDocument.uuid);
    }
    
    for (const targetEvent of targetEvents) {
      const actor = tokenDocuments.get(targetEvent.selected.tokenUuid)?.getActor() as MyActor;
      if (!actor || processedActorUuids.has(actor.uuid)) {
        continue;
      }

      const activeEffectCard = targetEvent.messageCardParts.getTypeData(ActiveEffectCardPart.instance);
      for (const targetCache of activeEffectCard.targetCaches$) {
        targetCache.appliedEffects$ = targetCache.appliedEffects$.filter(applied => {
          return !deleteActiveEffectUuids.has(applied.createdUuid$);
        });
        for (let i = 0; i < activeEffectCard.activeEffects.length; i++) {
          const key = `${targetEvent.messageId}/${targetCache.actorUuid$}/${i}`;
          if (createdUuidsByOriginKey.has(key)) {
            targetCache.appliedEffects$.push({originalIndex$: i, createdUuid$: createdUuidsByOriginKey.get(key)});
          }
        }
      }
    }
  }

  private getTargetState(context: StateContext): VisualState[] {
    const activeEffectPart = context.allMessageParts.getTypeData(ActiveEffectCardPart.instance);
    if (!activeEffectPart) {
      return [];
    }
    let applySmartStateByActor = this.smartApplyActors([context.allMessageParts]);
    const selectionIdToActorUuid = new Map<string, string>();
    for (const targetCache of activeEffectPart.targetCaches$) {
      for (const selection of targetCache.selections$) {
        selectionIdToActorUuid.set(selection.selectionId$, targetCache.actorUuid$);
      }
    }

    const states: VisualState[] = [];
    const addedTargetIds = new Set<string>();
    for (const targetCache of activeEffectPart.targetCaches$) {
      const appliedActiveEffects = targetCache.appliedEffects$.map(effect => effect.originalIndex$);
      for (const selection of targetCache.selections$) {
        addedTargetIds.add(selection.selectionId$)
        const visualState: VisualState = {
          selectionId: selection.selectionId$,
          tokenUuid: selection.tokenUuid$,
          state: 'not-applied',
          columns: []
        };
        const appliedStates = new Set<boolean>();
        for (let i = 0; i < activeEffectPart.activeEffects.length; i++) {
          const activeEffect = activeEffectPart.activeEffects[i];
          const applied = appliedActiveEffects.includes(i);
          appliedStates.add(applied);
          visualState.columns.push({
            key: ActiveEffectCardPart.instance.getType() + '-' + i,
            label: `<img style="min-width: 16px;width: 16px;min-height: 16px;height: 16px;" src="${activeEffect.icon}">`,
            rowValue: applied ? `<span style="color: green">✓</span>` : `<span style="color: red">✗</span>`
          });
        }
        if (appliedStates.size > 1) {
          visualState.state = 'partial-applied';
        } else if (appliedStates.size === 1 && appliedStates.has(true)) {
          visualState.state = 'applied';
        }
        if (visualState.state === 'applied' && applySmartStateByActor.has(targetCache.actorUuid$)) {
          visualState.smartState = 'applied';
        } else if (visualState.state === 'not-applied' && !applySmartStateByActor.has(targetCache.actorUuid$)) {
          visualState.smartState = 'applied';
        } else {
          visualState.smartState = 'not-applied';
        }
        states.push(visualState);
      }
    }
    
    for (const selected of context.selected) {
      if (addedTargetIds.has(selected.selectionId)) {
        continue;
      }
      const visualState: VisualState = {
        selectionId: selected.selectionId,
        tokenUuid: selected.tokenUuid,
        state: 'not-applied',
        columns: []
      };
      for (let i = 0; i < activeEffectPart.activeEffects.length; i++) {
        const activeEffect = activeEffectPart.activeEffects[i];
        visualState.columns.push({
          key: ActiveEffectCardPart.instance.getType() + '-' + i,
          label: `<img style="min-width: 16px;width: 16px;min-height: 16px;height: 16px;" src="${activeEffect.icon}">`,
          rowValue: `<span style="color: red">✗</span>`,
        });
      }
      states.push(visualState);
    
    }

    return states;
  }
  //#endregion

}

class TargetCardTrigger implements ITrigger<ModularCardTriggerData<TargetCardData>> {

  //#region upsert
  public async upsert(context: IAfterDmlContext<ModularCardTriggerData<TargetCardData>>): Promise<void> {
    await this.calcTargetCache(context);
  }
  
  private async calcTargetCache(context: IDmlContext<ModularCardTriggerData<TargetCardData>>): Promise<void> {
    const selectedByMessageId = new Map<string, TargetCardData['selected']>();
    const newSelectedByMessageId = new Map<string, TargetCardData['selected']>();
    const recalcTokens: Array<{selectionId: string, tokenUuid: string, data: ActiveEffectCardData, messageId: string}> = [];
    for (const {newRow, oldRow} of context.rows) {
      const activeEffect = newRow.allParts.getTypeData<ActiveEffectCardData>(ActiveEffectCardPart.instance);
      if (!activeEffect) {
        continue;
      }
      if (!newSelectedByMessageId.has(newRow.messageId)) {
        newSelectedByMessageId.set(newRow.messageId, []);
      }
      if (!selectedByMessageId.has(newRow.messageId)) {
        selectedByMessageId.set(newRow.messageId, []);
      }
      const newSelected = newSelectedByMessageId.get(newRow.messageId);
      const newSelectedThisMessage: TargetCardData['selected'] = [];
      const allSelected = selectedByMessageId.get(newRow.messageId);
      const oldSelectionIds = oldRow?.part?.selected.map(s => s.selectionId) ?? [];
      for (const target of newRow.part.selected) {
        allSelected.push(target);
        if (!oldSelectionIds.includes(target.selectionId)) {
          newSelected.push(target);
          newSelectedThisMessage.push(target);
        }
      }
      // Calc new targets
      for (const selection of newSelectedThisMessage) {
        // Ignore what is already cached, always fetch when a new target has been selected
        recalcTokens.push({data: activeEffect, tokenUuid: selection.tokenUuid, selectionId: selection.selectionId, messageId: newRow.messageId});
      }
    }

    if (recalcTokens.length === 0) {
      return;
    }

    const fetchTokenUuids = new Set<string>();
    for (const recalcToken of recalcTokens) {
      fetchTokenUuids.add(recalcToken.tokenUuid);
    }
    const tokenDocuments = await UtilsDocument.tokenFromUuid(fetchTokenUuids);
    const tokenUuidsByActorUuid = new Map<string, string[]>();
    for (const token of tokenDocuments.values()) {
      const actor: MyActor = token.getActor();
      if (!tokenUuidsByActorUuid.has(actor.uuid)) {
        tokenUuidsByActorUuid.set(actor.uuid, []);
      }
      tokenUuidsByActorUuid.get(actor.uuid).push(token.uuid);
    }
    const recalcedActorUuids = new Set<string>();
    for (const recalcToken of recalcTokens) {
      const actor: MyActor = tokenDocuments.get(recalcToken.tokenUuid).getActor();
      if (recalcedActorUuids.has(actor.uuid)) {
        continue;
      }
      const currentCache = getTargetCache(recalcToken.data, actor.uuid);
      const cache: TargetCache = {
        actorUuid$: actor.uuid,
        selections$: [],
        appliedEffects$: currentCache ? currentCache.appliedEffects$ : [],
      };

      for (const selected of selectedByMessageId.get(recalcToken.messageId) ?? []) {
        if (tokenUuidsByActorUuid.get(actor.uuid).includes(selected.tokenUuid)) {
          cache.selections$.push({
            selectionId$: selected.selectionId,
            tokenUuid$: selected.tokenUuid,
          });
        }
      }

      setTargetCache(recalcToken.data, cache);
      recalcedActorUuids.add(actor.uuid);
    }
  }
  
  //#endregion

}