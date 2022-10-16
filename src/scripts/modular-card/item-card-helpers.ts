import { DamageType, MyItemData } from "../types/fixed-types";
import { ModularCard, ModularCardPartData } from "./modular-card";
import { ModularCardPart } from "./modular-card-part";

export interface ChatPartIdData {
  readonly partId: string;
  readonly messageId: string;
  readonly subType?: string | null;
}

export interface ChatPartEnriched<T> {
  readonly allCardParts: ModularCardPartData<any>[];
  readonly part: ModularCardPartData<T>;
}

export interface UserIdData {
  readonly userId: string;
}

export interface ClickData {
  readonly click: {
    readonly altKey: boolean;
    readonly ctrlKey: boolean;
    readonly metaKey: boolean;
    readonly shiftKey: boolean;
  };
}

export interface ElementInputData {
  readonly inputValue: string;
}

export interface KeyData {
  readonly keyEvent: {
    readonly key: string;
  }
}

export interface ActionData {
  readonly action: string;
}

export class ItemCardHelpers {
  
  public static get tmpHealingDamageTypes(): DamageType[] {
    return ['temphp'];
  }
  
  public static get healingDamageTypes(): DamageType[] {
    return Object.keys((CONFIG as any).DND5E.healingTypes) as any;
  }
  
  public static get spellUpcastModes(): Array<MyItemData['data']['preparation']['mode']> {
    return (CONFIG as any).DND5E.spellUpcastModes;
  }

  public static getUserIdSerializer(): () => UserIdData {
    return () => {
      return {
        userId: game.userId,
      }
    }
  }

  public static getInputSerializer(): ({event}: {event: Event}) => ElementInputData {
    return ({event}) => {
      return {
        inputValue: (event.target as any)?.value,
      }
    }
  }

  public static getChatPartIdSerializer(): ({element}: {element: HTMLElement}) => ChatPartIdData {
    return ({element}) => {
      // TODO validate when values are missing
      return {
        messageId: element.closest('[data-message-id]')?.getAttribute('data-message-id'),
        partId: element.closest('[data-part-id]')?.getAttribute('data-part-id'),
        subType: element.getAttribute('data-sub-type'),
      }
    }
  }

  public static getRawSerializer<T, K extends keyof T>(field: K): (arg: T) => {[P in K]: T[P]} {
    return (arg: T) => {
      return <any>{
        [field]: arg[field]
      }
    }
  }

  public static getCustomEventSerializer<T>(): ({event}: {event: CustomEvent<T>}) => {event: T} {
    return ({event}) => ({event: event.detail});
  }

  public static getMouseEventSerializer(): ({event}: {event: MouseEvent}) => ClickData {
    return ({event}) => {
      return {
        click: {
          altKey: event.altKey === true,
          ctrlKey: event.ctrlKey === true,
          metaKey: event.metaKey === true,
          shiftKey: event.shiftKey === true,
        }
      }
    }
  }

  public static getActionSerializer(): ({event}: {event: Event}) => ActionData {
    return ({event}) => {
      return {action: (event.target as HTMLElement).closest('[data-action]').getAttribute('data-action')}
    }
  }

  public static getKeyEventSerializer(): ({event}: {event: KeyboardEvent}) => KeyData {
    return ({event}) => {
      return {
        keyEvent: {
          key: event.key
        }
      }
    }
  }

  public static getChatPartEnricher<T>(): (data: ChatPartIdData) => ChatPartEnriched<T> {
    return data => {
      const message = game.messages.get(data.messageId);
      const originalAllCardParts = ModularCard.getCardPartDatas(message);

      let allCardParts = deepClone(originalAllCardParts);
      const messagePartData = allCardParts.find(part => part.id === data.partId);
      if (messagePartData == null) {
        throw {
          success: false,
          errorType: 'warn',
          errorMessage: `Pressed an action button for message part ${data.messageId}.${data.partId} but no data was found`,
        };
      }
      return {
        allCardParts,
        part: messagePartData,
      }
    }
  }

  public static ifAttrData<T>(args: {
    attr: Partial<{readonly ['data-message-id']: string, readonly ['data-part-id']: string}>,
    element: HTMLElement,
    type: ModularCardPart<T>,
    callback: (args: {allParts: ModularCardPartData<any>[], part: ModularCardPartData<T>}) => any
  }): any {
    const allParts = ModularCard.getCardPartDatas(game.messages.get(args.attr['data-message-id']));
    if (allParts == null) {
      args.element.innerText = '';
      return;
    }
    const data: ModularCardPartData<T> = allParts.find(p => p.id === args.attr['data-part-id'] && p.type === args.type.getType());
    if (data == null) {
      args.element.innerText = '';
      return;
    }

    return args.callback({allParts: allParts, part: data});
  }
  
}