import { IDmlContext, IDmlTrigger } from "../lib/db/dml-trigger";
import { staticValues } from "../static-values";
import { ModularCardPart } from "./modular-card-part";

export class ModularCard {

  private readonly partsById = new Map<string, ModularCardPart>();
  private readonly orderedPartIds: string[] = [];

  constructor(
    parts: ReadonlyArray<ModularCardPart>,
  ) {
    for (const part of parts) {
      if (this.partsById.has(part.getId())) {
        throw new Error(`duplicate id detected: ${part.getId()}`)
      } else {
        this.orderedPartIds.push(part.getId());
        this.partsById.set(part.getId(), part);
      }
    }

    for (const part of this.partsById.values()) {
      part.afterCardInit(this);
    }
  }

  public static getCardPartDatas(message: ChatMessage): Array<{id: string, data: any, type: string}> | null {
    if (message == null) {
      return null;
    }
    return (message.getFlag(staticValues.moduleName, 'modularCardData') as any);
  }

  public static toPartDmlContext(context: IDmlContext<ChatMessage>): PartDmlContext {
    const partContext: Array<PartDmlContext['parts'][0]> = [];
    for (const {newRow, oldRow, changedByUserId, options} of context.rows) {
      const newPartsMap = new Map<string, PartDmlContext['parts'][0]['newPart']>()
      const oldPartsMap = new Map<string, PartDmlContext['parts'][0]['oldPart']>()
      const newParts = ModularCard.getCardPartDatas(newRow);
      const oldParts = ModularCard.getCardPartDatas(oldRow);
  
      if (Array.isArray(newParts)) {
        for (const part of newParts) {
          newPartsMap.set(part.id, part);
        }
      }
      if (Array.isArray(oldParts)) {
        for (const part of oldParts) {
          oldPartsMap.set(part.id, part);
        }
      }
  
      for (const [id, part] of newPartsMap.entries()) {
        partContext.push({
          newPart: part,
          oldPart: oldPartsMap.get(id),
          changedByUserId: changedByUserId,
          options: options,
          messageId: newRow.id,
        })
      }
      
      for (const [id, part] of oldPartsMap.entries()) {
        if (!newPartsMap.has(id)) {
          partContext.push({
            oldPart: part,
            changedByUserId: changedByUserId,
            options: options,
            messageId: newRow.id,
          })
        }
      }
    }
    return {parts: partContext};
  }

  public async getHtml(): Promise<string> {
    // TODO error handeling

    const htmlParts$: Array<{html: string, id: string} | Promise<{html: string, id: string}>> = [];
    for (const partId of this.orderedPartIds) {
      const htmlPart = this.getPartFromId(partId).getHtml();
      if (htmlPart instanceof Promise) {
        htmlParts$.push(htmlPart.then(html => {return {html: html, id: partId}}));
      } else {
        htmlParts$.push({html: htmlPart, id: partId});
      }
    }

    const enrichOptions: Partial<Parameters<typeof TextEditor['enrichHTML']>[1]> = {};
    if (game.user.isGM) {
      enrichOptions.secrets = true;
    }
    const htmlParts: string[] = [];
    for (const part of await Promise.all(htmlParts$)) {
      if (typeof part.html === 'string' && part.html !== '') {
        continue;
      }
      htmlParts.push(`<div data-${staticValues.moduleName}-card-part="${part.id}">`);
      htmlParts.push(TextEditor.enrichHTML(part.html, enrichOptions as any))
      htmlParts.push(`</div>`);
    }
    return htmlParts.join('');
  }

  public getPartFromId<T>(id: string): ModularCardPart<T> | null {
    return this.partsById.get(id);
  }

  public getPartFromType<T>(type: string): ModularCardPart<T> | null {
    const parts = this.getPartsByType().get(type);
    if (parts != null && parts.length > 0) {
      return parts[0];
    }
    return null;
  }

  public getPartsFromType<T>(type: string): ModularCardPart<T>[] {
    return this.getPartsByType().get(type) ?? [];
  }

  private partsByType: Map<string, ModularCardPart[]>;
  private getPartsByType(): Map<string, ModularCardPart[]> {
    if (!this.partsByType) {
      for (const part of this.partsById.values()) {
        if (!this.partsByType.has(part.getType())) {
          this.partsByType.set(part.getType(), []);
        }
        this.partsByType.get(part.getType()).push(part);
      }
    }
    return this.partsByType;
  }

}

export interface PartDmlContext {
  readonly parts: ReadonlyArray<{
    readonly newPart?: {readonly id: string; readonly type: string, data: any};
    readonly oldPart?: {readonly id: string; readonly type: string, data: any};
    readonly messageId: string;
    readonly changedByUserId: string;
    readonly options: any;
  }>;
}

class DmlTriggerChatMessage implements IDmlTrigger<ChatMessage> {

  get type(): typeof ChatMessage {
    return ChatMessage;
  }

  public beforeUpdate(context: IDmlContext<ChatMessage>): boolean {
    const partContext = ModularCard.toPartDmlContext(context);
    if (this.finalFields(partContext) === false) {
      return false;
    }
    return true;
  }
  
  private finalFields(context: PartDmlContext): boolean {
    for (const {newPart, oldPart} of context.parts) {
      /*
       TODO Does this even matter?
        CardParts in this foundry module should be build in a way to support this.
        But can I expect other modules who might want to integratie to also 
      if (!newPart && oldPart) {
        console.error(`Can't delete message parts.`)
        return false;
      }
      */
      if (!newPart || !oldPart) {
        continue;
      }
      if (newPart.type !== oldPart?.type) {
        console.error(`Can't change the type of part and retain the same id.`)
        return false;
      }
    }

    return true;
  }
  
}