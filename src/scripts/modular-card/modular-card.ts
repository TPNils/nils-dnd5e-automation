import { ChatMessageDataConstructorData } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/data/data.mjs/chatMessageData";
import { DmlTrigger, IDmlContext, IDmlTrigger, ITrigger, IUnregisterTrigger } from "../lib/db/dml-trigger";
import { TransformTrigger } from "../lib/db/transform-trigger";
import { RunOnce } from "../lib/decorator/run-once";
import { UtilsCompare } from "../lib/utils/utils-compare";
import { provider } from "../provider/provider";
import { staticValues } from "../static-values";
import { MyActor, MyItem } from "../types/fixed-types";
import { AttackCardPart } from "./attack-card-part";
import { DamageCardPart } from "./damage-card-part";
import { DescriptionCardPart } from "./description-card-part";
import { ActionParam, ClickEvent, ICallbackAction, KeyEvent, ModularCardPart } from "./modular-card-part";
import { PropertyCardPart } from "./property-card-part";
import { TargetCardPart } from "./target-card-part";
import { TemplateCardPart } from "./template-card-part";

export interface ModularCardPartData<T = any> {
  readonly id: string;
  readonly type: string;
  readonly data: T;
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

type InteractionResponse = {success: true;} | {success: false; errorMessage: string, stackTrace?: string, errorType: 'warn' | 'error'}

interface ActionResponse {
  permissionCheckResult: 'can-run-local' | 'can-run-as-gm' | 'prevent-action';
  action: ICallbackAction<any>;
  regex: RegExpExecArray;
}

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
  
  public static registerModularCardTrigger(trigger: ITrigger<ModularCardTriggerData>): IUnregisterTrigger {
    return chatMessageTransformer.register(trigger);
  }

  public static getTypeHandler<T extends ModularCardPart = ModularCardPart>(type: string): T | null {
    return ModularCard.registeredPartsByType.get(type).part as T;
  }

