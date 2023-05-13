import { IDmlContext, ITrigger } from "../../../lib/db/dml-trigger";
import { RunOnce } from "../../../lib/decorator/run-once";
import { Component, OnInit, OnInitParam } from "../../../lib/render-engine/component";
import { UtilsRoll } from "../../../lib/roll/utils-roll";
import { ValueReader } from "../../../provider/value-provider";
import { staticValues } from "../../../static-values";
import { UtilsItem } from "../../../utils/utils-item";
import { Action } from "../../action";
import { BaseCardComponent } from "../../base/base-card-component";
import { DamageCardData, DamageCardPart, ResourceCardData, ResourceCardPart, TargetCardData, TargetCardPart } from "../../base/index";
import { ChatPartIdData, ItemCardHelpers } from "../../item-card-helpers";
import { BeforeCreateModuleCardEvent, ModularCard, ModularCardTriggerData } from "../../modular-card";
import { createPermissionCheckAction, CreatePermissionCheckArgs, HtmlContext, ModularCardCreateArgs, ModularCardPart, PermissionResponse } from "../../modular-card-part";

export interface SrdLayOnHandsCardData extends DamageCardData {
  heal: number;
  cure: number;
  maxUsage: number;
}

@Component({
  tag: SrdLayOnHandsComponent.getSelector(),
  html: /*html*/`
  <div class="loh-grid">
    <label>{{this.localeHealing}}:</label>
    <input name="heal-amount" type="number" min="0" [max]="this.maxHeal" [value]="this.currentHeal" [disabled]="this.missingPermission" (keyup)="this.heal($event)" (blur)="this.heal($event)">
    <label>{{this.localeCure}}:</label>
    <input name="cure-amount" type="number" min="0" [max]="this.maxCure" [value]="this.currentCure" [disabled]="this.missingPermission" (keyup)="this.cure($event)" (blur)="this.cure($event)">
  </div>
  `,
  style: /*css*/`
    .loh-grid {
      display: grid;
      grid-template-columns: max-content auto;
    }

    .loh-grid label {
      display: flex;
      align-items: center;
    }

    .loh-grid input {
      margin-left: 3px;
    }
  `
})
export class SrdLayOnHandsComponent extends BaseCardComponent implements OnInit {

  //#region actions
  private static readonly permissionCheck = createPermissionCheckAction<{part: {data: DamageCardData}}>(({part}) => {
    const documents: CreatePermissionCheckArgs['documents'] = [];
    if (part.data.calc$.actorUuid) {
      documents.push({uuid: part.data.calc$.actorUuid, permission: 'OWNER', security: true});
    }
    return {documents: documents};
  });
  private static readonly setHealAndCure = new Action<ChatPartIdData & {heal?: number; cure?: number;}>('LayOnHandsHeal')
    .addSerializer(ItemCardHelpers.getRawSerializer('messageId'))
    .addSerializer(ItemCardHelpers.getRawSerializer('cure'))
    .addSerializer(ItemCardHelpers.getRawSerializer('heal'))
    .addEnricher(ItemCardHelpers.getChatEnricher())
    .setPermissionCheck(SrdLayOnHandsComponent.permissionCheck)
    .build(async ({messageId, cardParts, heal, cure}) => {
      const part = cardParts.getTypeData<SrdLayOnHandsCardData>(SrdLayOnHandsCardPart.instance);
      if (heal != null) {
        part.heal = heal;
      }
      if (cure != null) {
        part.cure = cure;
      }
      if ((part.heal + (part.cure * 5)) > part.maxUsage) {
        return;
      }
      return ModularCard.setCardPartDatas(game.messages.get(messageId), cardParts);
    });
  //#endregion
  
  public static getSelector(): string {
    return `${staticValues.code}-srd-lay-on-hands-part`;
  }

  public onInit(args: OnInitParam) {
    args.addStoppable(
      this.getData<SrdLayOnHandsCardData>(SrdLayOnHandsCardPart.instance).switchMap((data) => {
        return ValueReader.mergeObject({
          ...data,
          hasPermission: SrdLayOnHandsComponent.permissionCheck({messageId: this.messageId, part: {data: data.part}}, game.user)
        })
      }).listen(async ({part, hasPermission}) => this.setData(part, hasPermission)),
    );
  }

  public localeHealing = game.i18n.localize('DND5E.Healing');
  public localeCure =  game.i18n.localize(`${staticValues.moduleName}.Cure`);
  public currentHeal = 0;
  public currentCure = 0;
  public maxHeal = 0;
  public maxCure = 0;
  public missingPermission = true;
  private async setData(part: SrdLayOnHandsCardData, hasPermission: PermissionResponse) {
    this.missingPermission = !hasPermission;

    if (!part || this.missingPermission) {
      this.currentHeal = 0;
      this.currentCure = 0;
      this.maxHeal = 0;
      this.maxCure = 0;
      return;
    }

    this.currentHeal = part.heal;
    this.currentCure = part.cure;
    const remainingUsage = part.maxUsage - this.currentHeal - (this.currentCure * 5);
    this.maxHeal = this.currentHeal + remainingUsage;
    this.maxCure = this.currentCure + Math.floor(remainingUsage / 5);
  }

