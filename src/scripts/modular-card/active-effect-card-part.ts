import { ActiveEffectData } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/data/module.mjs";
import { IAfterDmlContext, IDmlContext, ITrigger } from "../lib/db/dml-trigger";
import { UtilsDocument } from "../lib/db/utils-document";
import { RunOnce } from "../lib/decorator/run-once";
import { staticValues } from "../static-values";
import { MyActor } from "../types/fixed-types";
import { ModularCard, ModularCardPartData, ModularCardTriggerData } from "./modular-card";
import { ModularCardCreateArgs, ModularCardPart } from "./modular-card-part";
import { StateContext, TargetCallbackData, TargetCardData, TargetCardPart, VisualState } from "./target-card-part";

interface TargetCache {
  actorUuid: string;
  selections: Array<{
    selectionId: string;
    tokenUuid: string;
  }>;
  appliedEffects: Array<{
    originalIndex: number;
    createdUuid: string;
  }>;
}

export interface ActiveEffectCardData {
  activeEffects: Array<ActiveEffectData>;
  calc$: {
    targetCaches: TargetCache[];
  }
}

function setTargetCache(cache: ActiveEffectCardData, targetCache: TargetCache): void {
  if (!cache.calc$.targetCaches) {
    cache.calc$.targetCaches = [];
  }
  for (let i = 0; i < cache.calc$.targetCaches.length; i++) {
    if (cache.calc$.targetCaches[i].actorUuid === targetCache.actorUuid) {
      cache.calc$.targetCaches[i] = targetCache;
      return;
    }
  }
  cache.calc$.targetCaches.push(targetCache);
}

function getTargetCache(cache: ActiveEffectCardData, actorUuid: string): TargetCache | null {
  if (!cache.calc$.targetCaches) {
    return null;
  }
  for (const targetCache of cache.calc$.targetCaches) {
    if (targetCache.actorUuid === actorUuid) {
      return targetCache;
    }
  }
  return null;
}

export class ActiveEffectCardPart implements ModularCardPart<ActiveEffectCardData> {

  public static readonly instance = new ActiveEffectCardPart();
  protected constructor(){}

