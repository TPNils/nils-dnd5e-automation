import { RunOnce } from "../lib/decorator/run-once";
import { staticValues } from "../static-values";
import { MyItem } from "../types/fixed-types";
import { ModularCard } from "./modular-card";
import { HtmlContext, ICallbackAction, ModularCardPart } from "./modular-card-part";

interface PropertyCardData {
  calc$: {
    properties: string[];
  }
}

export class PropertyCardPart implements ModularCardPart<PropertyCardData> {
  
  public static create({item}: {item: MyItem}): PropertyCardData[] {
    return [{
      calc$: {
        properties: item.getChatData().properties,
      }
    }];
  }

  @RunOnce()
  public static registerHooks(): void {
    ModularCard.registerModularCardPart(staticValues.moduleName, new PropertyCardPart());
  }

  public getType(): string {
    return this.constructor.name;
  }

  public getHtml(context: HtmlContext<PropertyCardData>): string | Promise<string> {
    return renderTemplate(
      `modules/${staticValues.moduleName}/templates/modular-card/property-part.hbs`, {
        data: context.data,
        messageId: context.messageId,
        moduleName: staticValues.moduleName
      }
    );
  }

  public getCallbackActions(): ICallbackAction<PropertyCardData>[] {
    return []
  }

}