import { DamageType, MyItemData } from "../../types/fixed-types";
import { ModularCard, ModularCardInstance } from "../modular-card";

export interface ChatPartIdData {
  readonly messageId: string;
}

export interface ChatPartEnriched {
  readonly cardParts: ModularCardInstance;
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
  
  public static get spellUpcastModes(): Array<MyItemData['preparation']['mode']> {
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

  public static getChatEnricher(): (data: ChatPartIdData) => ChatPartEnriched {
    return data => {
      const message = game.messages.get(data.messageId);
      return {
        cardParts: ModularCard.readModuleCard(message).deepClone()
      }
    }
  }
  
}