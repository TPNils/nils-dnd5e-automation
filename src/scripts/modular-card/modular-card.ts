import { ChatMessageDataConstructorData } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/data/data.mjs/chatMessageData";
import { DmlTrigger, IDmlContext, IDmlTrigger, ITrigger, IUnregisterTrigger } from "../lib/db/dml-trigger";
import { TransformTrigger } from "../lib/db/transform-trigger";
import { RunOnce } from "../lib/decorator/run-once";
import { staticValues } from "../static-values";
import { MyActor, MyItem } from "../types/fixed-types";
import { AttackCardPart } from "./attack-card-part";
import { DamageCardPart } from "./damage-card-part";
import { ModularCardPart } from "./modular-card-part";

export interface ModularCardPartData {
  readonly id: string;
  readonly type: string;
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

class ChatMessageTrigger implements IDmlTrigger<ChatMessage> {
  get type() {
    return ChatMessage;
  }

  public beforeUpsert(context: IDmlContext<ChatMessage>): void {
    for (const {newRow} of context.rows) {
      if (newRow == null) {
        continue;
      }
      if (Array.isArray(ModularCard.getCardPartDatas(newRow))) {
        newRow.data.content = `The ${staticValues.moduleName} module is required to render this message.`;
      }
    }
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

async function getHTML(this: ChatMessage, wrapped: (...args: any) => any, ...args: any[]): Promise<JQuery> {
  // Add client side rendering of the template, specific for the user.
  // Pro:
  // + This allows templates to be rendered specifically for the user (ex: based on permissions)
  // + and should also reduce network traffic (not sure how impactfull it actually is)
  // Con: 
  // - Extra CPU power required by the client
  // - Templates won't be shown properly once the module is uninstalled => would be an issue anyway, this might even be cleaner
  const clientTemplateData = ModularCard.getCardPartDatas(this);
  console.log(this, clientTemplateData)
  if (clientTemplateData) {
    try {
      this.data.update({content: await ModularCard.getHtml(clientTemplateData)});
    } catch (e) {
      console.error(e);

      let errorString: string;
      if (e instanceof Error) {
        errorString = `${e.name}: ${e.message}\n\n${e.stack}`;
      } else {
        errorString = String(e);
      }
      if (game.modules.get('bug-reporter')?.active) {
        const message = document.createElement('div');
        message.append(document.createTextNode("Internal error rendering the message."));
        const report = document.createElement('button');
        report.innerText = 'Please report the bug';
        report.setAttribute('onclick', `game.modules.get("bug-reporter").api.bugWorkflow("nils-automated-compendium", "Error rendering a message", "${errorString.replace(/"/g, '\\"').replace(/\n/g, '\\n')}")`)
        message.append(report);

        const wrapper = document.createElement('div');
        wrapper.append(message);
        this.data.update({content: wrapper.innerHTML});
      } else {
        const bugsUrl = game.modules.get(staticValues.moduleName).data.bugs;
        const message = document.createElement('div');
        message.append(document.createTextNode("Internal error rendering the message. Please "));
        const aUrl = document.createElement('a');
        aUrl.innerText = 'report the bug';
        aUrl.setAttribute('href', bugsUrl);
        aUrl.setAttribute('target', '_blank');
        aUrl.style.textDecoration = 'underline';
        message.append(aUrl);
        message.append(document.createTextNode(" with the follwoing message"));

        const errorNode = document.createElement('code');
        errorNode.style.maxHeight = '200px';
        errorNode.style.display = 'block';
        errorNode.style.overflowY = 'auto';
        errorNode.style.userSelect = 'text';
        errorNode.innerText = errorString;

        const wrapper = document.createElement('div');
        wrapper.append(message);
        wrapper.append(document.createElement('br'));
        wrapper.append(errorNode);
        this.data.update({content: wrapper.innerHTML});
      }
    }
  }

  return wrapped(args);
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

  public static async getDefaultItemParts(data: {actor?: MyActor, token?: TokenDocument, item: MyItem}): Promise<ModularCardPartData[]> {
    // TODO this is proof of concept, when finished to should dynamically assign which parts to use for creation
    let id = 0;
    const parts: ModularCardPartData[] = [];

    for (const part of AttackCardPart.create(data)) {
      parts.push({
        id: `${id++}`,
        type: AttackCardPart.name,
        data: part
      });
    }
    for (const part of DamageCardPart.create(data)) {
      parts.push({
        id: `${id++}`,
        type: DamageCardPart.name,
        data: part
      });
    }

    return parts;
  }
  
  public static async createCard(parts: ModularCardPartData[], insert: boolean = true): Promise<ChatMessage> {
    const chatMessageData: ChatMessageDataConstructorData = {
      flags: {
        [staticValues.moduleName]: {
          modularCardData: parts,
        }
      }
    };

    if (game.settings.get('core', 'rollMode') === 'gmroll') {
      chatMessageData.whisper = [game.userId];
      for (const user of game.users.values()) {
        if (user.isGM) {
          chatMessageData.whisper.push(user.id);
        }
      }
    }
    if (game.settings.get('core', 'rollMode') === 'blindroll') {
      for (const user of game.users.values()) {
        chatMessageData.whisper = [];
        chatMessageData.blind = true;
        if (user.isGM) {
          chatMessageData.whisper.push(user.id);
        }
      }
    }
    if (game.settings.get('core', 'rollMode') === 'selfroll') {
      chatMessageData.whisper = [game.userId];
    }

    if (insert) {
      return await ChatMessage.create(chatMessageData)
    } else {
      return new ChatMessage(chatMessageData);
    }
  }
  
  @RunOnce()
  public static registerHooks(): void {
    // Register message => part transformer
    DmlTrigger.registerTrigger(chatMessageTransformer);
    chatMessageTransformer.register(new TriggerMessagePart());
    
    // Override render behaviour
    DmlTrigger.registerTrigger(new ChatMessageTrigger());
    Hooks.on('setup', () => {
      libWrapper.register(staticValues.moduleName, 'ChatMessage.prototype.getHTML', getHTML, 'WRAPPER');
    });
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
      if (typeof part.html !== 'string' || part.html === '') {
        continue;
      }
      htmlParts.push(`<div data-${staticValues.moduleName}-card-part="${part.id}">`);
      htmlParts.push(TextEditor.enrichHTML(part.html, enrichOptions as any))
      htmlParts.push(`</div>`);
    }
    return htmlParts.join('');
  }

}