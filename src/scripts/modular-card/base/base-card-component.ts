import { DocumentListener } from "../../lib/db/document-listener";
import { Attribute } from "../../lib/render-engine/component";
import { ValueProvider, ValueReader } from "../../provider/value-provider";
import { ModularCard, ModularCardPartData } from "../modular-card";
import { ModularCardPart } from "../modular-card-part";

export class BaseCardComponent {
  
  //#region input
  private _partId = new ValueProvider<string>();
  @Attribute('data-part-id')
  public get partId(): string {
    return this._partId.get();
  }
  public set partId(v: string) {
    this._partId.set(v);
  }
  
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
    .switchMap(id => ValueReader.mergeObject({
      message: DocumentListener.listenUuid<ChatMessage>(`ChatMessage.${id}`),
      partId: this._partId
    })).map(({message, partId}) => {
      const allParts = ModularCard.getCardPartDatas(message);
      const part: ModularCardPartData<T> = allParts == null ? null : allParts.find(p => p.id === partId && p.type === type.getType());
      return {
        message: message,
        allParts: allParts,
        part: part,
      }
    }).filter(({part}) => part != null);
  }

}