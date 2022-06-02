import { UtilsDocument } from "../lib/db/utils-document";
import { RunOnce } from "../lib/decorator/run-once";
import { staticValues } from "../static-values";
import { ElementBuilder, OnAttributeChange } from "./element-builder";

export class TokenImgElement {

  public static selector(): string {
    return `${staticValues.code}-token-img`;
  }

  @RunOnce()
  public static registerHooks(): void {
    new ElementBuilder()
      .listenForAttribute('data-token-uuid', 'string')
      .listenForAttribute('data-token-img', 'string')
      .addOnAttributeChange(TokenImgElement.doRender)
      .setCss(/*css*/`
        :host {
          display: inline-block;
          height: 20px;
          width: 20px;
        }

        img {
          height: 100%;
          width: 100%;
        }
      `)
      .build(TokenImgElement.selector())
  }

  private static doRender: OnAttributeChange<{'data-token-uuid': string, 'data-token-img': string}> = async ({element, attributes}) => {
    console.log('doRender', attributes)
    if (!attributes['data-token-uuid']) {
      element.textContent = '';
      return;
    }

    const token = await UtilsDocument.tokenFromUuid(attributes['data-token-uuid']);
    let img: HTMLImageElement = element.querySelector('img');
    if (!img) {
      img = document.createElement('img');
      if (token) {
        img.addEventListener('mouseenter', () => {
          if (!canvas.ready) {
            return;
          }
          for (const canvasToken of game.canvas.tokens.placeables) {
            if (!canvasToken.visible || !canvasToken.can(game.user, "hover")) {
              continue;
            }
            if (canvasToken.document.uuid !== token.uuid) {
              continue;
            }
            // @ts-ignore
            canvasToken._onHoverIn(null, {hoverOutOthers: false});
          }
        });
        img.addEventListener('mouseleave', () => {
          if (!canvas.ready) {
            return;
          }
          for (const canvasToken of game.canvas.tokens.placeables) {
            if (!canvasToken.visible || !canvasToken.can(game.user, "hover")) {
              continue;
            }
            if (canvasToken.document.uuid !== token.uuid) {
              continue;
            }
            // @ts-ignore
            canvasToken._onHoverOut(null, {hoverOutOthers: false});
          }
        });
      }
      element.appendChild(img);
    }

    let imgUrl: string;
    if (token) {
      imgUrl = token.data.img;
    }
    if (!imgUrl) {
      imgUrl = attributes['data-token-img'];
    }
    if (!imgUrl) {
      imgUrl = CONST.DEFAULT_TOKEN;
    }
    img.setAttribute('src', imgUrl);
  }

}