import { ElementBuilder, ElementCallbackBuilder } from "../../elements/element-builder";
import { DmlTrigger, IDmlTrigger, IDmlContext, IAfterDmlContext, ITrigger } from "../../lib/db/dml-trigger";
import { UtilsDocument } from "../../lib/db/utils-document";
import { RunOnce } from "../../lib/decorator/run-once";
import { Component, OnInit, OnInitParam } from "../../lib/render-engine/component";
import { staticValues } from "../../static-values";
import { Action } from "../action";
import { ChatPartIdData, ItemCardHelpers } from "../item-card-helpers";
import { ModularCardPartData, ModularCard, ModularCardTriggerData } from "../modular-card";
import { ModularCardPart, ModularCardCreateArgs, createPermissionCheck, CreatePermissionCheckArgs, HtmlContext, createPermissionCheckAction } from "../modular-card-part";
import { AttackCardData, AttackCardPart } from "./attack-card-part";
import { BaseCardComponent } from "./base-card-component";
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
    // UtilsLog.log({expectedApplyAmount, currentValue, originalValue: newValue})
    
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
      if (part.data.phase === 'result') {
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

@Component({
  tag: ResourceCardComponent.getSelector(),
  html: /*html*/`
    <table *if="this.consumeResources.length > 0">
      <thead>
        <tr>
          <th>{{ this.localeResources }}</th>
          <th>{{ this.localeUses }}</th>
          <th class="button-column {{this.allConsumeResourcesApplied ? 'applied' : ''}}">
            <div style="display: flex;" title="All" *if="this.consumeResources.length > 1">
              <button (click)="this.apply('*')" class="apply"><i class="fas fa-check"></i></button>
              <button (click)="this.undo('*')" class="undo"><i class="fas fa-undo"></i></button>
            </div>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr *for="let consumeResource of this.consumeResources" class="{{consumeResource.calc$.calcChange === consumeResource.calc$.appliedChange ? 'applied' : ''}}">
          <td>{{consumeResource.label}}</td>
          <td>-{{consumeResource.calc$.calcChange}}</td>
          <td class="button-column">
            <button (click)="this.apply($index)" class="apply"><i class="fas fa-check"></i></button>
            <button (click)="this.undo($index)" class="undo"><i class="fas fa-undo"></i></button>
          </td>
        </tr>
      </tbody>
    </table>
  `,
  style: /*css*/`
    .button-column {
      width: 50px;
    }
    
    tbody .button-column button {
      display: inline-block;
    }

    .applied .apply {
      color: green;
    }
  
    .apply,
    .undo {
      font-size: 10px;
      height: 2em;
      width: 2em;
      line-height: 1em;
    }
  `
})
export class ResourceCardComponent extends BaseCardComponent implements OnInit {

  //#region actions
  private static permissionCheck = createPermissionCheckAction<{part: {data: ResourceCardData}, resourceIndex: number | '*'}>(({part, resourceIndex}) => {
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
  private static applyOrUndo = new Action<ChatPartIdData & {action: 'manual-apply' | 'undo'; resourceIndex: number | '*';}>('ResourceCardApplyOrUndo')
    .addSerializer(ItemCardHelpers.getRawSerializer('action'))
    .addSerializer(ItemCardHelpers.getRawSerializer('resourceIndex'))
    .addSerializer(ItemCardHelpers.getRawSerializer('messageId'))
    .addSerializer(ItemCardHelpers.getRawSerializer('partId'))
    .addSerializer(ItemCardHelpers.getUserIdSerializer())
    .addEnricher(ItemCardHelpers.getChatPartEnricher<ResourceCardData>())
    .setPermissionCheck(ResourceCardComponent.permissionCheck)
    .build(async ({resourceIndex, part, allCardParts, messageId, action}) => {
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
  //#endregion

  public static getSelector(): string {
    return `${staticValues.code}-resource-part`;
  }

  public localeResources = game.i18n.localize('Resources');
  public localeUses = game.i18n.localize('DND5E.Uses');
  public consumeResources: Array<ResourceCardData['consumeResources'][number] & {label: string;}> = [];
  public allConsumeResourcesApplied = false;
  
  public onInit(args: OnInitParam) {
    args.addStoppable(
      this.getData().listen(({message, partId}) => this.setData(message, partId))
    );
  }

  public apply(index: '*' | number) {
    console.log('apply', index);
    ResourceCardComponent.applyOrUndo({
      messageId: this.messageId,
      partId: this.partId,
      resourceIndex: index,
      action: 'manual-apply',
    });
  }

  public undo(index: '*' | number) {
    console.log('undo', index);
    ResourceCardComponent.applyOrUndo({
      messageId: this.messageId,
      partId: this.partId,
      resourceIndex: index,
      action: 'undo',
    });
  }

  private async setData(message: ChatMessage, partId: string) {
    const allParts = ModularCard.getCardPartDatas(message);
    let part: ModularCardPartData<ResourceCardData>;
    if (allParts != null) {
      part = allParts.find(p => p.id === partId && p.type === ResourceCardPart.instance.getType());
    }

    if (part) {
      const hasPerm = await UtilsDocument.hasAllPermissions([{
        permission: 'Observer',
        uuid: part.data.calc$.actorUuid,
        user: game.user,
      }]);
      if (hasPerm) {
        this.consumeResources = part.data.consumeResources.map(resource => {
          return {
            ...resource,
            label: ResourceCardComponent.translateUsage(resource),
          }
        });
      } else {
        this.consumeResources = [];
      }
    } else {
      this.consumeResources = [];
    }
    this.allConsumeResourcesApplied = this.consumeResources.every(r => r.calc$.appliedChange === r.calc$.calcChange);
  }

  private static translateUsage(usage: ResourceCardData['consumeResources'][number]): string {
    const uuidParts = usage.calc$.uuid.split('.');
    const pathParts = usage.calc$.path.split('.');

    const documentName = uuidParts[uuidParts.length - 2];
    if (documentName === (Actor as any).documentName) {
      switch (pathParts[0]) {
        case 'data': {
          switch (pathParts[1]) {
            case 'attributes': {
              if (pathParts[2] === 'hp') {
                return `${game.i18n.localize('DND5E.HP')}`;
              }
            }
            case 'currency': {
              return `${game.i18n.localize('DND5E.Currency' + pathParts[2].capitalize())}`;
            }
            case 'resources': {
              if (pathParts[3] === 'value') {
                const actor = UtilsDocument.actorFromUuid(usage.calc$.uuid, {sync: true});
                if (actor?.data?.data?.resources[pathParts[2]].label) {
                  return actor.data.data.resources[pathParts[2]].label;
                }
                return `${game.i18n.localize('DND5E.Resource' + pathParts[2].capitalize())}`;
              }
            }
            case 'spells': {
              let spellLevel;
              if (pathParts[2] === 'pact') {
                spellLevel = game.i18n.localize('DND5E.PactMagic');
              } else {
                spellLevel = pathParts[2].substring(5);
              }
              return `${game.i18n.localize('DND5E.SpellLevel')}: ${spellLevel}`;
            }
          }
        }
      }
    } else if (documentName === (Item as any).documentName) {
      const item = UtilsDocument.itemFromUuid(usage.calc$.uuid, {sync: true});
      if (item) {
        return item.name;
      }
    }

    return usage.calc$.path;
  }

}

export class ResourceCardPart implements ModularCardPart<ResourceCardData> {

  public static readonly instance = new ResourceCardPart();
  private constructor(){}
  
  public create({item, actor}: ModularCardCreateArgs): ResourceCardData {
    const data: ResourceCardData = {
      consumeResources: [],
      calc$: {
        actorUuid: actor?.uuid,
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
    ModularCard.registerModularCardTrigger(this, new ResourceTrigger());
    ModularCard.registerModularCardPart(staticValues.moduleName, this);
    DmlTrigger.registerTrigger(new ChatMessageCardTrigger());
  }

  public getType(): string {
    return this.constructor.name;
  }

  //#region Front end
  public getHtml(data: HtmlContext): string {
    return `<${ResourceCardComponent.getSelector()} data-part-id="${data.partId}" data-message-id="${data.messageId}"></${ResourceCardComponent.getSelector()}>`
  }
  //#endregion

}

class ResourceTrigger implements ITrigger<ModularCardTriggerData<ResourceCardData>> {
  
  //#region beforeUpsert
  public beforeUpsert(context: IDmlContext<ModularCardTriggerData<ResourceCardData>>): boolean | void {
    this.removeUnusedResources(context);
  }

  private removeUnusedResources(context: IDmlContext<ModularCardTriggerData<ResourceCardData>>): void {
    for (const {newRow} of context.rows) {
      const filtered = newRow.part.data.consumeResources.filter(resource => {
        return resource.calc$.calcChange !== 0 || resource.calc$.appliedChange !== 0
      });
      if (filtered.length !== newRow.part.data.consumeResources.length) {
        newRow.part.data.consumeResources = filtered;
      }
    }
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