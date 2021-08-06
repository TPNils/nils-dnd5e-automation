import { ChatMessageDataConstructorData } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/data/data.mjs/chatMessageData";

export interface ItemCardData {
  actor: {
    uuid: string;
  };
  item: {
    uuid: string;
    name: string;
    img: string;
    description?: string;
    materials?: string;
    spell?: {
      level: number;
    }
  };
  token?: {
    uuid: string;
  };
}

export class UtilsChatMessage {

  public static async damageOnlyCard(): Promise<ChatMessage> {
    const chatMessageData: ChatMessageDataConstructorData = {};
    return await ChatMessage.create(chatMessageData)
  }

}