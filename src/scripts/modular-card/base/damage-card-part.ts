
import { RollDamageEventData, RollDamageMode } from "../../elements/roll-damage-element";
import { ITrigger, IDmlContext, IAfterDmlContext } from "../../lib/db/dml-trigger";
import { UtilsDocument, PermissionCheck } from "../../lib/db/utils-document";
import { RunOnce } from "../../lib/decorator/run-once";
import { Component, OnInit, OnInitParam } from "../../lib/render-engine/component";
import { UtilsDiceSoNice } from "../../lib/roll/utils-dice-so-nice";
import { TermData, RollData, UtilsRoll } from "../../lib/roll/utils-roll";
import { UtilsCompare } from "../../lib/utils/utils-compare";
import { staticValues } from "../../static-values";
import { MyActor, DamageType, MyItemData } from "../../types/fixed-types";
import { Action } from "../action";
import { ChatPartIdData, ItemCardHelpers } from "../item-card-helpers";
import { ModularCard, ModularCardPartData, ModularCardTriggerData } from "../modular-card";
import { ModularCardPart, ModularCardCreateArgs, CreatePermissionCheckArgs, HtmlContext, createPermissionCheckAction } from "../modular-card-part";
import { AttackCardData, AttackCardPart } from "./attack-card-part";
import { BaseCardComponent } from "./base-card-component";
import { CheckCardData, CheckCardPart, TargetCache as CheckTargetCache } from "./check-card-part";
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

interface ItemDamageSource {
  type: 'Item';
  itemUuid: string;
  spellLevel?: MyItemData['data']['level'];
  hasVersatile: boolean;
}

interface ManualDamageSource {
  type: 'Manual';
  normalBaseRoll: TermData[];
  versatileBaseRoll?: TermData[];
}

export interface DamageCardData {
  phase: 'mode-select' | 'result';
  mode: 'normal' | 'critical';
  source: 'normal' | 'versatile';
  userBonus?: string;
  calc$: {
    actorUuid?: string;
    damageSource: ItemDamageSource | ManualDamageSource;
    modfierRule?: 'save-full-dmg' | 'save-halve-dmg' | 'save-no-dmg';
    roll?: RollData;
    displayFormula?: string;
    displayDamageTypes?: string;
    targetCaches: TargetCache[]
  }
}

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

@Component({
  tag: DamageCardComponent.getSelector(),
  html: /*html*/`
  <div class="flavor">
    {{ this.flavor }}
  </div>
  <nac-roll-damage
    [data-roll]="this.roll"
    [data-bonus-formula]="this.userBonus"
    [data-roll-mode]="this.rollMode"
    [data-roll-source]="this.rollSource"
    [data-has-versatile]="this.hasVersatile"
    [data-override-formula]="this.overrideFormula"
    [data-read-permission]="this.readPermission"
    [data-interaction-permission]="this.interactionPermission"

    (rollMode)="this.onRollMode($event)"
    (rollSource)="this.onRollSource($event)"
    (doRoll)="this.onRollClick($event)"
  ></nac-roll-damage>
  `,
  style: /*css*/`
    .flavor {
      margin-top: 2px;
      text-align: center;
    }
  `
})
class DamageCardComponent extends BaseCardComponent implements OnInit {
  //#region actions
  private static actionPermissionCheck = createPermissionCheckAction<{part: {data: DamageCardData}}>(({part}) => {
    const documents: CreatePermissionCheckArgs['documents'] = [];
    if (part.data.calc$.actorUuid) {
      documents.push({uuid: part.data.calc$.actorUuid, permission: 'OWNER', security: true});
    }
    return {documents: documents};
  });
  private static rollClick = new Action<{event: CustomEvent<{userBonus?: string}>} & ChatPartIdData>('DamageOnRollClick')
    .addSerializer(ItemCardHelpers.getRawSerializer('messageId'))
    .addSerializer(ItemCardHelpers.getRawSerializer('partId'))
    .addSerializer(ItemCardHelpers.getCustomEventSerializer())
    .addEnricher(ItemCardHelpers.getChatPartEnricher<DamageCardData>())
    .setPermissionCheck(DamageCardComponent.actionPermissionCheck)
    .build(({messageId, part, event, allCardParts}) => {
      if (part.data.userBonus === event.userBonus && part.data.phase === 'result') {
        return;
      }
      part.data.userBonus = event.userBonus;
      part.data.phase = 'result';
      return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
    });
  private static modeChange = new Action<{event: CustomEvent<RollDamageEventData<RollDamageMode>>} & ChatPartIdData>('DamageOnModeChange')
    .addSerializer(ItemCardHelpers.getRawSerializer('messageId'))
    .addSerializer(ItemCardHelpers.getRawSerializer('partId'))
    .addSerializer(ItemCardHelpers.getCustomEventSerializer())
    .addEnricher(ItemCardHelpers.getChatPartEnricher<DamageCardData>())
    .setPermissionCheck(DamageCardComponent.actionPermissionCheck)
    .build(({messageId, allCardParts, part, event}) => {
      if (part.data.mode === event.data) {
        return;
      }

      part.data.mode = event.data;
      if (event.quickRoll) {
        part.data.phase = 'result';
      }
      return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
    });
  private static sourceChange = new Action<{event: CustomEvent<RollDamageEventData<DamageCardData['source']>>} & ChatPartIdData>('DamageOnSourceChange')
    .addSerializer(ItemCardHelpers.getRawSerializer('messageId'))
    .addSerializer(ItemCardHelpers.getRawSerializer('partId'))
    .addSerializer(ItemCardHelpers.getCustomEventSerializer())
    .addEnricher(ItemCardHelpers.getChatPartEnricher<DamageCardData>())
    .setPermissionCheck(DamageCardComponent.actionPermissionCheck)
    .build(({messageId, allCardParts, part, event}) => {
      if (part.data.source === event.data) {
        return;
      }

      part.data.source = event.data;
      if (event.quickRoll) {
        part.data.phase = 'result';
      }
      return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
    });
  //#endregion

