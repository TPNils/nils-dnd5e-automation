import { ElementBuilder } from "../../elements/element-builder";
import { DocumentListener } from "../../lib/db/document-listener";
import { RunOnce } from "../../lib/decorator/run-once";
import { Attribute, Component, OnInit, OnInitParam } from "../../lib/render-engine/component";
import { ValueProvider, ValueReader } from "../../provider/value-provider";
import { staticValues } from "../../static-values";
import { MyItem } from "../../types/fixed-types";
import { ItemCardHelpers } from "../item-card-helpers";
import { ModularCard, ModularCardPartData } from "../modular-card";
import { HtmlContext, ModularCardCreateArgs, ModularCardPart } from "../modular-card-part";

interface PropertyCardData {
  properties$: string[];
}

@Component({
  tag: PropertyCardComponent.getSelector(),
  html: /*html*/`
  <div class="footer">
    <span *if="this.part != null" *for="let prop of this.part.data.properties$">{{prop}}</span>
  </div>
  `,
  style: /*css*/`
    :host {
      display: block;
    }

    .footer {
      padding: 3px 0 0;
      border-top: 2px groove #FFF;
    }

    span {
      border-right: 2px groove #FFF;
      padding: 0 3px 0 0;
      font-size: 10px;
    }
  `
})
export class PropertyCardComponent implements OnInit {

  public static getSelector(): string {
    return `${staticValues.code}-property-part`;
  }
  
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
  
  public part: ModularCardPartData<PropertyCardData>;
  public onInit(args: OnInitParam): void {
    args.addStoppable(
      this._messageId
        .switchMap(id => ValueReader.mergeObject({
          message: DocumentListener.listenUuid<ChatMessage>(`ChatMessage.${id}`),
          partId: this._partId
        }))
        .listen(({message, partId}) => {
          const allParts = ModularCard.getCardPartDatas(message);
          if (allParts != null) {
            this.part = allParts.find(p => p.id === partId && p.type === PropertyCardPart.instance.getType());
          }
        })
    )
  }

}

export class PropertyCardPart implements ModularCardPart<PropertyCardData> {

  public static readonly instance = new PropertyCardPart();
  private constructor(){}
  
  public create({item}: {item: MyItem}): PropertyCardData {
    return {
      properties$: item.getChatData().properties,
    };
  }

  public refresh(data: PropertyCardData, args: ModularCardCreateArgs): PropertyCardData {
    return this.create(args);
  }

  @RunOnce()
  public registerHooks(): void {
    ModularCard.registerModularCardPart(staticValues.moduleName, this);
  }

  public getType(): string {
    return this.constructor.name;
  }

  //#region Front end
  public getHtml(data: HtmlContext): string {
    return `<${PropertyCardComponent.getSelector()} data-part-id="${data.partId}" data-message-id="${data.messageId}"></${PropertyCardComponent.getSelector()}>`
  }
  //#endregion

}