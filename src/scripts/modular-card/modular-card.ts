import { ChatMessageDataConstructorData } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/data/data.mjs/chatMessageData";
import { DmlTrigger, IDmlContext, IDmlTrigger, ITrigger } from "../lib/db/dml-trigger";
import { TransformTrigger } from "../lib/db/transform-trigger";
import { UtilsDocument } from "../lib/db/utils-document";
import { RunOnce } from "../lib/decorator/run-once";
import { Component, ComponentElement } from "../lib/render-engine/component";
import { rerenderQueue } from "../lib/render-engine/virtual-dom/render-queue";
import { Stoppable } from "../lib/utils/stoppable";
import { UtilsCompare } from "../lib/utils/utils-compare";
import { UtilsObject } from "../lib/utils/utils-object";
import { staticValues } from "../static-values";
import { MyActor, MyItem } from "../types/fixed-types";
import { UtilsLog } from "../utils/utils-log";
import { ActiveEffectCardPart, AttackCardPart, CheckCardPart, DamageCardPart, DescriptionCardPart, PropertyCardPart, ResourceCardPart, SpellLevelCardPart, TargetCardPart, TemplateCardPart } from "./base/index";
import { ModularCardPart } from "./modular-card-part";
import { LayOnHandsCardPart } from "./srd/index";

export interface ModularCardPartData<T = any> {
  readonly id: string;
  readonly type: string;
  data: T;
}

export interface ModularCardTriggerData<T = any> {
  readonly messageId: string;
  readonly typeHandler: ModularCardPart<T>;
  readonly part: ModularCardPartData<T>;
  readonly allParts: ModularCardPartData<any>[];
}

class ChatMessageTransformer<T> extends TransformTrigger<ChatMessage, ModularCardTriggerData<T>> implements IDmlTrigger<ChatMessage> {

  public triggerStoppable: Stoppable;

  constructor(private cardPartType: ModularCardPart<T>) {
    super((from: ChatMessage) => this.transformFunc(from));
  }

  get type(): typeof ChatMessage {
    return ChatMessage;
  }

  private transformFunc(from: ChatMessage): {uniqueKey: string, data: ModularCardTriggerData} | Array<{uniqueKey: string, data: ModularCardTriggerData}> {
    const parts = ModularCard.getCardPartDatas(from);
    if (!Array.isArray(parts)) {
      return [];
    }

    const response: Array<{uniqueKey: string, data: ModularCardTriggerData}> = [];
    for (const part of parts) {
      if (ModularCard.isType(this.cardPartType, part)) {
        response.push({
          uniqueKey: `${from.uuid}.${part.id}`,
          data: {
            part: part,
            allParts: parts,
            messageId: from.id,
            typeHandler: ModularCard.getTypeHandler(part.type),
          }
        });
      }
    }

    return response;
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
    this.finalFields(context);
  }
  
