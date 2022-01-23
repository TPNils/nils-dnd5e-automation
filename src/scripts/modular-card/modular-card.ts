import { DmlTrigger, IDmlContext, IDmlTrigger, ITrigger, IUnregisterTrigger } from "../lib/db/dml-trigger";
import { TransformTrigger } from "../lib/db/transform-trigger";
import { RunOnce } from "../lib/decorator/run-once";
import { staticValues } from "../static-values";
import { ModularCardPart } from "./modular-card-part";

export interface ModularCardPartData {
  id: string;
  type: string;
  data: any;
}

export interface ModularCardTriggerData extends ModularCardPartData {
  messageId: string;
}

class ChatMessageTransformer extends TransformTrigger<ChatMessage, ModularCardTriggerData> implements IDmlTrigger<ChatMessage> {

  constructor() {
    super(ChatMessageTransformer.transformFunc);
  }

  get type(): typeof ChatMessage {
    return ChatMessage;
  }

  private static transformFunc(from: ChatMessage): {uniqueKey: string, data: ModularCardTriggerData} | Array<{uniqueKey: string, data: ModularCardTriggerData}> {
    const parts = ModularCard.getCardPartDatas(from);
    if (!Array.isArray(parts)) {
      return [];
    }
    
    return parts.map(p => {
      return {
        uniqueKey: `${from.uuid}.${p.id}`,
        data: {
          ...p,
          messageId: from.id
        }
      }
    });
  }
  
}

class TriggerMessagePart implements ITrigger<ModularCardPartData> {

  public beforeUpdate(context: IDmlContext<ModularCardPartData>): boolean {
    if (this.finalFields(context) === false) {
      return false;
    }
    return true;
  }

  public beforeDelete(context: IDmlContext<ModularCardPartData>): boolean | void {
    /*
    TODO Does this even matter?
     CardParts in this foundry module should be build in a way to support this.
     But can I expect other modules who might want to integratie to also 
    for (const {oldRow} of context.rows) {
      console.error(`Can't delete message parts.`)
      return false;
    }
    */
  }
  
  private finalFields(context: IDmlContext<ModularCardPartData>): boolean {
    for (const {newRow, oldRow} of context.rows) {
      if (newRow.type !== oldRow?.type) {
        console.error(`Can't change the type of part and retain the same id.`)
        return false;
      }
    }

    return true;
  }
  
}

const chatMessageTransformer = new ChatMessageTransformer();

export class ModularCard {

  private static registeredPartsByType = new Map<string, {part: ModularCardPart, unregisterTrigger: IUnregisterTrigger}>();
  private static typeToModule = new Map<string, string>();
  public static registerModularCardPart(moduleName: string, part: ModularCardPart): void {
    if (ModularCard.registeredPartsByType.has(part.getType())) {
      console.info(`ModularCardPart type "${part.getType()}" from module ${ModularCard.typeToModule.get(part.getType())} gets overwritten by module ${moduleName}`);
      ModularCard.registeredPartsByType.get(part.getType()).unregisterTrigger.unregister();
    }
    const unregisterTrigger = chatMessageTransformer.register(part);
    ModularCard.registeredPartsByType.set(part.getType(), {part: part, unregisterTrigger: unregisterTrigger});
    ModularCard.typeToModule.set(part.getType(), moduleName);
  }
  
  @RunOnce()
  public static registerHooks(): void {
    DmlTrigger.registerTrigger(chatMessageTransformer);
    chatMessageTransformer.register(new TriggerMessagePart())
  }

  public static getCardPartDatas(message: ChatMessage): Array<ModularCardPartData> | null {
    if (message == null) {
      return null;
    }
    return (message.getFlag(staticValues.moduleName, 'modularCardData') as any);
  }

  public static setCardPartDatas(message: ChatMessage, data: Array<ModularCardPartData>): Promise<ChatMessage> {
    if (message == null) {
      return Promise.resolve(message);
    }
    return message.setFlag(staticValues.moduleName, 'modularCardData', data);
  }

  public static async getHtml(parts: ModularCardPartData[]): Promise<string> {
    const htmlParts$: Array<{html: string, id: string} | Promise<{html: string, id: string}>> = [];
    for (const partData of parts) {
      if (!ModularCard.registeredPartsByType.has(partData.type)) {
        console.error(`Could not render ModularCardPart ${partData.type} of module ${ModularCard.typeToModule.get(partData.type)}`);
        // Don't throw(?), what if a module extention got disabled
        continue;
      }

      // TODO error handeling during render
      const htmlPart = ModularCard.registeredPartsByType.get(partData.type).part.getHtml({partId: partData.id, data: partData});
      if (htmlPart instanceof Promise) {
        htmlParts$.push(htmlPart.then(html => {return {html: html, id: partData.id}}));
      } else {
        htmlParts$.push({html: htmlPart, id: partData.id});
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

}