import { staticValues } from "../static-values";
import { ModularCardPart } from "./modular-card-part";

export class ModularCard {

  private readonly partsById = new Map<string, ModularCardPart>();
  private readonly orderedPartIds: string[] = [];

  constructor(
    parts: ReadonlyArray<ModularCardPart>,
  ) {
    for (const part of parts) {
      if (this.partsById.has(part.getId())) {
        throw new Error(`duplicate id detected: ${part.getId()}`)
      } else {
        this.orderedPartIds.push(part.getId());
        this.partsById.set(part.getId(), part);
      }
    }

    for (const part of this.partsById.values()) {
      part.afterCardInit(this);
    }
  }

  public static getCardPartDatas(message: ChatMessage): Array<{id: string, data: any, type: string}> | null {
    return (message.getFlag(staticValues.moduleName, 'modularCardData') as any);
  }

  public async getHtml(): Promise<string> {
    // TODO error handeling

    const htmlParts$: Array<{html: string, id: string} | Promise<{html: string, id: string}>> = [];
    for (const partId of this.orderedPartIds) {
      const htmlPart = this.getPartFromId(partId).getHtml();
      if (htmlPart instanceof Promise) {
        htmlParts$.push(htmlPart.then(html => {return {html: html, id: partId}}));
      } else {
        htmlParts$.push({html: htmlPart, id: partId});
      }
    }

    const enrichOptions: Partial<Parameters<typeof TextEditor['enrichHTML']>[1]> = {};
    if (game.user.isGM) {
      enrichOptions.secrets = true;
    }
    const htmlParts: string[] = [];
    for (const part of await Promise.all(htmlParts$)) {
      if (typeof part.html === 'string' && part.html !== '') {
        continue;
      }
      htmlParts.push(`<div data-${staticValues.moduleName}-card-part="${part.id}">`);
      htmlParts.push(TextEditor.enrichHTML(part.html, enrichOptions as any))
      htmlParts.push(`</div>`);
    }
    return htmlParts.join('');
  }

  public getPartFromId<T>(id: string): ModularCardPart<T> | null {
    return this.partsById.get(id);
  }

  public getPartFromType<T>(type: string): ModularCardPart<T> | null {
    const parts = this.getPartsByType().get(type);
    if (parts != null && parts.length > 0) {
      return parts[0];
    }
    return null;
  }

  public getPartsFromType<T>(type: string): ModularCardPart<T>[] {
    return this.getPartsByType().get(type) ?? [];
  }

  private partsByType: Map<string, ModularCardPart[]>;
  private getPartsByType(): Map<string, ModularCardPart[]> {
    if (!this.partsByType) {
      for (const part of this.partsById.values()) {
        if (!this.partsByType.has(part.getType())) {
          this.partsByType.set(part.getType(), []);
        }
        this.partsByType.get(part.getType()).push(part);
      }
    }
    return this.partsByType;
  }

}