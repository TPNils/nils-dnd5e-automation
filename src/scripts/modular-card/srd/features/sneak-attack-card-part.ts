import { data } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/module.mjs";
import { RoundData } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/foundry.js/clientDocuments/combat";
import { IAfterDmlContext, IDmlContext, ITrigger } from "../../../lib/db/dml-trigger";
import { DocumentListener } from "../../../lib/db/document-listener";
import { UtilsDocument } from "../../../lib/db/utils-document";
import { RunOnce } from "../../../lib/decorator/run-once";
import { Component, OnInit, OnInitParam } from "../../../lib/render-engine/component";
import { UtilsRoll } from "../../../lib/roll/utils-roll";
import { UtilsCompare } from "../../../lib/utils/utils-compare";
import { ValueReader } from "../../../provider/value-provider";
import { staticValues } from "../../../static-values";
import { DamageType, MyActor, MyItem } from "../../../types/fixed-types";
import { UtilsItem } from "../../../utils/utils-item";
import { Action } from "../../action";
import { BaseCardComponent } from "../../base/base-card-component";
import { DamageCardData, DamageCardPart, ManualDamageSource } from "../../base/index";
import { ChatPartIdData, ItemCardHelpers } from "../../item-card-helpers";
import { BeforeCreateModuleCardEvent, ModularCard, ModularCardPartData, ModularCardTriggerData } from "../../modular-card";
import { createPermissionCheckAction, CreatePermissionCheckArgs, HtmlContext, ModularCardCreateArgs, ModularCardPart } from "../../modular-card-part";

export interface SrdSneakAttackCardData {
  itemUuid: string;
  itemImg: string;
  name: string;
  shouldAdd: boolean;
  createdCombatRound?: Omit<RoundData, 'combatantid'> & {
    // combatantid is a typo in RoundData
    combatantId?: string; // who's turn
    combatUuid: string;
  };
  selectedDamage?: DamageType;
  calc$: {
    damageOptions: DamageType[];
    damageSource: ManualDamageSource;
    actorUuid: string;
  }
}

@Component({
  tag: SrdSneakAttackComponent.getSelector(),
  html: /*html*/`
    <label class="wrapper{{!this.canEdit ? ' disabled' : ''}}">
      <input [disabled]="!this.canEdit" (click)="this.onSneakToggleClick($event)" [checked]="this.addSneak" type="checkbox"/>
      <i *if="this.usedInCombat" class="used-in-combat-warning {{this.addSneak ? 'this-is-active' : ''}} fas fa-exclamation-triangle"></i>
      <img *if="this.itemImg" [src]="this.itemImg">
      {{this.itemName}}
      <div class="flexer"></div>
      <select *if="this.damageOptions.length > 0" [disabled]="this.damageOptions.length === 1" (change)="this.setDamageType($event)">
        <option *for="let option of this.damageOptions" [value]="option.value" [selected]="option.selected">{{option.label}}</option>
      </select>
    </label>
  `,
  style: /*css*/`
    :host {
      display: block;
    }

    label {
      display: flex;
      align-items: center;
    }

    label:not(.disabled) {
      cursor: pointer;
    }

    img {
      min-width: 16px;
      width: 16px;
      min-height: 16px;
      height: 16px;
      margin-right: 4px;
    }

    .flexer {
      flex-grow: 1;
    }

    .used-in-combat-warning {
      color: #fb6944;
      margin-right: 4px;
    }

    .used-in-combat-warning.this-is-active {
      color: red;
    }
  `
})
export class SrdSneakAttackComponent extends BaseCardComponent implements OnInit {
  //#region actions
  private static actionPermissionCheck = createPermissionCheckAction<{part: {data: SrdSneakAttackCardData}}>(({part}) => {
    const documents: CreatePermissionCheckArgs['documents'] = [];
    if (part.data.calc$.actorUuid) {
      documents.push({uuid: part.data.calc$.actorUuid, permission: 'OWNER', security: true});
    }
    return {documents: documents};
  });
  private static setAddSneak = new Action<{addSneak: boolean} & ChatPartIdData>('SneakAttackToggle')
    .addSerializer(ItemCardHelpers.getRawSerializer('messageId'))
    .addSerializer(ItemCardHelpers.getRawSerializer('partId'))
    .addSerializer(ItemCardHelpers.getRawSerializer('addSneak'))
    .addEnricher(ItemCardHelpers.getChatPartEnricher<SrdSneakAttackCardData>())
    .setPermissionCheck(SrdSneakAttackComponent.actionPermissionCheck)
    .build(({messageId, part, addSneak, allCardParts}) => {
      if (part.data.shouldAdd === addSneak) {
        return;
      }
      part.data.shouldAdd = addSneak;
      return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
    });
  private static setDamageType = new Action<{dmg: DamageType} & ChatPartIdData>('SneakAttackSetDamageType')
    .addSerializer(ItemCardHelpers.getRawSerializer('messageId'))
    .addSerializer(ItemCardHelpers.getRawSerializer('partId'))
    .addSerializer(ItemCardHelpers.getRawSerializer('dmg'))
    .addEnricher(ItemCardHelpers.getChatPartEnricher<SrdSneakAttackCardData>())
    .setPermissionCheck(SrdSneakAttackComponent.actionPermissionCheck)
    .build(({messageId, part, dmg, allCardParts}) => {
      if (part.data.selectedDamage === dmg) {
        return;
      }
      part.data.selectedDamage = dmg;
      return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
    });
  //#endregion
  
