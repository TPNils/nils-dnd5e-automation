import { UtilsDocument } from "../lib/db/utils-document";
import { RunOnce } from "../lib/decorator/run-once";
import { Attribute, Component } from "../lib/render-engine/component";
import { staticValues } from "../static-values";

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
export class TokenImgElement {

  public static selector(): string {
    return `${staticValues.code}-token-img`;
  }

  private token: TokenDocument;
  @Attribute('data-token-uuid')
  public set tokenUuid(value: string) {
    UtilsDocument.tokenFromUuid(value).then(token => {
      this.token = token;
    })
  };
  @Attribute('data-token-img')
  public tokenImg: string;

  public get tokenImgResult(): string {
    if (this.token?.data?.img) {
      return this.token.data.img;
    }
    if (this.tokenImg) {
      return this.tokenImg;
    }
    return CONST.DEFAULT_TOKEN;
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
      canvasToken._onHoverIn(null, {hoverOutOthers: false});
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
      canvasToken._onHoverOut(null, {hoverOutOthers: false});
    }
  }

  @RunOnce()
  public static registerHooks(): void {
  }

}