  public async create({item}: ModularCardCreateArgs): Promise<ActiveEffectCardData> {
    return {
      activeEffects: Array.from(item.effects.values())
        .filter(effectData => !effectData.data.transfer)
        .map(effect => {
          const data = deepClone(effect.data);
          delete data._id;
          return data;
        }),
      calc$: {
        targetCaches: [],
      }
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

    ModularCard.registerModularCardTrigger(new ActiveEffectCardTrigger());
  }

  public getType(): string {
    return this.constructor.name;
  }

  //#region Targeting
  private async targetCallback(targetEvents: TargetCallbackData[]): Promise<void> {
    const tokenDocuments = await UtilsDocument.tokenFromUuid(targetEvents.map(d => d.selected.tokenUuid));
    let actorsByTokenUuid = new Map<string, MyActor>();
    for (const token of tokenDocuments.values()) {
      const actor = token.getActor() as MyActor;
      actorsByTokenUuid.set(actor.uuid, actor);
    }
    const allRelevantActiveEffectUuids = new Set<string>();
    for (const targetEvent of targetEvents) {
      for (const part of targetEvent.messageCardParts) {
        if (ModularCard.isType<ActiveEffectCardData>(ActiveEffectCardPart.instance, part)) {
          for (const targetCache of part.data.calc$.targetCaches) {
            for (const effect of targetCache.appliedEffects) {
              allRelevantActiveEffectUuids.add(effect.createdUuid);
            }
          }
        }
      }
    }
    const activeEffectsMap = await UtilsDocument.activeEffectFromUuid(allRelevantActiveEffectUuids);


    const processedActorUuids = new Set<string>();
    const createActiveEffectsByActorUuid = new Map<string, ActiveEffectData[]>();
    const deleteActiveEffectUuids = new Set<string>();
    for (const targetEvent of targetEvents) {
      const actor = tokenDocuments.get(targetEvent.selected.tokenUuid)?.getActor() as MyActor;
      if (!actor || processedActorUuids.has(actor.uuid)) {
        continue;
      }

      const activeEffectCards: ModularCardPartData<ActiveEffectCardData>[] = targetEvent.messageCardParts.filter(part => ModularCard.isType<ActiveEffectCardData>(ActiveEffectCardPart.instance, part));
      for (const activeEffectCard of activeEffectCards) {
        const expectedActiveEffectIndexes: number[] = [];
        if (targetEvent.apply !== 'undo') {
          for (let i = 0; i < activeEffectCard.data.activeEffects.length; i++) {
            expectedActiveEffectIndexes.push(i);
          }
        }
        const appliedActiveEffectIndexes: number[] = [];
        const cache = getTargetCache(activeEffectCard.data, actor.uuid);
        for (const applied of cache.appliedEffects) {
          if (expectedActiveEffectIndexes.includes(applied.originalIndex)) {
            if (activeEffectsMap.has(applied.createdUuid)) {
              appliedActiveEffectIndexes.push(applied.originalIndex);
            }
          } else {
            deleteActiveEffectUuids.add(applied.createdUuid);
          }
        }

        for (let i = 0; i < activeEffectCard.data.activeEffects.length; i++) {
          if (appliedActiveEffectIndexes.includes(i) || !expectedActiveEffectIndexes.includes(i)) {
            continue;
          }
          const effect = activeEffectCard.data.activeEffects[i];
          const activeEffectData = deepClone(effect);
          activeEffectData.origin = null; // TODO
          activeEffectData.flags = activeEffectData.flags ?? {};
          activeEffectData.flags[staticValues.moduleName] = activeEffectData.flags[staticValues.moduleName] ?? {};
          (activeEffectData.flags[staticValues.moduleName] as any).origin = {
            messageId: targetEvent.messageId,
            partId: activeEffectCard.id,
            activeEffectIndex: i,
          };
          if (!createActiveEffectsByActorUuid.has(cache.actorUuid)) {
            createActiveEffectsByActorUuid.set(cache.actorUuid, []);
          }
          createActiveEffectsByActorUuid.get(cache.actorUuid).push(activeEffectData);
        }
      }
    }

    const createdEffectsPromises: Array<Promise<ActiveEffect[]>> = [];
    for (const [actorUuid, effectDatas] of createActiveEffectsByActorUuid.entries()) {
      if (effectDatas.length === 0) {
        return;
      }
      createdEffectsPromises.push(actorsByTokenUuid.get(actorUuid).createEmbeddedDocuments('ActiveEffect', effectDatas));
    }

    const createdUuidsByOriginKey = new Map<string, string>();
    if (deleteActiveEffectUuids.size > 0) {
      await UtilsDocument.bulkDelete(deleteActiveEffectUuids)
    }
    for (const effectDocument of (await Promise.all(createdEffectsPromises)).deepFlatten()) {
      const origin = (effectDocument.data.flags[staticValues.moduleName] as any).origin;
      createdUuidsByOriginKey.set(`${origin.messageId}/${origin.partId}/${effectDocument.parent.uuid}/${origin.activeEffectIndex}`, effectDocument.uuid);
    }
    
    for (const targetEvent of targetEvents) {
      const actor = tokenDocuments.get(targetEvent.selected.tokenUuid)?.getActor() as MyActor;
      if (!actor || processedActorUuids.has(actor.uuid)) {
        continue;
      }

      const activeEffectCards: ModularCardPartData<ActiveEffectCardData>[] = targetEvent.messageCardParts.filter(part => ModularCard.isType<ActiveEffectCardData>(ActiveEffectCardPart.instance, part));
      for (const activeEffectCard of activeEffectCards) {
        for (const targetCache of activeEffectCard.data.calc$.targetCaches) {
          targetCache.appliedEffects = targetCache.appliedEffects.filter(applied => {
            return !deleteActiveEffectUuids.has(applied.createdUuid);
          });
          for (let i = 0; i < activeEffectCard.data.activeEffects.length; i++) {
            const key = `${targetEvent.messageId}/${activeEffectCard.id}/${targetCache.actorUuid}/${i}`;
            if (createdUuidsByOriginKey.has(key)) {
              targetCache.appliedEffects.push({originalIndex: i, createdUuid: createdUuidsByOriginKey.get(key)});
            }
          }
        }
      }
    }
  }

  private getTargetState(context: StateContext): VisualState[] {
    const activeEffectParts: ActiveEffectCardData[] = [];
    const selectionIdToActorUuid = new Map<string, string>();
    for (const part of context.allMessageParts) {
      if (!ModularCard.isType<ActiveEffectCardData>(this, part)) {
        continue;
      }
      activeEffectParts.push(part.data);
      for (const targetCache of part.data.calc$.targetCaches) {
        for (const selection of targetCache.selections) {
          selectionIdToActorUuid.set(selection.selectionId, targetCache.actorUuid);
        }
      }
    }

    const states: VisualState[] = [];
    for (const part of activeEffectParts) {
      const addedTargetIds = new Set<string>();
      for (const targetCache of part.calc$.targetCaches) {
        const appliedActiveEffects = targetCache.appliedEffects.map(effect => effect.originalIndex);
        for (const selection of targetCache.selections) {
          addedTargetIds.add(selection.selectionId)
          const visualState: VisualState = {
            selectionId: selection.selectionId,
            tokenUuid: selection.tokenUuid,
            state: 'not-applied',
            columns: []
          };
          const appliedStates = new Set<boolean>();
          for (let i = 0; i < part.activeEffects.length; i++) {
            const activeEffect = part.activeEffects[i];
            const applied = appliedActiveEffects.includes(i);
            appliedStates.add(applied);
            visualState.columns.push({
              key: ActiveEffectCardPart.instance.getType() + '-' + i,
              label: `<img width="20px" height="20px" src="${activeEffect.icon}">`,
              rowValue: applied ? `<span style="color: green">✓</span>` : `<span style="color: red">✗</span>`
            });
          }
          if (appliedStates.size > 1) {
            visualState.state = 'partial-applied';
          } else if (appliedStates.size === 1 && appliedStates.has(true)) {
            visualState.state = 'applied';
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
        for (let i = 0; i < part.activeEffects.length; i++) {
          const activeEffect = part.activeEffects[i];
          visualState.columns.push({
            key: ActiveEffectCardPart.instance.getType() + '-' + i,
            label: `<img width="20px" height="20px" src="${activeEffect.icon}">`,
            rowValue: `<span style="color: red">✗</span>`,
          });
        }
        states.push(visualState);
      }
    }

    return states;
  }
  //#endregion

}

class ActiveEffectCardTrigger implements ITrigger<ModularCardTriggerData> {

  //#region upsert
  public async upsert(context: IAfterDmlContext<ModularCardTriggerData>): Promise<void> {
    await this.calcTargetCache(context);
    // TODO auto apply healing, but it needs to be sync?
  }
  
  private async calcTargetCache(context: IDmlContext<ModularCardTriggerData>): Promise<void> {
    const selectedByMessageId = new Map<string, TargetCardData['selected']>();
    const newSelectedByMessageId = new Map<string, TargetCardData['selected']>();
    for (const {newRow, oldRow} of context.rows) {
      if (!ModularCard.isType<TargetCardData>(TargetCardPart.instance, newRow)) {
        continue;
      }

      if (!newSelectedByMessageId.has(newRow.messageId)) {
        newSelectedByMessageId.set(newRow.messageId, []);
      }
      if (!selectedByMessageId.has(newRow.messageId)) {
        selectedByMessageId.set(newRow.messageId, []);
      }
      const newSelected = newSelectedByMessageId.get(newRow.messageId);
      const allSelected = selectedByMessageId.get(newRow.messageId);
      const oldSelectionIds = (oldRow as ModularCardTriggerData<TargetCardData>)?.data?.selected.map(s => s.selectionId) ?? [];
      for (const target of newRow.data.selected) {
        allSelected.push(target);
        if (!oldSelectionIds.includes(target.selectionId)) {
          newSelected.push(target);
        }
      }
    }

    const recalcTokens: Array<{selectionId: string, tokenUuid: string, data: ActiveEffectCardData, messageId: string}> = [];
    for (const {newRow} of context.rows) {
      if (!ModularCard.isType<ActiveEffectCardData>(ActiveEffectCardPart.instance, newRow)) {
        continue;
      }
      // Calc new targets
      if (newSelectedByMessageId.has(newRow.messageId)) {
        for (const selection of newSelectedByMessageId.get(newRow.messageId)) {
          // Ignore what is already cached, always fetch when a new target has been selected
          recalcTokens.push({data: newRow.data, tokenUuid: selection.tokenUuid, selectionId: selection.selectionId, messageId: newRow.messageId});
        }
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
        actorUuid: actor.uuid,
        selections: [],
        appliedEffects: currentCache ? currentCache.appliedEffects : [],
      };

      for (const selected of selectedByMessageId.get(recalcToken.messageId) ?? []) {
        if (tokenUuidsByActorUuid.get(actor.uuid).includes(selected.tokenUuid)) {
          cache.selections.push({
            selectionId: selected.selectionId,
            tokenUuid: selected.tokenUuid,
          });
        }
      }

      setTargetCache(recalcToken.data, cache);
      recalcedActorUuids.add(actor.uuid);
    }
  }
  
  //#endregion

}