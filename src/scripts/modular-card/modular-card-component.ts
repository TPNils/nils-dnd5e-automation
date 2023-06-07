import { DocumentListener } from "../lib/db/document-listener";
import { Component, OnInit, OnInitParam } from "../lib/render-engine/component";
import { Stoppable } from "../lib/utils/stoppable";
import { ValueReader } from "../provider/value-provider";
import { staticValues } from "../static-values";
import { MyActor, MyItem } from "../types/fixed-types";
import { UtilsLog } from "../utils/utils-log";
import { ModularCard, ModularCardInstance } from "./modular-card";
import { ModularCardCreateArgs, ModularCardPart } from "./modular-card-part";
import { UtilsCompare } from "../lib/utils/utils-compare";

@Component({
  tag: ModularCardComponent.getSelector(),
  html: /*html*/`
    <div class="item-card">{{{this.body}}}</div>
    <div *if="erroredTypes.length > 0" class="errors">
      Internal errors in these components: {{erroredTypes.join(', ')}}.
    </div>
    <div class="placeholder">
      <slot name="not-installed-placeholder"></slot>
    </div>
  `,
  style: scss`
    .placeholder {
      display: none;
    }

    .errors {
      color: red;
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
  public erroredTypes: string[] = [];
  public onInit(args: OnInitParam) {
    args.addStoppable(this.provideHasClasses(args.html));

    const messageIdElement = args.html.closest('[data-message-id]');
    if (!messageIdElement) {
      this.body = '';
      return;
    }

    const messageId = messageIdElement.getAttribute('data-message-id');
    const messageListener = DocumentListener.listenUuid<ChatMessage>(game.messages.get(messageId).uuid);
    args.addStoppable(
      messageListener.listen(async message => {
        const content = await ModularCardComponent.calcContent(message);
        if (this.body !== content.body || !UtilsCompare.deepEquals(this.erroredTypes, content.errors)) {
          this.body = content.body;
          this.erroredTypes = content.errors;
        }
      }),
      messageListener
        // TODO Only 1 user should update the message, even when the creator is offline
        .map(message => ({message: message, parts: ModularCard.readModuleCard(message)}))
        .filter(parts => !!parts)
        .switchMap(({message, parts}) => {
          return ValueReader.mergeObject({
            message: message,
            parts: parts,
            item: parts.getItemUuid() == null ? null : DocumentListener.listenUuid<MyItem>(parts.getItemUuid()),
            actor: parts.getActorUuid() == null ? null : DocumentListener.listenUuid<MyActor>(parts.getActorUuid()).first(),
            token: parts.getTokenUuid() == null ? null : DocumentListener.listenUuid<TokenDocument>(parts.getTokenUuid()).first(),
          })
        }).listen(((args) => {
          this.refreshMessage(args.message, args.parts, args);
        })),
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

  private static async calcContent(message: ChatMessage): Promise<{body: string, errors: string[]}> {
    const parts = ModularCard.readModuleCard(message);
    if (!parts) {
      return {body: '', errors: []}
    }

    const htmlParts$: Array<{html: string} | Promise<{html: string}>> = [];
    const erroredTypes: ModularCardPart[] = [];
    for (const typeHandler of parts.getAllTypes()) {
      const partData = parts.getTypeData(typeHandler);

      if (typeHandler?.getHtml) {
        try {
          const htmlPart = typeHandler.getHtml({messageId: message.id, data: partData, allMessageParts: parts});
          if (htmlPart instanceof Promise) {
            htmlParts$.push(htmlPart.then(html => {return {html: html}}).catch(e => {
              UtilsLog.error('An error occurred when trying generate the html for a card part.', {typeHandler, messageId: message.id, data: partData, allMessageParts: parts}, e);
              erroredTypes.push(typeHandler);
              return {html: null};
            }));
          } else if (typeof htmlPart === 'string') {
            htmlParts$.push({html: htmlPart});
          }
        } catch (e) {
          UtilsLog.error('An error occurred when trying generate the html for a card part.', {typeHandler, messageId: message.id, data: partData, allMessageParts: parts}, e);
          erroredTypes.push(typeHandler)
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
    return {body: enrichedHtmlParts.join(''), errors: erroredTypes.map(e => e.getType())};
  }

  private latestCreateArgs: ModularCardCreateArgs
  private async refreshMessage(message: ChatMessage, parts: ModularCardInstance, args: ModularCardCreateArgs): Promise<void> {
    if (args.item == null || args.actor == null || args.token == null) {
      // Don't refresh
      return;
    }
    if (this.latestCreateArgs == null) {
      this.latestCreateArgs = args;
      return;
    }

    if (this.latestCreateArgs.item !== args.item || this.latestCreateArgs.actor !== args.actor || this.latestCreateArgs.token !== args.token) {
      const updatedParts = await ModularCard.createInstanceNoDml(args, {type: 'visual', instance: parts});
      await ModularCard.writeBulkModuleCards([{message, data: updatedParts}]);
    }
  }

}