import { UtilsDocument } from "../../../lib/db/utils-document";
import { RunOnce } from "../../../lib/decorator/run-once";
import { Component, OnInit, OnInitParam } from "../../../lib/render-engine/component";
import { ValueReader } from "../../../provider/value-provider";
import { staticValues } from "../../../static-values";
import { MyItem } from "../../../types/fixed-types";
import { UtilsFoundry } from "../../../utils/utils-foundry";
import { ModularCard } from "../../modular-card";
import { HtmlContext, ModularCardCreateArgs, ModularCardPart } from "../../modular-card-part";
import { BaseCardComponent } from "./base-card-component";

interface Property {
  text: string;
  highlight: boolean;
}

interface PropertyCardData {
  properties$: Array<Property>;
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
      this.getData<PropertyCardData>(PropertyCardPart.instance)
        .switchMap((data) => {
          return ValueReader.mergeObject({
            ...data,
            descriptionPermission: UtilsDocument.hasAllPermissions([{user: game.user, uuid: data.allParts.getItemUuid(), permission: `${staticValues.code}ReadItemDescription`}]),
          })
        })
        .listen(({part, descriptionPermission}) => {
          if (descriptionPermission) {
            this.properties = part.properties$.map((prop: PropertyCardData['properties$'][number]) => typeof prop === 'string' ? {text: prop, highlight: false} : prop);
          } else {
            this.properties = [];
          }
        })
    )
  }

}

export class PropertyCardPart implements ModularCardPart<PropertyCardData> {

  public static readonly instance = new PropertyCardPart();
  private constructor(){}
  
  public async create({item}: {item: MyItem}): Promise<PropertyCardData> {
    const chatData: {properties: string[]} = await item.getChatData();
    const itemData = UtilsFoundry.getSystemData(item);
    return {
      properties$: (chatData.properties ?? []).map(prop => {
        const consumed = itemData?.materials?.consumed;
        const propIsConsumed = itemData?.materials?.value != null && prop.includes(`(${itemData?.materials?.value})`);
        return {text: prop, highlight: consumed && propIsConsumed}
      }),
    };
  }

  public refresh(data: PropertyCardData, args: ModularCardCreateArgs): Promise<PropertyCardData> {
    return this.create(args);
  }

  public refreshVisual(data: PropertyCardData, args: ModularCardCreateArgs): Promise<PropertyCardData> {
    return this.refresh(data, args);
  }

  @RunOnce()
  public registerHooks(): void {
    ModularCard.registerModularCardPart(staticValues.moduleName, this);
  }

  public getType(): string {
    return 'PropertyCardPart';
  }

  //#region Front end
  public getHtml(data: HtmlContext): string {
    return `<${PropertyCardComponent.getSelector()} data-message-id="${data.messageId}"></${PropertyCardComponent.getSelector()}>`
  }
  //#endregion

}