  public static getSelector(): string {
    return `srd-sneak-attack-part`;
  }

  public onInit(args: OnInitParam) {
    args.addStoppable(
      this.getData<SrdSneakAttackCardData>(SrdSneakAttackCardPart.instance)
        .switchMap(args => {
          const uuid = args.part.data.createdCombatRound?.combatUuid;
          return ValueReader.mergeObject({
            ...args,
            combat: uuid == null ? null : DocumentListener.listenUuid<Combat>(uuid)
          })
        })
        .listen(({part, combat}) => this.setData(part, combat))
    );
  }

  public canEdit = false;
  public itemName: string = '';
  public itemImg: string;
  public addSneak: boolean = false;
  public usedInCombat = false;
  public damageOptions: Array<{value: string; label: string; selected: boolean;}> = [];
  private async setData(part: ModularCardPartData<SrdSneakAttackCardData>, combat: Combat | null) {
    // read permission are handled in SneakAttackCardPart.getHtml()
    this.itemName = `${part.data.name}?`;
    this.itemImg = part.data.itemImg;
    this.addSneak = part.data.shouldAdd;
    const actionResponse = await SrdSneakAttackComponent.actionPermissionCheck({
      messageId: this.messageId,
      partId: part.id,
      part: part,
    }, game.user);
    this.canEdit = actionResponse !== 'prevent-action';
    this.damageOptions = part.data.calc$.damageOptions.sort().map(dmg => {
      return {
        value: dmg,
        label: game.i18n.localize(`DND5E.` + (dmg === '' ? 'None' : `Damage${dmg.capitalize()}`)),
        selected: part.data.selectedDamage === dmg,
      }
    });
    

    if (!combat) {
      this.usedInCombat = false;
    } else {
      if (part.data.calc$.actorUuid == null) {
        this.usedInCombat = false;
      } else {
        const usedSneakFlag = game.combat.getFlag(staticValues.moduleName, 'usedSneak') as {[turnKey: string]: Array<{source: string;}>} ?? {};
        const source = `${this.messageId}/${part.id}`;
        const key = `${part.data.createdCombatRound.combatantId}/${part.data.calc$.actorUuid.replace('.', '/')}`;
        if (!usedSneakFlag[key]) {
          this.usedInCombat = false;
        } else {
          this.usedInCombat = usedSneakFlag[key].some(flag => flag.source !== source);
        }
      }
    }
  }

