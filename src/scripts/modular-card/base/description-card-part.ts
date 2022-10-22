import { DocumentListener } from "../../lib/db/document-listener";
import { RunOnce } from "../../lib/decorator/run-once";
import { Attribute, Component, OnInitParam } from "../../lib/render-engine/component";
import { ValueProvider, ValueReader } from "../../provider/value-provider";
import { staticValues } from "../../static-values";
import { UtilsLog } from "../../utils/utils-log";
import { ModularCard, ModularCardPartData } from "../modular-card";
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

@Component({
  tag: DescriptionCardComponent.getSelector(),
  html: /*html*/`
  <div class="header" (click)="this.toggleCollapsed()">
    <img [src]="this.image" [title]="this.name" width="36" height="36"/>
    <h3 class="item-name">{{this.name}}</h3>
  </div>

  <div class="section description {{this.collapsed ? '' : 'open'}}">
    <div *if="this.description" [innerHTML]="this.description">
    </div>
    <p *if="this.materials">
      <strong>{{ this.localeRequiredMaterials }}.</strong>
      {{ this.materials }}
    </p>
  </div>
  `,
  style: /*css*/`
    .description:not(.open) {
      display: none;
    }
    
    .header {
      padding: 3px 0;
      border-top: 2px groove #FFFFFF;
      border-bottom: 2px groove #FFFFFF;
      display: flex;
      gap: 4px;
    }
    

    .header .item-name {
      flex: 1;
      margin: 0;
      line-height: 36px;
      font-family: "Modesto Condensed", "Palatino Linotype", serif;
      font-size: 20px;
      font-weight: 700;
      color: #4b4a44;
    }

    .header,
    .section {
      margin: 5px 0;
    }
  `
})
export class DescriptionCardComponent {

  public static getSelector(): string {
    return `${staticValues.code}-description-part`;
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
  
  public collapsed = getDefaultCardCollpased();
  public localeRequiredMaterials = game.i18n.localize('DND5E.RequiredMaterials')
  public name: string = '';
  public image: string;
  public description: string;
  public materials: string;
  public onInit(args: OnInitParam): void {
    args.addStoppable(
      this._messageId
        .switchMap(id => ValueReader.mergeObject({
          message: DocumentListener.listenUuid<ChatMessage>(`ChatMessage.${id}`),
          partId: this._partId
        }))
        .listen(({message, partId}) => {
          const allParts = ModularCard.getCardPartDatas(message);
          let part: ModularCardPartData<DescriptionCardData>;
          if (allParts != null) {
            part = allParts.find(p => p.id === partId && p.type === DescriptionCardPart.instance.getType());
          }
          UtilsLog.debug(part, allParts, partId)
          
          this.name = part?.data?.name$;
          this.image = part?.data?.img$;
          this.materials = part?.data?.materials$;
          this.description = part?.data?.description$;
          if (this.description) {
            const enrichOptions: Partial<Parameters<typeof TextEditor['enrichHTML']>[1]> = {};
            if (game.user.isGM) {
              enrichOptions.secrets = true;
            }
            this.description = TextEditor.enrichHTML(this.description, enrichOptions as any);
          }
        })
    )
  }

  public toggleCollapsed() {
    this.collapsed = !this.collapsed;
  }

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
    ModularCard.registerModularCardPart(staticValues.moduleName, this);
  }

  public getType(): string {
    return this.constructor.name;
  }

  //#region Front end
  public getHtml(data: HtmlContext): string {
    return `<${DescriptionCardComponent.getSelector()} data-part-id="${data.partId}" data-message-id="${data.messageId}"></${DescriptionCardComponent.getSelector()}>`
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