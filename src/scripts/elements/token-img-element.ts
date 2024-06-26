import { DocumentListener } from "../lib/db/document-listener";
import { RunOnce } from "../lib/decorator/run-once";
import { StaticInitFunc } from "../lib/decorator/static-init-func";
import { AsyncAttribute, Component, OnInit, OnInitParam } from "../lib/render-engine/component";
import { ValueProvider, ValueReader } from "../provider/value-provider";
import { staticValues } from "../static-values";
import { UtilsFoundry, Version } from "../utils/utils-foundry";

@Component({
  tag: TokenImgElement.selector(),
  html: /*html*/`<img [src]="this.tokenImgResult" (mouseEnter)="this.onMouseEnter()" (mouseLeave)="this.onMouseLeave()"/>`,
  style: /*css*/`
    :host {
      display: inline-block;
      height: 20px;
      width: 20px;
    }

    img {
      height: 100%;
      width: 100%;
    }
  `
})
export class TokenImgElement implements OnInit {

  public static selector(): string {
    return `${staticValues.code}-token-img`;
  }

  @AsyncAttribute('data-token-uuid')
  private tokenUuid$ = new ValueProvider<string>(null);

  @AsyncAttribute('data-token-img')
  private tokenImg$ = new ValueProvider<string>(null);

  public tokenImgResult: string = CONST.DEFAULT_TOKEN;
  
  private token: TokenDocument;
  public onInit(args: OnInitParam): void {
    args.addStoppable(
      ValueReader.mergeObject({
        token: this.tokenUuid$.switchMap(uuid => DocumentListener.listenUuid<TokenDocument>(uuid)),
        tokenImg: this.tokenImg$,
      }).listen(({token, tokenImg}) => {
        this.token = token;
        
        if (UtilsFoundry.usesDataModel()) {
          this.tokenImgResult = (token as any)?.texture?.src
        } else {
          this.tokenImgResult = token?.data?.img;
        }

        if (!this.tokenImgResult) {
          if (tokenImg) {
            this.tokenImgResult = tokenImg;
          } else {
            this.tokenImgResult = CONST.DEFAULT_TOKEN;
          }
        }
      })
    );
  }

  public onMouseEnter(): void {
    if (!this.token || !canvas.ready) {
      return;
    }
    for (const canvasToken of game.canvas.tokens.placeables) {
      if (!canvasToken.visible || !canvasToken.can(game.user, "hover")) {
        continue;
      }
      if (canvasToken.document.uuid !== this.token.uuid) {
        continue;
      }
      // @ts-ignore
      canvasToken._onHoverIn(TokenImgElement.getHoverEvent(), {hoverOutOthers: false});
    }
  }

  public async onMouseLeave(): Promise<void> {
    if (!this.token || !canvas.ready) {
      return;
    }
    for (const canvasToken of game.canvas.tokens.placeables) {
      if (!canvasToken.visible || !canvasToken.can(game.user, "hover")) {
        continue;
      }
      if (canvasToken.document.uuid !== this.token.uuid) {
        continue;
      }
      // @ts-ignore
      canvasToken._onHoverOut(TokenImgElement.getHoverEvent(), {hoverOutOthers: false});
    }
  }

  @RunOnce()
  public static registerHooks(): void {
    UtilsFoundry.getGameVersion({async: true}).then(v => {
      if (v >= new Version(11)) {
        // @ts-ignore
        TokenImgElement.getHoverEvent = () => new PIXI.FederatedEvent();
      }
    });
  }

  private static getHoverEvent(): PIXI.InteractionEvent {
    // V10 and lower
    return null;
  }

}