  public onSneakToggleClick(event: MouseEvent) {
    return SrdSneakAttackComponent.setAddSneak({
      messageId: this.messageId,
      partId: this.partId,
      addSneak: (event.target as HTMLInputElement).checked,
    })
  }

  public setDamageType(event: Event) {
    return SrdSneakAttackComponent.setDamageType({
      messageId: this.messageId,
      partId: this.partId,
      dmg: (event.target as HTMLSelectElement).value as DamageType,
    })
  }

}

export class SrdSneakAttackCardPart implements ModularCardPart<SrdSneakAttackCardData> {
  
  public static readonly instance = new SrdSneakAttackCardPart();

  public async create(args: ModularCardCreateArgs): Promise<SrdSneakAttackCardData> {
    // Only add sneak attack to weapon attacks
    if (!args.item.hasAttack || !['mwak', 'rwak'].includes(args.item.data.data.actionType)) {
      return null;
    }
    if (!args.item.hasDamage || !args.item.data.data.damage?.parts?.length) {
      return null;
    }

    const sneakItem = SrdSneakAttackCardPart.getSneakItem(args.actor);
    if (sneakItem == null) {
      return;
    }

    const rollData = sneakItem.getRollData()
    const normalRoll = UtilsRoll.toRollData(UtilsRoll.damagePartsToRoll(sneakItem.data.data.damage.parts, rollData));
    const versatileRoll = UtilsRoll.toRollData(UtilsRoll.versatilePartsToRoll(sneakItem.data.data.damage.parts, sneakItem.data.data.damage.versatile, rollData));

    const data: SrdSneakAttackCardData = {
      itemUuid: sneakItem.uuid,
      itemImg: sneakItem.img,
      name: sneakItem.name,
      shouldAdd: false,
      calc$: {
        damageOptions: [],
        damageSource: {
          type: 'Manual',
          normalBaseRoll: normalRoll.terms,
          versatileBaseRoll: versatileRoll?.terms,
        },
        actorUuid: args.actor?.uuid,
      }
    };
    if (game.combat) {
      data.createdCombatRound = {
        ...deepClone(game.combat.current),
        combatUuid: game.combat.uuid
      };
    }

    return data;
  }

  public async refresh(oldData: SrdSneakAttackCardData, args: ModularCardCreateArgs): Promise<SrdSneakAttackCardData> {
    const data = await this.create(args);
    if (data == null) {
      return oldData;
    }
    data.shouldAdd = oldData.shouldAdd;
    data.createdCombatRound = oldData.createdCombatRound;
    return data;
  }
  
  public getType(): string {
    return SrdSneakAttackCardPart.name;
  }

  private static getSneakItem(actor: MyActor): MyItem {
    if (!actor) {
      return null;
    }
    for (const item of actor.items.values()) {
      if (UtilsItem.matchesItemIdentifier('sneakAttack', item)) {
        return item;
      }
    }
    return null;
  }

  @RunOnce()
  public registerHooks(): void {
    ModularCard.registerModularCardPart(staticValues.moduleName, this);
    ModularCard.registerModularCardTrigger(this, new SrdSneakAttackCardTrigger());
    Hooks.on(`create${staticValues.code.capitalize()}ModuleCard`, (event: BeforeCreateModuleCardEvent) => {
      if (SrdSneakAttackCardPart.getSneakItem(event.actor) != null) {
        event.addAfter(DamageCardPart.instance, SrdSneakAttackCardPart.instance);
      }
    })
  }

  public async getHtml(data: HtmlContext<SrdSneakAttackCardData>): Promise<string> {
    const canSeeSneak = await UtilsDocument.hasAllPermissions([
      {
        uuid: data.data.calc$.actorUuid,
        permission: `${staticValues.code}ReadDamage`,
        user: game.user,
      }
    ]);
    if (!canSeeSneak) {
      return null;
    }
    return `<${SrdSneakAttackComponent.getSelector()} data-part-id="${data.partId}" data-message-id="${data.messageId}"></${SrdSneakAttackComponent.getSelector()}>`
  }
  
}

