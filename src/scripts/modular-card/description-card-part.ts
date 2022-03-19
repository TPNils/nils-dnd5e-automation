import { RunOnce } from "../lib/decorator/run-once";
import { MemoryStorageService } from "../service/memory-storage-service";
import { staticValues } from "../static-values";
import { createElement, ICallbackAction } from "./card-part-element";
import { ModularCard } from "./modular-card";
import { HtmlContext, ModularCardCreateArgs, ModularCardPart } from "./modular-card-part";

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
  
  public create({item}: ModularCardCreateArgs): DescriptionCardData[] {
    return [{
      calc$: {
        name: item.name,
        img: item.img,
        description: item.data?.data?.description?.value,
        materials: item.data?.data?.materials?.value,
      }
    }];
  }

  public refresh(data: DescriptionCardData[], args: ModularCardCreateArgs): DescriptionCardData[] {
    return this.create(args);
  }

  @RunOnce()
  public registerHooks(): void {
    createElement({
      selector: this.getType(),
      getHtml: context => this.getElementHtml(context),
      getCallbackActions: () => this.getCallbackActions(),
    });
    ModularCard.registerModularCardPart(staticValues.moduleName, this);
  }

  public getType(): string {
    return `${staticValues.code}-description-part`;
  }

  public getElementHtml(context: HtmlContext<DescriptionCardData>): string | Promise<string> {
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