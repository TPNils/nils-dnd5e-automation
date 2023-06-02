import { DocumentListener } from "../lib/db/document-listener";
import { Component, OnInit, OnInitParam } from "../lib/render-engine/component";
import { Stoppable } from "../lib/utils/stoppable";
import { staticValues } from "../static-values";
import { ModularCard } from "./modular-card";

@Component({
  tag: ModularCardComponent.getSelector(),
  html: /*html*/`
    <div class="item-card">{{{this.body}}}</div>
    <div class="placeholder">
      <slot name="not-installed-placeholder"></slot>
    </div>
  `,
  style: /*css*/`
    .placeholder {
      display: none;
    }

    /* root layout */
    .item-card {
      display: grid;
      grid-template-columns: repeat(10, 1fr);
    }

    .item-card :deep > * {
      grid-column: span 10;
    }

    /*Firefox does not support :has => solved in an other way */
    .item-card.has-nd5e-attack-part.has-nd5e-damage-part :deep > nd5e-attack-part,
    .item-card.has-nd5e-attack-part.has-nd5e-damage-part :deep > nd5e-damage-part {
      grid-column: span 5;
    }

    /* "global" css for this module */
    .item-card {
      font-style: normal;
      font-size: var(--font-size-12, 12px);
      --button-height: calc(2em - 2px);
    }

    :deep button {
      display: flex;
      justify-content: center;
      align-items: center;
      background: rgb(190, 189, 178);
      border: 2px groove #eeede0;
      height: var(--button-height);
      line-height: calc(var(--button-height) - 4px);
    }
    
    :deep .overlay {
      display: flex;
      position: absolute;
      left: 0px;
      top: 0px;
      width: 100%;
      height: 100%;
      pointer-events: none;
      padding: 3px;
    }
    
    :deep .overlay > .left,
    :deep .overlay > .right {
      pointer-events: initial;
      display: flex;
      width: fit-content;
    }
    
    :deep .overlay > .middel {
      flex-grow: 1;
    }
    
    /* default foundry css */
    :deep .table {
      padding-left: 2px;
    }
    
    :deep .header-cell {
      background: rgba(0, 0, 0, 0.5);
      color: #f0f0e0;
      text-shadow: 1px 1px #000;
      border-bottom: 1px solid #000;
    }
        
    :deep .body-cell,
    :deep .header-cell {
      padding: 0.25em 1px;
      min-height: 1.8em;
      text-align: center;
    }
  `,
})
export class ModularCardComponent implements OnInit {

  public static getSelector(): string {
    return `${staticValues.code}-modular-card`;
  }

  public body = '';
  public onInit(args: OnInitParam) {
    args.addStoppable(this.provideHasClasses(args.html));

    const messageIdElement = args.html.closest('[data-message-id]');
    if (!messageIdElement) {
      this.body = '';
      return;
    }

    const messageId = messageIdElement.getAttribute('data-message-id');
    args.addStoppable(
      DocumentListener.listenUuid<ChatMessage>(game.messages.get(messageId).uuid)
        .listen(async message => {
          const body = await this.calcBody(message);
          if (this.body !== body) {
            this.body = body;
          }
        })
    );
  }

  private provideHasClasses(thisElement: HTMLElement): Stoppable {
    
    const observer = new MutationObserver((mutationsList, observer) => {
      
      // Add child tags to item card as a replacement for :has
      for (const item of mutationsList) {
        for (const node of Array.from(item.addedNodes)) {
          if (node instanceof Element) {
            node.parentElement.classList.add(`has-${node.tagName.toLowerCase()}`);
          }
        }
        for (const node of Array.from(item.removedNodes)) {
          if (node instanceof Element && item.target instanceof Element) {
            item.target.classList.remove(`has-${node.tagName.toLowerCase()}`);
          }
        }
      }
    });

    const itemCard = thisElement.querySelector(':scope > .item-card');
    observer.observe(itemCard, { childList: true });

    return {
      stop: () => observer.disconnect()
    }
  }

  private async calcBody(message: ChatMessage): Promise<string> {
    const parts = ModularCard.getCardPartDatas(message);
    if (!parts) {
      return ''
    }

    const htmlParts$: Array<{html: string} | Promise<{html: string}>> = [];
    for (const typeHandler of parts.getAllTypes()) {
      const partData = parts.getTypeData(typeHandler);

      // TODO error handeling during render
      if (typeHandler?.getHtml) {
        const htmlPart = typeHandler.getHtml({messageId: message.id, data: partData, allMessageParts: parts});
        if (htmlPart instanceof Promise) {
          htmlParts$.push(htmlPart.then(html => {return {html: html}}));
        } else if (typeof htmlPart === 'string') {
          htmlParts$.push({html: htmlPart});
        }
      }
    }

    const enrichOptions: Partial<Parameters<typeof TextEditor['enrichHTML']>[1]> = {async: true} as any;
    if (game.user.isGM) {
      enrichOptions.secrets = true;
    }
    
    const htmlParts = (await Promise.all(htmlParts$)).filter(part => part.html != null);

    const enrichedHtmlParts: string[] = [];
    for (const enrichedPart of await Promise.all(htmlParts.map(part => TextEditor.enrichHTML(part.html, enrichOptions as any)))) {
      enrichedHtmlParts.push(enrichedPart);
    }
    return enrichedHtmlParts.join('');
  }

}