  public static async getDefaultItemParts(data: {actor?: MyActor, token?: TokenDocument, item: MyItem}): Promise<ModularCardPartData[]> {
    // TODO this is proof of concept, when finished to should dynamically assign which parts to use for creation
    let id = 0;
    const parts: Promise<{datas: any[], cardPart: ModularCardPart}>[] = [];

    const cardParts: ModularCardPart[] = [
      DescriptionCardPart.instance,
      AttackCardPart.instance,
      DamageCardPart.instance,
      TemplateCardPart.instance,
      TargetCardPart.instance,
      PropertyCardPart.instance,
    ];
    
    for (const cardPart of cardParts) {
      const response = cardPart.create(data);
      if (response instanceof Promise) {
        parts.push(response.then(data => ({datas: data, cardPart: cardPart})))
      } else {
        parts.push(Promise.resolve({datas: response, cardPart: cardPart}));
      }
    }

    const response: ModularCardPartData[] = [];
    for (const part of await Promise.all(parts)) {
      for (const data of part.datas) {
        response.push({
          id: `${id++}`,
          data: data,
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

    // Html listeners
    Hooks.on('renderChatLog', () => {
      const chatElement = document.getElementById('chat-log');
      chatElement.addEventListener('click', event => ModularCard.onClick(event));
      chatElement.addEventListener('focusout', event => ModularCard.onBlur(event));
      chatElement.addEventListener('keydown', event => ModularCard.onKeyDown(event));
      chatElement.addEventListener('change', event => ModularCard.onChange(event));
    });

    // Register remote execution
    provider.getSocket().then(socket => {
      socket.register('ModularCard.onInteraction', (params: Parameters<typeof ModularCard['onInteractionProcessor']>[0]) => {
        return ModularCard.onInteractionProcessor(params);
      })
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
    return message.setFlag(staticValues.moduleName, 'modularCardData', cardsObj);
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
      const htmlPart = ModularCard.registeredPartsByType.get(partData.type).part.getHtml({messageId: messageId, partId: partData.id, data: partData.data, allMessageParts: parts});
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
    htmlParts.push(`<div class="${staticValues.moduleName}-item-card">`);
    for (const part of await Promise.all(htmlParts$)) {
      if (typeof part.html !== 'string' || part.html === '') {
        continue;
      }
      htmlParts.push(`<div data-${staticValues.moduleName}-card-part="${part.id}">`);
      htmlParts.push(TextEditor.enrichHTML(part.html, enrichOptions as any))
      htmlParts.push(`</div>`);
    }
    htmlParts.push(`</div>`);
    return htmlParts.join('');
  }
  
  //#region User interaction
  private static async onClick(event: MouseEvent): Promise<void> {
    if (event.target instanceof HTMLInputElement) {
      // do not register clicks on inputs, except checkboxes
      const input = event.target as HTMLInputElement;
      if (input.type !== 'checkbox') {
        return;
      }
    }
    if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLOptionElement) {
      return;
    }
    if (event.target instanceof Node) {
      ModularCard.onInteraction({
        clickEvent: event,
        element: event.target as Node
      });
    }
  }

  private static async onBlur(event: FocusEvent): Promise<void> {
    if (event.target instanceof HTMLInputElement) {
      // blur does not work very well with checkboxes => listen to click event
      const input = event.target as HTMLInputElement;
      if (input.type === 'checkbox') {
        return;
      }
      if (event.target instanceof Node) {
        ModularCard.onInteraction({
          element: event.target as Node
        });
      }
    }
  }

  private static async onKeyDown(event: KeyboardEvent): Promise<void> {
    if (event.target instanceof HTMLInputElement && ['Enter', 'Escape'].includes(event.key)) {
      ModularCard.onInteraction({
        element: event.target as Node,
        keyEvent: {
          key: event.key as KeyEvent['key']
        },
      });
    }
  }

  private static async onChange(event: Event): Promise<void> {
    if (event.target instanceof Node) {
      ModularCard.onInteraction({
        element: event.target as Node
      });
    }
  }

  private static async onInteraction({clickEvent, element, keyEvent}: {element: Node, clickEvent?: ClickEvent, keyEvent?: KeyEvent}): Promise<void> {
    clickEvent = {
      altKey: clickEvent?.altKey === true,
      ctrlKey: clickEvent?.ctrlKey === true,
      metaKey: clickEvent?.metaKey === true,
      shiftKey: clickEvent?.shiftKey === true,
    }
    keyEvent = !keyEvent ? null : {
      key: keyEvent.key
    };

    let messageId: string;
    let partId: string;
    let action: string;
    let currentElement = element;
    let inputValue: boolean | number | string;
    while (currentElement != null) {
      if (currentElement instanceof HTMLElement) {
        if (currentElement.dataset.messageId != null) {
          messageId = currentElement.dataset.messageId;
        }
        if (currentElement.hasAttribute(`data-${staticValues.moduleName}-card-part`)) {
          partId = currentElement.getAttribute(`data-${staticValues.moduleName}-card-part`);
        }
        if (currentElement.hasAttribute(`data-${staticValues.moduleName}-action`)) {
          action = currentElement.getAttribute(`data-${staticValues.moduleName}-action`);
          
          if (currentElement instanceof HTMLInputElement) {
            if (['radio', 'checkbox'].includes(currentElement.type)) {
              inputValue = currentElement.checked;
            } else if (['number'].includes(currentElement.type)) {
              inputValue = Number(currentElement.value);
            } else {
              inputValue = currentElement.value;
            }
          } else if (currentElement instanceof HTMLSelectElement) {
            inputValue = currentElement.value;
          }
        }
      }

      currentElement = currentElement.parentNode;
    }

    if (!action || !partId || !messageId) {
      return;
    }
    
    const message = game.messages.get(messageId);
    const messageData = ModularCard.getCardPartDatas(message);
    if (!Array.isArray(messageData)) {
      console.warn(`pressed a ${staticValues.moduleName} action button for message ${messageId} but no data was found`);
      return;
    }
    let partData: ModularCardPartData;
    for (const part of messageData) {
      if (part.id === partId) {
        partData = part;
      }
    }
    if (!partData) {
      console.warn(`pressed a ${staticValues.moduleName} action button for message ${messageId}.${partId} but no part was found`);
      return;
    }

    const modularCardPart = ModularCard.registeredPartsByType.get(partData.type);
    if (modularCardPart == null) {
      console.error(`Could not interact with ModularCardPart ${partData.type} of module ${ModularCard.typeToModule.get(partData.type)}`);
      return;
    }

    const actions = await ModularCard.getActions(action, clickEvent, keyEvent, game.userId, messageId, partData);
    if (actions.some(a => a.permissionCheckResult === 'prevent-action')) {
      console.warn(`Pressed a ${staticValues.moduleName} action button for message part ${messageId}.${partId} with action ${action} for current user but permissions are missing`)
      return;
    }
    if (actions.length === 0) {
      console.info('no actions found')
      return;
    }

    const request: Parameters<typeof ModularCard['onInteractionProcessor']>[0] = {
      clickEvent: clickEvent,
      keyEvent: keyEvent,
      userId: game.userId,
      partId: partId,
      messageId: messageId,
      action: action,
      inputValue: inputValue,
    }

    let response: InteractionResponse;
    
    if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) {
      element.disabled = true;
    }
    try {
      if (actions.every(a => a.permissionCheckResult === 'can-run-local')) {
        // User has all required permissions, run locally
        response = await ModularCard.onInteractionProcessor(request);
      } else {
        response = await provider.getSocket().then(socket => socket.executeAsGM('ModularCard.onInteraction', request));
      }
    } finally {
      if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) {
        element.disabled = false;
      }
    }

    if (response.success === false) {
      if (response.errorType === 'warn') {
        console.warn(response.errorMessage);
        ui.notifications.warn(response.errorMessage);
      }
      if (response.errorType === 'error') {
        console.error(response.errorMessage);
        ui.notifications.error(response.errorMessage);
      }
      if (response.stackTrace) {
        console.error('Stacktrace:\n' + response.stackTrace)
      }
    }
  }

  private static async onInteractionProcessor({clickEvent, keyEvent, userId, messageId, partId, action, inputValue}: {
    clickEvent: ClickEvent,
    keyEvent: KeyEvent,
    userId: string,
    partId: string,
    messageId: string,
    action: string,
    inputValue?: ActionParam<any>['inputValue'];
  }): Promise<InteractionResponse> {
    const message = game.messages.get(messageId);
    const originalAllCardParts = ModularCard.getCardPartDatas(message);

    let allCardParts = deepClone(originalAllCardParts);
    const messagePartData = ModularCard.getCardPartDatas(message).find(part => part.id === partId);
    if (messagePartData == null) {
      return {
        success: false,
        errorType: 'warn',
        errorMessage: `Pressed a ${staticValues.moduleName} action button for message part ${messageId}.${partId} but no data was found`,
      };
    }

    const actions = await ModularCard.getActions(action, clickEvent, keyEvent, userId, messageId, messagePartData);
    if (actions.some(a => a.permissionCheckResult === 'prevent-action')) {
      return {
        success: false,
        errorType: 'error',
        errorMessage: `Pressed a ${staticValues.moduleName} action button for message message part ${messageId}.${partId} with action ${action} for user ${userId} but permissions are missing`,
      };
    }
    
    for (const action of actions) {
      const param: ActionParam<any> = {
        partId: partId,
        data: allCardParts.find(p => p.id === partId).data,
        regexResult: action.regex,
        messageId: messageId,
        allCardParts: allCardParts,
        userId: userId,
        clickEvent: clickEvent,
        keyEvent: keyEvent,
        inputValue: inputValue,
      };
      try {
        await action.action.execute(param);
      } catch (err) {
        return {
          success: false,
          errorMessage: err instanceof Error ? `${err.message}` : String(err),
          stackTrace: err instanceof Error ? err.stack : null,
          errorType: 'error'
        }
      }
    }

    if (!UtilsCompare.deepEquals(originalAllCardParts, allCardParts)) {
      // Don't use await so you can return a response faster to the client
      await ModularCard.setCardPartDatas(message, allCardParts);
    }

    return {
      success: true,
    }
  }

  private static async getActions(action: string, clickEvent: ClickEvent, keyEvent: KeyEvent, userId: string, messageId: string, partData: ModularCardPartData): Promise<Array<ActionResponse>> {
    if (!action) {
      return [];
    }
    const response: ActionResponse[] = [];

    for (const actionMatch of ModularCard.registeredPartsByType.get(partData.type).part.getCallbackActions()) {
      const result = actionMatch.regex.exec(action);
      if (result) {
        response.push({
          action: actionMatch,
          regex: result,
          permissionCheckResult: actionMatch.permissionCheck == null ? 'can-run-local' : await actionMatch.permissionCheck({
            partId: partData.id,
            data: partData.data,
            regexResult: result,
            messageId: messageId,
            allCardParts: [], // TODO
            userId: userId,
            clickEvent: clickEvent,
            keyEvent: keyEvent,
          })
        });
      }
    }


    return response;
  }
  //#endregion

}