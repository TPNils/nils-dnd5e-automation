import { UtilsCompare } from "../lib/utils/utils-compare";
import { provider } from "../provider/provider";
import { ModularCard, ModularCardPartData } from "./modular-card";

export interface ClickEvent {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}
export interface KeyEvent {
  readonly key: 'Enter' | 'Escape';
}

interface ActionParamBase<T> {
  partId: string;
  data: T;
  regexResult: RegExpExecArray;
  messageId: string;
  allCardParts: ModularCardPartData[];
  userId: string;
  subType?: string;
}

interface ActionParamClick {
  clickEvent: ClickEvent;
  inputValue: boolean | number | string
}

interface ActionParamKey {
  keyEvent: KeyEvent;
  inputValue: boolean | number | string
}

type PromiseOrSync<T> = T | Promise<T>;
export type ActionParam<T> = ActionParamBase<T> & Partial<ActionParamClick> & Partial<ActionParamKey>;
export type ActionPermissionCheck<T> = ({}: ActionParam<T>) => PromiseOrSync<'can-run-local' | 'can-run-as-gm' | 'prevent-action'>;
export type ActionPermissionExecute<T> = ({}: ActionParam<T>) => PromiseOrSync<void>;

export interface ICallbackAction<T> {
  regex: RegExp;
  permissionCheck?: ActionPermissionCheck<T>;
  execute: ActionPermissionExecute<T>;
}

export interface HtmlContext<T> {
  messageId: string;
  partId: string;
  subType?: string;
  data: T;
  allMessageParts: ModularCardPartData[];
}

export interface CardPartElementConfig<T = any> {
  selector: string;
  hasSubType?: boolean;
  getHtml?(context: HtmlContext<T>): string | Promise<string>
  getCallbackActions?(): ICallbackAction<T>[];
}

export function createElement(config: CardPartElementConfig): (typeof HTMLElement) {
  const element = class A extends CardPartElement {
    constructor() {
      super();
      this.config = config;
    }
  };
  // Register as a valid html element
  customElements.define(config.selector, element);
  
  // Register remote execution
  provider.getSocket().then(socket => {
    socket.register(`${config.selector}.onInteraction`, (params: Parameters<CardPartElement['onInteractionProcessor']>[0]) => {
      const query = [
        `[data-message-id="${params.messageId}"][data-part-id="${params.partId}"]${config.selector}`,
        `[data-message-id="${params.messageId}"][data-part-id="${params.partId}"] ${config.selector}`,
        `[data-message-id="${params.messageId}"] [data-part-id="${params.partId}"] ${config.selector}`,
      ];
      if (config.hasSubType) {
        for (let i = 0; i < query.length; i++) {
          query[i] += `[data-sub-type="${params.subType}"]`;
        }
      }
      const element = document.querySelector(query.join(', '));
      if (element instanceof CardPartElement) {
        return element.onInteractionProcessor(params);
      } else {
        return Promise.resolve<InteractionResponse>({success: false, errorMessage: 'Could not find element with querySelector: ' + query.join(', '), errorType: 'error'});
      }
    })
  });
  return element;
}

interface ActionResponse {
  permissionCheckResult: 'can-run-local' | 'can-run-as-gm' | 'prevent-action';
  action: ICallbackAction<any>;
  regex: RegExpExecArray;
}
type InteractionResponse = {success: true;} | {success: false; errorMessage: string, stackTrace?: string, errorType: 'warn' | 'error'}

class CardPartElement extends HTMLElement {
  protected config: CardPartElementConfig;

  constructor() {
    super();
  }
  
  //#region HTML element hooks
  public static get observedAttributes() {
    return ['data-message-id', 'data-part-id'];
  }

  public attributeChangedCallback(name: string, oldValue: string, newValue: string): void {
    this.calcInner();
  }

  public connectedCallback(): void {
    this.registerListeners();
    // If the message/part id is written on a parent node
    this.calcInner();
  }

  public adoptedCallback(): void {
    // If the element is moved and the message/part id is written on a parent node
    this.calcInner();
  }
  //#endregion
  
