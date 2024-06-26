import { RoundData } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/client/data/documents/combat";
import { ITrigger, IDmlContext, IAfterDmlContext } from "../../../../lib/db/dml-trigger";
import { DocumentListener } from "../../../../lib/db/document-listener";
import { UtilsDocument } from "../../../../lib/db/utils-document";
import { RunOnce } from "../../../../lib/decorator/run-once";
import { Component, OnInit, OnInitParam } from "../../../../lib/render-engine/component";
import { UtilsRoll } from "../../../../lib/roll/utils-roll";
import { UtilsCompare } from "../../../../lib/utils/utils-compare";
import { ValueReader } from "../../../../provider/value-provider";
import { staticValues } from "../../../../static-values";
import { DamageType, MyActor, MyItem } from "../../../../types/fixed-types";
import { UtilsFoundry } from "../../../../utils/utils-foundry";
import { UtilsItem } from "../../../../utils/utils-item";
import { Action } from "../../../action";
import { ModularCardInstance, ModularCard, ModularCardTriggerData } from "../../../modular-card";
import { createPermissionCheckAction, CreatePermissionCheckArgs, PermissionResponse, ModularCardPart, ModularCardCreateArgs, HtmlContext } from "../../../modular-card-part";
import { ManualDamageSource, DamageCardPart } from "../../base/index";
import { BaseCardComponent } from "../../base/base-card-component";
import { ChatPartIdData, ItemCardHelpers } from "../../item-card-helpers";
import { BeforeCreateModuleCardEvent } from "../../../events/before-create-module-card-event";


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
    <label *if="this.canRead" class="wrapper{{!this.canEdit ? ' disabled' : ''}}">
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
  private static actionPermissionCheck = createPermissionCheckAction<{cardParts: ModularCardInstance}>(({cardParts}) => {
    const part = cardParts.getTypeData(SrdSneakAttackCardPart.instance);
    const documents: CreatePermissionCheckArgs['documents'] = [];
    if (part?.calc$?.actorUuid) {
      documents.push({uuid: part.calc$.actorUuid, permission: 'OWNER', security: true});
    }
    return {documents: documents};
  });
  private static setAddSneak = new Action<{addSneak: boolean} & ChatPartIdData>('SneakAttackToggle')
    .addSerializer(ItemCardHelpers.getRawSerializer('messageId'))
    .addSerializer(ItemCardHelpers.getRawSerializer('addSneak'))
    .addEnricher(ItemCardHelpers.getChatEnricher())
    .setPermissionCheck(SrdSneakAttackComponent.actionPermissionCheck)
    .build(({messageId, addSneak, cardParts}) => {
      const part = cardParts.getTypeData(SrdSneakAttackCardPart.instance);
      if (part.shouldAdd === addSneak) {
        return;
      }
      part.shouldAdd = addSneak;
      return ModularCard.writeModuleCard(game.messages.get(messageId), cardParts);
    });
  private static setDamageType = new Action<{dmg: DamageType} & ChatPartIdData>('SneakAttackSetDamageType')
    .addSerializer(ItemCardHelpers.getRawSerializer('messageId'))
    .addSerializer(ItemCardHelpers.getRawSerializer('dmg'))
    .addEnricher(ItemCardHelpers.getChatEnricher())
    .setPermissionCheck(SrdSneakAttackComponent.actionPermissionCheck)
    .build(({messageId, dmg, cardParts}) => {
      const part = cardParts.getTypeData(SrdSneakAttackCardPart.instance);
      if (part.selectedDamage === dmg) {
        return;
      }
      part.selectedDamage = dmg;
      return ModularCard.writeModuleCard(game.messages.get(messageId), cardParts);
    });
  //#endregion
  
  public static getSelector(): string {
    return `${staticValues.code}-srd-sneak-attack-part`;
  }

  public onInit(args: OnInitParam) {
    args.addStoppable(
      this.getData<SrdSneakAttackCardData>(SrdSneakAttackCardPart.instance)
        .switchMap(args => {
          const uuid = args.part.createdCombatRound?.combatUuid;
          return ValueReader.mergeObject({
            ...args,
            combat: uuid == null ? null : DocumentListener.listenUuid<Combat>(uuid),
            readDamagePermission: UtilsDocument.hasAllPermissions([{uuid: args.part.calc$.actorUuid, permission: `${staticValues.code}ReadDamage`, user: game.user}]),
            actionResponse: SrdSneakAttackComponent.actionPermissionCheck({messageId: this.messageId, cardParts: args.allParts,}, game.user),
          })
        })
        .listen(({part, combat, readDamagePermission, actionResponse}) => this.setData(part, combat, readDamagePermission, actionResponse))
    );
  }

  public canRead = false;
  public canEdit = false;
  public itemName: string = '';
  public itemImg: string;
  public addSneak: boolean = false;
  public usedInCombat = false;
  public damageOptions: Array<{value: string; label: string; selected: boolean;}> = [];
  private async setData(part: SrdSneakAttackCardData, combat: Combat | null, readDamagePermission: boolean, actionResponse: PermissionResponse) {
    this.canRead = readDamagePermission;
    this.itemName = `${part.name}?`;
    this.itemImg = part.itemImg;
    this.addSneak = part.shouldAdd;
    this.canEdit = actionResponse !== 'prevent-action';
    this.damageOptions = part.calc$.damageOptions.sort().map(dmg => {
      return {
        value: dmg,
        label: game.i18n.localize(`DND5E.` + (dmg === '' ? 'None' : `Damage${dmg.capitalize()}`)),
        selected: part.selectedDamage === dmg,
      }
    });
    

    if (!combat) {
      this.usedInCombat = false;
    } else {
      if (part.calc$.actorUuid == null) {
        this.usedInCombat = false;
      } else {
        const usedSneakFlag = game.combat.getFlag(staticValues.moduleName, 'usedSneak') as {[turnKey: string]: Array<{source: string;}>} ?? {};
        const source = `${this.messageId}/${SrdSneakAttackCardPart.instance.getType()}`;
        const key = `${part.createdCombatRound.combatantId}/${part.createdCombatRound.round}/${part.createdCombatRound.turn}/${part.calc$.actorUuid.replace('.', '/')}`;
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
      addSneak: (event.target as HTMLInputElement).checked,
    })
  }

  public setDamageType(event: Event) {
    return SrdSneakAttackComponent.setDamageType({
      messageId: this.messageId,
      dmg: (event.target as HTMLSelectElement).value as DamageType,
    })
  }

}

