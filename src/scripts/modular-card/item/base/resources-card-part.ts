import { IAfterDmlContext, ITrigger } from "../../../lib/db/dml-trigger";
import { DmlUpdateRequest, UtilsDocument } from "../../../lib/db/utils-document";
import { RunOnce } from "../../../lib/decorator/run-once";
import { Component, OnInit, OnInitParam } from "../../../lib/render-engine/component";
import { ValueReader } from "../../../provider/value-provider";
import { staticValues } from "../../../static-values";
import { UtilsFoundry } from "../../../utils/utils-foundry";
import { UtilsHooks } from "../../../utils/utils-hooks";
import { Action } from "../../action";
import { ChatPartIdData, ItemCardHelpers } from "../item-card-helpers";
import { ModularCard, ModularCardTriggerData, ModularCardInstance } from "../../modular-card";
import { ModularCardPart, ModularCardCreateArgs, CreatePermissionCheckArgs, HtmlContext, createPermissionCheckAction } from "../../modular-card-part";
import { AttackCardPart } from "./attack-card-part";
import { BaseCardComponent } from "./base-card-component";
import { CheckCardPart } from "./check-card-part";
import { DamageCardPart } from "./damage-card-part";
import { OtherCardPart } from "./other-card-part";
import { TemplateCardPart } from "./template-card-part";

type AutoConsumeAfter = 'never' | 'init' | 'attack' | 'damage' | 'other-formula' | 'check' | 'template-placed';

