import { RollD20EventData, RollMode } from "../../elements/roll-d20-element";
import { ITrigger, IDmlContext, IAfterDmlContext } from "../../lib/db/dml-trigger";
import { UtilsDocument, PermissionCheck } from "../../lib/db/utils-document";
import { RunOnce } from "../../lib/decorator/run-once";
import { Component, OnInit, OnInitParam } from "../../lib/render-engine/component";
import { UtilsDiceSoNice } from "../../lib/roll/utils-dice-so-nice";
import { RollData, UtilsRoll } from "../../lib/roll/utils-roll";
import { UtilsCompare } from "../../lib/utils/utils-compare";
import { staticValues } from "../../static-values";
import { MyActor } from "../../types/fixed-types";
import { Action } from "../action";
import { ChatPartIdData, ItemCardHelpers } from "../item-card-helpers";
import { ModularCard, ModularCardTriggerData } from "../modular-card";
import { ModularCardPart, ModularCardCreateArgs, CreatePermissionCheckArgs, HtmlContext, createPermissionCheckAction } from "../modular-card-part";
import { BaseCardComponent } from "./base-card-component";
import { DamageCardData, DamageCardPart } from "./damage-card-part";
import { StateContext, TargetCardData, TargetCardPart, VisualState } from "./target-card-part";

type RollPhase = 'mode-select' | 'result';
const modeOrder: Array<AttackCardData['mode']> = ['disadvantage', 'normal', 'advantage'];

interface TargetCache {
  targetUuid$: string;
  actorUuid$: string;
  ac$: number;
  resultType$?: 'hit' | 'critical-hit' | 'mis' | 'critical-mis';
}

export interface AttackCardData {
  phase: RollPhase;
  mode: 'normal' | 'advantage' | 'disadvantage';
  userBonus: string;
  actorUuid$?: string;
  attackSource$: {
    type: 'Item';
    itemUuid: string;
  };
  advantageSources$: Array<{$uuid: string, $name: string, $image: string}>;
  disadvantageSources$: Array<{$uuid: string, $name: string, $image: string}>;
  roll$?: RollData;
  critTreshold$: number;
  isCrit$?: boolean;
  targetCaches$: TargetCache[]
}

/**
 * // TODO: solve the below issue
 * Most attack items only have 1 target.
 * However there are a few with multiple targets and I could not find a written rule to handle those.
 * So I decided that you need to roll an attack for each target based on multiple spells/feats RAW
 * - Ranger (Hunter): Multiattack
 * - Scorching Ray
 * - Eldritch Blast
 */
@Component({
  tag: AttackCardPartComponent.getSelector(),
  html: /*html*/`
    <div class="flavor">
      {{ this.flavor }}
    </div>
    <nd5a-roll-d20
      [data-roll]="this.part.roll$"
      [data-label]="this.overrideRollLabel"
      [data-roll-mode]="this.part.mode"
      [data-bonus-formula]="this.part.userBonus"
      [data-show-bonus]="this.part.phase !== 'mode-select'"
      [data-override-max-roll]="this.part.critTreshold$"

      [data-interaction-permission]="this.interactionPermission"
      [data-read-permission]="this.readPermission"
      [data-read-hidden-display-type]="this.readHiddenDisplayType"

      (doRoll)="this.onRollClick($event)"
      (rollMode)="this.onRollMode($event)"
      >
    </nd5a-roll-d20>
  `,
  style: /*css*/`
    .flavor {
      margin-top: 2px;
      text-align: center;
    }
  `
})
class AttackCardPartComponent extends BaseCardComponent implements OnInit {
  //#region actions
  private static actionPermissionCheck = createPermissionCheckAction<{part: {data: AttackCardData}}>(({part}) => {
    const documents: CreatePermissionCheckArgs['documents'] = [];
    if (part.data.actorUuid$) {
      documents.push({uuid: part.data.actorUuid$, permission: 'OWNER', security: true});
    }
    return {documents: documents};
  });
  private static rollClick = new Action<{event: CustomEvent<{userBonus?: string}>} & ChatPartIdData>('AttackOnRollClick')
    .addSerializer(ItemCardHelpers.getRawSerializer('messageId'))
    .addSerializer(ItemCardHelpers.getCustomEventSerializer())
    .addEnricher(ItemCardHelpers.getChatEnricher())
    .setPermissionCheck(AttackCardPartComponent.actionPermissionCheck)
    .build(({messageId, event, cardParts}) => {
      const part = cardParts.getTypeData<AttackCardData>(AttackCardPart.instance);
      if (part.userBonus === event.userBonus && part.phase === 'result') {
        return;
      }
      part.userBonus = event.userBonus;
      part.phase = 'result';
      return ModularCard.setCardPartDatas(game.messages.get(messageId), cardParts);
    });
  private static modeChange = new Action<{event: CustomEvent<RollD20EventData<RollMode>>} & ChatPartIdData>('AttackOnModeChange')
    .addSerializer(ItemCardHelpers.getRawSerializer('messageId'))
    .addSerializer(ItemCardHelpers.getCustomEventSerializer())
    .addEnricher(ItemCardHelpers.getChatEnricher())
    .setPermissionCheck(AttackCardPartComponent.actionPermissionCheck)
    .build(({messageId, cardParts, event}) => {
      const part = cardParts.getTypeData<AttackCardData>(AttackCardPart.instance);
      if (part.mode === event.data) {
        return;
      }

      part.mode = event.data;
      if (event.quickRoll) {
        part.phase = 'result';
      }
      return ModularCard.setCardPartDatas(game.messages.get(messageId), cardParts);
    });
  //#endregion