  private renderedKey: string;
  private async calcInner(): Promise<void> {
    if (!this.config.getHtml) {
      return;
    }
    const messageId = this.getMessageId();
    const partId = this.getPartId();
    const subtype = this.getSubType();
    const renderKey = `${messageId}/${partId}`;
    if (this.renderedKey === renderKey) {
      return;
    }
    if (!messageId || !partId || (this.config.hasSubType && !subtype)) {
      const properties = [];
      if (!messageId) {
        properties.push('data-message-id')
      }
      if (!partId) {
        properties.push('data-part-id')
      }
      if (!this.config.hasSubType && !subtype) {
        properties.push('data-sub-type')
      }
      this.innerHTML = `Missing properties: ` + properties.join(', ');
      return;
    }
    if (this.config.hasSubType && !subtype) {
      this.innerHTML = `Missing proprtties: ` + [(messageId == null ? 'data-message-id' : null), partId == null ? 'data-part-id' : null].filter(v => !!v).join(', ');
      return;
    }
    if (!game.messages.has(messageId)) {
      this.innerHTML = 'Message not found: ' + messageId;
      return;
    }
    const allCardParts = ModularCard.getCardPartDatas(game.messages.get(messageId)) ?? [];
    const cardPart = allCardParts.find(part => part.id === partId);
    // TODO store item uuid in message to allow for dynamic part creation (maybe? does not solve upcasting)
    if (!cardPart) {
      this.innerHTML = `Message part not found: ${messageId}.${partId}`;
      return;
    }

    this.renderedKey = renderKey;
    this.innerHTML = await this.config.getHtml({
      data: cardPart.data,
      messageId: messageId,
      partId: partId,
      subType: subtype,
      allMessageParts: allCardParts,
    });
  }

  private getMessageId(): string | null {
    return this.closest('[data-message-id]')?.getAttribute('data-message-id');
  }

  private getPartId(): string | null {
    return this.closest('[data-part-id]')?.getAttribute('data-part-id');
  }

  private getSubType(): string | null {
    return this.getAttribute('data-sub-type');
  }

  //#region User interaction
  private registerListeners(): void {
    if (!this.config.getCallbackActions) {
      return;
    }
    this.addEventListener('click', event => this.onClick(event));
    this.addEventListener('focusout', event => this.onBlur(event));
    this.addEventListener('keydown', event => this.onKeyDown(event));
    this.addEventListener('change', event => this.onChange(event));
  }
  
