
import { RollDamageEventData, RollDamageMode } from "../../elements/roll-damage-element";
import { ITrigger, IDmlContext, IAfterDmlContext } from "../../lib/db/dml-trigger";
import { DocumentListener } from "../../lib/db/document-listener";
import { UtilsDocument, PermissionCheck } from "../../lib/db/utils-document";
import { RunOnce } from "../../lib/decorator/run-once";
import { Component, OnInit, OnInitParam } from "../../lib/render-engine/component";
import { UtilsDiceSoNice } from "../../lib/roll/utils-dice-so-nice";
import { TermData, RollData, UtilsRoll } from "../../lib/roll/utils-roll";
import { UtilsCompare } from "../../lib/utils/utils-compare";
import { ValueProvider } from "../../provider/value-provider";
import { staticValues } from "../../static-values";
import { MyActor, DamageType, MyItemData, MyItem } from "../../types/fixed-types";
import { UtilsArray } from "../../utils/utils-array";
import { UtilsLog } from "../../utils/utils-log";
import { Action } from "../action";
import { ChatPartIdData, ItemCardHelpers } from "../item-card-helpers";
import { ModularCard, ModularCardInstance, ModularCardTriggerData } from "../modular-card";
import { ModularCardPart, ModularCardCreateArgs, CreatePermissionCheckArgs, HtmlContext, createPermissionCheckAction } from "../modular-card-part";
import { AttackCardData, AttackCardPart } from "./attack-card-part";
import { BaseCardComponent } from "./base-card-component";
import { CheckCardData, CheckCardPart, TargetCache as CheckTargetCache } from "./check-card-part";
import { State, StateContext, TargetCallbackData, TargetCardData, TargetCardPart, VisualState } from "./target-card-part";

type KeyOfType<T, V> = keyof {
  [P in keyof T as T[P] extends V? P: never]: any
}

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

export interface ItemDamageSource {
  type: 'Item';
  itemUuid: string;
  spellLevel?: MyItemData['data']['level'];
  hasVersatile: boolean;
}

export interface FormulaDamageSource {
  type: 'Formula';
  formula: string;
}

export interface ManualDamageSource {
  type: 'Manual';
  normalBaseRoll: TermData[];
  versatileBaseRoll?: TermData[];
}

export type DamageSource = ItemDamageSource | FormulaDamageSource | ManualDamageSource

