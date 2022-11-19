import { RunOnce } from "../../lib/decorator/run-once";
import { Component, OnInit, OnInitParam } from "../../lib/render-engine/component";
import { staticValues } from "../../static-values";
import { MyItem } from "../../types/fixed-types";
import { ModularCard, ModularCardPartData } from "../modular-card";
import { HtmlContext, ModularCardCreateArgs, ModularCardPart } from "../modular-card-part";
import { BaseCardComponent } from "./base-card-component";

interface Property {
  text: string;
  highlight: boolean;
}

interface PropertyCardData {
  properties$: Array<Property> | string[]; // string[] is deprecaded
}

@Component({
  tag: PropertyCardComponent.getSelector(),
  html: /*html*/`
  <div class="footer">
    <span *for="let prop of this.properties" class="{{prop.highlight ? 'highlight' : ''}}">{{prop.text}}</span>
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

    .highlight {
      font-weight: bold;
    }
  `
})
export class PropertyCardComponent extends BaseCardComponent implements OnInit {

  public static getSelector(): string {
    return `${staticValues.code}-property-part`;
  }
  
  public properties: Property[] = [];
  public onInit(args: OnInitParam): void {
    args.addStoppable(
      this.getData().listen(({message, partId}) => {
          const allParts = ModularCard.getCardPartDatas(message);
          const part: ModularCardPartData<PropertyCardData> = allParts == null ? null : allParts.find(p => p.id === partId && p.type === PropertyCardPart.instance.getType());
          this.properties = part.data.properties$.map(prop => typeof prop === 'string' ? {text: prop, highlight: false} : prop);
        })
    )
  }

}

export class PropertyCardPart implements ModularCardPart<PropertyCardData> {

  public static readonly instance = new PropertyCardPart();
  private constructor(){}
  
  public async create({item}: {item: MyItem}): Promise<PropertyCardData> {
    const chatData: {properties: string[]} = await item.getChatData();
    return {
      properties$: (chatData.properties ?? []).map(prop => {
        const consumed = item.data?.data?.materials.consumed;
        const propIsConsumed = item.data?.data?.materials?.value != null && prop.includes(`(${item.data?.data?.materials?.value})`);
        return {text: prop, highlight: consumed && propIsConsumed}
      }),
    };
  }

  public refresh(data: PropertyCardData, args: ModularCardCreateArgs): Promise<PropertyCardData> {
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