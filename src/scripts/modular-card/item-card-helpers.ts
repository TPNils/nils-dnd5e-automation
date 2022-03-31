import { DamageType } from "../types/fixed-types";

export interface ChatPartIdData {
  readonly partId: string;
  readonly messageId: string;
  readonly subType: string | null;
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

export interface KeyData {
  readonly keyEvent: {
    readonly key: string;
  }
}

export class ItemCardHelpers {
  
  public static get tmpHealingDamageTypes(): DamageType[] {
    return ['temphp'];
  }
  
  public static get healingDamageTypes(): DamageType[] {
    return Object.keys((CONFIG as any).DND5E.healingTypes) as any;
  }

  public static getUserIdSerializer(): (event: Event) => UserIdData {
    return event => {
      return {
        userId: game.userId,
      }
    }
  }

  public static getChatPartIdSerializer(): (event: Event) => ChatPartIdData {
    return event => {
      return {
        messageId: (event.target as HTMLElement).closest('[data-message-id]')?.getAttribute('data-message-id'),
        partId: (event.target as HTMLElement).closest('[data-part-id]')?.getAttribute('data-part-id'),
        subType: (event.target as HTMLElement).getAttribute('data-sub-type'),
      }
    }
  }

  public static getMouseEventSerializer(): (event: MouseEvent) => ClickData {
    return event => {
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

  public static getKeyEventSerializer(): (event: KeyboardEvent) => KeyData {
    return event => {
      return {
        keyEvent: {
          key: event.key
        }
      }
    }
  }
  
}