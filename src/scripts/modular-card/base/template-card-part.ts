import { DmlTrigger, ITrigger, IAfterDmlContext, IDmlTrigger, IDmlContext } from "../../lib/db/dml-trigger";
import { UtilsDocument } from "../../lib/db/utils-document";
import { RunOnce } from "../../lib/decorator/run-once";
import { Component, OnInit, OnInitParam } from "../../lib/render-engine/component";
import { UtilsCompare } from "../../lib/utils/utils-compare";
import MyAbilityTemplate from "../../pixi/ability-template";
import { ValueReader } from "../../provider/value-provider";
import { staticValues } from "../../static-values";
import { MyItemData } from "../../types/fixed-types";
import { UtilsTemplate } from "../../utils/utils-template";
import { ModularCard, ModularCardTriggerData, ModularCardInstance } from "../modular-card";
import { ModularCardPart, ModularCardCreateArgs, HtmlContext } from "../modular-card-part";
import { BaseCardComponent } from "./base-card-component";
import { TargetCardData, TargetCardPart, uuidsToSelected } from "./target-card-part";

export interface TemplateCardData {
  calc$: {
    actorUuid: string;
    tokenUuid?: string;
    createdTemplateUuid?: string;
    target: MyItemData['data']['target'];
    rangeUnit?: MyItemData['data']['range']['units'];
  }
}

@Component({
  tag: TemplateCardComponent.getSelector(),
  html: /*html*/`
  <div class="section">
    <button data-action="item-template" [disabled]="!this.hasPermission" (click)="this.startPlace()">
      {{this.placeTemplateLocale}}
    </button> 
  </div>
  `,
  style: /*css*/`
    .section {
      margin: 5px 0;
    }
  `
})
export class TemplateCardComponent extends BaseCardComponent implements OnInit {

  public static getSelector(): string {
    return `${staticValues.code}-template-part`;
  }

  public placeTemplateLocale = game.i18n.localize('DND5E.PlaceTemplate');
  public onInit(args: OnInitParam) {
    args.addStoppable(
      this.getData<TemplateCardData>(TemplateCardPart.instance)
        .switchMap(data => {
          return ValueReader.mergeObject({
            ...data,
            hasPermission: UtilsDocument.hasAllPermissions([{uuid: data.part.calc$.actorUuid, permission: 'Owner', user: game.user}]),
          })
        })
        .listen(data => this.setData(data.part, data.hasPermission))
    );
  }

  public hasPermission = false;
  private target: TemplateCardData['calc$']['target'];
  private async setData(part: TemplateCardData, hasPermission: boolean) {
    if (part) {
      this.hasPermission = this.hasPermission;
      this.target = part.calc$.target;
    } else {
      this.hasPermission = false;
    }
  }

  public startPlace() {
    const template = MyAbilityTemplate.fromItem({
      target: this.target,
      flags: {
        [staticValues.moduleName]: {
          dmlCallbackMessageId: this.messageId,
        }
      }
    });
    // TODO area of Minor Illlusion (Caspian) is too big with XGE area (did not test default)
    if ((template as MyAbilityTemplate)?.drawPreview) {
      (template as MyAbilityTemplate).drawPreview();
    }
  }

}

export class TemplateCardPart implements ModularCardPart<TemplateCardData> {

  public static readonly instance = new TemplateCardPart();
  private constructor(){}
  
  public create({item, actor, token}: ModularCardCreateArgs): TemplateCardData {
    // @ts-expect-error
    const hasAoe = CONFIG.DND5E.areaTargetTypes.hasOwnProperty(item.data.data.target?.type);
    if (!hasAoe) {
      return null;
    }
    return {
      calc$: {
        actorUuid: actor?.uuid,
        tokenUuid: token?.uuid,
        target: item.data.data.target,
        rangeUnit: item.data.data.range?.units
      }
    };
  }

  public refresh(oldData: TemplateCardData, args: ModularCardCreateArgs): TemplateCardData {
    const newData = this.create(args);

    if (!newData) {
      return null;
    }
    if (!oldData) {
      return newData;
    }

    // Retain template link
    newData.calc$.createdTemplateUuid = oldData.calc$.createdTemplateUuid;

    return newData;
  }

  @RunOnce()
  public registerHooks(): void {
    ModularCard.registerModularCardPart(staticValues.moduleName, this);
    ModularCard.registerModularCardTrigger(this, new TemplateCardTrigger());
    DmlTrigger.registerTrigger(new DmlTriggerTemplate());
  }

  public getType(): string {
    return 'TemplateCardPart';
  }

  //#region Front end
  public getHtml(data: HtmlContext): string {
    return `<${TemplateCardComponent.getSelector()} data-message-id="${data.messageId}"></${TemplateCardComponent.getSelector()}>`
  }
  //#endregion

}

class TemplateCardTrigger implements ITrigger<ModularCardTriggerData<TemplateCardData>> {

  //#region afterCreate
  public async afterCreate(context: IAfterDmlContext<ModularCardTriggerData<TemplateCardData>>): Promise<void> {
    await this.createTemplatePreview(context);
  }

