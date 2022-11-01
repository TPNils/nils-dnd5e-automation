import { IAfterDmlContext, ITrigger } from "../../lib/db/dml-trigger";
import { DocumentListener } from "../../lib/db/document-listener";
import { FoundryDocument, UtilsDocument } from "../../lib/db/utils-document";
import { RunOnce } from "../../lib/decorator/run-once";
import { Component, OnInit, OnInitParam } from "../../lib/render-engine/component";
import { ValueReader } from "../../provider/value-provider";
import { staticValues } from "../../static-values";
import { SpellData, MyActor } from "../../types/fixed-types";
import { Action } from "../action";
import { ChatPartIdData, ItemCardHelpers } from "../item-card-helpers";
import { ModularCardPartData, ModularCard, ModularCardTriggerData } from "../modular-card";
import { ModularCardPart, ModularCardCreateArgs, CreatePermissionCheckArgs, HtmlContext, createPermissionCheckAction } from "../modular-card-part";
import { BaseCardComponent } from "./base-card-component";

interface SpellLevelCardData {
  selectedLevel: number | 'pact';
  calc$: {
    tokenUuid?: string;
    actorUuid: string;
    itemUuid: string;
    originalLevel: number;
    spellSlots: Array<{
      type: 'pact' | 'spell';
      level: number;
      maxSlots: number;
      availableSlots: number;
    }>
  }
}

const originalLevelSymbol = Symbol('Original level');
@Component({
  tag: SpellLevelCardComponent.getSelector(),
  html: /*html*/`
  <select class="form-fields" [disabled]="this.spellSlotOptions.length <= 1" (change)="this.onSelectChange($event)">
    <option *for="let option of this.spellSlotOptions" [selected]="option.selected" [value]="option.value">{{ option.label }}</option>
  </select>
  `,
})
export class SpellLevelCardComponent extends BaseCardComponent implements OnInit {
  //#region actions
  private static actionPermissionCheck = createPermissionCheckAction<{part: {data: SpellLevelCardData}}>(({part}) => {
    const documents: CreatePermissionCheckArgs['documents'] = [];
    if (part.data.calc$.actorUuid) {
      documents.push({uuid: part.data.calc$.actorUuid, permission: 'OWNER', security: true});
    }
    return {documents: documents};
  });
  private static selectChange = new Action<{event: Event} & ChatPartIdData>('SpellLevelCardChangeLevel')
    .addSerializer(ItemCardHelpers.getRawSerializer('messageId'))
    .addSerializer(ItemCardHelpers.getRawSerializer('partId'))
    .addSerializer(ItemCardHelpers.getInputSerializer())
    .addEnricher(ItemCardHelpers.getChatPartEnricher<SpellLevelCardData>())
    .setPermissionCheck(SpellLevelCardComponent.actionPermissionCheck)
    .build(async ({messageId, part, inputValue, allCardParts}) => {
      part.data.selectedLevel = inputValue === 'pact' ? inputValue : Number.parseInt(inputValue);
      return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
    });
  //#endregion

  public static getSelector(): string {
    return `${staticValues.code}-spell-level-part`;
  }
  
  public spellSlotOptions: Array<{label: string; value: string; selected: boolean}> = [];
  public onInit(args: OnInitParam): void {
    args.addStoppable(
      this.getData().switchMap(({message, partId}) => {
        const allParts = ModularCard.getCardPartDatas(message);
        let part: ModularCardPartData<SpellLevelCardData>;
        if (allParts != null) {
          part = allParts.find(p => p.id === partId && p.type === SpellLevelCardPart.instance.getType());
        }
        return ValueReader.mergeObject({
          part,
          actor: part == null ? null : DocumentListener.listenUuid<MyActor & FoundryDocument>(part.data.calc$.actorUuid)
        })
      }).listen(async ({part, actor}) => this.setData(part, actor)),
    )
  }

  private async setData(part: ModularCardPartData<SpellLevelCardData>, actor: MyActor) {
    this.spellSlotOptions = [];
    if (part) {
      const permissionResponse = await SpellLevelCardComponent.actionPermissionCheck({
        part: part,
        partId: this.partId,
        messageId: this.messageId,
      }, game.user)
      const isOwner = permissionResponse !== 'prevent-action';
      if (actor) {
        for (const spellData of part.data.calc$.spellSlots) {
          // const spellData: SpellData = actor.data.data.spells[spellKey];
          // if (spellData.max <= 0) {
          //   continue;
          // }
          if (spellData.type === 'spell') {
            // const spellLevel = Number.parseInt(spellKey.substring(5));
            const spellLevel = spellData.level;
            const availableSlots = spellData.availableSlots;
            this.spellSlotOptions.push({
              label: game.i18n.format("DND5E.SpellLevelSlot", {level: game.i18n.localize(`DND5E.SpellLevel${spellLevel}`), n: isOwner ? availableSlots : '?'}),
              value: String(spellLevel),
              selected: part.data.selectedLevel === spellLevel,
            });
          } else if (spellData.type === 'pact') {
            // const spellLevel = (spellData as MyActor['data']['data']['spells']['pact']).level;
            // const availableSlots = spellData.value;
            const spellLevel = spellData.level;
            const availableSlots = spellData.availableSlots;
            this.spellSlotOptions.push({
              label: game.i18n.format("DND5E.SpellLevelPact", {level: spellLevel, n: isOwner ? availableSlots : '?'}),
              value: spellData.type,
              selected: part.data.selectedLevel === spellLevel,
            });
          }
        }
      } else if (part.data.selectedLevel === 'pact') {
        this.spellSlotOptions.push({
          label: game.i18n.format("DND5E.SpellLevelPact", {level: '?', n: '?'}),
          value: part.data.selectedLevel,
          selected: true,
        });
      } else {
        this.spellSlotOptions.push({
          label: game.i18n.format("DND5E.SpellLevelSlot", {level: game.i18n.localize(`DND5E.SpellLevel${part.data.selectedLevel}`), n: '?'}),
          value: String(part.data.selectedLevel),
          selected: true,
        });
      }
      
      if (!isOwner) {
        // Only show the selected slot
        this.spellSlotOptions = this.spellSlotOptions.filter(option => option.selected);
      }
    }
  }