class SrdSneakAttackCardTrigger implements ITrigger<ModularCardTriggerData<SrdSneakAttackCardData>> {

  //#region beforeUpsert
  public beforeUpsert(context: IDmlContext<ModularCardTriggerData<SrdSneakAttackCardData>>): boolean | void {
    this.selectedDamage(context);
    this.syncWithBaseDamage(context);
  }

  private selectedDamage(context: IDmlContext<ModularCardTriggerData<SrdSneakAttackCardData>>) {
    for (const {newRow} of context.rows) {
      if (newRow.part.data.calc$.damageOptions.length === 0) {
        newRow.part.data.selectedDamage = '';
      } else if (!newRow.part.data.calc$.damageOptions.includes(newRow.part.data.selectedDamage)) {
        newRow.part.data.selectedDamage = newRow.part.data.calc$.damageOptions[0];
      }

      // Convert all damage types to the selected
      const rolls = [newRow.part.data.calc$.damageSource.normalBaseRoll];
      if (newRow.part.data.calc$.damageSource.versatileBaseRoll?.length > 0) {
        rolls.push(newRow.part.data.calc$.damageSource.versatileBaseRoll);
      }
      for (const terms of rolls) {
        let foundDamageType = false;
        for (const term of terms) {
          if (UtilsRoll.toDamageType(term.options?.flavor) != null) {
            foundDamageType = true;
            term.options.flavor = newRow.part.data.selectedDamage;
          }
        }
        if (!foundDamageType) {
          terms[terms.length - 1].options = terms[terms.length - 1].options ?? {};
          terms[terms.length - 1].options.flavor = newRow.part.data.selectedDamage;
        }
      }

    }
  }

  private syncWithBaseDamage(context: IDmlContext<ModularCardTriggerData<SrdSneakAttackCardData>>) {
    for (const {newRow, oldRow} of context.rows) {
      const baseDamage: ModularCardPartData<DamageCardData> = newRow.allParts.find(part => {
        return ModularCard.isType<DamageCardData>(DamageCardPart.instance, part) && !ModularCard.isType(SrdSneakAttackCardPart.instance, part);
      });

      if (!baseDamage) {
        continue;
      }
      
      if (newRow.part.data.shouldAdd !== (oldRow?.part?.data?.shouldAdd || false)) {
        if (newRow.part.data.shouldAdd) {
          baseDamage.data.extraDamageSources[SrdSneakAttackCardPart.instance.getType()] = deepClone(newRow.part.data.calc$.damageSource);
        } else {
          delete baseDamage.data.extraDamageSources[SrdSneakAttackCardPart.instance.getType()];
        }
      }
    }
  }
  //#endregion

  //#region upsert
  public async upsert(context: IAfterDmlContext<ModularCardTriggerData<SrdSneakAttackCardData>>): Promise<void> {
    await this.calcDamageTypeOptions(context);
  }

