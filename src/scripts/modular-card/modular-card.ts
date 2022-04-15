import { ChatMessageDataConstructorData } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/data/data.mjs/chatMessageData";
import { DmlTrigger, IAfterDmlContext, IDmlContext, IDmlTrigger, ITrigger } from "../lib/db/dml-trigger";
import { TransformTrigger } from "../lib/db/transform-trigger";
import { RunOnce } from "../lib/decorator/run-once";
import { Stoppable } from "../lib/utils/stoppable";
import { UtilsCompare } from "../lib/utils/utils-compare";
import { UtilsObject } from "../lib/utils/utils-object";
import { staticValues } from "../static-values";
import { MyActor, MyItem } from "../types/fixed-types";
import { ActiveEffectCardPart } from "./active-effect-card-part";
import { AttackCardPart } from "./attack-card-part";
import { CheckCardPart } from "./check-card-part";
import { DamageCardPart } from "./damage-card-part";
import { DescriptionCardPart } from "./description-card-part";
import { LayOnHandsCardPart } from "./features/lay-on-hands-card-part";
import { ModularCardPart } from "./modular-card-part";
import { PropertyCardPart } from "./property-card-part";
import { ResourceCardPart } from "./resources-card-part";
import { SpellLevelCardPart } from "./spell-level-card-part";
import { TargetCardPart } from "./target-card-part";
import { TemplateCardPart } from "./template-card-part";

export interface ModularCardPartData<T = any> {
  readonly id: string;
  readonly type: string;
  data: T;
}

export interface ModularCardTriggerData<T = any> extends ModularCardPartData<T> {
  readonly messageId: string;
  readonly typeHandler: ModularCardPart<T>;
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
          messageId: from.id,
          typeHandler: ModularCard.getTypeHandler(p.type),
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
  
  public beforeUpdate(context: IDmlContext<ChatMessage>): boolean | void {
    const log = document.querySelector("#chat-log");
    const isAtBottom = Math.abs(log.scrollHeight - (log.scrollTop + log.getBoundingClientRect().height)) < 2;
    if (isAtBottom) {
      for (const row of context.rows) {
        row.options['chatIsAtBottom'] = true;
      }
    }
  }

