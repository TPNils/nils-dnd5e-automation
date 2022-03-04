import { DmlTrigger, IAfterDmlContext, IDmlContext, IDmlTrigger } from "../lib/db/dml-trigger";
import { UtilsDocument } from "../lib/db/utils-document";
import { RunOnce } from "../lib/decorator/run-once";
import MyAbilityTemplate from "../pixi/ability-template";
import { staticValues } from "../static-values";
import { MyActor, MyItem, MyItemData } from "../types/fixed-types";
import { UtilsTemplate } from "../utils/utils-template";
import { ModularCard, ModularCardPartData, ModularCardTriggerData } from "./modular-card";
import { createPermissionCheck, CreatePermissionCheckArgs, HtmlContext, ICallbackAction, ModularCardPart } from "./modular-card-part";

interface TemplateCardData {
  calc$: {
    actorUuid: string;
    createdTemplateUuid?: string;
    target: MyItemData['data']['target'];
  }
}

export class TemplateCardPart implements ModularCardPart<TemplateCardData> {

  public static readonly instance = new TemplateCardPart();
  private constructor(){}
  
  public generate({item, actor}: {item: MyItem, actor?: MyActor}): TemplateCardData[] {
    // @ts-expect-error
    const hasAoe = CONFIG.DND5E.areaTargetTypes.hasOwnProperty(item.data.data.target.type);
    if (!hasAoe) {
      return [];
    }
    return [{
      calc$: {
        actorUuid: actor?.uuid,
        target: item.data.data.target,
      }
    }];
  }

  @RunOnce()
  public registerHooks(): void {
    ModularCard.registerModularCardPart(staticValues.moduleName, this);
    DmlTrigger.registerTrigger(new DmlTriggerTemplate());
  }

  public getType(): string {
    return this.constructor.name;
  }

  public getHtml(context: HtmlContext<TemplateCardData>): string | Promise<string> {
    return renderTemplate(
      `modules/${staticValues.moduleName}/templates/modular-card/template-part.hbs`, {
        data: context.data,
        moduleName: staticValues.moduleName
      }
    );
  }

  public getCallbackActions(): ICallbackAction<TemplateCardData>[] {
    const permissionCheck = createPermissionCheck<TemplateCardData>(({data}) => {
      const documents: CreatePermissionCheckArgs['documents'] = [];
      if (data.calc$.actorUuid) {
        documents.push({uuid: data.calc$.actorUuid, permission: 'OWNER'});
      }
      return {documents: documents};
    })

    return [
      {
        regex: /^item-template$/,
        permissionCheck: permissionCheck,
        execute: ({data, messageId, partId}) => TemplateCardPart.processItemTemplate(data, messageId, partId),
      }
    ]
  }
  
  private static async processItemTemplate(data: TemplateCardData, messageId: string, partId: string): Promise<void> {
    // TODO
    // if (!InternalFunctions.canChangeTargets(messageData.items[itemIndex])) {
    //   return;
    // }

    const template = MyAbilityTemplate.fromItem({
      target: data.calc$.target,
      flags: {
        [staticValues.moduleName]: {
          dmlCallbackMessageId: messageId,
          dmlCallbackPartId: partId,
        }
      }
    });
    template.drawPreview();
  }

  public afterCreate(context: IAfterDmlContext<ModularCardTriggerData>): void | Promise<void> {
    for (const row of context.rows) {
      if (row.newRow.type === this.getType()) {
        // Initiate measured template creation
        const template = MyAbilityTemplate.fromItem({
          target: (row.newRow.data as TemplateCardData).calc$.target,
          flags: {
            [staticValues.moduleName]: {
              dmlCallbackMessageId: row.newRow.messageId,
              dmlCallbackPartId: row.newRow.id,
            }
          }
        });
        if (template) {
          template.drawPreview();
          return;
        }
      }
    }
  }

}


class DmlTriggerTemplate implements IDmlTrigger<MeasuredTemplateDocument> {

  get type(): typeof MeasuredTemplateDocument {
    return MeasuredTemplateDocument;
  }
  
  public async afterUpsert(context: IDmlContext<MeasuredTemplateDocument>): Promise<void> {
    const updateChatMessageMap = new Map<string, ModularCardPartData[]>();
    const deleteTemplateUuids = new Set<string>();
    for (const {newRow: newTemplate, oldRow: oldTemplate, changedByUserId} of context.rows) {
      if (game.userId !== changedByUserId) {
        continue;
      }
      const messageId = newTemplate.getFlag(staticValues.moduleName, 'dmlCallbackMessageId') as string;
      if (!messageId || !game.messages.has(messageId)) {
        continue;
      }
      const chatMessage = game.messages.get(messageId);
      const parts = updateChatMessageMap.has(messageId) ? updateChatMessageMap.get(messageId) : deepClone(ModularCard.getCardPartDatas(chatMessage));
      if (parts == null) {
        continue;
      }

      const partId = newTemplate.getFlag(staticValues.moduleName, 'dmlCallbackPartId') as string;
      let part: ModularCardPartData<TemplateCardData> = parts.find(part => part.id === partId && part.type === 'TemplateCardPart');
      if (!part) {
        continue;
      }

      if (part.data.calc$.createdTemplateUuid !== newTemplate.uuid) {
        deleteTemplateUuids.add(part.data.calc$.createdTemplateUuid);
        
        part.data.calc$.createdTemplateUuid = newTemplate.uuid;
        updateChatMessageMap.set(chatMessage.id, parts);
      }

      if (newTemplate.data.x !== oldTemplate?.data?.x || newTemplate.data.y !== oldTemplate?.data?.y) {
        const templateDetails = UtilsTemplate.getTemplateDetails(newTemplate);
        const scene = newTemplate.parent;
        const newTargets: {uuid: string}[] = [];
        for (const token of scene.getEmbeddedCollection('Token').values() as Iterable<TokenDocument>) {
          if (UtilsTemplate.isTokenInside(templateDetails, token, true)) {
            newTargets.push({uuid: token.uuid});
          }
        }
        // TODO set targets
        console.log('new targets: ', Array.from(((await UtilsDocument.tokenFromUuid(newTargets.map(t => t.uuid))).values())).map(token => token.name));
      }
    }

    for (const [chatMessageId, parts] of updateChatMessageMap.entries()) {
      await ModularCard.setCardPartDatas(game.messages.get(chatMessageId), parts);
    }

    deleteTemplateUuids.delete(null);
    deleteTemplateUuids.delete(undefined);
    if (deleteTemplateUuids.size > 0) {
      await UtilsDocument.fromUuid(deleteTemplateUuids).then(docs => {
        for (const doc of docs.values()) {
          doc.delete();
        }
      });
    }
  }

}