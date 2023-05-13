import { DocumentListener } from "../../lib/db/document-listener";
import { UtilsDocument } from "../../lib/db/utils-document";
import { RunOnce } from "../../lib/decorator/run-once";
import { Component, OnInit, OnInitParam } from "../../lib/render-engine/component";
import { ValueReader } from "../../provider/value-provider";
import { staticValues } from "../../static-values";
import { ModularCard } from "../modular-card";
import { ModularCardPart, ModularCardCreateArgs, HtmlContext } from "../modular-card-part";
import { BaseCardComponent } from "./base-card-component";

interface DescriptionCardData {
  uuid$: string;
  name$: string;
  img$: string;
  description$?: string;
  materials$?: string;
}

let defaultCardCollpased = false;
DocumentListener.listenSettingValue<boolean>('dnd5e', 'autoCollapseItemCards').listen(value => {
  defaultCardCollpased = value;
})

@Component({
  tag: DescriptionCardComponent.getSelector(),
  html: /*html*/`
  <div class="header" (click)="this.toggleCollapsed()">
    <img [src]="this.image" [title]="this.name" width="36" height="36"/>
    <h3 class="name">{{this.name}}</h3>
  </div>

  <div class="section description {{this.collapsed ? '' : 'open'}}">
    <div *if="this.description" class="desc">{{{this.description}}}</div>
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
    

    .header .name {
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
export class DescriptionCardComponent extends BaseCardComponent implements OnInit {

  public static getSelector(): string {
    return `${staticValues.code}-description-part`;
  }
  
  public collapsed = defaultCardCollpased;
  public localeRequiredMaterials = game.i18n.localize('DND5E.RequiredMaterials')
  public name: string = '';
  public image: string = '';
  public description: string = '';
  public materials: string;
  public onInit(args: OnInitParam): void {
    args.addStoppable(
      this.getData<DescriptionCardData>(DescriptionCardPart.instance)
        .switchMap((data) => {
          return ValueReader.mergeObject({
            ...data,
            namePermission: UtilsDocument.hasAllPermissions([{user: game.user, uuid: data.part.uuid$, permission: `${staticValues.code}ReadItemName`}]),
            imagePermission: UtilsDocument.hasAllPermissions([{user: game.user, uuid: data.part.uuid$, permission: `${staticValues.code}ReadItemImage`}]),
            descriptionPermission: UtilsDocument.hasAllPermissions([{user: game.user, uuid: data.part.uuid$, permission: `${staticValues.code}ReadItemDescription`}]),
          })
        })
        .listen(async ({part, namePermission, imagePermission, descriptionPermission}) => {
          this.name = namePermission ? part.name$ : `${game.i18n.localize(`Hidden`)}`;
          this.image = imagePermission ? part.img$ : 'icons/svg/combat.svg';
          this.materials = descriptionPermission ? part.materials$ : '';

          let description = descriptionPermission ? part.description$ : '';
          if (description) {
            const enrichOptions: Partial<Parameters<typeof TextEditor['enrichHTML']>[1]> = {async: true} as any;
            if (game.user.isGM) {
              enrichOptions.secrets = true;
            }
            this.description = await TextEditor.enrichHTML(description, enrichOptions as any);
          } else {
            this.description = description;
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
      uuid$: item.uuid,
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
    return 'DescriptionCardPart';
  }

  //#region Front end
  public getHtml(data: HtmlContext): string {
    return `<${DescriptionCardComponent.getSelector()} data-message-id="${data.messageId}"></${DescriptionCardComponent.getSelector()}>`
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