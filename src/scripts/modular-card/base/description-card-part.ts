import { ElementBuilder, ElementCallbackBuilder } from "../../elements/element-builder";
import { RunOnce } from "../../lib/decorator/run-once";
import { MemoryStorageService } from "../../service/memory-storage-service";
import { staticValues } from "../../static-values";
import { ItemCardHelpers } from "../item-card-helpers";
import { ModularCard } from "../modular-card";
import { ModularCardPart, ModularCardCreateArgs, HtmlContext } from "../modular-card-part";

interface DescriptionCardData {
  name$: string;
  img$: string;
  description$?: string;
  materials$?: string;
}

function getDefaultCardCollpased(): boolean {
  return !!game.settings.get('dnd5e', 'autoCollapseItemCards');
}

export class DescriptionCardPart implements ModularCardPart<DescriptionCardData> {

  public static readonly instance = new DescriptionCardPart();
  private constructor(){}
  
  public create({item}: ModularCardCreateArgs): DescriptionCardData {
    return {
      name$: item.name,
      img$: item.img,
      description$: item.data?.data?.description?.value,
      materials$: item.data?.data?.materials?.value,
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
          collapsed$.set(!collapsed$.get());
        })
      )
      .addOnInit(({element}) => {
        const collapsed$ = MemoryStorageService.getElementValue<boolean>(element, `cardCollapse`, getDefaultCardCollpased);
        collapsed$.listen(value => DescriptionCardPart.setCollpasedState(element, !!value));
      })
      .addOnAttributeChange(({element, attributes}) => {
        return ItemCardHelpers.ifAttrData<DescriptionCardData>({attr: attributes, element, type: this, callback: async ({part}) => {
          let description = part.data.description$;
          if (description) {
            const enrichOptions: Partial<Parameters<typeof TextEditor['enrichHTML']>[1]> = {};
            if (game.user.isGM) {
              enrichOptions.secrets = true;
            }
            description = TextEditor.enrichHTML(description, enrichOptions as any);
          }
          element.innerHTML = await renderTemplate(
            `modules/${staticValues.moduleName}/templates/modular-card/description-part.hbs`, {
              data: {
                ...part.data,
                description$: description,
              },
              messageId: attributes['data-message-id'],
              moduleName: staticValues.moduleName
            }
          );
          DescriptionCardPart.setCollpasedState(element, !!MemoryStorageService.getElementValue<boolean>(element, `cardCollapse`, getDefaultCardCollpased).get());
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