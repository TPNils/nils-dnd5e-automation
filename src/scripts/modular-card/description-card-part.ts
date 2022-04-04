import { ElementBuilder, ElementCallbackBuilder } from "../elements/element-builder";
import { RunOnce } from "../lib/decorator/run-once";
import { MemoryStorageService } from "../service/memory-storage-service";
import { staticValues } from "../static-values";
import { HtmlContext } from "./card-part-element";
import { ItemCardHelpers } from "./item-card-helpers";
import { ModularCard } from "./modular-card";
import { ModularCardCreateArgs, ModularCardPart } from "./modular-card-part";

interface DescriptionCardData {
  calc$: {
    name: string;
    img: string;
    description?: string;
    materials?: string;
  }
}

function getDefaultCardCollpased(): boolean {
  return !!game.settings.get('dnd5e', 'autoCollapseItemCards');
}

export class DescriptionCardPart implements ModularCardPart<DescriptionCardData> {

  public static readonly instance = new DescriptionCardPart();
  private constructor(){}
  
  public create({item}: ModularCardCreateArgs): DescriptionCardData {
    return {
      calc$: {
        name: item.name,
        img: item.img,
        description: item.data?.data?.description?.value,
        materials: item.data?.data?.materials?.value,
      }
    };
  }

  public refresh(data: DescriptionCardData, args: ModularCardCreateArgs): DescriptionCardData {
    return this.create(args);
  }

  @RunOnce()
  public registerHooks(): void {
    new ElementBuilder()
      .listenForAttribute('data-part-id', 'string')
      .listenForAttribute('data-message-id', 'string')
      .addListener(new ElementCallbackBuilder()
        .setEvent('click')
        //.setFilter('[data-action="toggle-collapse"]')
        .setExecute(({element}) => {
          const collapsed$ = MemoryStorageService.getElementValue<boolean>(element, `cardCollapse`, getDefaultCardCollpased);
          console.log('set', !collapsed$.get())
          collapsed$.set(!collapsed$.get());
        })
      )
      .addOnInit(({element}) => {
        const collapsed$ = MemoryStorageService.getElementValue<boolean>(element, `cardCollapse`, getDefaultCardCollpased);
        collapsed$.listen(value => DescriptionCardPart.setCollpasedState(element, !!value));
      })
      .addOnAttributeChange(async ({element, attributes}) => {
        const allParts = ModularCard.getCardPartDatas(game.messages.get(attributes['data-message-id']));
        if (allParts == null) {
          element.innerText = '';
          return;
        }
        const data: DescriptionCardData = allParts.find(p => p.id === attributes['data-part-id'] && p.type === this.getType())?.data;
        if (data == null) {
          element.innerText = '';
          return;
        }
        
        element.innerHTML = await renderTemplate(
          `modules/${staticValues.moduleName}/templates/modular-card/description-part.hbs`, {
            data: data,
            messageId: attributes['data-message-id'],
            moduleName: staticValues.moduleName
          }
        );
        DescriptionCardPart.setCollpasedState(element, !!MemoryStorageService.getElementValue<boolean>(element, `cardCollapse`, getDefaultCardCollpased).get());
      })
      .build(this.getSelector())
    
    ModularCard.registerModularCardPart(staticValues.moduleName, this);
  }

  public getType(): string {
    return this.constructor.name;
  }

  //#region Front end
  public getSelector(): string {
    return `${staticValues.code}-description-part`;
  }

  public getHtml(data: HtmlContext): string {
    return `<${this.getSelector()} data-part-id="${data.partId}" data-message-id="${data.messageId}"></${this.getSelector()}>`
  }

  private static setCollpasedState(element: HTMLElement, shouldBeCollapsed: boolean): void {
    const wrapper = element.querySelector(':scope > .description');
    if (!wrapper) {
      return;
    }
    
    const isCurrentlyCollapsed = !wrapper.classList.contains('open');
    console.log(isCurrentlyCollapsed, '!==', shouldBeCollapsed)
    if (isCurrentlyCollapsed !== shouldBeCollapsed) {
      if (shouldBeCollapsed) {
        wrapper.classList.remove('open');
      } else {
        wrapper.classList.add('open');
      }
    }
  }
  //#endregion

}