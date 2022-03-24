import { RunOnce } from "../lib/decorator/run-once";
import { staticValues } from "../static-values";
import { ModularCard, ModularCardPartData } from "./modular-card";
import { MyActor, SpellData } from "../types/fixed-types";
import { ModularCardCreateArgs, ModularCardPart } from "./modular-card-part";
import { UtilsDocument } from "../lib/db/utils-document";
import { createElement, HtmlContext, ICallbackAction } from "./card-part-element";

interface SpellLevelCardData {
  selectedLevel: number | 'pact';
  calc$: {
    tokenUuid?: string;
    actorUuid: string;
    itemUuid: string;
    spellSlots: Array<{
      type: 'pact' | 'spell';
      level: number;
      maxSlots: number;
      availableSlots: number;
    }>
  }
}

// TODO consume the spell slot
export class SpellLevelCardPart implements ModularCardPart<SpellLevelCardData> {

  public static readonly instance = new SpellLevelCardPart();
  private constructor(){}
  
  public async create({item, actor, token}: ModularCardCreateArgs): Promise<SpellLevelCardData> {
    if (item.data.data.level <= 0 || item.data.data.level == null || !actor) {
      return null;
    }

    let spellSlots: SpellLevelCardData['calc$']['spellSlots'] = [];
    for (const spellKey in actor.data.data.spells) {
      const spellData: SpellData = actor.data.data.spells[spellKey];
      if (spellData.max <= 0) {
        continue;
      }
      if (spellKey.startsWith('spell')) {
        spellSlots.push({
          type: 'spell',
          level: Number.parseInt(spellKey.substring(5)),
          maxSlots: spellData.max,
          availableSlots: spellData.value
        });
      } else if (spellKey === 'pact') {
        spellSlots.push({
          type: 'pact',
          level: (spellData as MyActor['data']['data']['spells']['pact']).level,
          maxSlots: spellData.max,
          availableSlots: spellData.value
        });
      }
    }
    // The item passed may have its level changed => vanilla foundry/dnd5e behaviour.
    const originalLevel = (await UtilsDocument.itemFromUuid(item.uuid)).data.data.level
    spellSlots = spellSlots.filter(slot => slot.level >= originalLevel);
    
    // Sort pact before spell levels
    spellSlots = spellSlots.sort((a, b) => {
      let diff = a.type.localeCompare(b.type);
      if (diff) {
        return diff;
      }
      return a.level - b.level;
    });

    // Find the first available spellslot
    let selectedLevel: SpellLevelCardData['selectedLevel'] = item.data.data.level;
    for (const spellSlot of spellSlots) {
      if (spellSlot.availableSlots > 0 && spellSlot.level >= item.data.data.level) {
        selectedLevel = spellSlot.type === 'pact' ? 'pact' : spellSlot.level;
        break;
      }
    }

    return {
      selectedLevel: selectedLevel,
      calc$: {
        actorUuid: actor.uuid,
        itemUuid: item.uuid,
        tokenUuid: token?.uuid,
        spellSlots: spellSlots,
      }
    };
  }

  public async refresh(oldData: SpellLevelCardData, args: ModularCardCreateArgs): Promise<SpellLevelCardData> {
    const newData = await this.create(args);

    if (!newData) {
      return null;
    }
    if (!oldData) {
      return newData;
    }

    if (newData.calc$.spellSlots.find(slot => slot.level === oldData.selectedLevel)) {
      // Retain the selected level if still available
      newData.selectedLevel = oldData.selectedLevel;
    }

    return newData;
  }

  @RunOnce()
  public registerHooks(): void {
    createElement({
      selector: this.getSelector(),
      getHtml: context => this.getElementHtml(context),
      getCallbackActions: () => this.getCallbackActions(),
    });

    ModularCard.registerModularCardPart(staticValues.moduleName, this);
  }

  public getType(): string {
    return this.constructor.name;
  }

  //#region Front end
  public getSelector(): string {
    return `${staticValues.code}-spell-level-part`;
  }

  public getHtml(data: HtmlContext): string {
    return `<${this.getSelector()} data-part-id="${data.partId}" data-message-id="${data.messageId}"></${this.getSelector()}>`
  }

  public getElementHtml(context: HtmlContext<SpellLevelCardData>): string | Promise<string> {
    return renderTemplate(
      `modules/${staticValues.moduleName}/templates/modular-card/spell-level-part.hbs`, {
        data: context.data,
        moduleName: staticValues.moduleName
      }
    );
  }

  public getCallbackActions(): ICallbackAction<SpellLevelCardData>[] {
    return [
      {
        regex: /^spell-level-change$/,
        execute: ({partId, data, allCardParts, inputValue}) => this.onSpellLevelChange(partId, data, allCardParts, inputValue as string),
      },
    ]
  }
  
  private async onSpellLevelChange(partId: string, data: SpellLevelCardData, allCardParts: ModularCardPartData[], level: string): Promise<void> {
    if (level === 'pact') {
      data.selectedLevel = 'pact';
    } else if (!Number.isNaN(Number(level))) {
      data.selectedLevel = Number(level);
    }
    const spellSlot = data.calc$.spellSlots.find(slot => slot.type === level || slot.level === Number(level));
    if (!spellSlot) {
      // Selected an invalid spell slot (too low of a level or has no pact slots)
      return;
    }

    let [item, actor, token] = await Promise.all([
      UtilsDocument.itemFromUuid(data.calc$.itemUuid),
      UtilsDocument.actorFromUuid(data.calc$.actorUuid),
      data.calc$.tokenUuid == null ? Promise.resolve(null) : UtilsDocument.tokenFromUuid(data.calc$.tokenUuid)
    ]);

    if (item.data.data.level !== spellSlot.level) {
      item = item.clone({data: {level: spellSlot.level}}, {keepId: true});
    }

    const responses: Array<Promise<ModularCardPartData>> = [];
    const partsById = new Map<string, ModularCardPartData>();
    for (const part of allCardParts) {
      partsById.set(part.id, part);
      const typeHandler = ModularCard.getTypeHandler(part.type);
      const response = typeHandler.refresh(part.data, {item, actor, token});
      if (response instanceof Promise) {
        responses.push(response.then(r => ({
          id: part.id,
          type: part.type,
          data: r
        })));
      } else {
        responses.push(Promise.resolve({
          id: part.id,
          type: part.type,
          data: response
        }));
      }
    }

    // TODO should also be able to 'add' new types
    //  Idea: have item templates which need to be registered
    //  They contain all the types which should be used and in what order they are

    const deleteIds = new Set<string>();
    for (const response of await Promise.all(responses)) {
      if (response.data == null) {
        deleteIds.add(response.id);
      } else {
        partsById.get(response.id).data = response.data;
      }
    }

    for (const id of Array.from(deleteIds)) {
      allCardParts.splice(allCardParts.findIndex(part => part.id === id), 1);
    }
  }
  //#endregion

}