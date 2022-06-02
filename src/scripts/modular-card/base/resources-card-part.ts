import { ElementBuilder, ElementCallbackBuilder } from "../../elements/element-builder";
import { DmlTrigger, IDmlTrigger, IDmlContext, IAfterDmlContext } from "../../lib/db/dml-trigger";
import { UtilsDocument } from "../../lib/db/utils-document";
import { RunOnce } from "../../lib/decorator/run-once";
import { staticValues } from "../../static-values";
import { ItemCardHelpers } from "../item-card-helpers";
import { ModularCardPartData, ModularCard } from "../modular-card";
import { ModularCardPart, ModularCardCreateArgs, createPermissionCheck, CreatePermissionCheckArgs, HtmlContext } from "../modular-card-part";
import { AttackCardData, AttackCardPart } from "./attack-card-part";
import { CheckCardData, CheckCardPart } from "./check-card-part";
import { DamageCardData, DamageCardPart } from "./damage-card-part";
import { TemplateCardData, TemplateCardPart } from "./template-card-part";

type AutoConsumeAfter = 'never' | 'init' | 'attack' | 'damage' | 'check' | 'template-placed';

export interface ResourceCardData {
  consumeResources: {
    consumeResourcesAction: 'undo' | 'manual-apply' | 'auto';
    calc$: {
      uuid: string;
      path: string;
      calcChange: number;
      appliedChange: number;
      autoconsumeAfter?: AutoConsumeAfter;
    }
  }[];
  calc$: {
    actorUuid: string;
    allConsumeResourcesApplied: boolean;
  }
}

interface ApplyResourceConsumptionRequest {
  messageDataById: Map<string, MessageState>;
  resources: Array<{
    messageId: string;
    resource: ResourceCardData['consumeResources'][0];
  }>;
}

interface MessageState {
  /**
   * If the message has, for example: an attack
   */
  hasStates: Set<AutoConsumeAfter>;
  /**
   * If the message has completed a state, for example: rolled the attack
   */
  completedStates: Set<AutoConsumeAfter>;
}

async function applyResourceConsumption({messageDataById, resources}: ApplyResourceConsumptionRequest): Promise<void> {
  const documentsByUuid = new Map<string, foundry.abstract.Document<any, any>>();
  const applyResources: ApplyResourceConsumptionRequest['resources'] = [];
  {
    const requestUuids = new Set<string>();
    for (const resource of resources) {
      let shouldApply = false;
      if (resource.resource.consumeResourcesAction === 'undo') {
        shouldApply = false;
      } else if (resource.resource.consumeResourcesAction === 'manual-apply') {
        shouldApply = true;
      } else {
        switch (resource.resource.calc$.autoconsumeAfter) {
          case 'init': {
            shouldApply = true;
            break;
          }
          default: {
            shouldApply = messageDataById.get(resource.messageId).completedStates.has(resource.resource.calc$.autoconsumeAfter);
            break;
          }
        }
      }

      const isCurrentlyApplied = resource.resource.calc$.appliedChange === resource.resource.calc$.calcChange;
      
      if (shouldApply !== isCurrentlyApplied) {
        applyResources.push(resource);
        requestUuids.add(resource.resource.calc$.uuid);
      }
    }

    for (const [uuid, row] of (await UtilsDocument.fromUuid(requestUuids)).entries()) {
      documentsByUuid.set(uuid, row);
    }
  }

  if (applyResources.length === 0) {
    return;
  }

  const updatesByUuid = new Map<string, any>();
  for (const resource of applyResources) {
    if (!updatesByUuid.has(resource.resource.calc$.uuid)) {
      updatesByUuid.set(resource.resource.calc$.uuid, {});
    }
    const updates = updatesByUuid.get(resource.resource.calc$.uuid);
    let shouldApply = false;
    if (resource.resource.consumeResourcesAction === 'undo') {
      shouldApply = false;
    } else if (resource.resource.consumeResourcesAction === 'manual-apply') {
      shouldApply = true;
    } else {
      switch (resource.resource.calc$.autoconsumeAfter) {
        case 'init': {
          shouldApply = true;
          break;
        }
        default: {
          shouldApply = messageDataById.get(resource.messageId).completedStates.has(resource.resource.calc$.autoconsumeAfter);
          break;
        }
      }
    }

    const document = documentsByUuid.get(resource.resource.calc$.uuid);
    const expectedApplyAmount = shouldApply ? resource.resource.calc$.calcChange : 0;
    // If the value already is getting updated, work with the new value
    let currentValue = getProperty(updates, resource.resource.calc$.path);
    if (currentValue === undefined) {
      currentValue = getProperty(document.data, resource.resource.calc$.path);
    }
    const originalValue = currentValue + resource.resource.calc$.appliedChange;
    const newValue = Math.max(0, originalValue - expectedApplyAmount);
    resource.resource.calc$.appliedChange = originalValue - newValue;
    // console.log({expectedApplyAmount, currentValue, originalValue: newValue})
    
    setProperty(updates, resource.resource.calc$.path, newValue);
  }

  const bulkUpdate: Parameters<typeof UtilsDocument['bulkUpdate']>[0] = [];
  for (const uuid of documentsByUuid.keys()) {
    if (updatesByUuid.has(uuid)) {
      bulkUpdate.push({
        document: documentsByUuid.get(uuid) as any,
        data: updatesByUuid.get(uuid)
      })
    }
  }
  await UtilsDocument.bulkUpdate(bulkUpdate);
}