export interface ResourceCardData {
  consumeResources: {
    consumeResourcesAction: 'undo' | 'manual-apply' | 'auto';
    calc$: {
      uuid: string;
      path: string;
      calcChange: number;
      appliedChange: number;
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
      let tryToApply = false;
      if (resource.resource.consumeResourcesAction === 'undo') {
        tryToApply = resource.resource.calc$.appliedChange !== 0;
      } else if (resource.resource.consumeResourcesAction === 'manual-apply') {
        tryToApply = resource.resource.calc$.appliedChange !== resource.resource.calc$.calcChange;
      } else {
        const states = messageDataById.get(resource.messageId);
        for (const state of states.hasStates) {
          if (states.completedStates.has(state)) {
            tryToApply = true;
            break;
          }
        }
      }
      
      if (tryToApply) {
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
      const autobehavior = game.settings.get(staticValues.moduleName, 'autoConsumeResources') as string;
      switch (autobehavior) {
        case 'detection': {
          const states = messageDataById.get(resource.messageId);
          if (states.hasStates.size > 0) {
            // No states detected, probably a very limited item => just auto consume
              shouldApply = true;
          } else {
            for (const state of states.hasStates) {
              if (states.completedStates.has(state)) {
                shouldApply = true;
                break;
              }
            }
          }
          break;
        }
        case 'always': {
          shouldApply = true;
          break;
        }
        case 'never':
        default: {
          shouldApply = false;
          break;
        }
      }
    }

    const document = documentsByUuid.get(resource.resource.calc$.uuid);
    const expectedApplyAmount = shouldApply ? resource.resource.calc$.calcChange : 0;
    // If the value already is getting updated, work with the new value
    let currentValue = getProperty(updates, resource.resource.calc$.path);
    if (currentValue === undefined) {
      currentValue = getProperty(UtilsFoundry.getModelData(document), resource.resource.calc$.path);
    }
    const originalValue = currentValue + resource.resource.calc$.appliedChange;
    const newValue = Math.max(0, originalValue - expectedApplyAmount);
    resource.resource.calc$.appliedChange = originalValue - newValue;
    // UtilsLog.log({path: resource.resource.calc$.path, expectedApplyAmount, currentValue, originalValue, newValue, appliedChange: resource.resource.calc$.appliedChange})
    
    setProperty(updates, resource.resource.calc$.path, newValue);
  }

  const bulkUpdate: DmlUpdateRequest[] = [];
  for (const uuid of documentsByUuid.keys()) {
    if (updatesByUuid.has(uuid)) {
      bulkUpdate.push({
        document: documentsByUuid.get(uuid) as any,
        rootData: updatesByUuid.get(uuid),
      })
    }
  }
  await UtilsDocument.bulkUpdate(bulkUpdate);
}

function getMessageState(allParts: ModularCardInstance): MessageState {
  const messageState: MessageState = {
    hasStates: new Set<AutoConsumeAfter>(),
    completedStates: new Set<AutoConsumeAfter>(),
  };

  if (allParts.hasType(AttackCardPart.instance)) {
    messageState.hasStates.add('attack');
    if (allParts.getTypeData(AttackCardPart.instance).phase === 'result') {
      messageState.completedStates.add('attack');
    }
  }
  if (allParts.hasType(DamageCardPart.instance)) {
    messageState.hasStates.add('damage');
    if (allParts.getTypeData(DamageCardPart.instance).phase === 'result') {
      messageState.completedStates.add('damage');
    }
  }
  if (allParts.hasType(CheckCardPart.instance)) {
    messageState.hasStates.add('check');
    for (const target of (allParts.getTypeData(CheckCardPart.instance).targetCaches$ ?? [])) {
      if (target.phase === 'result') {
        messageState.completedStates.add('check');
        break;
      }
    }
  }
  if (allParts.hasType(TemplateCardPart.instance)) {
    messageState.hasStates.add('template-placed');
    if (allParts.getTypeData(TemplateCardPart.instance).calc$.createdTemplateUuid) {
      messageState.completedStates.add('template-placed');
    }
  }
  if (allParts.hasType(OtherCardPart.instance)) {
    messageState.hasStates.add('other-formula');
    if (allParts.getTypeData(OtherCardPart.instance).roll$?.evaluated) {
      messageState.completedStates.add('other-formula');
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
        <tr *for="let consumeResource of this.consumeResources" class="{{consumeResource.state}}">
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

    .not-applied .undo {
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
  private static permissionCheck = createPermissionCheckAction<{cardParts: ModularCardInstance, resourceIndex: number | '*'}>(({cardParts, resourceIndex}) => {
    const part = cardParts.getTypeData(ResourceCardPart.instance);
    const documents: CreatePermissionCheckArgs['documents'] = [];
    if (resourceIndex === '*') {
      for (const resource of part.consumeResources) {
        documents.push({uuid: resource.calc$.uuid, permission: 'OWNER', security: true});
      }
    } else {
      documents.push({uuid: part.consumeResources[resourceIndex].calc$.uuid, permission: 'OWNER', security: true});
    }
    return {documents: documents};
  })
  private static applyOrUndo = new Action<ChatPartIdData & {action: 'manual-apply' | 'undo'; resourceIndex: number | '*';}>('ResourceCardApplyOrUndo')
    .addSerializer(ItemCardHelpers.getRawSerializer('action'))
    .addSerializer(ItemCardHelpers.getRawSerializer('resourceIndex'))
    .addSerializer(ItemCardHelpers.getRawSerializer('messageId'))
    .addSerializer(ItemCardHelpers.getUserIdSerializer())
    .addEnricher(ItemCardHelpers.getChatEnricher())
    .setPermissionCheck(ResourceCardComponent.permissionCheck)
    .build(async ({resourceIndex, cardParts, messageId, action}) => {
      const part = cardParts.getTypeData(ResourceCardPart.instance);
      const consumeResources: ResourceCardData['consumeResources'] = [];
      if (resourceIndex === '*') {
        for (const consumeResource of part.consumeResources) {
          consumeResources.push(consumeResource)
        }
      } else if (part.consumeResources.length >= resourceIndex-1) {
        consumeResources.push(part.consumeResources[resourceIndex]);
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
        request.messageDataById.set(messageId, getMessageState(cardParts));
        for (const change of changed) {
          request.resources.push({
            messageId: messageId,
            resource: change,
          })
        }

        await applyResourceConsumption(request);
        return ModularCard.writeModuleCard(game.messages.get(messageId), cardParts);
      }
    })
  //#endregion

  public static getSelector(): string {
    return `${staticValues.code}-resource-part`;
  }

  public localeResources = game.i18n.localize('Resources');
  public localeUses = game.i18n.localize('DND5E.Uses');
  public consumeResources: Array<ResourceCardData['consumeResources'][number] & {label: string; state: 'applied' | 'partial-applied' | 'not-applied'}> = [];
  public allConsumeResourcesApplied = false;
  
  public onInit(args: OnInitParam) {
    args.addStoppable(
      this.getData<ResourceCardData>(ResourceCardPart.instance).switchMap(data => {
        return ValueReader.mergeObject({
          ...data,
          hasObserverPerm: UtilsDocument.hasAllPermissions([{permission: 'Observer', uuid: data.part.calc$.actorUuid, user: game.user}]),
        })
      })
      .listen(({part, hasObserverPerm}) => this.setData(part, hasObserverPerm))
    );
  }

  public apply(index: '*' | number) {
    ResourceCardComponent.applyOrUndo({
      messageId: this.messageId,
      resourceIndex: index,
      action: 'manual-apply',
    });
  }

  public undo(index: '*' | number) {
    ResourceCardComponent.applyOrUndo({
      messageId: this.messageId,
      resourceIndex: index,
      action: 'undo',
    });
  }

  private async setData(part: ResourceCardData, hasObserverPerm: boolean) {
    if (part) {
      if (hasObserverPerm) {
        this.consumeResources = part.consumeResources
          .filter(resource => {
            // Hide unused resources
            return resource.calc$.appliedChange !== 0 || resource.calc$.calcChange !== 0;
          })
          .map(resource => {
            let state: this['consumeResources'][number]['state'];
            if (resource.calc$.appliedChange === 0) {
              state = 'not-applied';
            } else if (resource.calc$.appliedChange === resource.calc$.calcChange) {
              state = 'applied';
            } else {
              state = 'partial-applied';
            }
            return {
              ...resource,
              label: ResourceCardComponent.translateUsage(resource),
              state: state,
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
        case 'system':
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
                const actorData = UtilsFoundry.getSystemData(actor);
                if (actorData?.resources[pathParts[2]].label) {
                  return actorData.resources[pathParts[2]].label;
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
    const itemData = UtilsFoundry.getSystemData(item);
    
    // TODO this is currently hard coded, would be nice if it could be extended
    // Consume actor resources
    if (actor) {
      const spellSlot = item.type === "spell" && itemData.level > 0 && ItemCardHelpers.spellUpcastModes.includes(itemData.preparation.mode);
      if (spellSlot) {
        let spellPropertyName = itemData.preparation.mode === "pact" ? "pact" : `spell${itemData.level}`;
        data.consumeResources.push({
          consumeResourcesAction: 'auto',
          calc$: {
            uuid: actor.uuid,
            path: `system.spells.${spellPropertyName}.value`,
            calcChange: 1,
            appliedChange: 0,
          }
        });
      }
      
      switch (itemData.consume?.type) {
        case 'attribute': {
          if (itemData.consume.target && itemData.consume.amount > 0) {
            let propertyPath = `system.${itemData.consume.target}`;
            data.consumeResources.push({
              consumeResourcesAction: 'auto',
              calc$: {
                uuid: actor.uuid,
                path: propertyPath,
                calcChange: itemData.consume.amount,
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
      switch (itemData.consume?.type) {
        case 'ammo':
        case 'material': {
          if (itemData.consume?.target && itemData.consume.amount > 0) {
            const targetItem = item.actor.items.get(itemData.consume.target);
            let propertyPath = `system.quantity`;
            data.consumeResources.push({
              consumeResourcesAction: 'auto',
              calc$: {
                uuid: targetItem.uuid,
                path: propertyPath,
                calcChange: itemData.consume.amount,
                appliedChange: 0,
              }
            });
          }
          break;
        }
        case 'charges': {
          if (itemData.consume?.target && itemData.consume.amount > 0) {
            const targetItem = item.actor.items.get(itemData.consume.target);
            let propertyPath = `system.uses.value`;
            data.consumeResources.push({
              consumeResourcesAction: 'auto',
              calc$: {
                uuid: targetItem.uuid,
                path: propertyPath,
                calcChange: itemData.consume.amount,
                appliedChange: 0,
              }
            });
          }
          break;
        }
      }
      
      if (itemData.uses?.per != null && itemData.uses?.per != '') {
        let propertyPath = `system.uses.value`;
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
    const spellKeyRegex = /^data|system\.spells\.(?:pact|spell[0-9]+)\.value$/;
    let spellResource: ResourceCardData['consumeResources'][number];
    for (const resource of newData.consumeResources) {
      if (spellKeyRegex.exec(resource.calc$.path)) {
        spellResource = resource;
      }
      const key = `${resource.calc$.uuid}-${resource.calc$.path}`;
      newKeys.add(key);
      const original = originalResourcesByKey.get(key);
      if (original) {
        resource.calc$.appliedChange += original.calc$.appliedChange;
      }
    }

    const originalSpellResources: ResourceCardData['consumeResources'] = [];
    for (const [key, resource] of originalResourcesByKey.entries()) {
      if (!newKeys.has(key)) {
        let action = resource.consumeResourcesAction;
        if (spellResource && spellKeyRegex.exec(resource.calc$.path)) {
          originalSpellResources.push(resource);
          continue;
        }
        newData.consumeResources.push({
          consumeResourcesAction: action,
          calc$: {
            ...resource.calc$,
            calcChange: 0,
          }
        });
      }
    }

    let originalSpellAction: ResourceCardData['consumeResources'][number]['consumeResourcesAction'] = 'undo';
    for (const originalSpellResource of originalSpellResources) {
      if (originalSpellResource.calc$.calcChange !== 0) {
        originalSpellAction = originalSpellResource.consumeResourcesAction;
      }

      newData.consumeResources.push({
        consumeResourcesAction: 'undo',
        calc$: {
          ...originalSpellResource.calc$, // Undo old spell slot
          calcChange: 0,
        }
      });
    }

    // Transfer input from old spell to new
    if (spellResource) {
      spellResource.consumeResourcesAction = originalSpellAction;
    }

    return newData;
  }

  @RunOnce()
  public registerHooks(): void {
    ModularCard.registerModularCardTrigger(this, new ResourceTrigger());
    UtilsHooks.init().then(() => {
      if (UtilsFoundry.usesDocumentData()) {
        ModularCard.registerModularCardTrigger(this, new DowngradeConsumtionKeys());
      }
    })
    ModularCard.registerModularCardPart(staticValues.moduleName, this);
  }

  public getType(): string {
    return 'ResourceCardPart';
  }

  //#region Front end
  public getHtml(data: HtmlContext): string {
    return `<${ResourceCardComponent.getSelector()} data-message-id="${data.messageId}"></${ResourceCardComponent.getSelector()}>`
  }
  //#endregion

}

class ResourceTrigger implements ITrigger<ModularCardTriggerData<ResourceCardData>> {
  
  //#region upsert
  public async upsert(context: IAfterDmlContext<ModularCardTriggerData<ResourceCardData>>) {
    await this.applyConsumeResources(context);
  }
  
  private async applyConsumeResources(context: IAfterDmlContext<ModularCardTriggerData<ResourceCardData>>): Promise<void> {
    const applyRequest: ApplyResourceConsumptionRequest = {
      messageDataById: new Map(),
      resources: [],
    };
    for (const {newRow, oldRow} of context.rows) {
      const oldResourceByKey = new Map<string, ResourceCardData['consumeResources'][number]>();
      if (oldRow) {
        for (const consumeResource of oldRow.part.consumeResources) {
          oldResourceByKey.set(`${consumeResource.calc$.uuid}-${consumeResource.calc$.path}`, consumeResource);
        }
      }

      let originalResourceCount = applyRequest.resources.length;
      const newResourceByKey = new Map<string, ResourceCardData['consumeResources'][number]>();
      for (const consumeResource of newRow.part.consumeResources) {
        const key = `${consumeResource.calc$.uuid}-${consumeResource.calc$.path}`;
        const oldResource = oldResourceByKey.get(key);
        newResourceByKey.set(key, consumeResource);

        const changed = consumeResource.consumeResourcesAction !== (oldResource?.consumeResourcesAction || 'undo') ||
          consumeResource.calc$.calcChange != (oldResource?.calc$.calcChange || 0);

        if (changed || consumeResource.consumeResourcesAction == 'auto') {
          switch (consumeResource.consumeResourcesAction) {
            case 'auto': {
              applyRequest.resources.push({
                messageId: newRow.messageId,
                resource: consumeResource,
              });
              break;
            }
            case 'manual-apply': {
              if (consumeResource.calc$.calcChange !== consumeResource.calc$.appliedChange) {
                applyRequest.resources.push({
                  messageId: newRow.messageId,
                  resource: consumeResource,
                });
              }
              break;
            }
            case 'undo': {
              if (consumeResource.calc$.appliedChange !== 0) {
                applyRequest.resources.push({
                  messageId: newRow.messageId,
                  resource: consumeResource,
                });
              }
              break;
            }
          }
        }
      }

      for (const [key, oldResource] of oldResourceByKey.entries()) {
        if (!newResourceByKey.has(key)) {
          const oldClone = deepClone(oldResource);
          oldClone.consumeResourcesAction = 'undo';
          applyRequest.resources.push({
            messageId: oldRow.messageId,
            resource: oldClone,
          });
        }
      }
      
      if (originalResourceCount !== applyRequest.resources.length && !applyRequest.messageDataById.has(newRow.messageId)) {
        applyRequest.messageDataById.set(newRow.messageId, getMessageState(newRow.allParts));
      }
    }

    if (applyRequest.resources.length > 0) {
      await applyResourceConsumption(applyRequest);
    }
  }
  //#endregion

}

class DowngradeConsumtionKeys implements ITrigger<ModularCardTriggerData<ResourceCardData>> {
  
  //#region upsert
  public beforeUpsert(context: IAfterDmlContext<ModularCardTriggerData<ResourceCardData>>): void {
    for (const {newRow} of context.rows) {
      for (const consumeResource of newRow.part.consumeResources) {
        if (consumeResource.calc$.path.startsWith('system.')) {
          consumeResource.calc$.path = 'data.' + consumeResource.calc$.path.substring(7)
        }
      }
    }
  }
  //#endregion

}