import { DocumentListener } from "../../lib/db/document-listener";
import { Attribute } from "../../lib/render-engine/component";
import { ValueProvider, ValueReader } from "../../provider/value-provider";

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

  protected getData() {
    return this._messageId
    .switchMap(id => ValueReader.mergeObject({
      message: DocumentListener.listenUuid<ChatMessage>(`ChatMessage.${id}`),
      partId: this._partId
    }));
  }

}