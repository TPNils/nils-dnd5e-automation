import { ElementBuilder, ElementCallbackBuilder } from "../../../elements/element-builder";
import { IDmlContext, ITrigger } from "../../../lib/db/dml-trigger";
import { UtilsDocument } from "../../../lib/db/utils-document";
import { RunOnce } from "../../../lib/decorator/run-once";
import { UtilsRoll } from "../../../lib/roll/utils-roll";
import { staticValues } from "../../../static-values";
import { DamageCardData, DamageCardPart, ResourceCardData, ResourceCardPart, TargetCardData, TargetCardPart } from "../../base/index";
import { ItemCardHelpers } from "../../item-card-helpers";
import { ModularCard, ModularCardTriggerData } from "../../modular-card";
import { createPermissionCheck, CreatePermissionCheckArgs, ModularCardCreateArgs } from "../../modular-card-part";

export interface LayOnHandsCardData extends DamageCardData {
  heal: number;
  cure: number;
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
    data.heal = 0;
    data.cure = 0;
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
    const elementBuilder = new ElementBuilder()
      .listenForAttribute('data-part-id', 'string')
      .listenForAttribute('data-message-id', 'string')
      
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
          if (part.data.heal !== newValue) {
            part.data.heal = newValue;
            return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
          }
        })
      )
      .addOnAttributeChange(async ({element, attributes}) => {
        return ItemCardHelpers.ifAttrData<LayOnHandsCardData>({attr: attributes, element, type: this, callback: async ({part}) => {
          const hasPermission = await UtilsDocument.hasPermissions([{
            uuid: part.data.calc$.actorUuid,
            permission: 'OWNER',
            user: game.user,
          }]);
          // TODO translate cure
          element.innerHTML = /*html*/`
          <div style="display:grid; grid-template-columns:max-content auto;">
            <label style="display: flex; align-items: center;">${game.i18n.localize('DND5E.Healing')}:</label>
            <input style="margin-left: 3px;" name="heal-amount" type="number" min="0" max="${part.data.maxUsage}" value="${part.data.heal}" ${hasPermission[0].result ? '' : 'disabled'}>
            <label style="display: flex; align-items: center;">Cure:</label>
            <input style="margin-left: 3px;" name="cure-amount" type="number" min="0" max="${Math.floor(part.data.maxUsage / 5)}" value="${part.data.cure}" ${hasPermission[0].result ? '' : 'disabled'}>
          </div>`;
        }});
      });

    for (const eventName of ['focusout', 'keypress']) {
      elementBuilder.addListener(new ElementCallbackBuilder()
      .setEvent(eventName)
      .addSelectorFilter('input[name="heal-amount"]')
      .addSerializer(ItemCardHelpers.getChatPartIdSerializer())
      .addSerializer(ItemCardHelpers.getUserIdSerializer())
      .addSerializer(ItemCardHelpers.getInputSerializer())
      .addEnricher(ItemCardHelpers.getChatPartEnricher<LayOnHandsCardData>())
      .setPermissionCheck(permissionCheck)
      .setExecute(async ({messageId, part, allCardParts, inputValue}) => {
        const newValue = Math.min(part.data.maxUsage, Number.isNaN(Number(inputValue)) ? 0 : Number(inputValue));
        if (part.data.heal !== newValue) {
          part.data.heal = newValue;
          return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
        }
      }))
    }
    for (const eventName of ['focusout', 'keypress']) {
      elementBuilder.addListener(new ElementCallbackBuilder()
      .setEvent(eventName)
      .addSelectorFilter('input[name="cure-amount"]')
      .addSerializer(ItemCardHelpers.getChatPartIdSerializer())
      .addSerializer(ItemCardHelpers.getUserIdSerializer())
      .addSerializer(ItemCardHelpers.getInputSerializer())
      .addEnricher(ItemCardHelpers.getChatPartEnricher<LayOnHandsCardData>())
      .setPermissionCheck(permissionCheck)
      .setExecute(async ({messageId, part, allCardParts, inputValue}) => {
        const newValue = Math.min(part.data.maxUsage, Number.isNaN(Number(inputValue)) ? 0 : Number(inputValue));
        if (part.data.cure !== newValue) {
          part.data.cure = newValue;
          return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
        }
      }))
    }
    elementBuilder.build(this.getSelector());

    ModularCard.registerModularCardPart(staticValues.moduleName, this);
    ModularCard.registerModularCardTrigger(this, new LayOnHandsCardTrigger());
  }
  
  //#region Front end
  public getSelector(): string {
    return `${staticValues.code}-lay-on-hands-part`;
  }
  //#endregion
  
}


class LayOnHandsCardTrigger implements ITrigger<ModularCardTriggerData<LayOnHandsCardData>> {
  
  public beforeUpsert(context: IDmlContext<ModularCardTriggerData<LayOnHandsCardData>>): boolean | void {
    this.calcRoll(context);
    this.calcResource(context);
  }

  private calcRoll(context: IDmlContext<ModularCardTriggerData<LayOnHandsCardData>>): void {
    for (const {newRow, oldRow} of context.rows) {
      if (newRow.part.data.heal !== oldRow?.part.data.heal) {
        const terms = UtilsRoll.fromRollTermData(newRow.part.data.calc$.normalBaseRoll).terms;
        terms[0] = new NumericTerm({number: newRow.part.data.heal, options: {flavor: 'healing'}});
        newRow.part.data.calc$.normalBaseRoll = UtilsRoll.toRollData(new Roll(Roll.getFormula(terms))).terms;
      }
    }
  }

  private calcResource(context: IDmlContext<ModularCardTriggerData<LayOnHandsCardData>>): void {
    const resourcesByMessageId = new Map<string, ResourceCardData[]>();
    const targetsByMessageId = new Map<string, TargetCardData[]>();
    const layOfHandsByMessageId = new Map<string, LayOnHandsCardData[]>();

    for (const {newRow} of context.rows) {
      const resources: ResourceCardData[] = [];
      let amountOfTargets = 0;

      let healAmount = newRow.part.data.heal + (newRow.part.data.cure * 5);
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