function getMessageState(allParts: ModularCardPartData[]): MessageState {
  const messageState: MessageState = {
    hasStates: new Set<AutoConsumeAfter>(),
    completedStates: new Set<AutoConsumeAfter>(),
  };

  for (const part of allParts) {
    if (ModularCard.isType<AttackCardData>(AttackCardPart.instance, part)) {
      messageState.hasStates.add('attack');
      if (part.data.targetCaches$.some(cache => cache.phase === 'result')) {
        messageState.completedStates.add('attack');
      }
    }
    if (ModularCard.isType<DamageCardData>(DamageCardPart.instance, part)) {
      messageState.hasStates.add('damage');
      if (part.data.phase === 'result') {
        messageState.completedStates.add('damage');
      }
    }
    if (ModularCard.isType<CheckCardData>(CheckCardPart.instance, part)) {
      messageState.hasStates.add('check');
      for (const target of (part.data.targetCaches$ ?? [])) {
        if (target.phase === 'result') {
          messageState.completedStates.add('check');
          break;
        }
      }
    }
    if (ModularCard.isType<TemplateCardData>(TemplateCardPart.instance, part)) {
      messageState.hasStates.add('template-placed');
      if (part.data.calc$.createdTemplateUuid) {
        messageState.completedStates.add('template-placed');
      }
    }
  }

  return messageState;
}

export class ResourceCardPart implements ModularCardPart<ResourceCardData> {

  public static readonly instance = new ResourceCardPart();
  private constructor(){}
  
  public create({item, actor}: ModularCardCreateArgs): ResourceCardData {
    const data: ResourceCardData = {
      consumeResources: [],
      calc$: {
        actorUuid: actor?.uuid,
        allConsumeResourcesApplied: false,
      }
    };
    
    // TODO this is currently hard coded, would be nice if it could be extended
    // Consume actor resources
    if (actor) {
      const spellSlot = item.type === "spell" && item.data.data.level > 0 && ItemCardHelpers.spellUpcastModes.includes(item.data.data.preparation.mode);
      if (spellSlot) {
        let spellPropertyName = item.data.data.preparation.mode === "pact" ? "pact" : `spell${item.data.data.level}`;
        data.consumeResources.push({
          consumeResourcesAction: 'auto',
          calc$: {
            uuid: actor.uuid,
            path: `data.spells.${spellPropertyName}.value`,
            calcChange: 1,
            appliedChange: 0,
          }
        });
      }
      
      switch (item.data.data.consume.type) {
        case 'attribute': {
          if (item.data.data.consume.target && item.data.data.consume.amount > 0) {
            let propertyPath = `data.${item.data.data.consume.target}`;
            data.consumeResources.push({
              consumeResourcesAction: 'auto',
              calc$: {
                uuid: actor.uuid,
                path: propertyPath,
                calcChange: item.data.data.consume.amount,
                appliedChange: 0,
              }
            });
          }
          break;
        }
      }
    }

    // Consume item resources
    {
      switch (item.data.data.consume.type) {
        case 'ammo':
        case 'material': {
          if (item.data.data.consume.target && item.data.data.consume.amount > 0) {
            const targetItem = item.actor.items.get(item.data.data.consume.target);
            let propertyPath = `data.quantity`;
            data.consumeResources.push({
              consumeResourcesAction: 'auto',
              calc$: {
                uuid: targetItem.uuid,
                path: propertyPath,
                calcChange: item.data.data.consume.amount,
                appliedChange: 0,
              }
            });
          }
          break;
        }
        case 'charges': {
          if (item.data.data.consume.target && item.data.data.consume.amount > 0) {
            const targetItem = item.actor.items.get(item.data.data.consume.target);
            let propertyPath = `data.uses.value`;
            data.consumeResources.push({
              consumeResourcesAction: 'auto',
              calc$: {
                uuid: targetItem.uuid,
                path: propertyPath,
                calcChange: item.data.data.consume.amount,
                appliedChange: 0,
              }
            });
          }
          break;
        }
      }
      
      if (item.data.data.uses?.per != null && item.data.data.uses?.per != '') {
        let propertyPath = `data.uses.value`;
        data.consumeResources.push({
          consumeResourcesAction: 'auto',
          calc$: {
            uuid: item.uuid,
            path: propertyPath,
            calcChange: 1,
            appliedChange: 0,
          }
        });
      }
    }

    return data;
  }