  public static getSelector(): string {
    return `${staticValues.code}-attack-part`;
  }
  
  public part: AttackCardData;
  public flavor: string;
  public interactionPermission: string;
  public readPermission: string;
  public readHiddenDisplayType: string;
  public overrideRollLabel: string;
  
  public onInit(args: OnInitParam): void {
    args.addStoppable(
      this.getData<AttackCardData>(AttackCardPart.instance).listen(async ({part}) => {
        this.part = part;
        this.interactionPermission = `OwnerUuid:${this.part.actorUuid$}`;
        this.readPermission = `${staticValues.code}ReadAttackUuid:${this.part.actorUuid$}`;
        this.readHiddenDisplayType = game.settings.get(staticValues.moduleName, 'attackHiddenRoll') as string;
        
        const hasReadPermission = await UtilsDocument.hasAllPermissions([{uuid: part.actorUuid$, permission: `${staticValues.code}ReadAttack`, user: game.user}])
        if (!hasReadPermission || !part.roll$?.evaluated || part.mode === 'normal') {
          this.flavor = game.i18n.localize('DND5E.Attack');
        } else {
          this.flavor = game.i18n.localize(`DND5E.${part.mode.capitalize()}`);
        }
      })
    )
  }

  public onRollClick(event: CustomEvent<{userBonus?: string}>): void {
    if (this.part.userBonus === event.detail.userBonus && this.part.phase === 'result') {
      return;
    }
    AttackCardPartComponent.rollClick({event, messageId: this.messageId});
  }

  public onRollMode(event: CustomEvent<RollD20EventData<RollMode>>): void {
    AttackCardPartComponent.modeChange({event, messageId: this.messageId});
  }
}

export class AttackCardPart implements ModularCardPart<AttackCardData> {

  public static readonly instance = new AttackCardPart();
  private constructor() {}