  private async onClick(event: MouseEvent): Promise<void> {
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
      this.onInteraction({
        clickEvent: event,
        element: event.target as Node
      });
    }
  }

  private async onBlur(event: FocusEvent): Promise<void> {
    if (event.target instanceof HTMLInputElement) {
      // blur does not work very well with checkboxes => listen to click event
      const input = event.target as HTMLInputElement;
      if (input.type === 'checkbox') {
        return;
      }
      if (event.target instanceof Node) {
        this.onInteraction({
          element: event.target as Node
        });
      }
    }
  }

  private async onKeyDown(event: KeyboardEvent): Promise<void> {
    if (event.target instanceof HTMLInputElement && ['Enter', 'Escape'].includes(event.key)) {
      this.onInteraction({
        element: event.target as Node,
        keyEvent: {
          key: event.key as KeyEvent['key']
        },
      });
    }
  }

  private async onChange(event: Event): Promise<void> {
    if (event.target instanceof Node) {
      this.onInteraction({
        element: event.target as Node
      });
    }
  }

  private async onInteraction({clickEvent, element, keyEvent}: {element: Node, clickEvent?: ClickEvent, keyEvent?: KeyEvent}): Promise<void> {
    clickEvent = {
      altKey: clickEvent?.altKey === true,
      ctrlKey: clickEvent?.ctrlKey === true,
      metaKey: clickEvent?.metaKey === true,
      shiftKey: clickEvent?.shiftKey === true,
    }
    keyEvent = !keyEvent ? null : {
      key: keyEvent.key
    };

    let messageId = this.getMessageId();
    let partId = this.getPartId();
    let subType = this.getSubType();
    let action: string;
    let currentElement = element;
    let inputValue: boolean | number | string;
    let customData: any = {};
    while (currentElement != null) {
      if (currentElement instanceof HTMLElement) {
        if (currentElement.hasAttribute(`data-action`)) {
          action = currentElement.getAttribute(`data-action`);
          
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

        if (this.config.hasSubType) {
          for (const [dataKey, attribute] of Object.entries(this.config)) {
            if (customData[dataKey] !== undefined && currentElement.hasAttribute(`data-${attribute}`)) {
              customData[dataKey] = currentElement.getAttribute(`data-${attribute}`);;
            }
          }
        }
      }

      if (currentElement === this) {
        break;
      }
      currentElement = currentElement.parentNode;
    }

    if (!action || !partId || !messageId) {
      return;
    }
    if (this.config.hasSubType && ! subType) {
      return;
    }
    
    const message = game.messages.get(messageId);
    const messageData = ModularCard.getCardPartDatas(message);
    if (!Array.isArray(messageData)) {
      console.warn(`pressed an action button for message ${messageId} but no data was found`, this);
      return;
    }
    let partData: ModularCardPartData;
    for (const part of messageData) {
      if (part.id === partId) {
        partData = part;
      }
    }
    if (!partData) {
      console.warn(`pressed an action button for message ${messageId}.${partId} but no part was found`, this);
      return;
    }

    const actions = await this.getActions(action, clickEvent, keyEvent, game.userId, messageId, customData, messageData, partData);
    if (actions.some(a => a.permissionCheckResult === 'prevent-action')) {
      console.warn(`Pressed an action button for message part ${messageId}.${partId} with action ${action} for current user but permissions are missing.`, this);
      return;
    }
    if (actions.length === 0) {
      console.info('no actions found');
      return;
    }

    const request: Parameters<CardPartElement['onInteractionProcessor']>[0] = {
      clickEvent: clickEvent,
      keyEvent: keyEvent,
      userId: game.userId,
      partId: partId,
      messageId: messageId,
      action: action,
      inputValue: inputValue,
      subType: subType,
    }

    let response: InteractionResponse;
    
    if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) {
      element.disabled = true;
    }
    try {
      if (actions.every(a => a.permissionCheckResult === 'can-run-local')) {
        // User has all required permissions, run locally
        response = await this.onInteractionProcessor(request);
      } else {
        response = await provider.getSocket().then(socket => socket.executeAsGM(`${this.config.selector}.onInteraction`, request));
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

  public async onInteractionProcessor({clickEvent, keyEvent, userId, messageId, partId, action, subType, inputValue}: {
    clickEvent: ClickEvent,
    keyEvent: KeyEvent,
    userId: string,
    partId: string,
    messageId: string,
    action: string,
    subType: string | null,
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
        errorMessage: `Pressed an action button for message part ${messageId}.${partId} but no data was found`,
      };
    }

    const actions = await this.getActions(action, clickEvent, keyEvent, userId, messageId, subType, allCardParts, messagePartData);
    if (actions.some(a => a.permissionCheckResult === 'prevent-action')) {
      return {
        success: false,
        errorType: 'error',
        errorMessage: `Pressed an action button for message message part ${messageId}.${partId} with action ${action} for user ${userId} but permissions are missing`,
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
        subType: subType,
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
      await ModularCard.setCardPartDatas(message, allCardParts);
    }

    return {
      success: true,
    }
  }

  private async getActions(action: string, clickEvent: ClickEvent, keyEvent: KeyEvent, userId: string, messageId: string, subType: string | null, allCardParts: ModularCardPartData[], partData: ModularCardPartData): Promise<Array<ActionResponse>> {
    if (!action) {
      return [];
    }
    const response: ActionResponse[] = [];

    for (const actionMatch of this.config.getCallbackActions()) {
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
            allCardParts: allCardParts,
            userId: userId,
            clickEvent: clickEvent,
            keyEvent: keyEvent,
            subType: subType,
          })
        });
      }
    }


    return response;
  }
  //#endregion

}
