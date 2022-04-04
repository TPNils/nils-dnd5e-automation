import { ElementBuilder } from "../elements/element-builder";
import { RunOnce } from "../lib/decorator/run-once";
import { staticValues } from "../static-values";
import { MyItem } from "../types/fixed-types";
import { createElement, HtmlContext } from "./card-part-element";
import { ItemCardHelpers } from "./item-card-helpers";
import { ModularCard } from "./modular-card";
import { ModularCardCreateArgs, ModularCardPart } from "./modular-card-part";

interface PropertyCardData {
  calc$: {
    properties: string[];
  }
}

export class PropertyCardPart implements ModularCardPart<PropertyCardData> {

  public static readonly instance = new PropertyCardPart();
  private constructor(){}
  
  public create({item}: {item: MyItem}): PropertyCardData {
    return {
      calc$: {
        properties: item.getChatData().properties,
      }
    };
  }

  public refresh(data: PropertyCardData, args: ModularCardCreateArgs): PropertyCardData {
    return this.create(args);
  }

  @RunOnce()
  public registerHooks(): void {
    new ElementBuilder()
      .listenForAttribute('data-part-id', 'string')
      .listenForAttribute('data-message-id', 'string')
      .addOnAttributeChange(({element, attributes}) => {
        return ItemCardHelpers.ifAttrData({attr: attributes, element, type: this, callback: async ({part}) => {
          element.innerHTML = await renderTemplate(
            `modules/${staticValues.moduleName}/templates/modular-card/property-part.hbs`, {
              data: part.data,
              moduleName: staticValues.moduleName
            });
          
        }});
      })
      .build(this.getSelector())
    
    ModularCard.registerModularCardPart(staticValues.moduleName, this);
  }

  public getType(): string {
    return this.constructor.name;
  }

  //#region Front end
  public getSelector(): string {
    return `${staticValues.code}-property-part`;
  }

  public getHtml(data: HtmlContext): string {
    return `<${this.getSelector()} data-part-id="${data.partId}" data-message-id="${data.messageId}"></${this.getSelector()}>`
  }
  //#endregion

}