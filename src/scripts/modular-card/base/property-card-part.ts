import { RunOnce } from "../../lib/decorator/run-once";
import { Component, OnInit, OnInitParam } from "../../lib/render-engine/component";
import { staticValues } from "../../static-values";
import { MyItem } from "../../types/fixed-types";
import { UtilsLog } from "../../utils/utils-log";
import { ModularCard, ModularCardPartData } from "../modular-card";
import { HtmlContext, ModularCardCreateArgs, ModularCardPart } from "../modular-card-part";
import { BaseCardComponent } from "./base-card-component";

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
export class PropertyCardComponent extends BaseCardComponent implements OnInit {

  public static getSelector(): string {
    return `${staticValues.code}-property-part`;
  }
  
  public part: ModularCardPartData<PropertyCardData>;
  public onInit(args: OnInitParam): void {
    args.addStoppable(
      this.getData().listen(({message, partId}) => {
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
  
  public async create({item}: {item: MyItem}): Promise<PropertyCardData> {
    const chatData = await item.getChatData();
    return {
      properties$: chatData.properties ?? [],
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