  public heal(event: Event) {
    if (!(event.target instanceof HTMLInputElement)) {
      return;
    }
    const inputValue = Number(event.target.value);
    let value = Math.max(0, Math.min(this.maxHeal, inputValue));
    if (event instanceof KeyboardEvent) {
      if (Number.isNaN(inputValue)) {
        // Don't allow invalid characters
        event.preventDefault();
        event.target.value = String(value);
        return;
      }
      if (inputValue !== value) {
        // Keep value between min/max range
        event.preventDefault();
        event.target.value = String(value);
      }
      if (event.key !== 'Enter') {
        return;
      }
    }
    if (Number.isNaN(inputValue)) {
      return;
    }

    SrdLayOnHandsComponent.setHealAndCure({
      messageId: this.messageId,
      heal: value
    });
  }

  public cure(event: Event) {
    if (!(event.target instanceof HTMLInputElement)) {
      return;
    }
    const inputValue = Number(event.target.value);
    let value = Math.max(0, Math.min(this.maxCure, inputValue));
    if (event instanceof KeyboardEvent) {
      if (Number.isNaN(inputValue)) {
        // Don't allow invalid characters
        event.preventDefault();
        event.target.value = String(value);
        return;
      }
      if (inputValue !== value) {
        // Keep value between min/max range
        event.preventDefault();
        event.target.value = String(value);
      }
      if (event.key !== 'Enter') {
        return;
      }
    }
    if (Number.isNaN(inputValue)) {
      return;
    }

    SrdLayOnHandsComponent.setHealAndCure({
      messageId: this.messageId,
      cure: value
    });
  }

}

export class SrdLayOnHandsCardPart extends DamageCardPart implements ModularCardPart<SrdLayOnHandsCardData> {
  
  public static readonly instance = new SrdLayOnHandsCardPart();

  private injectCreateHealing(args: ModularCardCreateArgs): ModularCardCreateArgs {
    const merge = args.item.data.data.damage == null ? {} : deepClone(args.item.data.data.damage);
    if (!merge.parts) {
      merge.parts = [];
    }
    // insert at index 0
    merge.parts.splice(0, 0, ['0', 'healing']);
    const modifiedItem = args.item.clone({data: {damage: merge}}, {keepId: true});
    return {...args, item: modifiedItem};
  }

  public async create(args: ModularCardCreateArgs): Promise<SrdLayOnHandsCardData> {
    const data = await super.create(this.injectCreateHealing(args)) as Partial<SrdLayOnHandsCardData>;
    data.maxUsage = Number(args.item.getRollData().item.uses?.max) ?? 0;
    data.heal = 0;
    data.cure = 0;
    return data as SrdLayOnHandsCardData;
  }

  public refresh(oldData: DamageCardData, args: ModularCardCreateArgs): Promise<SrdLayOnHandsCardData> {
    return super.refresh(oldData, this.injectCreateHealing(args)) as Promise<SrdLayOnHandsCardData>;
  }

  @RunOnce()
  public registerHooks(): void {
    ModularCard.registerModularCardPart(staticValues.moduleName, this);
    ModularCard.registerModularCardTrigger(this, new SrdLayOnHandsCardTrigger());
    Hooks.on(`create${staticValues.code.capitalize()}ModuleCard`, (event: BeforeCreateModuleCardEvent) => {
      if (UtilsItem.matchesItemIdentifier('layOnHands', event.item)) {
        event.replace(DamageCardPart.instance, SrdLayOnHandsCardPart.instance);
      }
    })
  }

  public getHtml(data: HtmlContext<any>): string {
    return `<${SrdLayOnHandsComponent.getSelector()} data-message-id="${data.messageId}"></${SrdLayOnHandsComponent.getSelector()}>`
  }

  public getType(): string {
    return 'SrdLayOnHandsCardPart';
  }
  
}


class SrdLayOnHandsCardTrigger implements ITrigger<ModularCardTriggerData<SrdLayOnHandsCardData>> {
  
  public beforeUpsert(context: IDmlContext<ModularCardTriggerData<SrdLayOnHandsCardData>>): boolean | void {
    this.calcRoll(context);
    this.calcResource(context);
  }

  private calcRoll(context: IDmlContext<ModularCardTriggerData<SrdLayOnHandsCardData>>): void {
    for (const {newRow, oldRow} of context.rows) {
      if (newRow.part.heal > 0) {
        newRow.part.phase = 'result';
      }
      if (newRow.part.heal !== oldRow?.part?.heal) {
        const terms = [new NumericTerm({number: newRow.part.heal, options: {flavor: 'healing'}})];
        newRow.part.calc$.damageSource = {
          type: 'Manual',
          normalBaseRoll: UtilsRoll.toRollData(new Roll(Roll.getFormula(terms))).terms,
        }
      }
    }
  }

  private calcResource(context: IDmlContext<ModularCardTriggerData<SrdLayOnHandsCardData>>): void {
    for (const {newRow} of context.rows) {
      if (!newRow.allParts.hasType(ResourceCardPart.instance)) {
        continue;
      }
      let amountOfTargets = 0;
      if (newRow.allParts.hasType(TargetCardPart.instance)) {
        amountOfTargets += newRow.allParts.getTypeData<TargetCardData>(TargetCardPart.instance).selected.length;
      }
      // If there are no targets, assume it has been mentioned verbally => set to 1
      amountOfTargets = Math.max(1, amountOfTargets);

      let healAmount = newRow.part.heal;
      healAmount += (newRow.part.cure * 5);
      
      const resourceAmount = healAmount * amountOfTargets;
      for (const resource of newRow.allParts.getTypeData<ResourceCardData>(ResourceCardPart.instance).consumeResources) {
        if (resource.calc$.uuid.includes('Item.') && resource.calc$.path === 'data.uses.value') {
          resource.calc$.autoconsumeAfter = 'never';
          resource.calc$.calcChange = resourceAmount;
          break;
        }
      }
    }
  }

}