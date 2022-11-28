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

export interface SrdSneakAttackCardData {
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
  tag: SrdSneakAttackComponent.getSelector(),
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
  //#endregion
  
  public static getSelector(): string {
    return `srd-sneak-attack-part`;
  }

  public onInit(args: OnInitParam) {
    args.addStoppable(
      this.getData<SrdSneakAttackCardData>(SrdSneakAttackCardPart.instance).listen(({part}) => this.setData(part))
    );
  }

  public canEdit = false;
  public itemName: string = '';
  public itemImg: string;
  public addSneak: boolean = false;
  private async setData(part: ModularCardPartData<SrdSneakAttackCardData>) {
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
  }

  public onSneakToggleClick(event: MouseEvent) {
    return SrdSneakAttackComponent.setAddSneak({
      messageId: this.messageId,
      partId: this.partId,
      addSneak: (event.target as HTMLInputElement).checked,
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

    const data: SrdSneakAttackCardData = {
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
      if (item.name.toLowerCase() === 'sneak attack') {
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

  public beforeUpsert(context: IDmlContext<ModularCardTriggerData<SrdSneakAttackCardData>>): boolean | void {
    this.syncWithBaseDamage(context);
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
          baseDamage.data.extraDamageSources[SrdSneakAttackCardPart.instance.getType()] = {
            type: 'Item',
            itemUuid: newRow.part.data.itemUuid,
            hasVersatile: false,
          }
        } else {
          delete baseDamage.data.extraDamageSources[SrdSneakAttackCardPart.instance.getType()];
        }
      }
    }
  }

}