export class SrdSneakAttackCardPart implements ModularCardPart<SrdSneakAttackCardData> {
  
  public static readonly instance = new SrdSneakAttackCardPart();

  public async create(args: ModularCardCreateArgs): Promise<SrdSneakAttackCardData> {
    // Only add sneak attack to weapon attacks
    const itemData = UtilsFoundry.getSystemData(args.item);
    if (!args.item.hasAttack || !['mwak', 'rwak'].includes(itemData.actionType)) {
      return null;
    }
    if (!args.item.hasDamage || !itemData.damage?.parts?.length) {
      return null;
    }

    const sneakItem = SrdSneakAttackCardPart.getSneakItem(args.actor);
    if (sneakItem == null) {
      return;
    }

    const rollData = sneakItem.getRollData()
    const sneakItemData = UtilsFoundry.getSystemData(sneakItem);
    const normalRoll = UtilsRoll.toRollData(UtilsRoll.damagePartsToRoll(sneakItemData.damage.parts, rollData));
    const versatileRoll = UtilsRoll.toRollData(UtilsRoll.versatilePartsToRoll(sneakItemData.damage.parts, sneakItemData.damage.versatile, rollData));

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
    return 'SrdSneakAttackCardPart';
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
    Hooks.on(`${staticValues.code.capitalize()}.createModuleCard`, (event: BeforeCreateModuleCardEvent) => {
      if (SrdSneakAttackCardPart.getSneakItem(event.actor) != null) {
        event.addAfter(DamageCardPart.instance, SrdSneakAttackCardPart.instance);
      }
    })
  }