  public afterUpdate(context: IAfterDmlContext<ChatMessage>): void {
    const isAtBottom = context.rows.some(row => row.options['chatIsAtBottom'] === true);
    if (isAtBottom) {
      setTimeout(() => {
        (ui.chat as any).scrollBottom();
      }, 0);
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
  if (clientTemplateData) {
    try {
      this.data.update({content: await ModularCard.getHtml(this.id, clientTemplateData)});
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

  private static registeredPartsByType = new Map<string, {part: ModularCardPart}>();
  private static typeToModule = new Map<string, string>();
  public static registerModularCardPart(moduleName: string, part: ModularCardPart): void {
    if (ModularCard.registeredPartsByType.has(part.getType())) {
      console.info(`ModularCardPart type "${part.getType()}" from module ${ModularCard.typeToModule.get(part.getType())} gets overwritten by module ${moduleName}`);
    }
    ModularCard.registeredPartsByType.set(part.getType(), {part: part});
    ModularCard.typeToModule.set(part.getType(), moduleName);
  }
  
  public static registerModularCardTrigger(trigger: ITrigger<ModularCardTriggerData>): Stoppable {
    // TODO this should only trigger for a specific part type => should be more effecient as more parts get added
    return chatMessageTransformer.register(trigger);
  }

  public static getTypeHandler<T extends ModularCardPart = ModularCardPart>(type: string): T | null {
    return ModularCard.registeredPartsByType.get(type).part as T;
  }

  public static async getDefaultItemParts(data: {actor?: MyActor, token?: TokenDocument, item: MyItem}): Promise<ModularCardPartData[]> {
    // TODO this is proof of concept, when finished to should dynamically assign which parts to use for creation
    let id = 0;
    const parts: Promise<{data: any, cardPart: ModularCardPart}>[] = [];

    const cardParts: ModularCardPart[] = [
      DescriptionCardPart.instance,
      SpellLevelCardPart.instance,
      AttackCardPart.instance,
      DamageCardPart.instance,
      TemplateCardPart.instance,
      ResourceCardPart.instance,
      CheckCardPart.instance,
      TargetCardPart.instance,
      ActiveEffectCardPart.instance,
      PropertyCardPart.instance,
    ];

    if (data.item.name === 'Lay on Hands') {
      cardParts[cardParts.indexOf(DamageCardPart.instance)] = LayOnHandsCardPart.instance;
    }
    
    for (const cardPart of cardParts) {
      const response = cardPart.create(data);
      if (response instanceof Promise) {
        parts.push(response.then(resp => ({data: resp, cardPart: cardPart})))
      } else {
        parts.push(Promise.resolve({data: response, cardPart: cardPart}));
      }
    }

    const response: ModularCardPartData[] = [];
    for (const part of await Promise.all(parts)) {
      if (part.data != null) {
        response.push({
          id: `${id++}`,
          data: part.data,
          type: part.cardPart.getType(),
        })
      }
    }
    return response;
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
      chatMessageData.whisper = [];
      chatMessageData.blind = true;
      for (const user of game.users.values()) {
        if (user.isGM) {
          chatMessageData.whisper.push(user.id);
        }
      }
    }
    if (game.settings.get('core', 'rollMode') === 'selfroll') {
      chatMessageData.whisper = [game.userId];
    }

    if (insert) {
      return await ChatMessage.createDocuments([chatMessageData]).then(documents => documents[0]);
    } else {
      return new ChatMessage(chatMessageData);
    }
  }

  public static isType<T>(modularCardPart: ModularCardPart<T>, data: ModularCardPartData): data is ModularCardPartData<T> {
    return ModularCard.getTypeHandler(data.type) instanceof modularCardPart.constructor;
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

    let cards: Array<ModularCardPartData> | {[key: string]: ModularCardPartData} = message.getFlag(staticValues.moduleName, 'modularCardData') as any;
    if (typeof cards === 'object' && !Array.isArray(cards)) {
      let cardsArray: Array<ModularCardPartData> = [];

      const keys = Object.keys(cards).map(Number).sort();
      for (const key of keys) {
        cardsArray.push(cards[key]);
      }

      cards = cardsArray;
    }
    return cards;
  }

  public static setCardPartDatas(message: ChatMessage, data: Array<ModularCardPartData>): Promise<ChatMessage> {
    if (message == null) {
      return Promise.resolve(message);
    }

    // Foundry change detection is not perfect.
    // If a single part of an array has been changed the whole array needs to be updated, this is not a problem with objects.
    // Ideally all arrays would be converted to object, but thats more complex and this solution will be fine for now.
    const cardsObj = {};
    if (data) {
      for (let i = 0; i < data.length; i++) {
        cardsObj[i] = data[i];
      }
    }
    const originalCards = message.getFlag(staticValues.moduleName, 'modularCardData');
    if (UtilsCompare.deepEquals(originalCards, cardsObj)) {
      return Promise.resolve(message);
    }
    UtilsObject.injectDeleteForDml(originalCards, cardsObj);
    
    return message.update({
      [`flags.${staticValues.moduleName}.modularCardData`]: cardsObj
    });
    //return message.setFlag(staticValues.moduleName, 'modularCardData', cardsObj);
  }

  public static async getHtml(messageId: string, parts: ModularCardPartData[]): Promise<string> {
    const htmlParts$: Array<{html: string, id: string} | Promise<{html: string, id: string}>> = [];
    for (const partData of parts) {
      if (!ModularCard.registeredPartsByType.has(partData.type)) {
        console.error(`Could not render ModularCardPart ${partData.type} of module ${ModularCard.typeToModule.get(partData.type)}`);
        // Don't throw(?), what if a module extention got disabled
        continue;
      }

      // TODO error handeling during render
      const typeHandler = ModularCard.getTypeHandler(partData.type);
      if (typeHandler?.getHtml) {
        const htmlPart = typeHandler.getHtml({messageId: messageId, partId: partData.id, data: partData.data, allMessageParts: parts});
        if (htmlPart instanceof Promise) {
          htmlParts$.push(htmlPart.then(html => {return {html: html, id: partData.id}}));
        } else if (typeof htmlPart === 'string') {
          htmlParts$.push({html: htmlPart, id: partData.id});
        }
      }
    }

    const enrichOptions: Partial<Parameters<typeof TextEditor['enrichHTML']>[1]> = {};
    if (game.user.isGM) {
      enrichOptions.secrets = true;
    }
    const htmlParts: string[] = [];
    htmlParts.push(`<div class="${staticValues.moduleName}-item-card">`);
    for (const part of await Promise.all(htmlParts$)) {
      if (typeof part.html !== 'string' || part.html === '') {
        continue;
      }
      // TODO should not have to be wrapped anymore
      htmlParts.push(`<div data-part-id="${part.id}">`);
      htmlParts.push(TextEditor.enrichHTML(part.html, enrichOptions as any))
      htmlParts.push(`</div>`);
    }
    htmlParts.push(`</div>`);
    return htmlParts.join('');
  }

}