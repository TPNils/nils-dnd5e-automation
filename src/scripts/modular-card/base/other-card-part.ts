import { ITrigger, IDmlContext, IAfterDmlContext, IDmlTrigger, DmlTrigger } from "../../lib/db/dml-trigger";
import { DocumentListener } from "../../lib/db/document-listener";
import { UtilsDocument, PermissionCheck } from "../../lib/db/utils-document";
import { RunOnce } from "../../lib/decorator/run-once";
import { Component, OnInit, OnInitParam } from "../../lib/render-engine/component";
import { UtilsDiceSoNice } from "../../lib/roll/utils-dice-so-nice";
import { RollData, UtilsRoll } from "../../lib/roll/utils-roll";
import { Stoppable } from "../../lib/utils/stoppable";
import { UtilsCompare } from "../../lib/utils/utils-compare";
import { ValueProvider } from "../../provider/value-provider";
import { staticValues } from "../../static-values";
import { UtilsFoundry, Version } from "../../utils/utils-foundry";
import { UtilsLog } from "../../utils/utils-log";
import { Action } from "../action";
import { ChatPartIdData, ItemCardHelpers } from "../item-card-helpers";
import { ModularCard, ModularCardInstance, ModularCardTriggerData } from "../modular-card";
import { ModularCardPart, ModularCardCreateArgs, CreatePermissionCheckArgs, HtmlContext, createPermissionCheckAction } from "../modular-card-part";
import { BaseCardComponent } from "./base-card-component";

type RollPhase = 'mode-select' | 'result';

export interface OtherCardData {
  phase: RollPhase;
  userBonus: string;
  spellLevel: number;
  roll$?: RollData;
}

@Component({
  tag: OtherCardPartComponent.getSelector(),
  html: /*html*/`
    <div class="flavor">
      {{ this.flavor }}
    </div>
    <nd5a-roll *if="this.part"
      [data-roll]="this.part.roll$"
      [data-bonus-formula]="this.part.userBonus"
      [data-show-bonus]="this.part.phase !== 'mode-select'"

      [data-can-interact]="this.interactionPermission"
      [data-can-read]="this.readPermission"
      [data-read-hidden-display-type]="this.readHiddenDisplayType"

      (doRoll)="this.onRollClick($event)"
      (rollMode)="this.onRollMode($event)"
      >
    </nd5a-roll>
  `,
  style: /*css*/`
    .flavor {
      margin-top: 2px;
      text-align: center;
    }
  `
})
class OtherCardPartComponent extends BaseCardComponent implements OnInit {
  //#region actions
  private static actionPermissionCheck = createPermissionCheckAction<{cardParts: ModularCardInstance}>(({cardParts}) => {
    const documents: CreatePermissionCheckArgs['documents'] = [];
    if (cardParts.getItemUuid()) {
      documents.push({uuid: cardParts.getItemUuid(), permission: 'OWNER', security: true});
    }
    return {documents: documents};
  });
  private static rollClick = new Action<{event: CustomEvent<{userBonus?: string}>} & ChatPartIdData>('AttackOnRollClick')
    .addSerializer(ItemCardHelpers.getRawSerializer('messageId'))
    .addSerializer(ItemCardHelpers.getCustomEventSerializer())
    .addEnricher(ItemCardHelpers.getChatEnricher())
    .setPermissionCheck(OtherCardPartComponent.actionPermissionCheck)
    .build(({messageId, event, cardParts}) => {
      const part = cardParts.getTypeData<OtherCardData>(OtherCardPart.instance);
      if (part.userBonus === event.userBonus && part.phase === 'result') {
        return;
      }
      part.userBonus = event.userBonus;
      part.phase = 'result';
      return ModularCard.setCardPartDatas(game.messages.get(messageId), cardParts);
    });
  //#endregion

  public static getSelector(): string {
    return `${staticValues.code}-other-part`;
  }
  