  public onSelectChange(event: Event) {
    SpellLevelCardComponent.selectChange({
      event,
      partId: this.partId,
      messageId: this.messageId,
    })
  }

}

export class SpellLevelCardPart implements ModularCardPart<SpellLevelCardData> {

  public static readonly instance = new SpellLevelCardPart();
  private constructor(){}
  
  public async create({item, actor, token}: ModularCardCreateArgs): Promise<SpellLevelCardData> {
    if (item.type !== 'spell' || item?.data?.data?.level == null || item.data.data.level <= 0 || !actor || !ItemCardHelpers.spellUpcastModes.includes(item.data.data?.preparation?.mode)) {
      return null;
    }

    // TODO happens on level change wih the Command spell for Erling
    //   Uncaught (in promise) TypeError: obj is null
    //   [Detected 1 package: nils-automated-compendium]
    //   setProperty utils-object.ts:24
    //   injectDeleteForDml utils-object.ts:32
    //   setCardPartDatas modular-card.ts:360
    //   registerHooks spell-level-card-part.ts:176

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
    const originalLevel = item[originalLevelSymbol] !== undefined ? item[originalLevelSymbol] : (await UtilsDocument.itemFromUuid(item.uuid)).data.data.level;
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
        originalLevel: originalLevel,
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
    ModularCard.registerModularCardPart(staticValues.moduleName, this);
    ModularCard.registerModularCardTrigger(this, new SpellLevelCardTrigger());
  }

  public getType(): string {
    return this.constructor.name;
  }

  //#region Front end
  public getHtml(data: HtmlContext): string {
    return `<${SpellLevelCardComponent.getSelector()} data-part-id="${data.partId}" data-message-id="${data.messageId}"></${SpellLevelCardComponent.getSelector()}>`
  }
  //#endregion

}

class SpellLevelCardTrigger implements ITrigger<ModularCardTriggerData<SpellLevelCardData>> {

  public async update(context: IAfterDmlContext<ModularCardTriggerData<SpellLevelCardData>>): Promise<void> {
    await this.refreshOnLevelChange(context);
  }

  private async refreshOnLevelChange(context: IAfterDmlContext<ModularCardTriggerData<SpellLevelCardData>>): Promise<void> {
    const recalcByMessageId = new Map<string, ModularCardPartData<any>[]>();
    const spellLevelsByMessageId = new Map<string, ModularCardPartData<SpellLevelCardData>>();
    for (const {newRow, oldRow} of context.rows) {
      if (newRow.part.data.selectedLevel !== oldRow.part.data.selectedLevel) {
        recalcByMessageId.set(newRow.messageId, newRow.allParts);
        spellLevelsByMessageId.set(newRow.messageId, newRow.part);
      }
    }

    const promises: Array<Promise<any>> = [];
    for (const [id, parts] of recalcByMessageId.entries()) {
      const part = spellLevelsByMessageId.get(id);
      let level: number;
      if (part.data.selectedLevel === 'pact') {
        const actor = await UtilsDocument.actorFromUuid(part.data.calc$.actorUuid);
        level = actor.data.data.spells.pact.level;
      } else {
        level = part.data.selectedLevel;
      }
  
      let [item, actor, token] = await Promise.all([
        UtilsDocument.itemFromUuid(part.data.calc$.itemUuid),
        UtilsDocument.actorFromUuid(part.data.calc$.actorUuid),
        part.data.calc$.tokenUuid == null ? Promise.resolve(null) : UtilsDocument.tokenFromUuid(part.data.calc$.tokenUuid)
      ]);
  
      if (item.data.data.level !== level) {
        const originalLevel = item.data.data.level;
        item = item.clone({data: {level: level}}, {keepId: true});
        item.prepareFinalAttributes(); // Spell save DC, etc...
        item[originalLevelSymbol] = originalLevel;
      }
  
      const responses: Array<Promise<ModularCardPartData>> = [];
      const partsById = new Map<string, ModularCardPartData>();
      for (const part of parts) {
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

      promises.push(Promise.all(responses).then(newParts => {
        for (let i = 0; i < newParts.length; i++) {
          parts[i].data = newParts[i].data;
        }
      }))
    }
    await Promise.all(promises);
  }

}