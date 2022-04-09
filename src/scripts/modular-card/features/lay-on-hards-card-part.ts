import { ElementBuilder, ElementCallbackBuilder } from "../../elements/element-builder";
import { IDmlContext, ITrigger } from "../../lib/db/dml-trigger";
import { RunOnce } from "../../lib/decorator/run-once";
import { UtilsRoll } from "../../lib/roll/utils-roll";
import { staticValues } from "../../static-values";
import { DamageCardData, DamageCardPart } from "../damage-card-part";
import { ItemCardHelpers } from "../item-card-helpers";
import { ModularCard, ModularCardTriggerData } from "../modular-card";
import { createPermissionCheck, CreatePermissionCheckArgs, ModularCardCreateArgs } from "../modular-card-part";
import { ResourceCardData, ResourceCardPart } from "../resources-card-part";
import { TargetCardData, TargetCardPart } from "../target-card-part";

export interface LayOnHandsCardData extends DamageCardData {
  maxUsage: number;
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
    data.phase = 'result';
    data.maxUsage = Number(args.item.getRollData().item.uses?.max) ?? 0;
    return data as LayOnHandsCardData;
  }

  public refresh(oldData: DamageCardData, args: ModularCardCreateArgs): Promise<LayOnHandsCardData> {
    return super.refresh(oldData, this.injectCreateHealing(args)) as Promise<LayOnHandsCardData>;
  }

  @RunOnce()
  public registerHooks(): void {
    const permissionCheck = createPermissionCheck<{part: {data: DamageCardData}}>(({part}) => {
      const documents: CreatePermissionCheckArgs['documents'] = [];
      if (part.data.calc$.actorUuid) {
        documents.push({uuid: part.data.calc$.actorUuid, permission: 'OWNER', security: true});
      }
      return {documents: documents};
    })
    new ElementBuilder()
      .listenForAttribute('data-part-id', 'string')
      .listenForAttribute('data-message-id', 'string')
      .addListener(new ElementCallbackBuilder()
        .setEvent('focusout')
        .addSelectorFilter('input[name="heal-amount"]')
        .addSerializer(ItemCardHelpers.getChatPartIdSerializer())
        .addSerializer(ItemCardHelpers.getUserIdSerializer())
        .addSerializer(ItemCardHelpers.getInputSerializer())
        .addEnricher(ItemCardHelpers.getChatPartEnricher<LayOnHandsCardData>())
        .setPermissionCheck(permissionCheck)
        .setExecute(async ({messageId, part, allCardParts, inputValue}) => {
          const newValue = Math.min(part.data.maxUsage, Number.isNaN(Number(inputValue)) ? 0 : Number(inputValue));
          const terms = UtilsRoll.fromRollTermData(part.data.calc$.normalBaseRoll).terms;
          terms[0] = new NumericTerm({number: newValue, options: {flavor: 'healing'}});
          part.data.calc$.normalBaseRoll = UtilsRoll.toRollData(new Roll(Roll.getFormula(terms))).terms;
          return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
        })
      )
      .addListener(new ElementCallbackBuilder()
        .setEvent('keypress')
        .addSelectorFilter('input[name="heal-amount"]')
        .addFilter(({event}) => event.key !== 'Enter')
        .addSerializer(ItemCardHelpers.getChatPartIdSerializer())
        .addSerializer(ItemCardHelpers.getUserIdSerializer())
        .addSerializer(ItemCardHelpers.getInputSerializer())
        .addEnricher(ItemCardHelpers.getChatPartEnricher<LayOnHandsCardData>())
        .setPermissionCheck(permissionCheck)
        .setExecute(async ({messageId, part, allCardParts, inputValue}) => {
          const newValue = Math.min(part.data.maxUsage, Number.isNaN(Number(inputValue)) ? 0 : Number(inputValue));
          const terms = UtilsRoll.fromRollTermData(part.data.calc$.normalBaseRoll).terms;
          terms[0] = new NumericTerm({number: newValue, options: {flavor: 'healing'}});
          part.data.calc$.normalBaseRoll = UtilsRoll.toRollData(new Roll(Roll.getFormula(terms))).terms;
          return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
        })
      )
      .addOnAttributeChange(async ({element, attributes}) => {
        return ItemCardHelpers.ifAttrData<LayOnHandsCardData>({attr: attributes, element, type: this, callback: async ({part}) => {
          let currentUsage = Number((part.data.calc$.roll?.terms?.[0] as {number: number})?.number ?? 0);
          element.innerHTML = `
            <label style="display: flex; align-items: center;">
              ${game.i18n.localize('DND5E.Healing')}:
              <input style="margin-left: 3px;" name="heal-amount" type="number" min="0" max="${part.data.maxUsage}" value="${currentUsage}">
            </label>`;
          /*element.innerHTML = await renderTemplate(
            `modules/${staticValues.moduleName}/templates/modular-card/lay-on-hands-part.hbs`, {
              data: part.data,
              moduleName: staticValues.moduleName
            }
          );*/
        }});
      })
      .build(this.getSelector())

    ModularCard.registerModularCardPart(staticValues.moduleName, this);
    ModularCard.registerModularCardTrigger(new LayOnHandsCardTrigger());
  }
  
  //#region Front end
  public getSelector(): string {
    return `${staticValues.code}-lay-on-hands-part`;
  }
  //#endregion
  
}


class LayOnHandsCardTrigger implements ITrigger<ModularCardTriggerData> {
  
  public beforeUpsert(context: IDmlContext<ModularCardTriggerData<any>>): boolean | void {
    this.calcResource(context);
  }

  private calcResource(context: IDmlContext<ModularCardTriggerData<any>>): void {
    const resourcesByMessageId = new Map<string, ResourceCardData[]>();
    const targetsByMessageId = new Map<string, TargetCardData[]>();
    const layOfHandsByMessageId = new Map<string, DamageCardData[]>();

    for (const {newRow} of context.rows) {
      if (!resourcesByMessageId.has(newRow.messageId)) {
        resourcesByMessageId.set(newRow.messageId, []);
      }
      if (!targetsByMessageId.has(newRow.messageId)) {
        targetsByMessageId.set(newRow.messageId, []);
      }
      if (!layOfHandsByMessageId.has(newRow.messageId)) {
        layOfHandsByMessageId.set(newRow.messageId, []);
      }
      if (ModularCard.isType<ResourceCardData>(ResourceCardPart.instance, newRow)) {
        resourcesByMessageId.get(newRow.messageId).push(newRow.data);
      }
      if (ModularCard.isType<TargetCardData>(TargetCardPart.instance, newRow)) {
        targetsByMessageId.get(newRow.messageId).push(newRow.data);
      }
      if (ModularCard.isType<DamageCardData>(LayOnHandsCardPart.instance, newRow)) {
        layOfHandsByMessageId.get(newRow.messageId).push(newRow.data);
      }
    }

    for (const [messageId, layOfHands] of layOfHandsByMessageId.entries()) {
      const resources = resourcesByMessageId.get(messageId);
      if (resources.length === 0) {
        continue;
      }
      const targets = targetsByMessageId.get(messageId);
      let amountOfTargets = 0;
      for (const target of targets) {
        amountOfTargets += target.selected.length;
      }
      // If there are no targets, assume it has been mentioned verbally => set to 1
      amountOfTargets = Math.max(1, amountOfTargets);

      let healAmount = 0;
      for (const layOfHand of layOfHands) {
        healAmount += (layOfHand.calc$.normalBaseRoll[0] as {number: number}).number;
      }
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