import { IAfterDmlContext, ITrigger } from "../../lib/db/dml-trigger";
import { DocumentListener } from "../../lib/db/document-listener";
import { FoundryDocument, UtilsDocument } from "../../lib/db/utils-document";
import { RunOnce } from "../../lib/decorator/run-once";
import { Component, OnInit, OnInitParam } from "../../lib/render-engine/component";
import { ValueReader } from "../../provider/value-provider";
import { staticValues } from "../../static-values";
import { SpellData, MyActor, MyActorData } from "../../types/fixed-types";
import { UtilsFoundry } from "../../utils/utils-foundry";
import { Action } from "../action";
import { ChatPartIdData, ItemCardHelpers } from "../item-card-helpers";
import { ItemUtils } from "../item-utils";
import { ModularCard, ModularCardTriggerData, ModularCardInstance } from "../modular-card";
import { ModularCardPart, ModularCardCreateArgs, CreatePermissionCheckArgs, HtmlContext, createPermissionCheckAction, PermissionResponse } from "../modular-card-part";
import { BaseCardComponent } from "./base-card-component";

export interface SpellLevelCardData {
  selectedLevel: number | 'pact';
  selectedLevelNr: number;
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
  private static actionPermissionCheck = createPermissionCheckAction<{cardParts: ModularCardInstance}>(({cardParts}) => {
    const part = cardParts.getTypeData<SpellLevelCardData>(SpellLevelCardPart.instance);
    const documents: CreatePermissionCheckArgs['documents'] = [];
    if (part?.calc$?.actorUuid) {
      documents.push({uuid: part.calc$.actorUuid, permission: 'OWNER', security: true});
    }
    return {documents: documents};
  });
  private static selectChange = new Action<{event: Event} & ChatPartIdData>('SpellLevelCardChangeLevel')
    .addSerializer(ItemCardHelpers.getRawSerializer('messageId'))
    .addSerializer(ItemCardHelpers.getInputSerializer())
    .addEnricher(ItemCardHelpers.getChatEnricher())
    .setPermissionCheck(SpellLevelCardComponent.actionPermissionCheck)
    .build(async ({messageId, inputValue, cardParts}) => {
      const part = cardParts.getTypeData<SpellLevelCardData>(SpellLevelCardPart.instance);
      part.selectedLevel = inputValue === 'pact' ? inputValue : Number.parseInt(inputValue);
      return ModularCard.setCardPartDatas(game.messages.get(messageId), cardParts);
    });
  //#endregion

  public static getSelector(): string {
    return `${staticValues.code}-spell-level-part`;
  }
  
  public spellSlotOptions: Array<{label: string; value: string; selected: boolean}> = [];
  public onInit(args: OnInitParam): void {
    args.addStoppable(
      this.getData<SpellLevelCardData>(SpellLevelCardPart.instance).switchMap((data) => {
        return ValueReader.mergeObject({
          ...data,
          actor: data.part == null ? null : DocumentListener.listenUuid<MyActor & FoundryDocument>(data.part.calc$.actorUuid),
          interactPermission: SpellLevelCardComponent.actionPermissionCheck({cardParts: data.allParts, messageId: this.messageId}, game.user),
          isObserver: UtilsDocument.hasAnyPermissions([
            {
              uuid: data.part.calc$.actorUuid,
              // TODO Don't know if I want to bloat more settings
              //  ReadImmunity has the same idea as read spell slots => are you allowed to see details in the character sheet
              //  Maybe make a proper setting settings page with a global behaviour with the option to fine tune
              permission: `${staticValues.code}ReadImmunity`,
              user: game.user,
            },
          ])
        })
      }).listen(async ({part, actor, interactPermission, isObserver}) => this.setData(part, actor, interactPermission, isObserver)),
    )
  }

  private async setData(part: SpellLevelCardData, actor: MyActor, interactPermission: PermissionResponse, isObserver: boolean) {
    this.spellSlotOptions = [];
    if (part) {
      if (!isObserver) {
        // Only show the selected slot
        this.spellSlotOptions.push({
          label: game.i18n.format("DND5E.SpellLevelSlot", {level: '?', n: '?'}),
          value: '-1',
          selected: true,
        });
      }
      if (actor) {
        const actorData = UtilsFoundry.getSystemData(actor);
        for (const spellKey of Object.keys(actorData.spells)) {
          const spellData: SpellData = actorData.spells[spellKey];
          if (spellData.max === 0) {
            continue;
          }
          if (spellKey === 'pact') {
            const spellLevel = (spellData as MyActorData['spells']['pact']).level;
            const availableSlots = spellData.value;
            this.spellSlotOptions.push({
              label: game.i18n.format("DND5E.SpellLevelPact", {level: spellLevel, n: availableSlots}),
              value: 'pact',
              selected: part.selectedLevel === 'pact',
            });
          } else {
            const spellLevel = /spell([0-9]+)/.exec(spellKey)[1];
            const availableSlots = spellData.value;
            this.spellSlotOptions.push({
              label: game.i18n.format("DND5E.SpellLevelSlot", {level: game.i18n.localize(`DND5E.SpellLevel${spellLevel}`), n: availableSlots}),
              value: spellLevel,
              selected: part.selectedLevel === Number(spellLevel),
            });
          } 
        }
      } else if (part.selectedLevel === 'pact') {
        this.spellSlotOptions.push({
          label: game.i18n.format("DND5E.SpellLevelPact", {level: '?', n: '?'}),
          value: part.selectedLevel,
          selected: true,
        });
      } else {
        this.spellSlotOptions.push({
          label: game.i18n.format("DND5E.SpellLevelSlot", {level: game.i18n.localize(`DND5E.SpellLevel${part.selectedLevel}`), n: '?'}),
          value: String(part.selectedLevel),
          selected: true,
        });
      }

      if (interactPermission === 'prevent-action') {
        // Only show the selected slot
        this.spellSlotOptions = this.spellSlotOptions.filter(option => option.selected);
      }
    }
  }

