import { DocumentListener } from "../lib/db/document-listener";
import { Component, OnInit, OnInitParam } from "../lib/render-engine/component";
import { staticValues } from "../static-values";
import { ModularCard } from "./modular-card";

@Component({
  tag: ModularCardComponent.getSelector(),
  html: /*html*/`
    <div>{{{this.body}}}</div>
    <div class="placeholder">
      <slot name="not-installed-placeholder"></slot>
    </div>
  `,
  style: /*css*/`
    .placeholder {
      display: none;
    }
  `,
})
export class ModularCardComponent implements OnInit {

  public static getSelector(): string {
    return `${staticValues.code}-modular-card`;
  }

  public body = '';
  public onInit(args: OnInitParam) {
    const messageIdElement = args.html.closest('[data-message-id]');
    if (!messageIdElement) {
      this.body = '';
      return;
    }

    const messageId = messageIdElement.getAttribute('data-message-id');
    args.addStoppable(
      DocumentListener.listenUuid<ChatMessage>(game.messages.get(messageId).uuid)
        .listen(async message => {
          const parts = ModularCard.getCardPartDatas(message);
          if (!parts) {
            this.body = '';
            return;
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
          enrichedHtmlParts.push(`<div class="${staticValues.moduleName}-item-card" ${parts.getItemUuid() == null ? '' : `data-item-id="${/Item\.([^\.]+)/i.exec(parts.getItemUuid())[1]}"`}>`);
          for (const enrichedPart of await Promise.all(htmlParts.map(part => TextEditor.enrichHTML(part.html, enrichOptions as any)))) {
            enrichedHtmlParts.push(enrichedPart);
          }
          enrichedHtmlParts.push(`</div>`);
          const body = enrichedHtmlParts.join('');
          if (this.body !== body) {
            this.body = body;
          }
        })
    );
  }

}