  private async createTemplatePreview(context: IAfterDmlContext<ModularCardTriggerData<TemplateCardData>>): Promise<void> {
    for (const {newRow, changedByUserId} of context.rows) {
      if (!this.isThisTriggerType(newRow)) {
        continue;
      }
      if (changedByUserId !== game.userId) {
        continue;
      }
      // Initiate measured template creation
      const template = MyAbilityTemplate.fromItem({
        target: newRow.part.calc$.target,
        flags: {
          [staticValues.moduleName]: {
            dmlCallbackMessageId: newRow.messageId,
          }
        }
      });
      // Auto place circle templates with range self
      if (newRow.part.calc$.tokenUuid && newRow.part.calc$.rangeUnit === 'self' && template.document.data.t === 'circle') {
        const token = await UtilsDocument.tokenFromUuid(newRow.part.calc$.tokenUuid);
        if (token) {
          template.document.data.update({
            x: token.data.x + (token.data.width * token.parent.data.grid / 2),
            y: token.data.y + (token.data.height * token.parent.data.grid / 2),
          })
          UtilsDocument.bulkCreate([template.document]);
          return;
        }
      }
      // Manually place template
      if (template && (template as MyAbilityTemplate).drawPreview) {
        (template as MyAbilityTemplate).drawPreview();
        return;
      }
    }
  }
  //#endregion
  
  //#region afterDelete
  public async afterDelete(context: IAfterDmlContext<ModularCardTriggerData<TemplateCardData>>): Promise<void> {
    await this.deleteTemplates(context);
  }

  private async deleteTemplates(context: IAfterDmlContext<ModularCardTriggerData<TemplateCardData>>): Promise<void> {
    const templateUuids = new Set<string>();
    for (const {oldRow, changedByUserId} of context.rows) {
      if (!this.isThisTriggerType(oldRow) || game.userId !== changedByUserId) {
        continue;
      }

      templateUuids.add(oldRow.part.calc$.createdTemplateUuid)
    }
    templateUuids.delete(null);
    templateUuids.delete(undefined);

    if (templateUuids.size === 0) {
      return;
    }

    await UtilsDocument.bulkDelete(templateUuids);
  }
  //#endregion

  //#region helpers
  private isThisTriggerType(row: ModularCardTriggerData): row is ModularCardTriggerData<TemplateCardData> {
    return row.typeHandler instanceof TemplateCardPart;
  }
  //#endregion

}

class DmlTriggerTemplate implements IDmlTrigger<MeasuredTemplateDocument> {

  get type(): typeof MeasuredTemplateDocument {
    return MeasuredTemplateDocument;
  }
  
  public async afterUpsert(context: IDmlContext<MeasuredTemplateDocument>): Promise<void> {
    const updateChatMessageMap = new Map<string, ModularCardInstance>();
    const deleteTemplateUuids = new Set<string>();
    for (const {newRow: newTemplate, oldRow: oldTemplate, changedByUserId} of context.rows) {
      const messageId = newTemplate.getFlag(staticValues.moduleName, 'dmlCallbackMessageId') as string;
      if (!messageId || !game.messages.has(messageId)) {
        continue;
      }
      const chatMessage = game.messages.get(messageId);
      const parts = updateChatMessageMap.has(messageId) ? updateChatMessageMap.get(messageId) : ModularCard.getCardPartDatas(chatMessage).deepClone();
      if (parts == null) {
        continue;
      }
      
      const executingUserCanModify = chatMessage.canUserModify(game.users.get(changedByUserId), 'update');
      if (executingUserCanModify) {
        if (game.userId !== changedByUserId) {
          // User can edit message => user should edit message
          continue;
        }
      } else {
        // User can't edit message => find someone who can.
        // Order doesn't really matter, what is important is that every client selects the same one
        const firstUserWithEditPermissions = Array.from(game.users.values()).sort((a, b) => a.id.localeCompare(b.id)).find(user => user.active && chatMessage.canUserModify(user, 'update'));
        if (!firstUserWithEditPermissions) {
          // To bad I guess.
          continue;
        }
        if (game.userId !== firstUserWithEditPermissions.id) {
          continue;
        }
      }

      let templatePart = parts.getTypeData<TemplateCardData>(TemplateCardPart.instance)
      let targetPart = parts.getTypeData<TargetCardData>(TargetCardPart.instance)
      if (!templatePart || !targetPart) {
        continue;
      }

      if (templatePart.calc$.createdTemplateUuid !== newTemplate.uuid) {
        deleteTemplateUuids.add(templatePart.calc$.createdTemplateUuid);
        
        templatePart.calc$.createdTemplateUuid = newTemplate.uuid;
        updateChatMessageMap.set(chatMessage.id, parts);
      }

      if (newTemplate.data.x !== oldTemplate?.data?.x || newTemplate.data.y !== oldTemplate?.data?.y) {
        const templateDetails = UtilsTemplate.getTemplateDetails(newTemplate);
        const scene = newTemplate.parent;
        const newTargets = new Set<string>();
        for (const token of scene.getEmbeddedCollection('Token').values() as Iterable<TokenDocument>) {
          if (UtilsTemplate.isTokenInside(templateDetails, token, true)) {
            newTargets.add(token.uuid);
          }
        }
        const targets = Array.from(newTargets).sort();
        if (!UtilsCompare.deepEquals(targetPart.selected.map(s => s.tokenUuid).sort(), targets)) {
          targetPart.selected = uuidsToSelected(targets);
          updateChatMessageMap.set(chatMessage.id, parts);
        }
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