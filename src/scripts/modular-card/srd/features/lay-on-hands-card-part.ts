import { IDmlContext, ITrigger } from "../../../lib/db/dml-trigger";
import { RunOnce } from "../../../lib/decorator/run-once";
import { Component, OnInit, OnInitParam } from "../../../lib/render-engine/component";
import { UtilsRoll } from "../../../lib/roll/utils-roll";
import { staticValues } from "../../../static-values";
import { Action } from "../../action";
import { BaseCardComponent } from "../../base/base-card-component";
import { DamageCardData, DamageCardPart, ResourceCardData, ResourceCardPart, TargetCardData, TargetCardPart } from "../../base/index";
import { ChatPartIdData, ItemCardHelpers } from "../../item-card-helpers";
import { BeforeCreateModuleCardEvent, ModularCard, ModularCardPartData, ModularCardTriggerData } from "../../modular-card";
import { createPermissionCheckAction, CreatePermissionCheckArgs, HtmlContext, ModularCardCreateArgs } from "../../modular-card-part";

export interface LayOnHandsCardData extends DamageCardData {
  heal: number;
  cure: number;
  maxUsage: number;
}

@Component({
  tag: LayOnHandsComponent.getSelector(),
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
export class LayOnHandsComponent extends BaseCardComponent implements OnInit {

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
    .addSerializer(ItemCardHelpers.getRawSerializer('partId'))
    .addSerializer(ItemCardHelpers.getRawSerializer('cure'))
    .addSerializer(ItemCardHelpers.getRawSerializer('heal'))
    .addEnricher(ItemCardHelpers.getChatPartEnricher<LayOnHandsCardData>())
    .setPermissionCheck(LayOnHandsComponent.permissionCheck)
    .build(async ({messageId, part, allCardParts, heal, cure}) => {
      if (heal != null) {
        part.data.heal = heal;
      }
      if (cure != null) {
        part.data.cure = cure;
      }
      if ((part.data.heal + (part.data.cure * 5)) > part.data.maxUsage) {
        return;
      }
      return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
    });
  //#endregion
  
  public static getSelector(): string {
    return `${staticValues.code}-lay-on-hands-part`;
  }

  public onInit(args: OnInitParam) {
    args.addStoppable(
      this.getData<LayOnHandsCardData>(LayOnHandsCardPart.instance).listen(({part}) => this.setData(part))
    );
  }

  public localeHealing = game.i18n.localize('DND5E.Healing');
  public localeCure = 'Cure'; // TODO translate
  public currentHeal = 0;
  public currentCure = 0;
  public maxHeal = 0;
  public maxCure = 0;
  public missingPermission = true;
  private async setData(part: ModularCardPartData<LayOnHandsCardData>) {
    let hasPermission = false;
    if (part) {
      const result = await LayOnHandsComponent.permissionCheck({
        messageId: this.messageId,
        partId: part.id,
        part: part
      }, game.user);
      hasPermission = result !== 'prevent-action';
    }
    this.missingPermission = !hasPermission;

    if (!part || this.missingPermission) {
      this.currentHeal = 0;
      this.currentCure = 0;
      this.maxHeal = 0;
      this.maxCure = 0;
      return;
    }

    this.currentHeal = part.data.heal;
    this.currentCure = part.data.cure;
    const remainingUsage = part.data.maxUsage - this.currentHeal - (this.currentCure * 5);
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

    LayOnHandsComponent.setHealAndCure({
      messageId: this.messageId,
      partId: this.partId,
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

    LayOnHandsComponent.setHealAndCure({
      messageId: this.messageId,
      partId: this.partId,
      cure: value
    });
  }

}

export class LayOnHandsCardPart extends DamageCardPart {
  
  public static readonly instance = new LayOnHandsCardPart();

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

  public async create(args: ModularCardCreateArgs): Promise<LayOnHandsCardData> {
    const data = await super.create(this.injectCreateHealing(args)) as Partial<LayOnHandsCardData>;
    data.maxUsage = Number(args.item.getRollData().item.uses?.max) ?? 0;
    data.heal = 0;
    data.cure = 0;
    return data as LayOnHandsCardData;
  }

  public refresh(oldData: DamageCardData, args: ModularCardCreateArgs): Promise<LayOnHandsCardData> {
    return super.refresh(oldData, this.injectCreateHealing(args)) as Promise<LayOnHandsCardData>;
  }

  @RunOnce()
  public registerHooks(): void {
    ModularCard.registerModularCardPart(staticValues.moduleName, this);
    ModularCard.registerModularCardTrigger(this, new LayOnHandsCardTrigger());
    Hooks.on(`create${staticValues.code.capitalize()}ModuleCard`, (event: BeforeCreateModuleCardEvent) => {
      if (event.item.name.toLowerCase() === 'lay on hands') {
        event.addBefore(DamageCardPart.instance, LayOnHandsCardPart.instance);
        event.remove(DamageCardPart.instance);
      }
    })
  }

  public getHtml(data: HtmlContext<any>): string {
    return `<${LayOnHandsComponent.getSelector()} data-part-id="${data.partId}" data-message-id="${data.messageId}"></${LayOnHandsComponent.getSelector()}>`
  }
  
}


class LayOnHandsCardTrigger implements ITrigger<ModularCardTriggerData<LayOnHandsCardData>> {
  
  public beforeUpsert(context: IDmlContext<ModularCardTriggerData<LayOnHandsCardData>>): boolean | void {
    this.calcRoll(context);
    this.calcResource(context);
  }

  private calcRoll(context: IDmlContext<ModularCardTriggerData<LayOnHandsCardData>>): void {
    for (const {newRow, oldRow} of context.rows) {
      if (newRow.part.data.heal > 0) {
        newRow.part.data.phase = 'result';
      }
      if (newRow.part.data.heal !== oldRow?.part?.data?.heal) {
        const terms = [new NumericTerm({number: newRow.part.data.heal, options: {flavor: 'healing'}})];
        newRow.part.data.calc$.damageSource = {
          type: 'Manual',
          normalBaseRoll: UtilsRoll.toRollData(new Roll(Roll.getFormula(terms))).terms,
        }
      }
    }
  }

  private calcResource(context: IDmlContext<ModularCardTriggerData<LayOnHandsCardData>>): void {
    for (const {newRow} of context.rows) {
      const resources: ResourceCardData[] = [];
      let amountOfTargets = 0;

      let healAmount = 0;
      for (const part of newRow.allParts) {
        if (ModularCard.isType<LayOnHandsCardData>(LayOnHandsCardPart.instance, part)) {
          // If for some reason there are multiple instances
          healAmount += part.data.heal;
          healAmount += (part.data.cure * 5);
        }
        if (ModularCard.isType<ResourceCardData>(ResourceCardPart.instance, part)) {
          resources.push(part.data);
        }
        if (ModularCard.isType<TargetCardData>(TargetCardPart.instance, part)) {
          amountOfTargets += part.data.selected.length;
        }
      }
      // If there are no targets, assume it has been mentioned verbally => set to 1
      amountOfTargets = Math.max(1, amountOfTargets);
      
      const resourceAmount = healAmount * amountOfTargets;
      for (const resource of resources.map(r => r.consumeResources).deepFlatten()) {
        if (resource.calc$.uuid.includes('Item.') && resource.calc$.path === 'data.uses.value') {
          resource.calc$.autoconsumeAfter = 'never';
          resource.calc$.calcChange = resourceAmount;
          break;
        }
      }
    }
  }

}