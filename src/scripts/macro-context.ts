import { ChatSpeakerDataProperties } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/data/data.mjs/chatSpeakerData";
import { PropertiesToSource } from "@league-of-foundry-developers/foundry-vtt-types/src/types/helperTypes";
import { MyActor, MyItem } from "./types/fixed-types";

export type VanillaMacroArguments = [
  PropertiesToSource<ChatSpeakerDataProperties>, // Speaker
  Actor, // actor
  Token, // token
  Actor, // character
  MyItem?, // Item macros called from midi will provide a 5th item argument
];

export interface MacroContextData {
  actorUuid: string;
  tokenUuid: string;
  itemUuid?: string;
  selectedTokenUuids: string[];
  targetTokenUuids: string[];
}

export class MacroContext {
  
  constructor(private readonly data: MacroContextData) {}

  public static fromVanillaArguments(args: VanillaMacroArguments): MacroContext {
    return new MacroContext({
      actorUuid: args[1].uuid,
      tokenUuid: args[2].document.uuid,
      itemUuid: args.length > 4 && args[4] != null ? args[4].uuid : undefined,
      selectedTokenUuids: canvas.tokens.controlled.map(token => token.document.uuid),
      targetTokenUuids: Array.from(game.user.targets).map(token => token.document.uuid),
    });
  }

  public static fromData(data: MacroContextData): MacroContext {
    return new MacroContext(data);
  }

  public getMactoContextData(): MacroContextData {
    return JSON.parse(JSON.stringify(this.data));
  }

  /**
   * @returns An Actor id who is the protagonist of the executed action
   */
  public actorUuid(): string {
    return this.data.actorUuid;
  }
  
  /**
   * @returns A Actor which is the protagonist of the executed action
   */
   public actorDocument(): Promise<MyActor> {
    return fromUuid(this.data.actorUuid) as Promise<any> as Promise<MyActor>;
  }

  /**
   * @returns A Token id which is the protagonist of the executed action
   */
  public tokenUuid(): string {
    return this.data.tokenUuid;
  }
  
  /**
   * @returns A TokenDocument which is the protagonist of the executed action
   */
  public tokenDocument(): Promise<TokenDocument> {
    return fromUuid(this.data.tokenUuid) as Promise<TokenDocument>;
  }

  /**
   * @returns The Item id which is linked to this macro
   */
  public itemUuid(): string | null {
    return this.data.itemUuid;
  }
  
  /**
   * @returns The Item which is linked to this macro
   */
  public itemDocument(): Promise<MyItem | null> {
    if (!this.data.itemUuid) {
      return Promise.resolve(null);
    }
    return fromUuid(this.data.actorUuid) as Promise<any> as Promise<MyItem>;
  }

  /**
   * @returns All the uuids of the tokens which have been targeted by the user
   */
  public targetTokenUuids(): string[] {
    return [...this.data.targetTokenUuids];
  }

  /**
   * @returns All the TokenDocuments which have been selected by the user
   */
  public selectedTokenDocuments(): Promise<TokenDocument[]> {
    return MacroContext.getTokenDocuments(this.data.selectedTokenUuids);
  }

  /**
   * @returns All the TokenDocuments which have been selected by the user
   */
  public selectedTokens(): Promise<Token[]> {
    return MacroContext.getTokens(this.data.selectedTokenUuids);
  }

  /**
   * @returns All the TokenDocuments which have been targeted by the user
   */
  public targetTokenDocuments(): Promise<TokenDocument[]> {
    return MacroContext.getTokenDocuments(this.data.targetTokenUuids);
  }

  /**
   * @returns All the TokenDocuments which have been targeted by the user
   */
  public targetTokens(): Promise<Token[]> {
    return MacroContext.getTokens(this.data.targetTokenUuids);
  }

  private static getTokenDocuments(tokenUuids: string[]): Promise<TokenDocument[]> {
    return Promise.all(tokenUuids.map(tokenUuid => {
      return fromUuid(tokenUuid) as Promise<TokenDocument>;
    }));
  }

  private static async getTokens(tokenUuids: string[]): Promise<Token[]> {
    const tokenDocuments = await MacroContext.getTokenDocuments(tokenUuids);
    const tokens: Token[] = [];
    for (const tokenDocument of tokenDocuments) {
      if (tokenDocument.parent.uuid === canvas.scene.uuid) {
        tokens.push(canvas.tokens.get(tokenDocument.id));
      }
    }
    return tokens;
  }

}