import { DocumentListener } from "../../lib/db/document-listener";
import { Attribute } from "../../lib/render-engine/component";
import { ValueProvider } from "../../provider/value-provider";
import { ModularCard } from "../modular-card";
import { ModularCardPart } from "../modular-card-part";

export class BaseCardComponent {
  
  //#region input
  private _messageId = new ValueProvider<string>();
  @Attribute('data-message-id')
  public get messageId(): string {
    return this._messageId.get();
  }
  public set messageId(v: string) {
    this._messageId.set(v);
  }
  //#endregion

  protected getData<T>(type: ModularCardPart<T>) {
    return this._messageId
    .switchMap(id => DocumentListener.listenUuid<ChatMessage>(`ChatMessage.${id}`))
    .map((message) => {
      const allParts = ModularCard.getCardPartDatas(message);
      const part = allParts == null ? null : allParts.getTypeData<T>(type);
      return {
        message: message,
        allParts: allParts,
        part: part,
      }
    }).filter(({part}) => part != null);
  }

}