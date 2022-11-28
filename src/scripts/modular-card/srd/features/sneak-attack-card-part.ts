import { RoundData } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/foundry.js/clientDocuments/combat";
import { IDmlContext, ITrigger } from "../../../lib/db/dml-trigger";
import { UtilsDocument } from "../../../lib/db/utils-document";
import { RunOnce } from "../../../lib/decorator/run-once";
import { Component, OnInit, OnInitParam } from "../../../lib/render-engine/component";
import { staticValues } from "../../../static-values";
import { MyActor, MyItem } from "../../../types/fixed-types";
import { Action } from "../../action";
import { BaseCardComponent } from "../../base/base-card-component";
import { DamageCardData, DamageCardPart } from "../../base/index";
import { ChatPartIdData, ItemCardHelpers } from "../../item-card-helpers";
import { BeforeCreateModuleCardEvent, ModularCard, ModularCardPartData, ModularCardTriggerData } from "../../modular-card";
import { createPermissionCheckAction, CreatePermissionCheckArgs, HtmlContext, ModularCardCreateArgs, ModularCardPart } from "../../modular-card-part";

export interface SneakAttackCardData {
  itemUuid: string;
  itemImg: string;
  name: string;
  shouldAdd: boolean;
  createdCombatRound?: RoundData;
  calc$: {
    actorUuid: string;
  }
}

@Component({
  tag: SneakAttackComponent.getSelector(),
  html: /*html*/`
    <label class="wrapper{{!this.canEdit ? ' disabled' : ''}}">
      <input [disabled]="!this.canEdit" (click)="this.onSneakToggleClick($event)" [checked]="this.addSneak" type="checkbox"/>
      <img *if="this.itemImg" [src]="this.itemImg">
      {{this.itemName}}
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
  `
})
export class SneakAttackComponent extends BaseCardComponent implements OnInit {
  //#region actions
  private static actionPermissionCheck = createPermissionCheckAction<{part: {data: SneakAttackCardData}}>(({part}) => {
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
    .addEnricher(ItemCardHelpers.getChatPartEnricher<SneakAttackCardData>())
    .setPermissionCheck(SneakAttackComponent.actionPermissionCheck)
    .build(({messageId, part, addSneak, allCardParts}) => {
      if (part.data.shouldAdd === addSneak) {
        return;
      }
      part.data.shouldAdd = addSneak;
      return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
    });
  //#endregion
  
  public static getSelector(): string {
    return `${staticValues.code}-sneak-attack-part`;
  }

  public onInit(args: OnInitParam) {
    args.addStoppable(
      this.getData<SneakAttackCardData>(SneakAttackCardPart.instance).listen(({part}) => this.setData(part))
    );
  }

  public canEdit = false;
  public itemName: string = '';
  public itemImg: string;
  public addSneak: boolean = false;
  private async setData(part: ModularCardPartData<SneakAttackCardData>) {
    // read permission are handled in SneakAttackCardPart.getHtml()
    this.itemName = `${part.data.name}?`;
    this.itemImg = part.data.itemImg;
    this.addSneak = part.data.shouldAdd;
    const actionResponse = await SneakAttackComponent.actionPermissionCheck({
      messageId: this.messageId,
      partId: part.id,
      part: part,
    }, game.user);
    this.canEdit = actionResponse !== 'prevent-action';
  }

  public onSneakToggleClick(event: MouseEvent) {
    return SneakAttackComponent.setAddSneak({
      messageId: this.messageId,
      partId: this.partId,
      addSneak: (event.target as HTMLInputElement).checked,
    })
  }

}

export class SneakAttackCardPart implements ModularCardPart<SneakAttackCardData> {
  
  public static readonly instance = new SneakAttackCardPart();

  public async create(args: ModularCardCreateArgs): Promise<SneakAttackCardData> {
    // Only add sneak attack to weapon attacks
    if (!args.item.hasAttack || !['mwak', 'rwak'].includes(args.item.data.data.actionType)) {
      return null;
    }
    if (!args.item.hasDamage || !args.item.data.data.damage?.parts?.length) {
      return null;
    }

    const sneakItem = SneakAttackCardPart.getSneakItem(args.actor);
    if (sneakItem == null) {
      return;
    }

    const data: SneakAttackCardData = {
      itemUuid: sneakItem.uuid,
      itemImg: sneakItem.img,
      name: sneakItem.name,
      shouldAdd: false,
      calc$: {
        actorUuid: args.actor?.uuid,
      }
    };
    if (game.combat) {
      data.createdCombatRound = deepClone(game.combat.current);
    }

    return data;
  }

  public async refresh(oldData: SneakAttackCardData, args: ModularCardCreateArgs): Promise<SneakAttackCardData> {
    const data = await this.create(args);
    if (data == null) {
      return oldData;
    }
    data.shouldAdd = oldData.shouldAdd;
    data.createdCombatRound = oldData.createdCombatRound;
    return data;
  }
  
  public getType(): string {
    return SneakAttackCardPart.name;
  }

  private static getSneakItem(actor: MyActor): MyItem {
    if (!actor) {
      return null;
    }
    for (const item of actor.items.values()) {
      if (item.name.toLowerCase() === 'sneak attack') {
        return item;
      }
    }
    return null;
  }

  @RunOnce()
  public registerHooks(): void {
    ModularCard.registerModularCardPart(staticValues.moduleName, this);
    ModularCard.registerModularCardTrigger(this, new SneakAttackCardTrigger());
    Hooks.on(`create${staticValues.code.capitalize()}ModuleCard`, (event: BeforeCreateModuleCardEvent) => {
      if (SneakAttackCardPart.getSneakItem(event.actor) != null) {
        event.addAfter(DamageCardPart.instance, SneakAttackCardPart.instance);
      }
    })
  }

  public async getHtml(data: HtmlContext<SneakAttackCardData>): Promise<string> {
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
    return `<${SneakAttackComponent.getSelector()} data-part-id="${data.partId}" data-message-id="${data.messageId}"></${SneakAttackComponent.getSelector()}>`
  }
  
}

class SneakAttackCardTrigger implements ITrigger<ModularCardTriggerData<SneakAttackCardData>> {

  public beforeUpsert(context: IDmlContext<ModularCardTriggerData<SneakAttackCardData>>): boolean | void {
    // TODO if rolled, should also display in the damage component
    this.syncWithBaseDamage(context);
  }

  private syncWithBaseDamage(context: IDmlContext<ModularCardTriggerData<SneakAttackCardData>>) {
    for (const {newRow, oldRow} of context.rows) {
      const baseDamage: ModularCardPartData<DamageCardData> = newRow.allParts.find(part => {
        return ModularCard.isType<DamageCardData>(DamageCardPart.instance, part) && !ModularCard.isType(SneakAttackCardPart.instance, part);
      });

      if (!baseDamage) {
        continue;
      }
      
      if (newRow.part.data.shouldAdd !== (oldRow?.part?.data?.shouldAdd || false)) {
        if (newRow.part.data.shouldAdd) {
          baseDamage.data.extraDamageSources[SneakAttackCardPart.instance.getType()] = {
            type: 'Item',
            itemUuid: newRow.part.data.itemUuid,
            hasVersatile: false,
          }
        } else {
          delete baseDamage.data.extraDamageSources[SneakAttackCardPart.instance.getType()];
        }
      }
    }
  }

}