  public part: OtherCardData;
  public flavor: string = game.i18n.localize('DND5E.OtherFormula');
  public interactionPermission = false;
  public readPermission = false;
  public readHiddenDisplayType: string;
  public overrideRollLabel: string;
  
  public onInit(args: OnInitParam): void {
    args.addStoppable(
      this.getData<OtherCardData>(OtherCardPart.instance)
        .switchMap((args) => {
          return ValueProvider.mergeObject({
            ...args,
            readHiddenDisplayType: DocumentListener.listenSettingValue<string>(staticValues.moduleName, 'damageHiddenRoll'),
            permissions: UtilsDocument.hasPermissions([
              {
                uuid: args.allParts.getItemUuid(),
                permission: `${staticValues.code}ReadOther`,
                user: game.user,
                meta: 'canRead'
              },
              {
                uuid: args.allParts.getItemUuid(),
                permission: `Owner`,
                user: game.user,
                meta: 'canInteract'
              }
          ]),
          })
        })
        .listen(async ({part, readHiddenDisplayType, permissions}) => {
          this.part = part;
          this.interactionPermission = permissions.filter(p => p.requestedCheck.meta === 'canInteract').every(p => p.result);
          this.readPermission = permissions.filter(p => p.requestedCheck.meta === 'canRead').every(p => p.result);
          this.readHiddenDisplayType = readHiddenDisplayType;
      })
    )
  }

  public onRollClick(event: CustomEvent<{userBonus?: string}>): void {
    if (this.part.userBonus === event.detail.userBonus && this.part.phase === 'result') {
      return;
    }
    OtherCardPartComponent.rollClick({event, messageId: this.messageId});
  }

}

export class OtherCardPart implements ModularCardPart<OtherCardData> {

  public static readonly instance = new OtherCardPart();
  private constructor() {}

  public create({item}: ModularCardCreateArgs): OtherCardData {
    if (!item.data.data.formula) {
      return null;
    }

    return {
      phase: 'mode-select',
      userBonus: "",
      spellLevel: item.data.data.level,
    };
  }

  public refresh(oldData: OtherCardData, args: ModularCardCreateArgs): OtherCardData {
    const newData = this.create(args);

    if (!newData) {
      return null;
    }
    if (!oldData) {
      return newData;
    }
    newData.roll$ = deepClone(oldData.roll$);
    return newData;
  }

  @RunOnce()
  public registerHooks(): void {
    ModularCard.registerModularCardPart(staticValues.moduleName, this);
    ModularCard.registerModularCardTrigger(this, new OtherCardTrigger());
  }

  public getType(): string {
    return 'OtherCardPart';
  }

  //#region Front end

  public getHtml(data: HtmlContext): string {
    return `<${OtherCardPartComponent.getSelector()} data-message-id="${data.messageId}"></${OtherCardPartComponent.getSelector()}>`
  }
  //#endregion

}

class PreventOtherChatMessage implements IDmlTrigger<ChatMessage> {
  
  get type() {
    return ChatMessage;
  }

  public stopSelf: Stoppable;

  public beforeCreate(context: IDmlContext<ChatMessage>): boolean | void {
    if (!this.stopSelf) {
      return;
    }
    for (const {newRow} of context.rows) {
      if (newRow.data.flavor.endsWith(game.i18n.localize('DND5E.OtherFormula'))) {
        this.stopSelf.stop();
        return false;
      }
    }
  }

}

class OtherCardTrigger implements ITrigger<ModularCardTriggerData<OtherCardData>> {

  //#region beforeCreate
  public beforeCreate(context: IDmlContext<ModularCardTriggerData<OtherCardData>>): boolean | void {
    this.calcAutoRoll(context);
  }