  public getHtml(data: HtmlContext<SrdSneakAttackCardData>): string {
    return `<${SrdSneakAttackComponent.getSelector()} data-message-id="${data.messageId}"></${SrdSneakAttackComponent.getSelector()}>`
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
      if (newRow.part.calc$.damageOptions.length === 0) {
        newRow.part.selectedDamage = '';
      } else if (!newRow.part.calc$.damageOptions.includes(newRow.part.selectedDamage)) {
        newRow.part.selectedDamage = newRow.part.calc$.damageOptions[0];
      }

      // Convert all damage types to the selected
      const rolls = [newRow.part.calc$.damageSource.normalBaseRoll];
      if (newRow.part.calc$.damageSource.versatileBaseRoll?.length > 0) {
        rolls.push(newRow.part.calc$.damageSource.versatileBaseRoll);
      }
      for (const terms of rolls) {
        let foundDamageType = false;
        for (const term of terms) {
          if (UtilsRoll.toDamageType(term.options?.flavor) != null) {
            foundDamageType = true;
            term.options.flavor = newRow.part.selectedDamage;
          }
        }
        if (!foundDamageType) {
          terms[terms.length - 1].options = terms[terms.length - 1].options ?? {};
          terms[terms.length - 1].options.flavor = newRow.part.selectedDamage;
        }
      }

    }
  }

  private syncWithBaseDamage(context: IDmlContext<ModularCardTriggerData<SrdSneakAttackCardData>>) {
    for (const {newRow, oldRow} of context.rows) {
      const baseDamage = newRow.allParts.getTypeData(DamageCardPart.instance)

      if (!baseDamage) {
        continue;
      }
      
      if (newRow.part.shouldAdd !== (oldRow?.part?.shouldAdd || false)) {
        if (newRow.part.shouldAdd) {
          baseDamage.extraDamageSources[SrdSneakAttackCardPart.instance.getType()] = deepClone(newRow.part.calc$.damageSource);
        } else {
          delete baseDamage.extraDamageSources[SrdSneakAttackCardPart.instance.getType()];
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
      const baseDamage = newRow.allParts.getTypeData(DamageCardPart.instance)
      if (!baseDamage) {
        continue;
      }
      const oldDamage = oldRow?.allParts?.getTypeData(DamageCardPart.instance)

      const newChangeDetect = {
        damageSource: baseDamage.calc$.damageSource,
        extraDamageSources: baseDamage.extraDamageSources,
      }
      const oldChangeDetect = {
        damageSource: oldDamage?.calc$?.damageSource,
        extraDamageSources: oldDamage?.extraDamageSources,
      }

      if (UtilsCompare.deepEquals(newChangeDetect, oldChangeDetect)) {
        continue;
      }

      const damageTypes = new Set<DamageType>();
      const damageSources = Object.values(baseDamage.extraDamageSources);
      damageSources.push(baseDamage.calc$.damageSource);
      if (baseDamage.userBonus) {
        damageSources.push({
          type: 'Formula',
          formula: baseDamage.userBonus,
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
          const terms = baseDamage.source === 'versatile' ? source.versatileBaseRoll : source.normalBaseRoll;
          for (const term of terms) {
            damageTypes.add(UtilsRoll.toDamageType(term.options?.flavor));
          }
        }
        if (source.type === 'Item') {
          const itemData = UtilsFoundry.getSystemData(await UtilsDocument.itemFromUuid(source.itemUuid));
          for (const [formula, damage] of itemData.damage.parts) {
            damageTypes.add(damage);
          }
        }
      }
      damageTypes.delete(null);
      damageTypes.delete(undefined);
      newRow.part.calc$.damageOptions = Array.from(damageTypes);
    }
  }
  //#endregion

  //#region afterUpsert
  public async afterUpsert(context: IAfterDmlContext<ModularCardTriggerData<SrdSneakAttackCardData>>): Promise<void> {
    await this.setSneakUsed(context);
  }

  private async setSneakUsed(context: IAfterDmlContext<ModularCardTriggerData<SrdSneakAttackCardData>>): Promise<void> {
    for (const {newRow, oldRow} of context.rows) {
      if (newRow.part.shouldAdd !== !!oldRow?.part?.shouldAdd) {
        if (!newRow.part.createdCombatRound) {
          continue;
        }
        const combat = await UtilsDocument.combatFromUuid(newRow.part.createdCombatRound.combatUuid);
        if (!combat) {
          continue;
        }
        
        const executingUser = Array.from(game.users.values())
          .filter(user => user.active && user.isGM)
          .sort((a, b) => a.id.localeCompare(b.id))[0];
        if (executingUser?.id !== game.userId) {
          continue;
        }

        let usedSneakFlag = combat.getFlag(staticValues.moduleName, 'usedSneak') as {[turnKey: string]: Array<{source: string;}>};
        if (usedSneakFlag == null) {
          usedSneakFlag = {};
        } else {
          usedSneakFlag = deepClone(usedSneakFlag);
        }
        const key = `${newRow.part.createdCombatRound.combatantId}/${newRow.part.createdCombatRound.round}/${newRow.part.createdCombatRound.turn}/${newRow.part.calc$.actorUuid.replace('.', '/')}`;
        usedSneakFlag[key] = usedSneakFlag[key] ?? [];

        const source = `${newRow.messageId}/${SrdSneakAttackCardPart.instance.getType()}`;
        const hasSource = usedSneakFlag[key].some(flag => flag.source === source);
        if (newRow.part.shouldAdd === hasSource) {
          continue;
        }

        if (newRow.part.shouldAdd) {
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