  private async calcDamageTypeOptions(context: IAfterDmlContext<ModularCardTriggerData<SrdSneakAttackCardData>>) {
    for (const {newRow, oldRow} of context.rows) {
      const baseDamage: ModularCardPartData<DamageCardData> = newRow.allParts.find(part => {
        return ModularCard.isType<DamageCardData>(DamageCardPart.instance, part) && !ModularCard.isType(SrdSneakAttackCardPart.instance, part);
      });
      if (!baseDamage) {
        continue;
      }
      const oldDamage: ModularCardPartData<DamageCardData> = oldRow?.allParts?.find(part => part.id === baseDamage.id);

      const newChangeDetect = {
        damageSource: baseDamage.data.calc$.damageSource,
        extraDamageSources: baseDamage.data.extraDamageSources,
      }
      const oldChangeDetect = {
        damageSource: oldDamage?.data?.calc$?.damageSource,
        extraDamageSources: oldDamage?.data?.extraDamageSources,
      }

      if (UtilsCompare.deepEquals(newChangeDetect, oldChangeDetect)) {
        continue;
      }

      const damageTypes = new Set<DamageType>();
      const damageSources = Object.values(baseDamage.data.extraDamageSources);
      damageSources.push(baseDamage.data.calc$.damageSource);
      if (baseDamage.data.userBonus) {
        damageSources.push({
          type: 'Formula',
          formula: baseDamage.data.userBonus,
        });
      }

      for (let source of damageSources) {
        if (source.type === 'Formula') {
          source = {
            type: 'Manual',
            normalBaseRoll: UtilsRoll.toRollData(new Roll(source.formula)).terms,
          }
        }
        if (source.type === 'Manual') {
          const terms = baseDamage.data.source === 'versatile' ? source.versatileBaseRoll : source.normalBaseRoll;
          for (const term of terms) {
            damageTypes.add(UtilsRoll.toDamageType(term.options?.flavor));
          }
        }
        if (source.type === 'Item') {
          const item = await UtilsDocument.itemFromUuid(source.itemUuid);
          for (const [formula, damage] of item.data.data.damage.parts) {
            damageTypes.add(damage);
          }
        }
      }
      damageTypes.delete(null);
      damageTypes.delete(undefined);
      newRow.part.data.calc$.damageOptions = Array.from(damageTypes);
    }
  }
  //#endregion

  //#region afterUpsert
  public async afterUpsert(context: IAfterDmlContext<ModularCardTriggerData<SrdSneakAttackCardData>>): Promise<void> {
    await this.setSneakUsed(context);
  }

  private async setSneakUsed(context: IAfterDmlContext<ModularCardTriggerData<SrdSneakAttackCardData>>): Promise<void> {
    for (const {newRow, oldRow} of context.rows) {
      if (newRow.part.data.shouldAdd !== !!oldRow?.part?.data?.shouldAdd) {
        if (!newRow.part.data.createdCombatRound) {
          continue;
        }
        const combat = await UtilsDocument.combatFromUuid(newRow.part.data.createdCombatRound.combatUuid);
        if (!combat) {
          continue;
        }
        const checks = await UtilsDocument.hasPermissions(Array.from(game.users.values())
          .filter(user => user.active)
          .map(user => {
            return {
              uuid: newRow.part.data.createdCombatRound.combatUuid,
              permission: 'update',
              user: user
            }
          }))
        const executingUser = checks.sort((a, b) => a.requestedCheck.user.id.localeCompare(b.requestedCheck.user.id))
          .find(check => check.result)
          ?.requestedCheck.user
        if (executingUser?.id === game.userId) {
          continue;
        }

        let usedSneakFlag = combat.getFlag(staticValues.moduleName, 'usedSneak') as {[turnKey: string]: Array<{source: string;}>};
        if (usedSneakFlag == null) {
          usedSneakFlag = {};
        } else {
          usedSneakFlag = deepClone(usedSneakFlag);
        }
        const key = `${newRow.part.data.createdCombatRound.combatantId}/${newRow.part.data.calc$.actorUuid.replace('.', '/')}`;
        usedSneakFlag[key] = usedSneakFlag[key] ?? [];

        const source = `${newRow.messageId}/${newRow.part.id}`;
        const hasSource = usedSneakFlag[key].some(flag => flag.source === source);
        if (newRow.part.data.shouldAdd === hasSource) {
          continue;
        }

        if (newRow.part.data.shouldAdd) {
          usedSneakFlag[key].push({source: source});
        } else {
          usedSneakFlag[key] = usedSneakFlag[key].filter(flag => flag.source !== source);
        }
        await combat.setFlag(staticValues.moduleName, 'usedSneak', usedSneakFlag);
      }
    }
  }
  //#endregion

}