  private calcAutoRoll(context: IDmlContext<ModularCardTriggerData<OtherCardData>>): boolean | void {
    let autoRoll = false;
    if (game.user.isGM) {
      autoRoll = game.settings.get(staticValues.moduleName, 'gmAutorollOther') === 'always';
    } else {
      autoRoll = game.settings.get(staticValues.moduleName, 'playerAutorollOther') === 'always';
    }

    if (!autoRoll) {
      return;
    }

    for (const {newRow} of context.rows) {
      newRow.part.phase = 'result';
    }
  }
  //#endregion

  //#region upsert
  public async upsert(context: IAfterDmlContext<ModularCardTriggerData<OtherCardData>>): Promise<void> {
    await this.doRoll(context);
  }

  private async doRoll(context: IAfterDmlContext<ModularCardTriggerData<OtherCardData>>): Promise<void> {
    for (const {newRow, oldRow} of context.rows) {
      if (newRow.part.phase !== 'result') {
        return;
      }

      // Only do roll when changed is detected
      const newData = newRow.part;
      const oldData = oldRow?.part;

      let shouldModifyRoll = oldData == null || !newRow.part.roll$?.evaluated;
      if (!shouldModifyRoll) {
        const newChangeDetectData = {
          userBonus: newData.userBonus,
          formula: newData.roll$.formula,
        }
        
        const oldChangeDetectData = {
          userBonus: oldData.userBonus,
          formula: newData.roll$.formula,
        }
        shouldModifyRoll = !UtilsCompare.deepEquals(newChangeDetectData, oldChangeDetectData);
      }

      if (shouldModifyRoll) {
        const item = await UtilsDocument.itemFromUuid(newRow.allParts.getItemUuid());
        if (item) {
          const newRoll = async () => {
            const rollPromises: Promise<Roll>[] = [];
            if (UtilsFoundry.getSystemVersion() < new Version(2)) {
              // dnd5e 1.x always creates a message;
              const trigger = new PreventOtherChatMessage();
              const stoppable = DmlTrigger.registerTrigger(trigger);
              trigger.stopSelf = stoppable;
            }
            rollPromises.push(item.rollFormula({spellLevel: newData.spellLevel, chatMessage: false}));

            if (newData.userBonus) {
              rollPromises.push(new Roll(newData.userBonus).roll({async: true}));
            }
            return UtilsRoll.mergeRolls(...await Promise.all(rollPromises));
          };
          const oldRoll = oldData?.roll$ == null ? null : UtilsRoll.fromRollData(oldData.roll$);
          newData.roll$ = UtilsRoll.toRollData((await UtilsRoll.modifyRoll(oldRoll, newRoll)).result);
        }
      }
    }
  }
  //#endregion

  //#region afterUpsert
  public async afterUpsert(context: IAfterDmlContext<ModularCardTriggerData<OtherCardData>>): Promise<void> {
    await this.diceSoNiceHook(context);
  }
  
  private async diceSoNiceHook(context: IDmlContext<ModularCardTriggerData<OtherCardData>>): Promise<void> {
    const showRolls: PermissionCheck<Roll>[] = [];
    for (const {newRow, oldRow} of context.rows) {
      // Detect new rolled dice
      if (newRow.part.roll$?.evaluated) {
        const roll = UtilsRoll.getNewRolledTerms(oldRow?.part?.roll$, newRow.part.roll$);
        UtilsLog.debug('new rolls', roll)
        if (roll) {
          showRolls.push({
            uuid: newRow.allParts.getActorUuid(),
            permission: `${staticValues.code}ReadOther`,
            user: game.user,
            meta: roll,
          });
        }
      }
    }
    
    UtilsDocument.hasPermissions(showRolls).listenFirst().then(responses => {
      const rolls: Roll[] = [];
      for (const response of responses) {
        UtilsLog.debug('check', response)
        if (response.result) {
          rolls.push(response.requestedCheck.meta);
        }
      }

      if (rolls.length > 0) {
        return UtilsDiceSoNice.showRoll({roll: UtilsRoll.mergeRolls(...rolls), showUserIds: [game.userId]});
      }
    });
  }
  //#endregion

}