  private finalFields(context: IDmlContext<ChatMessage>): boolean {
    for (const {newRow, oldRow} of context.rows) {
      const parts = ModularCard.getCardPartDatas(newRow);
      if (parts == null) {
        continue;
      }

      const oldParts = new Map<string, ModularCardPartData>();
      for (const part of ModularCard.getCardPartDatas(oldRow)) {
        oldParts.set(part.id, part);
      }

      for (const part of parts) {
        const oldPart = oldParts.get(part.id);
        if (!oldPart) {
          continue;
        }
        if (part.type !== oldPart?.type) {
          UtilsLog.error(`Can't change the type of part and retain the same id.`)
          return false;
        }
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
      UtilsLog.error(e);

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

async function updateMessage(this: ChatLog, wrapped: (...args: any) => any, ...args: any[]): Promise<void> {
  const message: ChatMessage = args[0];
  const clientTemplateData = ModularCard.getCardPartDatas(message);
  if (!clientTemplateData) {
    // Lets not mess with other messages. If there is am internal bug, don't affect them
    return wrapped(args);
  }

  const notify: boolean = args[1];
  let li = this.element.find(`.message[data-message-id="${message.id}"]`);
  if (li.length) {
    const updatedHtml = await message.getHTML();
    const updatedContent = updatedHtml.children(`.message-content`)[0].querySelector(`:scope > .${staticValues.moduleName}-item-card`);
    const currentContent = li.children(`.message-content`)[0].querySelector(`:scope > .${staticValues.moduleName}-item-card`);
    const updatedContentChildren = Array.from(updatedContent.childNodes);
    const currentContentChildren = Array.from(currentContent.childNodes);

    let sameTopLevelLayout = updatedContentChildren.length === currentContentChildren.length;
    if (sameTopLevelLayout) {
      for (let i = 0; i < currentContentChildren.length; i++) {
        // isEqualNode does a deep compare => make shallow copies
        if (currentContentChildren[i].nodeName !== updatedContentChildren[i].nodeName) {
          sameTopLevelLayout = false;
          break;
        }
      }
    }

    if (sameTopLevelLayout) {
      // replace message content
      for (let i = 0; i < currentContentChildren.length; i++) {
        if (Component.isComponentElement(currentContentChildren[i])) {
          const currentElement = (currentContentChildren[i] as ComponentElement);
          const updatedElement = (updatedContentChildren[i] as HTMLElement);
          for (const attr of updatedElement.getAttributeNames()) {
            if (currentElement.getAttribute(attr) !== updatedElement.getAttribute(attr)) {
              currentElement.setAttribute(attr, updatedElement.getAttribute(attr));
            }
          }
          for (const attr of currentElement.getAttributeNames()) {
            if (attr === currentElement.getHostAttribute()) {
              continue;
            }
            if (currentElement.getAttribute(attr) !== updatedElement.getAttribute(attr)) {
              currentElement.removeAttribute(attr);
            }
          }
        } else {
          currentContentChildren[i].replaceWith(updatedContentChildren[i]);
        }
      }

      // Replace non message content
      let messageContentElement: HTMLElement;
      const currentNonContentElements = Array.from(li[0].childNodes);
      for (let i = 0; i < currentNonContentElements.length; i++) {
        const element = currentNonContentElements[i];
        if (element instanceof HTMLElement && element.classList.contains('message-content')) {
          messageContentElement = element;
          continue;
        }
        element.remove();
      }
      let isBeforeMessageContent = true;
      const updatedNonContentElements = Array.from(updatedHtml[0].childNodes);
      for (let i = 0; i < updatedNonContentElements.length; i++) {
        const element = updatedNonContentElements[i];
        if (element instanceof HTMLElement && element.classList.contains('message-content')) {
          isBeforeMessageContent = false;
          continue;
        }

        if (isBeforeMessageContent) {
          li[0].insertBefore(element, messageContentElement);
        } else {
          li[0].append(element);
        }
      }
    } else {
      // sameTopLevelLayout should always be true, but just in case have a fallback
      // Default behaviour isn foundry V9
      li.replaceWith(updatedHtml);
    }
  } else {
    await this.postOne(message, false);
  }

  // Post notification of update
  if (notify) {
    this.notify(message);
  }

  // Update popout tab
  if (this._popout) {
    await this._popout.updateMessage(message, false);
  }
  if (this.popOut) {
    this.setPosition();
  }
}

const chatMessageTransformerMap = new Map<string, ChatMessageTransformer<any>>();

interface ModularCardInitAdd {
  addPart: ModularCardPart;
  position: ModularCardInitPosition<ModularCardPart | string>[];
}
interface ModularCardInitPosition<T> {
  type: 'before' | 'after'
  reference: T;
}
export class BeforeCreateModuleCardEvent {

  private addActions: ModularCardInitAdd[] = [];
  private add(addPart: ModularCardPart | ModularCardPart[], ...inputPositions: Array<ModularCardInitPosition<ModularCardPart | string> | ModularCardInitPosition<ModularCardPart | string>[]>): void {
    addPart = (Array.isArray(addPart) ? addPart : [addPart]);
    const positions: ModularCardInitPosition<ModularCardPart | string>[] = [];
    for (const position of inputPositions.deepFlatten()) {
      const refType = typeof position.reference === 'string' ? position.reference : position.reference.getType();
      if (ModularCard.getTypeHandler(refType) == null) {
        UtilsLog.warn(new Error(`${refType} has not been registered, skipping it as a position option.`));
      } else {
        positions.push(position);
      }
    }
    for (let i = 0; i < addPart.length; i++) {
      if (ModularCard.getTypeHandler(addPart[i].getType()) == null) {
        UtilsLog.error(new Error(`${addPart[i].getType()} has not been registered, it won't be added to the card.`));
        continue;
      }
      if (i === 0) {
        this.addActions.push({
          addPart: addPart[i],
          position: positions,
        });
      } else {
        this.addActions.push({
          addPart: addPart[i],
          position: [{type: 'after', reference: addPart[0]}],
        });
      }
    }
  }

  public addBefore(reference: ModularCardPart | string, addPart: ModularCardPart): void {
    this.add(addPart, {type: 'before', reference: reference});
  }

  public addAfter(reference: ModularCardPart | string, addPart: ModularCardPart): void {
    this.add(addPart, {type: 'after', reference: reference});
  }

  private removed = new Set<string>();
  public remove(...removeInputs: Array<ModularCardPart | ModularCardPart[] | string | string[]>) {
    // Don't actually remove any items so they can still be used as a reference
    const removes = removeInputs.deepFlatten();
    for (const remove of removes) {
      this.removed.add(typeof remove === 'string' ? remove : remove.getType());
    }
  }

  public getParts(): ModularCardPart[] {
    const resolvedParts: Array<string> = [];
    for (const standardPart of [
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
    ]) {
      resolvedParts.push(standardPart.getType());
    }

    const fallbackPosition: ModularCardInitPosition<string> = {
      type: 'after',
      reference: TemplateCardPart.instance.getType()
    };

    let pendingAddActions = this.addActions;
    while (pendingAddActions.length > 0) {
      const processing = pendingAddActions;
      pendingAddActions = [];
      for (const process of processing) {
        const positions = process.position.length === 0 ? [fallbackPosition] : process.position;
        let added = false;
        for (const position of positions) {
          const type = typeof position.reference === 'string' ? position.reference : position.reference.getType();
          const index = resolvedParts.indexOf(type);
          if (index !== -1) {
            resolvedParts.splice(index + (position.type === 'after' ? 1 : 0), 0, process.addPart.getType());
            added = true;
            break;
          }
          if (!added) {
            pendingAddActions.push(process);
          }
        }

        if (processing.length === pendingAddActions.length) {
          // Nothing got processed => missing a reference, use fallback
          // TODO be smarter, detect wich are also still pending
          for (const pending of pendingAddActions) {
            pending.position = [fallbackPosition];
          }
        }
      }
    }
    
    for (const remove of this.removed) {
      const index = resolvedParts.indexOf(remove);
      if (index !== -1) {
        resolvedParts.splice(index, 1);
      }
    }

    return resolvedParts.map(typeName => ModularCard.getTypeHandler(typeName));
  }
}

export class ModularCard {

  private static registeredPartsByType = new Map<string, {part: ModularCardPart}>();
  private static typeToModule = new Map<string, string>();
  public static registerModularCardPart(moduleName: string, part: ModularCardPart): void {
    if (ModularCard.registeredPartsByType.has(part.getType())) {
      UtilsLog.info(`ModularCardPart type "${part.getType()}" from module ${ModularCard.typeToModule.get(part.getType())} gets overwritten by module ${moduleName}`);
    }
    ModularCard.registeredPartsByType.set(part.getType(), {part: part});
    ModularCard.typeToModule.set(part.getType(), moduleName);
  }
  
  public static registerModularCardTrigger<T>(type: ModularCardPart<T>, trigger: ITrigger<ModularCardTriggerData>): Stoppable {
    let chatMessageTransformer: ChatMessageTransformer<T> = chatMessageTransformerMap.get(type.getType());
    if (!chatMessageTransformer) {
      chatMessageTransformer = new ChatMessageTransformer(type);
      chatMessageTransformerMap.set(type.getType(), chatMessageTransformer);
      chatMessageTransformer.triggerStoppable = DmlTrigger.registerTrigger(chatMessageTransformer);
    }
    const transformerStoppable = chatMessageTransformer.register(trigger);
    return {stop: () => {
      transformerStoppable.stop();
      if (!chatMessageTransformer.hasTriggers()) {
        chatMessageTransformer.triggerStoppable.stop();
      }
    }};
  }

  public static getTypeHandler<T extends ModularCardPart = ModularCardPart>(type: string): T | null {
    return ModularCard.registeredPartsByType.get(type).part as T;
  }

  public static async getDefaultItemParts(data: {actor?: MyActor, token?: TokenDocument, item: MyItem}): Promise<ModularCardPartData[]> {
    let id = 0;
    const parts: Promise<{data: any, cardPart: ModularCardPart}>[] = [];

    const createEvent = new BeforeCreateModuleCardEvent();
    // Ignore returned boolean
    Hooks.call(`create${staticValues.code.capitalize()}ModuleCard`, createEvent);

    const cardParts: ModularCardPart[] = createEvent.getParts();

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
          modularCardData: ModularCard.createFlagObject(parts),
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
    // Override render behaviour
    DmlTrigger.registerTrigger(new ChatMessageTrigger());
    Hooks.on('setup', () => {
      libWrapper.register(staticValues.moduleName, 'ChatMessage.prototype.getHTML', getHTML, 'WRAPPER');
      libWrapper.register(staticValues.moduleName, 'ChatLog.prototype.updateMessage', updateMessage, 'MIXED');
    });
    
    // - Keep scrollbar at the bottom
    // - Add child tags to item card as a replacement for :has
    Hooks.on('renderChatLog', () => {
      const log = document.querySelector("#chat-log");
      const itemCardSelector = `.${staticValues.moduleName}-item-card`;
      let isAtBottom = Math.abs(log.scrollHeight - (log.scrollTop + log.getBoundingClientRect().height)) < 2;
      const scrollToBottom = () => (ui.chat as any).scrollBottom();

      const calcChildTags = (itemCard: Element) => {
        const cssClasses = new Set<string>();
        cssClasses.add(`${staticValues.moduleName}-item-card`);
        for (const child of Array.from(itemCard.children)) {
          cssClasses.add(`has-${child.tagName.toLowerCase()}`);
        }
        itemCard.className = Array.from(cssClasses).sort().join(' ');
      }
      
      for (const child of Array.from(log.querySelectorAll(itemCardSelector))) {
        calcChildTags(child);
      }
      
      const observer = new MutationObserver((mutationsList, observer) => {
        if (isAtBottom) {
          rerenderQueue.add(scrollToBottom);
        }
        
        // Add child tags to item card as a replacement for :has
        const recalcItemCards = new Set<Element>();
        for (const item of mutationsList) {
          const nodes: Node[] = [];
          nodes.push(...Array.from(item.addedNodes));
          nodes.push(...Array.from(item.removedNodes));
          for (const node of nodes) {
            if (node instanceof Element) {
              if (node.matches(itemCardSelector)) {
                recalcItemCards.add(node);
              } else if (node.parentElement != null && node.parentElement.matches(itemCardSelector)) {
                recalcItemCards.add(node.parentElement);
              } else {
                for (const child of Array.from(node.querySelectorAll(itemCardSelector))) {
                  recalcItemCards.add(child);
                }
              }
            }
          }
        }
        recalcItemCards.delete(null);
        recalcItemCards.delete(undefined);
        for (const itemCard of recalcItemCards) {
          calcChildTags(itemCard);
        }
      });

      log.addEventListener('scroll', () => {
        isAtBottom = Math.abs(log.scrollHeight - (log.scrollTop + log.getBoundingClientRect().height)) < 2;
      });

      // Start observing the target node for configured mutations
      observer.observe(document, { childList: true, subtree: true });
    })
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
        if (cards[key] != null) {
          cardsArray.push(cards[key]);
        }
      }

      cards = cardsArray;
    }
    return cards;
  }
  
  public static async setBulkCardPartDatas(updates: Array<{message: ChatMessage, data: Array<ModularCardPartData>}>): Promise<void> {
    const bulkUpdateRequest: Parameters<typeof UtilsDocument.bulkUpdate>[0] = [];
    for (const update of updates) {
      if (update.message == null) {
        continue;
      }
  
      const cardsObj = ModularCard.createFlagObject(update.data);
      const originalCards = update.message.getFlag(staticValues.moduleName, 'modularCardData');
      if (UtilsCompare.deepEquals(originalCards, cardsObj)) {
        continue;
      }
      UtilsObject.injectDeleteForDml(originalCards, cardsObj);
      bulkUpdateRequest.push({document: update.message, data: {[`flags.${staticValues.moduleName}.modularCardData`]: cardsObj}});
    }
    return UtilsDocument.bulkUpdate(bulkUpdateRequest);
  }

  public static setCardPartDatas(message: ChatMessage, data: Array<ModularCardPartData>): Promise<void> {
    return ModularCard.setBulkCardPartDatas([{message, data}])
  }

  /**
   * Foundry change detection is not perfect.
   * If a single part of an array has been changed the whole array needs to be updated, this is not a problem with objects.
   * Ideally all arrays would be converted to object, but thats more complex and this solution will be fine for now.
   */
  private static createFlagObject(data: Array<ModularCardPartData>): {[key: string]: ModularCardPartData} {
    const cardsObj: {[key: string]: ModularCardPartData} = {};
    if (data) {
      for (const part of data) {
        if (part.data != null) {
          cardsObj[part.id] = part;
        }
      }
    }
    return cardsObj;
  }

  public static async getHtml(messageId: string, parts: ModularCardPartData[]): Promise<string> {
    const htmlParts$: Array<{html: string, id: string} | Promise<{html: string, id: string}>> = [];
    for (const partData of parts) {
      if (!ModularCard.registeredPartsByType.has(partData.type)) {
        UtilsLog.error(`Could not render ModularCardPart ${partData.type} of module ${ModularCard.typeToModule.get(partData.type)}`);
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

    const enrichOptions: Partial<Parameters<typeof TextEditor['enrichHTML']>[1]> = {async: true} as any;
    if (game.user.isGM) {
      enrichOptions.secrets = true;
    }
    
    const htmlParts = await Promise.all(htmlParts$);

    const enrichedHtmlParts: string[] = [];
    enrichedHtmlParts.push(`<div class="${staticValues.moduleName}-item-card">`);
    for (const enrichedPart of await Promise.all(htmlParts.map(part => TextEditor.enrichHTML(part.html, enrichOptions as any)))) {
      enrichedHtmlParts.push(enrichedPart);
    }
    enrichedHtmlParts.push(`</div>`);
    return enrichedHtmlParts.join('');
  }

}