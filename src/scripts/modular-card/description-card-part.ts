import { RunOnce } from "../lib/decorator/run-once";
import { MemoryStorageService } from "../service/memory-storage-service";
import { staticValues } from "../static-values";
import { MyItem } from "../types/fixed-types";
import { ItemCard } from "../utils/utils-chat-message";
import { ModularCard } from "./modular-card";
import { HtmlContext, ICallbackAction, ModularCardPart } from "./modular-card-part";

interface DescriptionCardData {
  calc$: {
    name: string;
    img: string;
    description?: string;
    materials?: string;
  }
}

export class DescriptionCardPart implements ModularCardPart<DescriptionCardData> {

  public static readonly instance = new DescriptionCardPart();
  private constructor(){}
  
  public generate({item}: {item: MyItem}): DescriptionCardData[] {
    return [{
      calc$: {
        name: item.name,
        img: item.img,
        description: item.data?.data?.description?.value,
        materials: item.data?.data?.materials?.value,
      }
    }];
  }

  @RunOnce()
  public registerHooks(): void {
    ModularCard.registerModularCardPart(staticValues.moduleName, this);
  }

  public getType(): string {
    return this.constructor.name;
  }

  public getHtml(context: HtmlContext<DescriptionCardData>): string | Promise<string> {
    return renderTemplate(
      `modules/${staticValues.moduleName}/templates/modular-card/description-part.hbs`, {
        data: context.data,
        messageId: context.messageId,
        moduleName: staticValues.moduleName
      }
    );
  }

  public getCallbackActions(): ICallbackAction<DescriptionCardData>[] {
    return [
      {
        regex: /^toggle-collapse$/,
        execute: ({messageId}) => this.toggleCollapse(messageId),
      },
    ]
  }
  
  private toggleCollapse(messageId: string): void {
    MemoryStorageService.setCardCollapse(messageId, !MemoryStorageService.isCardCollapsed(messageId));
    ui.chat.updateMessage(game.messages.get(messageId));
  }

}