export interface DamageCardData {
  phase: 'mode-select' | 'result';
  mode: 'normal' | 'critical';
  source: 'normal' | 'versatile';
  userBonus?: string;
  calc$: {
    actorUuid?: string;
    properties: MyItem['data']['data']['properties'];
    damageSource: ItemDamageSource | ManualDamageSource;
    modfierRule?: 'save-full-dmg' | 'save-halve-dmg' | 'save-no-dmg';
    roll?: RollData;
    displayFormula?: string;
    displayDamageTypes?: string;
    targetCaches: TargetCache[]
  };
  /* External factors may add damages to this object to be added to the total */
  extraDamageSources: {
    [key: string]: DamageSource;
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


function isItem(item: any): item is MyItem {
  return item instanceof Item;
}

async function itemSourceToManualSource(itemSource: ItemDamageSource | MyItem, addActorBonus = false): Promise<ManualDamageSource> {
  const item = isItem(itemSource) ? itemSource : (await UtilsDocument.itemFromUuid(itemSource.itemUuid));
  const rollData = item.getRollData();

  const manualSource: ManualDamageSource = {
    type: 'Manual',
    normalBaseRoll: [],
  };

  if (item.data.data.damage?.parts?.length > 0) {
    manualSource.normalBaseRoll = UtilsRoll.toRollData(UtilsRoll.damagePartsToRoll(item.data.data.damage.parts, rollData)).terms;
    if (item.data.data.damage.versatile) {
      manualSource.versatileBaseRoll = UtilsRoll.toRollData(UtilsRoll.versatilePartsToRoll(item.data.data.damage.parts, item.data.data.damage.versatile, rollData)).terms;
    }
  }

  const rollKeys: Array<KeyOfType<ManualDamageSource, TermData[]>> = ['normalBaseRoll'];
  if (item.data.data.damage.versatile) {
    rollKeys.push('versatileBaseRoll');
  }
  
  // Upcasting
  for (const key of rollKeys) {
    const scaling = item.data.data.scaling;

    let upcastLevels = 0;
    if (scaling?.mode === 'level' && scaling.formula) {
      const originalItem = await UtilsDocument.itemFromUuid(item.uuid);
      if (originalItem && item.data.data.level > originalItem.data.data.level) {
        upcastLevels = item.data.data.level - originalItem.data.data.level;
      }
    } else if (scaling?.mode === 'cantrip' && item.actor) {
      let actorLevel = 0;
      if (item.actor.type === "character") {
        actorLevel = item.actor.data.data.details.level;
      } else if (item.data.data.preparation.mode === "innate") {
        actorLevel = Math.ceil(item.actor.data.data.details.cr);
      } else {
        actorLevel = item.actor.data.data.details.spellLevel;
      }
      upcastLevels = Math.floor((actorLevel + 1) / 6);
    }

    if (upcastLevels > 0) {
      let scalingBaseRoll: Roll;
      if (scaling.formula == null || scaling.formula === '') {
        // DND5e spell compendium has cantrip formula empty => default to the base damage formula
        // For consistency, do this for all spells
        scalingBaseRoll = UtilsRoll.fromRollTermData(manualSource[key]);
      } else {
        scalingBaseRoll = new Roll(scaling.formula, rollData);
      }
      const scalingRoll = scalingBaseRoll.alter(upcastLevels, 0, {multiplyNumeric: true});
      manualSource[key] = UtilsRoll.toRollData(UtilsRoll.mergeRolls(UtilsRoll.fromRollTermData(manualSource[key]), scalingRoll)).terms;
    }
  }

  // Actor bonus
  if (addActorBonus && item.actor) {
    const actorBonus = item.actor.data.data.bonuses?.[item.data.data.actionType];
    if (actorBonus?.damage && parseInt(actorBonus.damage) !== 0) {
      for (const key of rollKeys) {
        const modifiedRoll = UtilsRoll.mergeRolls(UtilsRoll.fromRollTermData(manualSource[key]), new Roll(actorBonus.damage, rollData));
        manualSource[key] = UtilsRoll.toRollData(modifiedRoll).terms;
      }
    }
  }

  return manualSource;    
}

@Component({
  tag: DamageCardComponent.getSelector(),
  html: /*html*/`
  <div class="flavor">
    {{ this.flavor }}
  </div>
  <nd5a-roll-damage
    [data-roll]="this.roll"
    [data-bonus-formula]="this.userBonus"
    [data-roll-mode]="this.rollMode"
    [data-roll-source]="this.rollSource"
    [data-disable-source-select]="!this.hasVersatile"
    [data-override-formula]="this.overrideFormula"
    [data-read-permission]="this.readPermission"
    [data-interaction-permission]="this.interactionPermission"

    (rollMode)="this.onRollMode($event)"
    (rollSource)="this.onRollSource($event)"
    (doRoll)="this.onRollClick($event)"
  ></nd5a-roll-damage>
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
  private static actionPermissionCheck = createPermissionCheckAction<{cardParts: ModularCardInstance}>(({cardParts}) => {
    const part = cardParts.getTypeData<DamageCardData>(DamageCardPart.instance);
    const documents: CreatePermissionCheckArgs['documents'] = [];
    if (part?.calc$?.actorUuid) {
      documents.push({uuid: part.calc$.actorUuid, permission: 'OWNER', security: true});
    }
    return {documents: documents};
  });
  private static rollClick = new Action<{event: CustomEvent<{userBonus?: string}>} & ChatPartIdData>('DamageOnRollClick')
    .addSerializer(ItemCardHelpers.getRawSerializer('messageId'))
    .addSerializer(ItemCardHelpers.getCustomEventSerializer())
    .addEnricher(ItemCardHelpers.getChatEnricher())
    .setPermissionCheck(DamageCardComponent.actionPermissionCheck)
    .build(({messageId, event, cardParts}) => {
      const part = cardParts.getTypeData<DamageCardData>(DamageCardPart.instance);
      if (part.userBonus === event.userBonus && part.phase === 'result') {
        return;
      }
      part.userBonus = event.userBonus;
      part.phase = 'result';
      return ModularCard.setCardPartDatas(game.messages.get(messageId), cardParts);
    });
  private static modeChange = new Action<{event: CustomEvent<RollDamageEventData<RollDamageMode>>} & ChatPartIdData>('DamageOnModeChange')
    .addSerializer(ItemCardHelpers.getRawSerializer('messageId'))
    .addSerializer(ItemCardHelpers.getCustomEventSerializer())
    .addEnricher(ItemCardHelpers.getChatEnricher())
    .setPermissionCheck(DamageCardComponent.actionPermissionCheck)
    .build(({messageId, cardParts, event}) => {
      const part = cardParts.getTypeData<DamageCardData>(DamageCardPart.instance);
      if (part.mode === event.data) {
        return;
      }

      part.mode = event.data;
      if (event.quickRoll) {
        part.phase = 'result';
      }
      return ModularCard.setCardPartDatas(game.messages.get(messageId), cardParts);
    });
  private static sourceChange = new Action<{event: CustomEvent<RollDamageEventData<DamageCardData['source']>>} & ChatPartIdData>('DamageOnSourceChange')
    .addSerializer(ItemCardHelpers.getRawSerializer('messageId'))
    .addSerializer(ItemCardHelpers.getCustomEventSerializer())
    .addEnricher(ItemCardHelpers.getChatEnricher())
    .setPermissionCheck(DamageCardComponent.actionPermissionCheck)
    .build(({messageId, cardParts, event}) => {
      const part = cardParts.getTypeData<DamageCardData>(DamageCardPart.instance);
      if (part.source === event.data) {
        return;
      }

      part.source = event.data;
      if (event.quickRoll) {
        part.phase = 'result';
      }
      return ModularCard.setCardPartDatas(game.messages.get(messageId), cardParts);
    });
  //#endregion

  private static inlineFlavorRegex: RegExp;
  private static optionFlavorRegex: RegExp;

  static {
    const baseFlavorRegex = `(?:(?:${UtilsRoll.getValidDamageTypes().join('|')}):)?(.*)`;
    DamageCardComponent.inlineFlavorRegex = new RegExp(`\\[${baseFlavorRegex}] *$`, 'i');
    DamageCardComponent.optionFlavorRegex = new RegExp(`^ *${baseFlavorRegex} *$`, 'i');
  }

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
      this.getData<DamageCardData>(DamageCardPart.instance).switchMap((data) => {
        return ValueProvider.mergeObject({
          ...data,
          itemDamageSource: data.part.calc$.damageSource.type === 'Manual' ? null : DocumentListener.listenUuid(data.part.calc$.damageSource.itemUuid),
          hasReadPermission: UtilsDocument.hasAllPermissions([{uuid: data.part.calc$.actorUuid, permission: `${staticValues.code}ReadDamage`, user: game.user}]),
        })
      }).listen(async ({part, itemDamageSource, hasReadPermission}) => {
        this.roll = part.calc$.roll;
        this.rollMode = part.mode;
        this.rollSource = part.source;
        this.hasVersatile = part.calc$.damageSource.type === 'Item' ? part.calc$.damageSource.hasVersatile : (part.calc$.damageSource.versatileBaseRoll != null);
        this.userBonus = part.userBonus;
        this.overrideFormula = part.calc$.displayFormula
        this.interactionPermission = `OwnerUuid:${part.calc$.actorUuid}`;
        this.readPermission = `${staticValues.code}ReadDamageUuid:${part.calc$.actorUuid}`;
        this.flavor = game.i18n.localize('DND5E.Damage');

        if (hasReadPermission) {
          let isHealing = false;
          let damageSourceFlavor: string = null;
          if (!part.calc$.roll && part.calc$.damageSource.type === 'Item') {
            if (itemDamageSource) {
              const dmg = itemDamageSource.data.data.damage;
              isHealing = dmg.parts.every(([dmg, type]) => ItemCardHelpers.healingDamageTypes.includes(type));
              if (this.rollSource === 'normal' && dmg.parts) {
                const flavor = DamageCardComponent.inlineFlavorRegex.exec(dmg.parts[dmg.parts.length-1][0]);
                if (flavor && UtilsRoll.toDamageType(flavor[1]) == null) {
                  damageSourceFlavor = flavor[1];
                }
              } else if (this.rollSource === 'versatile' && dmg.versatile) {
                const flavor = DamageCardComponent.inlineFlavorRegex.exec(dmg.versatile);
                if (flavor && UtilsRoll.toDamageType(flavor[1]) == null) {
                  damageSourceFlavor = flavor[1];
                }
              }
            } else {
              isHealing = false;
            }
          } else {
            let rollTerms: TermData[];
            if (part.calc$.roll) {
              rollTerms = part.calc$.roll.terms;
            } else {
              rollTerms = part.source === 'versatile' ? (part.calc$.damageSource as ManualDamageSource).versatileBaseRoll : (part.calc$.damageSource as ManualDamageSource).normalBaseRoll;
            }
            
            const damageTypes: DamageType[] = rollTerms.map(roll => roll.options?.flavor).map(flavor => UtilsRoll.toDamageType(flavor)).filter(type => type != null);
            isHealing = damageTypes.length > 0 && damageTypes.every(damageType => ItemCardHelpers.healingDamageTypes.includes(damageType));
            
            let flavor: RegExpExecArray;
            if (rollTerms[rollTerms.length-1].options?.flavor != null) {
              flavor = DamageCardComponent.optionFlavorRegex.exec(rollTerms[rollTerms.length-1].options?.flavor ?? '');
            } else if (rollTerms[rollTerms.length-1].class === 'StringTerm') {
              flavor = DamageCardComponent.inlineFlavorRegex.exec(((rollTerms[rollTerms.length-1]) as any).term);
            }
            if (flavor && UtilsRoll.toDamageType(flavor[1]) == null) {
              damageSourceFlavor = flavor[1];
            }
          }
          
          if (damageSourceFlavor) {
            this.flavor = damageSourceFlavor;
          } else if (isHealing) {
            this.flavor = game.i18n.localize('DND5E.Healing');
            if (part.calc$.roll?.evaluated) {
              // Critical and/or versatile heals almost never happen (only in homebrew I think?), but just in case do specify that the crit is a heal
              if (part.source === 'versatile') {
                this.flavor = `${this.flavor}+${game.i18n.localize(`DND5E.${part.source.capitalize()}`)}`;
              }if (part.mode === 'critical') {
                this.flavor = `${this.flavor}+${game.i18n.localize(`DND5E.${part.mode.capitalize()}`)}`;
              }
            }
          } else {
            if (!part.calc$.roll?.evaluated) {
              this.flavor = game.i18n.localize('DND5E.Damage');
            } else if (part.source === 'versatile') {
              this.flavor = game.i18n.localize(`DND5E.${part.source.capitalize()}`);
              if (part.mode === 'critical') {
                this.flavor = `${this.flavor}+${game.i18n.localize(`DND5E.${part.mode.capitalize()}`)}`
              }
            } else if (part.mode === 'critical') {
              this.flavor = game.i18n.localize(`DND5E.${part.mode.capitalize()}`);
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
    DamageCardComponent.rollClick({event, messageId: this.messageId});
  }
  
  public onRollSource(event: CustomEvent<RollDamageEventData<DamageCardData['source']>>): void {
    DamageCardComponent.sourceChange({event, messageId: this.messageId});
  }

  public onRollMode(event: CustomEvent<RollDamageEventData<RollDamageMode>>): void {
    DamageCardComponent.modeChange({event, messageId: this.messageId});
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
        properties: deepClone(item.data.data.properties),
        damageSource: await itemSourceToManualSource(item, true),
        targetCaches: [],
      },
      extraDamageSources: {},
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
    return 'DamageCardPart';
  }

  //#region Front end
  public getHtml(data: HtmlContext): string | null | Promise<string | null> {
    return `<${DamageCardComponent.getSelector()} data-message-id="${data.messageId}"></${DamageCardComponent.getSelector()}>`
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
      
      const attackCard = targetEvent.messageCardParts.getTypeData<AttackCardData>(AttackCardPart.instance);
      const damageCard = targetEvent.messageCardParts.getTypeData<DamageCardData>(DamageCardPart.instance);

      // Undo already applied damage
      if (damageCard) {
        const cache = deepClone(getTargetCache(damageCard, targetEvent.selected.selectionId));
        if (!cache) {
          continue;
        }
        tokenHp.hp -= cache.appliedHpChange;
        tokenHp.tempHp -= cache.appliedTmpHpChange;
        tokenHp.failedDeathSaves -= cache.appliedFailedDeathSaved;
        
        let apply = false;
        delete cache.smartState;
        switch (targetEvent.apply) {
          case 'smart-apply': {
            let attackHits = true;
            if (attackCard != null) {
              const hitType = attackCard.targetCaches$.find(target => target.targetUuid$ === targetEvent.selected.tokenUuid)?.resultType$;
              attackHits = hitType === 'hit' || hitType === 'critical-hit';
            }
            cache.smartState = 'applied';
            if (!attackHits) {
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
          setTargetCache(damageCard, {
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
          setTargetCache(damageCard, {
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
    const part = context.allMessageParts.getTypeData<DamageCardData>(this);
    if (part == null) {
      return [];
    }
    
    const states = new Map<string, Omit<VisualState, 'columns'> & {hpDiff: number, hidden: boolean}>();
    for (const selected of context.selected) {
      states.set(selected.selectionId, {selectionId: selected.selectionId, tokenUuid: selected.tokenUuid, hpDiff: 0, hidden: false});
    }

    for (const targetCache of part.calc$.targetCaches) {
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
      if (part.calc$.actorUuid) {
        canSeeDamage = game.settings.get(staticValues.moduleName, 'damageHiddenRoll') === 'total';
        if (!canSeeDamage) {
          UtilsDocument.hasAllPermissions([{
            uuid: part.calc$.actorUuid,
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
      const damagePart = newRow.allParts.getTypeData<DamageCardData>(DamageCardPart.instance);
      if (damagePart == null) {
        continue;
      }
      const oldSelectionIds = oldRow?.part?.selected.map(s => s.selectionId) ?? [];
      for (const target of newRow.part.selected) {
        if (!oldSelectionIds.includes(target.selectionId)) {
          recalcTokens.push({selectionId: target.selectionId, tokenUuid: target.tokenUuid, data: damagePart});
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

  //#region beforeCreate
  public beforeCreate(context: IDmlContext<ModularCardTriggerData<DamageCardData>>): boolean | void {
    this.calcAutoRollOnCreate(context);
  }

  private calcAutoRollOnCreate(context: IDmlContext<ModularCardTriggerData<DamageCardData>>): boolean | void {
    let autoRoll = false;
    if (game.user.isGM) {
      autoRoll = game.settings.get(staticValues.moduleName, 'gmAutorollDamage') === 'always';
    } else {
      autoRoll = game.settings.get(staticValues.moduleName, 'playerAutorollDamage') === 'always';
    }

    if (autoRoll) {
      for (const {newRow} of context.rows) {
        newRow.part.phase = 'result';
      }
    }
  }
  //#endregion

  //#region beforeUpsert
  public beforeUpsert(context: IDmlContext<ModularCardTriggerData<DamageCardData>>): boolean | void {
    this.calcAutoRollOnAttackHit(context);
    this.calculateRollDisplay(context);
    this.calcTargetCache(context);
  }

  private calculateRollDisplay(context: IDmlContext<ModularCardTriggerData<DamageCardData>>): void {
    for (const {newRow} of context.rows) {
      if (!newRow.part.calc$.roll) {
        newRow.part.calc$.displayFormula = null;
        newRow.part.calc$.displayDamageTypes = null;
        continue;
      }
    
      const damageTypes: DamageType[] = [];
      let shortenedFormula = newRow.part.calc$.roll.formula;
      for (const damageType of UtilsRoll.getValidDamageTypes()) {
        if (shortenedFormula.match(`\\[${damageType}\\]`)) {
          damageTypes.push(damageType);
          shortenedFormula = shortenedFormula.replace(new RegExp(`\\[${damageType}\\]`, 'g'), '');
        }
      }

      // formula without damage comments
      newRow.part.calc$.displayFormula = shortenedFormula;
      newRow.part.calc$.displayDamageTypes = damageTypes.length > 0 ? `(${damageTypes.sort().map(s => s.capitalize()).join(', ')})` : undefined;
    }
  }
  
  private calcTargetCache(context: IDmlContext<ModularCardTriggerData<DamageCardData>>): void {
    for (const {newRow} of context.rows) {
      const checkPart = newRow.allParts.getTypeData<CheckCardData>(CheckCardPart.instance);
      
      const checkResultsBySelectionId = new Map<string, CheckTargetCache>();
      if (checkPart) {
        for (const target of checkPart.targetCaches$) {
          checkResultsBySelectionId.set(target.selectionId$, target);
        }
      }

      for (const cache of newRow.part.calc$.targetCaches) {
        cache.calcAddTmpHp = 0;
        cache.calcHpChange = 0;
        cache.calcFailedDeathSaved = 0;
        if (newRow.part.calc$.roll?.evaluated) {
          for (let [dmgType, amount] of UtilsRoll.rollToDamageResults(UtilsRoll.fromRollData(newRow.part.calc$.roll)).entries()) {
            const aliases: string[] = [dmgType];
            if (dmgType === 'bludgeoning' || dmgType === 'piercing' || dmgType === 'slashing') {
              if (!newRow.part.calc$.properties.mgc) {
                aliases.push('physical'); // = non magical physical
              }
            }
            if (UtilsArray.includesAny(cache.immunities, aliases)) {
              continue;
            }
            if (UtilsArray.includesAny(cache.resistances, aliases)) {
              amount /= 2;
            }
            if (UtilsArray.includesAny(cache.vulnerabilities, aliases)) {
              amount *= 2;
            }
            const checkResult = checkResultsBySelectionId.get(cache.selectionId);
            if (checkResult?.resultType$ === 'pass') {
              switch (newRow.part.calc$.modfierRule) {
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
          
          cache.calcAddTmpHp = Math.floor(cache.calcAddTmpHp);
          cache.calcHpChange = Math.floor(cache.calcHpChange);
          cache.calcHpChange = Math.floor(cache.calcHpChange);
        }
      }
    }
  }

  private calcAutoRollOnAttackHit(context: IDmlContext<ModularCardTriggerData<DamageCardData>>): boolean | void {
    let autoRoll = false;
    if (game.user.isGM) {
      autoRoll = game.settings.get(staticValues.moduleName, 'gmAutorollDamage') === 'onAttackHit';
    } else {
      autoRoll = game.settings.get(staticValues.moduleName, 'playerAutorollDamage') === 'onAttackHit';
    }

    if (!autoRoll) {
      return;
    }
    
    for (const {newRow} of context.rows) {
      if (newRow.part.phase === 'result') {
        continue;
      }
      const attack = newRow.allParts.getTypeData<AttackCardData>(AttackCardPart.instance);
      let countAsHit = false;
      if (attack == null) {
        countAsHit = true;
      } else {
        for (const cache of attack.targetCaches$) {
          if (cache.resultType$ === 'hit' || cache.resultType$ === 'critical-hit') {
            countAsHit = true;
            break;
          }
        }
      }
      if (countAsHit) {
        newRow.part.phase = 'result';
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
      if (newRow.part.phase !== 'result') {
        return;
      }

      // Only do roll when changed is detected
      const newData = newRow.part;
      const oldData = oldRow?.part;

      let shouldModifyRoll = oldData == null || !newRow.part.calc$.roll?.evaluated;
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
        const damageSources: DamageSource[] = [newData.calc$.damageSource];
        if (newData.userBonus) {
          damageSources.push({type: 'Formula', formula: newData.userBonus});
        }
        damageSources.push(...Object.values(newData.extraDamageSources));
        
        const newRoll: () => Promise<Roll> = async () => {
          const rollTermsCollection$: Array<Promise<TermData[]>> = [];
          for (let damageSource of damageSources) {
            switch (damageSource.type) {
              case 'Formula': {
                const rollTerms = UtilsRoll.toRollData(new Roll(damageSource.formula)).terms;
                rollTermsCollection$.push(Promise.resolve(rollTerms));
                break;
              }
              case 'Manual': {
                const rollTerms = newData.source === 'versatile' && damageSource.versatileBaseRoll ? damageSource.versatileBaseRoll :  damageSource.normalBaseRoll;
                rollTermsCollection$.push(Promise.resolve(rollTerms));
                break;
              }
              case 'Item': {
                rollTermsCollection$.push(itemSourceToManualSource(damageSource).then(source => {
                  return newData.source === 'versatile' && source.versatileBaseRoll ? source.versatileBaseRoll :  source.normalBaseRoll;
                }));
                break;
              }
            }
          }

          const rollRolls = (await Promise.all(rollTermsCollection$))
            .filter(terms => terms?.length > 0)
            .map(terms => UtilsRoll.fromRollTermData(terms));

          // TODO ammo
          // TODO event hooks
          const dmgRoll = UtilsRoll.createDamageRoll(UtilsRoll.mergeRolls(...rollRolls).terms, {critical: newRow.part.mode === 'critical'});

          return dmgRoll.roll({async: true});
        }

        const oldRoll = oldData?.calc$?.roll == null ? null : UtilsRoll.fromRollData(oldData.calc$.roll);
        const resultRoll = (await UtilsRoll.modifyRoll(oldRoll, newRoll)).result;
        if (resultRoll.total == null) {
          await resultRoll.roll({async: true});
        }
        newData.calc$.roll = UtilsRoll.toRollData(resultRoll);
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
      if (newRow.part.calc$.roll?.evaluated) {
        const roll = UtilsRoll.getNewRolledTerms(oldRow?.part?.calc$?.roll, newRow.part.calc$.roll);
        if (roll) {
          showRolls.push({
            uuid: newRow.part.calc$.actorUuid,
            permission: `${staticValues.code}ReadDamage`,
            user: game.user,
            meta: roll,
          });
        }
      }
    }
    
    UtilsDocument.hasPermissions(showRolls).listenFirst().then(responses => {
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