  public refresh(data: ResourceCardData, args: ModularCardCreateArgs): ResourceCardData {
    const originalResourcesByKey = new Map<string, ResourceCardData['consumeResources'][0]>();
    for (const resource of data.consumeResources) {
      originalResourcesByKey.set(`${resource.calc$.uuid}-${resource.calc$.path}`, resource);
    }

    const newData = this.create(args);
    const newKeys = new Set<string>();
    for (const resource of newData.consumeResources) {
      const key = `${resource.calc$.uuid}-${resource.calc$.path}`;
      newKeys.add(key);
      const original = originalResourcesByKey.get(key);
      if (original) {
        resource.calc$.appliedChange += original.calc$.appliedChange;
      }
    }

    for (const [key, resource] of originalResourcesByKey.entries()) {
      if (!newKeys.has(key)) {
        newData.consumeResources.push({
          consumeResourcesAction: resource.consumeResourcesAction,
          calc$: {
            ...resource.calc$,
            calcChange: 0,
          }
        });
      }
    }

    return newData;
  }

  @RunOnce()
  public registerHooks(): void {
    const permissionCheck = createPermissionCheck<{part: {data: ResourceCardData}, resourceIndex: number | '*'}>(({part, resourceIndex}) => {
      const documents: CreatePermissionCheckArgs['documents'] = [];
      if (resourceIndex === '*') {
        for (const resource of part.data.consumeResources) {
          documents.push({uuid: resource.calc$.uuid, permission: 'OWNER', security: true});
        }
      } else {
        documents.push({uuid: part.data.consumeResources[resourceIndex].calc$.uuid, permission: 'OWNER', security: true});
      }
      return {documents: documents};
    })
    
    new ElementBuilder()
      .listenForAttribute('data-part-id', 'string')
      .listenForAttribute('data-message-id', 'string')
      .addListener(new ElementCallbackBuilder()
        .setEvent('click')
        .addSelectorFilter('[data-action="manual-apply"],[data-action="undo"]')
        .addSerializer(ItemCardHelpers.getUserIdSerializer())
        .addSerializer(ItemCardHelpers.getChatPartIdSerializer())
        .addSerializer(ItemCardHelpers.getActionSerializer())
        .addSerializer(({event}) => {
          const index = (event.target as HTMLElement).closest('[data-resource-index]').getAttribute('data-resource-index');
          return {
            resourceIndex: index === '*' ? '*' as const : Number(index),
          }
        })
        .addEnricher(ItemCardHelpers.getChatPartEnricher<ResourceCardData>())
        .setPermissionCheck(permissionCheck)
        .setExecute(async ({resourceIndex, part, allCardParts, messageId, action}) => {
          const consumeResources: ResourceCardData['consumeResources'] = [];
          if (resourceIndex === '*') {
            for (const consumeResource of part.data.consumeResources) {
              consumeResources.push(consumeResource)
            }
          } else if (part.data.consumeResources.length >= resourceIndex-1) {
            consumeResources.push(part.data.consumeResources[resourceIndex]);
          }

          const changed: ResourceCardData['consumeResources'] = [];
          for (const consumeResource of consumeResources) {
            consumeResource.consumeResourcesAction = action as any;
            changed.push(consumeResource);
          }

          if (changed.length) {
            const request: ApplyResourceConsumptionRequest = {
              messageDataById: new Map(),
              resources: [],
            }
            request.messageDataById.set(messageId, getMessageState(allCardParts));
            for (const change of changed) {
              request.resources.push({
                messageId: messageId,
                resource: change,
              })
            }

            await applyResourceConsumption(request);
            return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
          }
        })
      )
      .addOnAttributeChange(({element, attributes}) => {
        return ItemCardHelpers.ifAttrData<ResourceCardData>({attr: attributes, element, type: this, callback: async ({part}) => {
          element.innerHTML = await renderTemplate(
            `modules/${staticValues.moduleName}/templates/modular-card/resource-part.hbs`, {
              data: {
                ...part.data,
                consumeResources: part.data.consumeResources.filter(resource => {
                  return resource.calc$.calcChange !== 0 || resource.calc$.appliedChange !== 0
                })
              },
              moduleName: staticValues.moduleName
            });
          
        }});
      })
      .build(this.getSelector())
    
    ModularCard.registerModularCardPart(staticValues.moduleName, this);
    DmlTrigger.registerTrigger(new ChatMessageCardTrigger());
  }

