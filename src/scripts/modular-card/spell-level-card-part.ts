import { RunOnce } from "../lib/decorator/run-once";
import { staticValues } from "../static-values";
import { ModularCard, ModularCardPartData } from "./modular-card";
import { MyActor, SpellData } from "../types/fixed-types";
import { HtmlContext, ICallbackAction, ModularCardCreateArgs, ModularCardPart } from "./modular-card-part";
import { UtilsDocument } from "../lib/db/utils-document";

interface SpellLevelCardData {
  selectedLevel: number | 'pact';
  calc$: {
    actorUuid?: string;
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
  
  public async create({item, actor}: ModularCardCreateArgs): Promise<SpellLevelCardData[]> {
    if (item.data.data.level <= 0 || item.data.data.level == null || !actor) {
      return [];
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

    return [{
      selectedLevel: selectedLevel,
      calc$: {
        actorUuid: actor.uuid,
        spellSlots: spellSlots,
      }
    }];
  }

  public refresh(data: SpellLevelCardData[], args: ModularCardCreateArgs): Promise<SpellLevelCardData[]> {
    return this.create(args);
  }

  @RunOnce()
  public registerHooks(): void {
    ModularCard.registerModularCardPart(staticValues.moduleName, this);
  }

  public getType(): string {
    return this.constructor.name;
  }

  public getHtml(context: HtmlContext<SpellLevelCardData>): string | Promise<string> {
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
  
  private onSpellLevelChange(partId: string, data: SpellLevelCardData, allCardParts: ModularCardPartData[], level: string): void {
    if (level === 'pact') {
      data.selectedLevel = 'pact';
    } else if (!Number.isNaN(Number(level))) {
      data.selectedLevel = Number(level);
    }
    // TODO refresh
  }

}