  public create({item, actor}: ModularCardCreateArgs): AttackCardData {
    if (!item.hasAttack) {
      return null;
    }

    const attack: AttackCardData = {
      mode: 'normal',
      phase: 'mode-select',
      userBonus: "",
      attackSource$: {
        type: 'Item',
        itemUuid: item.uuid,
      },
      targetCaches$: [],
      advantageSources$: [],
      disadvantageSources$: [],
      actorUuid$: actor?.uuid,
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
    ModularCard.registerModularCardPart(staticValues.moduleName, this);
    ModularCard.registerModularCardTrigger(this, new AttackCardTrigger());
    ModularCard.registerModularCardTrigger(TargetCardPart.instance, new TargetCardTrigger());
    TargetCardPart.instance.registerIntegration({
      getVisualState: context => this.getTargetState(context),
    });
  }

  public getType(): string {
    return 'AttackCardPart';
  }

  //#region Front end

  public getHtml(data: HtmlContext): string {
    // TODO technically, you would roll an attack for each target
    //  UI idea: unrolled keep it as is, once rolled (1 button for multiple rolls) show a list below for each target
    return `<${AttackCardPartComponent.getSelector()} data-message-id="${data.messageId}"></${AttackCardPartComponent.getSelector()}>`
  }
  //#endregion

  //#region Targeting
  private getTargetState(context: StateContext): VisualState[] {
    const visualStates: VisualState[] = [];

    const attack = context.allMessageParts.getTypeData<AttackCardData>(AttackCardPart.instance);
    if (attack == null) {
      return [];
    }

    const cache = this.getTargetCache([attack]);
    for (const selected of context.selected) {
      let rowValue: string;
      const canReadAttack = UtilsDocument.hasAllPermissions([{
        uuid: attack.actorUuid$,
        user: game.user,
        permission: `${staticValues.code}ReadAttack`,
      }], {sync: true});
      let canSeeAc: boolean;
      if (cache.has(selected.tokenUuid)) {
        canSeeAc = UtilsDocument.hasAllPermissions([{
          uuid: cache.get(selected.tokenUuid).actorUuid$,
          user: game.user,
          permission: `Observer`,
        }], {sync: true});
      } else {
        canSeeAc = false;
      }
      const canSeeTotal = game.settings.get(staticValues.moduleName, 'attackHiddenRoll') === 'total';
      if (!attack.roll$?.evaluated || !canSeeAc) {
        if (attack.roll$?.evaluated) {
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
            styles.push('color: red');
            rowValue = `<div style="${styles.join(';')};" title="${game.i18n.localize(`${staticValues.moduleName}.CriticalMis`)}!">✗</div>`;
            break;
          }
          case 'hit': {
            styles.push('color: green');
            rowValue = `<div style="${styles.join(';')};" title="${game.i18n.localize('DND5E.AC')}: ${cache.get(selected.tokenUuid).ac$} <= ${attack.roll$?.total}">✓</div>`;
            break;
          }
          case 'mis': {
            styles.push('color: red');
            rowValue = `<div style="${styles.join(';')};" title="${game.i18n.localize('DND5E.AC')}: ${cache.get(selected.tokenUuid).ac$} <= ${attack.roll$?.total}">✗</div>`;
            break;
          }
        }
      }
      visualStates.push({
        selectionId: selected.selectionId,
        tokenUuid: selected.tokenUuid,
        columns: [{
          key: `${this.getType()}-attack`,
          label: `<div style="font-size: 16px;" title="${game.i18n.localize('DND5E.Attack')}">
          <svg height="1em" width="1em">
            <use xlink:href="/modules/${staticValues.moduleName}/assets/icons/sword.svg#sword"/>
          </svg>
          </div>`,
          rowValue: rowValue,
        }],
      })
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
      if (!newRow.allParts.hasType(AttackCardPart.instance)) {
        continue;
      }
      const allTargetUuids = new Set<string>();
      const cachedTargetUuids = new Set<string>();
      for (const selected of newRow.part.selected) {
        allTargetUuids.add(selected.tokenUuid);
      }
      for (const target of newRow.allParts.getTypeData<AttackCardData>(AttackCardPart.instance).targetCaches$) {
        cachedTargetUuids.add(target.targetUuid$);
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
      if (!newRow.allParts.hasType(AttackCardPart.instance)) {
        continue;
      }
      const allTargetUuids = new Set<string>();
      for (const selected of newRow.part.selected) {
        allTargetUuids.add(selected.tokenUuid);
      }

      const attackPart = newRow.allParts.getTypeData<AttackCardData>(AttackCardPart.instance);
      const cachedTargetUuids = new Set<string>();
      for (const target of attackPart.targetCaches$) {
        cachedTargetUuids.add(target.targetUuid$);
      }

      for (const expectedUuid of allTargetUuids) {
        if (!cachedTargetUuids.has(expectedUuid)) {
          const actor = (tokens.get(expectedUuid).getActor() as MyActor);
          attackPart.targetCaches$.push({
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

class AttackCardTrigger implements ITrigger<ModularCardTriggerData<AttackCardData>> {

  //#region beforeCreate
  public beforeCreate(context: IDmlContext<ModularCardTriggerData<AttackCardData>>): boolean | void {
    this.calcAutoRoll(context);
  }

  private calcAutoRoll(context: IDmlContext<ModularCardTriggerData<AttackCardData>>): boolean | void {
    let autoRoll = false;
    if (game.user.isGM) {
      autoRoll = game.settings.get(staticValues.moduleName, 'gmAutorollAttack') === 'always';
    } else {
      autoRoll = game.settings.get(staticValues.moduleName, 'playerAutorollAttack') === 'always';
    }

    if (!autoRoll) {
      return;
    }

    for (const {newRow} of context.rows) {
      newRow.part.phase = 'result';
    }
  }
  //#endregion

  //#region beforeUpsert
  public beforeUpsert(context: IDmlContext<ModularCardTriggerData<any>>): boolean | void {
    this.calcRollMode(context);
    this.calcIsCrit(context);
    this.setDamageAsCrit(context);
    this.calcResultCache(context);
  }

  private calcIsCrit(context: IDmlContext<ModularCardTriggerData<AttackCardData>>): void {
    for (const {newRow} of context.rows) {
      if (!newRow.part.roll$?.evaluated) {
        newRow.part.isCrit$ = false;
        continue;
      }

      const baseRollResult = newRow.part.roll$.terms[0].results.filter(result => result.active)[0];
      newRow.part.isCrit$ = baseRollResult?.result >= newRow.part.critTreshold$;
    }
  }

  private setDamageAsCrit(context: IDmlContext<ModularCardTriggerData<AttackCardData>>): void {
    for (const {newRow, oldRow} of context.rows) {
      if (newRow.part.isCrit$ !== oldRow?.part?.isCrit$) {
        const damagePart = newRow.allParts.getTypeData<DamageCardData>(DamageCardPart.instance);
        if (damagePart != null) {
          continue;
        }
        
        if (damagePart.phase === 'mode-select') {
          if (newRow.part.isCrit$) {
            damagePart.mode = 'critical';
          } else {
            damagePart.mode = 'normal';
          }
        }
      }
    }
  }

  private calcResultCache(context: IDmlContext<ModularCardTriggerData<AttackCardData>>): void {
    for (const {newRow} of context.rows) {
      for (const targetCache of newRow.part.targetCaches$) {
        if (newRow.part.roll$?.evaluated) {
          const firstRoll = newRow.part.roll$.terms[0].results.find(r => r.active);
          if (firstRoll.result === 20 || targetCache.ac$ <= newRow.part.roll$.total) {
            // 20 always hits, lower crit treshold does not
            if (firstRoll.result >= newRow.part.critTreshold$) {
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
      const newMode = this.calcAutoMode(newRow.part);
      if (oldRow) {
        if (newMode !== this.calcAutoMode(oldRow.part)) {
          newRow.part.mode = newMode;
        }
      } else {
        newRow.part.mode = newMode;
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
    await this.doRoll(context);
  }

  private async doRoll(context: IAfterDmlContext<ModularCardTriggerData<AttackCardData>>): Promise<void> {
    for (const {newRow, oldRow} of context.rows) {
      if (newRow.part.phase !== 'result') {
        return;
      }

      // Only do roll when changed is detected
      const newData = newRow.part;
      const oldData = oldRow?.part;

      let shouldModifyRoll = oldData == null || !newRow.part.roll$?.evaluated;
      if (!shouldModifyRoll) {
        const newChangeDetectData: DeepPartial<AttackCardData> = {
          mode: newData.mode,
          userBonus: newData.userBonus,
          attackSource$: newData.attackSource$,
        }
        
        const oldChangeDetectData: DeepPartial<AttackCardData> = {
          mode: oldData.mode,
          userBonus: oldData.userBonus,
          attackSource$: oldData.attackSource$,
        }
        shouldModifyRoll = !UtilsCompare.deepEquals(newChangeDetectData, oldChangeDetectData);
      }

      if (shouldModifyRoll) {
        if (newData.attackSource$.type === 'Item') {
          const item = await UtilsDocument.itemFromUuid(newData.attackSource$.itemUuid);
          if (item) {
            const newRoll = async () => {
              const rollPromises: Promise<Roll>[] = [];
              rollPromises.push(item.rollAttack({
                advantage: newData.mode === 'advantage',
                disadvantage: newData.mode === 'disadvantage',
                critical: newData.critTreshold$,  
                fastForward: true,
                chatMessage: false,
              }));

              if (newData.userBonus) {
                rollPromises.push(new Roll(newData.userBonus).roll({async: true}));
              }
              return UtilsRoll.mergeRolls(...await Promise.all(rollPromises));
            };
            const oldRoll = oldData?.roll$ == null ? null : UtilsRoll.fromRollData(oldData.roll$);
            newData.roll$ = UtilsRoll.toRollData((await UtilsRoll.modifyRoll(oldRoll, newRoll)).result);
          }
        }
      }
    }
  }
  //#endregion

  //#region afterUpsert
  public async afterUpsert(context: IAfterDmlContext<ModularCardTriggerData<AttackCardData>>): Promise<void> {
    await this.diceSoNiceHook(context);
  }
  
  private async diceSoNiceHook(context: IDmlContext<ModularCardTriggerData<AttackCardData>>): Promise<void> {
    const showRolls: PermissionCheck<Roll>[] = [];
    for (const {newRow, oldRow} of context.rows) {
      // Detect new rolled dice
      if (newRow.part.roll$?.evaluated) {
        const roll = UtilsRoll.getNewRolledTerms(oldRow?.part?.roll$, newRow.part.roll$);
        if (roll) {
          showRolls.push({
            uuid: newRow.part.actorUuid$,
            permission: `${staticValues.code}ReadAttack`,
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