  public getType(): string {
    return this.constructor.name;
  }

  //#region Front end
  public getSelector(): string {
    return `${staticValues.code}-resource-part`;
  }

  public getHtml(data: HtmlContext): string {
    return `<${this.getSelector()} data-part-id="${data.partId}" data-message-id="${data.messageId}"></${this.getSelector()}>`
  }
  //#endregion

}

class ChatMessageCardTrigger implements IDmlTrigger<ChatMessage> {
  get type(): typeof ChatMessage {
    return ChatMessage;
  }
  
  //#region beforeUpsert
  public beforeUpsert(context: IDmlContext<ChatMessage>): boolean | void {
    this.calcAutoApply(context);
    this.calcAllApplied(context);
  }

  private calcAutoApply(context: IDmlContext<ChatMessage>): void {
    for (const {newRow} of context.rows) {
      const allParts = ModularCard.getCardPartDatas(newRow);
      if (!allParts) {
        continue;
      }

      const resources: ResourceCardData[] = [];
      for (const part of allParts) {
        if (ModularCard.isType<ResourceCardData>(ResourceCardPart.instance, part)) {
          resources.push(part.data);
        }
      }
      if (resources.length > 0) {
        const state = getMessageState(allParts);
        for (const resource of resources) {
          for (const consumeResource of resource.consumeResources) {
            if (consumeResource.calc$.autoconsumeAfter == null) {
              if (state.hasStates.has('attack')) {
                consumeResource.calc$.autoconsumeAfter = 'attack';
              } else if (state.hasStates.has('damage')) {
                consumeResource.calc$.autoconsumeAfter = 'damage';
              } else if (state.hasStates.has('template-placed')) {
                consumeResource.calc$.autoconsumeAfter = 'template-placed';
              } else if (state.hasStates.has('check')) {
                consumeResource.calc$.autoconsumeAfter = 'check';
              } else {
                consumeResource.calc$.autoconsumeAfter = 'init';
              }
            }
          }
        }
      }
    }
  }

  private calcAllApplied(context: IDmlContext<ChatMessage>): void {
    for (const {newRow} of context.rows) {
      const allParts = ModularCard.getCardPartDatas(newRow);
      if (!allParts) {
        continue;
      }

      for (const part of allParts) {
        if (ModularCard.isType<ResourceCardData>(ResourceCardPart.instance, part)) {
          part.data.calc$.allConsumeResourcesApplied = part.data.consumeResources.every(r => r.calc$.appliedChange === r.calc$.calcChange);
        }
      }
    }
  }
  //#endregion
  
  //#region upsert
  public async upsert(context: IAfterDmlContext<ChatMessage>) {
    await this.applyConsumeResources(context);
  }
  
  private async applyConsumeResources(context: IAfterDmlContext<ChatMessage>): Promise<void> {
    const applyRequest: ApplyResourceConsumptionRequest = {
      messageDataById: new Map(),
      resources: [],
    };
    for (const {newRow, changedByUserId} of context.rows) {
      if (changedByUserId !== game.userId) {
        // Only one user needs to do this operation
        continue;
      }
      const allParts = ModularCard.getCardPartDatas(newRow);
      if (!allParts) {
        continue;
      }

      const resources: ResourceCardData[] = [];
      for (const part of allParts) {
        if (ModularCard.isType<ResourceCardData>(ResourceCardPart.instance, part)) {
          resources.push(part.data);
        }
      }
      if (resources.length > 0) {
        let addedResource = false;
        for (const resource of resources) {
          for (const consumeResource of resource.consumeResources) {
            if (consumeResource.consumeResourcesAction === 'auto') {
              addedResource = true;
              applyRequest.resources.push({
                messageId: newRow.id,
                resource: consumeResource,
              });
            }
          }
        }
        if (addedResource) {
          applyRequest.messageDataById.set(newRow.id, getMessageState(allParts));
        }
      }
    }

    if (applyRequest.resources.length > 0) {
      await applyResourceConsumption(applyRequest);
    }
  }
  //#endregion

}