  public onSelectChange(event: Event) {
    SpellLevelCardComponent.selectChange({
      event,
      messageId: this.messageId,
    })
  }

}

export class SpellLevelCardPart implements ModularCardPart<SpellLevelCardData> {

  public static readonly instance = new SpellLevelCardPart();
  private constructor(){}
  
  public async create({item, actor, token}: ModularCardCreateArgs): Promise<SpellLevelCardData> {
    const itemData = UtilsFoundry.getSystemData(item);
    if (item.type !== 'spell' || itemData?.level == null || itemData.level <= 0 || !actor || !ItemCardHelpers.spellUpcastModes.includes(itemData?.preparation?.mode)) {
      return null;
    }

    let spellSlots: SpellLevelCardData['calc$']['spellSlots'] = [];
    const actorData = UtilsFoundry.getSystemData(actor);
    for (const spellKey in actorData.spells) {
      const spellData: SpellData = actorData.spells[spellKey];
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
          level: (spellData as MyActorData['spells']['pact']).level,
          maxSlots: spellData.max,
          availableSlots: spellData.value
        });
      }
    }
    // The item passed may have its level changed => vanilla foundry/dnd5e behaviour.
    const originalLevel = await ItemUtils.getOriginalLevel(item);
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
    // TODO innate casting (always?) also counts as known spells => allow to use either the (un)limited uses or (upcast) spell slots
    const spellIsPact = itemData?.preparation?.mode === 'pact';
    let selectedLevel: SpellLevelCardData['selectedLevel'] = spellIsPact ? 'pact' : itemData.level;
    if (selectedLevel === 'pact') {
      if (actorData.spells.pact.value < 1 && actorData.spells[`spell${actorData.spells.pact.level}`].value > 0) {
        selectedLevel = actorData.spells.pact.level;
      }
    } else {
      if (actorData.spells.pact.value > 0 && actorData.spells.pact.level === selectedLevel) {
        selectedLevel = 'pact';
      }
    }

    return {
      selectedLevel: selectedLevel,
      selectedLevelNr: itemData.level,
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

    if (newData.calc$.spellSlots.find(slot => (slot.level === oldData.selectedLevel) || (oldData.selectedLevel === 'pact' && slot.type === 'pact'))) {
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
    return 'SpellLevelCardPart';
  }

  //#region Front end
  public getHtml(data: HtmlContext): string {
    return `<${SpellLevelCardComponent.getSelector()} data-message-id="${data.messageId}"></${SpellLevelCardComponent.getSelector()}>`
  }
  //#endregion

}

class SpellLevelCardTrigger implements ITrigger<ModularCardTriggerData<SpellLevelCardData>> {

  public async update(context: IAfterDmlContext<ModularCardTriggerData<SpellLevelCardData>>): Promise<void> {
    await this.refreshOnLevelChange(context);
  }

  private async refreshOnLevelChange(context: IAfterDmlContext<ModularCardTriggerData<SpellLevelCardData>>): Promise<void> {
    const recalcByMessageId = new Map<string, ModularCardInstance>();
    const spellLevelsByMessageId = new Map<string, SpellLevelCardData>();
    for (const {newRow, oldRow} of context.rows) {
      if (newRow.part.selectedLevel !== oldRow.part.selectedLevel) {
        recalcByMessageId.set(newRow.messageId, newRow.allParts);
        spellLevelsByMessageId.set(newRow.messageId, newRow.part);
      }
    }

    const promises: Array<Promise<any>> = [];
    for (const [id, parts] of recalcByMessageId.entries()) {
      const part = spellLevelsByMessageId.get(id);
      let level: number;
      if (part.selectedLevel === 'pact') {
        const actor = await UtilsDocument.actorFromUuid(part.calc$.actorUuid);
        level =  UtilsFoundry.getSystemData(actor).spells.pact.level;
      } else {
        level = part.selectedLevel;
      }
  
      let [item, actor, token] = await Promise.all([
        UtilsDocument.itemFromUuid(part.calc$.itemUuid),
        UtilsDocument.actorFromUuid(part.calc$.actorUuid),
        part.calc$.tokenUuid == null ? Promise.resolve(null) : UtilsDocument.tokenFromUuid(part.calc$.tokenUuid)
      ]);

      const itemData = UtilsFoundry.getSystemData(item);
      if (itemData.level !== level || (part.selectedLevel === 'pact' && itemData?.preparation?.mode !== 'pact')) {
        item = ItemUtils.createUpcastItem(item, level);
      }
      if (part.selectedLevel === 'pact') {
        // Detect that it should consume pact slots
        itemData.preparation.mode = 'pact';
      } else if (itemData.preparation.mode === 'pact') {
        // Detect that it should consume spell slots
        itemData.preparation.mode = 'always';
      }
  
      const responses: Array<Promise<{data: any; type: ModularCardPart}>> = [];
      for (const typeHandler of parts.getAllTypes()) {
        const response = typeHandler.refresh(parts.getTypeData(typeHandler), {item, actor, token});
        if (response instanceof Promise) {
          responses.push(response.then(r => ({
            type: typeHandler,
            data: r
          })));
        } else {
          responses.push(Promise.resolve({
            type: typeHandler,
            data: response
          }));
        }
      }

      promises.push(Promise.all(responses).then(newParts => {
        for (const newPart of newParts) {
          parts.setTypeData(newPart.type, newPart.data);
        }
      }))
    }
    await Promise.all(promises);
  }

}