  public static getSelector(): string {
    return `${staticValues.code}-damage-part`;
  }
  
  public roll: RollData;
  public rollMode: RollDamageMode;
  public rollSource: DamageCardData['source'];
  public hasVersatile = false;
  public flavor = '';
  public userBonus: string;
  public overrideFormula: string;
  public readPermission: string;
  public readHiddenDisplayType: string;
  public interactionPermission: string;
  
  public onInit(args: OnInitParam): void {
    args.addStoppable(
      this.getData<DamageCardData>(DamageCardPart.instance).listen(async ({part}) => {
        this.roll = part.data.calc$.roll;
        this.rollMode = part.data.mode;
        this.rollSource = part.data.source;
        this.hasVersatile = part.data.calc$.damageSource.type === 'Item' ? part.data.calc$.damageSource.hasVersatile : (part.data.calc$.damageSource.versatileBaseRoll != null);
        this.userBonus = part.data.userBonus;
        this.overrideFormula = part.data.calc$.displayFormula
        this.interactionPermission = `OwnerUuid:${part.data.calc$.actorUuid}`;
        this.readPermission = `${staticValues.code}ReadDamageUuid:${part.data.calc$.actorUuid}`;
        this.flavor = game.i18n.localize('DND5E.Damage');

        const hasReadPermission = await UtilsDocument.hasAllPermissions([{uuid: part.data.calc$.actorUuid, permission: `${staticValues.code}ReadDamage`, user: game.user}]);
        if (hasReadPermission) {
          let isHealing = false;
          if (!part.data.calc$.roll && part.data.calc$.damageSource.type === 'Item') {
            const item = await UtilsDocument.itemFromUuid(part.data.calc$.damageSource.itemUuid);
            if (item) {
              isHealing = item.data.data.damage.parts.every(([dmg, type]) => ItemCardHelpers.healingDamageTypes.includes(type));
            } else {
              isHealing = false;
            }
          } else {
            let rollTerms: TermData[];
            if (part.data.calc$.roll) {
              rollTerms = part.data.calc$.roll.terms;
            } else {
              rollTerms = part.data.source === 'versatile' ? (part.data.calc$.damageSource as ManualDamageSource).versatileBaseRoll : (part.data.calc$.damageSource as ManualDamageSource).normalBaseRoll;
            }
            
            const damageTypes: DamageType[] = rollTerms.map(roll => roll.options?.flavor).map(flavor => UtilsRoll.toDamageType(flavor)).filter(type => type != null);
            isHealing = damageTypes.length > 0 && damageTypes.every(damageType => ItemCardHelpers.healingDamageTypes.includes(damageType));
          }
          
          if (isHealing) {
            this.flavor = game.i18n.localize('DND5E.Healing');
            if (part.data.calc$.roll?.evaluated) {
              // Critical and/or versatile heals almost never happen (only in homebrew I think?), but just in case do specify that the crit is a heal
              if (part.data.source === 'versatile') {
                this.flavor = `${this.flavor}+${game.i18n.localize(`DND5E.${part.data.source.capitalize()}`)}`;
              }if (part.data.mode === 'critical') {
                this.flavor = `${this.flavor}+${game.i18n.localize(`DND5E.${part.data.mode.capitalize()}`)}`;
              }
            }
          } else {
            if (!part.data.calc$.roll?.evaluated) {
              this.flavor = game.i18n.localize('DND5E.Damage');
            } else if (part.data.source === 'versatile') {
              this.flavor = game.i18n.localize(`DND5E.${part.data.source.capitalize()}`);
              if (part.data.mode === 'critical') {
                this.flavor = `${this.flavor}+${game.i18n.localize(`DND5E.${part.data.mode.capitalize()}`)}`
              }
            } else if (part.data.mode === 'critical') {
              this.flavor = game.i18n.localize(`DND5E.${part.data.mode.capitalize()}`);
            } else {
              this.flavor = game.i18n.localize('DND5E.Damage');
            }
          }
        }
      })
    )
  }

  public onRollClick(event: CustomEvent<{userBonus?: string}>): void {
    if (this.userBonus === event.detail.userBonus && this.roll?.evaluated) {
      return;
    }
    DamageCardComponent.rollClick({event, partId: this.partId, messageId: this.messageId});
  }
  
  public onRollSource(event: CustomEvent<RollDamageEventData<DamageCardData['source']>>): void {
    DamageCardComponent.sourceChange({event, partId: this.partId, messageId: this.messageId});
  }

  public onRollMode(event: CustomEvent<RollDamageEventData<RollDamageMode>>): void {
    DamageCardComponent.modeChange({event, partId: this.partId, messageId: this.messageId});
  }
}

export class DamageCardPart implements ModularCardPart<DamageCardData> {

  public static readonly instance = new DamageCardPart();
  protected constructor(){}

  public async create({item, actor}: ModularCardCreateArgs): Promise<DamageCardData> {
    // TODO what about other interactions like hunters mark (automatic, but only to a specific target)
    //  => Add a damage per target uuid option (not selection id)?
    //     Maybe a bit more structured => Should have a damage object/array which everything uses, base dmg, user bonus and external factors

    if (!item.hasDamage) {
      return null;
    }

    // TODO make an other element with for the "other" formula
    const rollData: {[key: string]: any} = item.getRollData();
    if (item.data.data.prof?.hasProficiency) {
      rollData.prof = item.data.data.prof.term;
    }

    const inputDamages: DamageCardData = {
      mode: 'normal',
      phase: 'mode-select',
      source: 'normal',
      calc$: {
        damageSource: {
          type: 'Item',
          itemUuid: item.uuid,
          spellLevel: item.data.data.level,
          hasVersatile: item.data.data.damage?.versatile?.length > 0,
        },
        targetCaches: [],
      }
    };

    if (item.data.data.level === 0) {
      // Non homebrew cantrips take no damage on save
      inputDamages.calc$.modfierRule = 'save-no-dmg';
    } else if (item.data.data.level > 0) {
      // Not confirmed, but I believe most leveled spells that do damage use half damage on save
      inputDamages.calc$.modfierRule = 'save-halve-dmg';
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
  public getHtml(data: HtmlContext): string {
    return `<${DamageCardComponent.getSelector()} data-part-id="${data.partId}" data-message-id="${data.messageId}"></${DamageCardComponent.getSelector()}>`
  }
  //#endregion

  //#region Targeting
  private async targetCallback(targetEvents: TargetCallbackData[]): Promise<void> {
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
    // TODO also account for success/failed checks + half or 0 damage
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
    this.calculateRollDisplay(context);
    this.calcTargetCache(context);
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
      let checkPart: ModularCardPartData<CheckCardData> = newRow.allParts.find(part => ModularCard.isType<CheckCardData>(CheckCardPart.instance, part));
      
      const checkResultsBySelectionId = new Map<string, CheckTargetCache>();
      if (checkPart) {
        for (const target of checkPart.data.targetCaches$) {
          checkResultsBySelectionId.set(target.selectionId$, target);
        }
      }

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
            const checkResult = checkResultsBySelectionId.get(cache.selectionId);
            if (checkResult?.resultType$ === 'pass') {
              switch (newRow.part.data.calc$.modfierRule) {
                case 'save-halve-dmg': {
                  amount /= 2;
                  break;
                }
                case 'save-no-dmg': {
                  amount = 0;
                  break;
                }
              }
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
    await this.doRoll(context);
    // TODO auto apply healing, but it needs to be sync?
  }

  private async doRoll(context: IAfterDmlContext<ModularCardTriggerData<DamageCardData>>): Promise<void> {
    for (const {newRow, oldRow} of context.rows) {
      if (newRow.part.data.phase !== 'result') {
        return;
      }

      // Only do roll when changed is detected
      const newData = newRow.part.data;
      const oldData = oldRow?.part?.data;

      let shouldModifyRoll = oldData == null || !newRow.part.data.calc$.roll?.evaluated;
      if (!shouldModifyRoll) {
        const newChangeDetectData: DeepPartial<DamageCardData> = {
          ...newData,
        }
        newChangeDetectData.calc$ = {
          damageSource: newData.calc$.damageSource,
        };
        
        const oldChangeDetectData: DeepPartial<DamageCardData> = {
          ...oldData,
        }
        oldChangeDetectData.calc$ = {
          damageSource: oldData.calc$.damageSource,
        };
        shouldModifyRoll = !UtilsCompare.deepEquals(newChangeDetectData, oldChangeDetectData);
      }

      if (shouldModifyRoll) {
        if (newData.calc$.damageSource.type === 'Item') {
          const damageSource = newData.calc$.damageSource
          const item = await UtilsDocument.itemFromUuid(newData.calc$.damageSource.itemUuid);
          if (item) {
            // Crit's don't work for sneak attack "(ceil(@classes.rogue.levels /2))d6" on DnD5e V1.5.3
            // It does work on V2.0.3 (probably worked sooner)
            // Consider this bug fixed since it's fixed in a DnD system update
            const newRoll = async () => {
              const rollPromises: Promise<Roll>[] = [];
              rollPromises.push(item.rollDamage({
                critical: newData.mode === 'critical',
                versatile: newData.source === 'versatile',
                spellLevel: damageSource.spellLevel,
                options: {
                  fastForward: true,
                  chatMessage: false,
                }}));

              if (newData.userBonus) {
                rollPromises.push(new Roll(newData.userBonus).roll({async: true}));
              }
              return UtilsRoll.mergeRolls(...await Promise.all(rollPromises));
            };
            const oldRoll = oldData?.calc$?.roll == null ? null : UtilsRoll.fromRollData(oldData.calc$.roll);
            newData.calc$.roll = UtilsRoll.toRollData((await UtilsRoll.modifyRoll(oldRoll, newRoll)).result);
          }
        } else {
          const rollTerms = newData.source === 'versatile' ? newData.calc$.damageSource.versatileBaseRoll :  newData.calc$.damageSource.normalBaseRoll;
          if (newData.userBonus) {
            rollTerms.push(new OperatorTerm({operator: '+'}).toJSON() as TermData);
            rollTerms.push(...UtilsRoll.toRollData(new Roll(newData.userBonus)).terms);
          }
          const newRoll = UtilsRoll.fromRollTermData(rollTerms);
          const oldRoll = oldData.calc$.roll == null ? null : UtilsRoll.fromRollData(oldData.calc$.roll);
          const resultRoll = (await UtilsRoll.modifyRoll(oldRoll, newRoll)).result;
          if (resultRoll.total == null) {
            await resultRoll.roll({async: true});
          }
          newData.calc$.roll = UtilsRoll.toRollData(resultRoll);
        }
      }
    }
  }
  //#endregion

  //#region afterUpsert
  public async afterUpsert(context: IAfterDmlContext<ModularCardTriggerData<DamageCardData>>): Promise<void> {
    await this.diceSoNiceHook(context);
  }
  
  private async diceSoNiceHook(context: IDmlContext<ModularCardTriggerData<DamageCardData>>): Promise<void> {
    const showRolls: PermissionCheck<Roll>[] = [];
    for (const {newRow, oldRow} of context.rows) {
      // Detect new rolled dice
      if (newRow.part.data.calc$.roll?.evaluated) {
        const roll = UtilsRoll.getNewRolledTerms(oldRow?.part?.data?.calc$?.roll, newRow.part.data.calc$.roll);
        if (roll) {
          showRolls.push({
            uuid: newRow.part.data.calc$.actorUuid,
            permission: `${staticValues.code}ReadDamage`,
            user: game.user,
            meta: roll,
          });
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