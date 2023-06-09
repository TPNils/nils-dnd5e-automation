import { ChatMessageData } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/data/data.mjs";
import { RollD20EventData, RollMode } from "../../elements";
import { DocumentListener } from "../../lib/db/document-listener";
import { UtilsDocument } from "../../lib/db/utils-document";
import { Component, OnInit, OnInitParam } from "../../lib/render-engine/component";
import { UtilsDiceSoNice } from "../../lib/roll/utils-dice-so-nice";
import { UtilsRoll } from "../../lib/roll/utils-roll";
import { ValueReader } from "../../provider/value-provider";
import { staticValues } from "../../static-values";
import { MyActorData } from "../../types/fixed-types";
import { UtilsFoundry, Version } from "../../utils/utils-foundry";
import { Action } from "../action";
import { ChatPartIdData, ItemCardHelpers } from "../item/item-card-helpers";
import { CreatePermissionCheckArgs, createPermissionCheckAction } from "../modular-card-part";

export interface Dnd5eRollHandler {
  type: string;
  doRoll(message: ChatMessage, mode: string | null, userBonus: string | null): Promise<any>;
}

function getRollFromMsg(message: ChatMessage): Roll {
  if (UtilsFoundry.getGameVersion() >= new Version(10)) {
    const rolls: Roll[] = (message as any).rolls;
    return rolls[0];
  } else {
    return message.roll;
  }
}
async function saveRollToMsg(message: ChatMessage, roll: Roll, userBonus?: string | null): Promise<void> {
  const updateData: Record<string, any> = {};
  if (userBonus != null) {
    updateData.flags = {
      [staticValues.moduleName]: {
        userBonus: userBonus,
      }
    }
  }

  if (UtilsFoundry.getGameVersion() >= new Version(10)) {
    const rolls: any[] = deepClone((message as any).rolls);
    rolls[0] = roll.toJSON();
    updateData.rolls = rolls;
  } else {
    updateData.roll = roll;
  }
  await message.update(updateData);
}

function getRollMode(roll: Roll): string {
  const firstTerm = roll.terms[0];
  if (firstTerm instanceof Die) {
    if (firstTerm.number > 1) {
      // could have super advantage with 3 rolls => just capture everything which is more than 1
      if (firstTerm.modifiers.includes('kh')) {
        return 'advantage';
      } else if (firstTerm.modifiers.includes('kl')) {
        return 'disadvantage';
      }
    }
  }
  
  return 'normal';
}

function showDiceSoNice(msgData: ChatMessageData, roll: Roll): Promise<boolean> {
  let rollMode: ClientSettings.Values['core.rollMode'] = 'publicroll';
  let whispers: string[] = null;
  if (msgData.blind) {
    rollMode = 'blindroll';
    whispers = msgData.whisper;
  } else if (msgData.whisper.length === 0) {
    rollMode = 'publicroll';
    whispers = null;
  } else {
    rollMode = msgData.whisper.includes(game.userId) && msgData.whisper.length === 1 ? 'selfroll' : 'gmroll';
    whispers = msgData.whisper;
  }

  return UtilsDiceSoNice.showRoll({roll: roll, rollMode: rollMode, showUserIds: whispers})
}

const rollTypeHandlers: Dnd5eRollHandler[] = [
  {
    type: 'skill',
    async doRoll(msg: ChatMessage, mode: string | null, userBonus: string | null) {
      const msgData = UtilsFoundry.getModelData(msg);
      const actor = await UtilsDocument.actorFromUuid(`Actor.${msgData.speaker.actor}`);
      const dndFlag = msg.getFlag('dnd5e', 'roll') as {skillId: keyof MyActorData['skills'] };
      const roll = deepClone(getRollFromMsg(msg));
      if (mode == null) {
        mode = getRollMode(roll);
      }
      if (userBonus == null) {
        userBonus = msg.getFlag(staticValues.moduleName, 'userBonus') as string | null;
      }

      const result = await UtilsRoll.modifyRoll(roll, async () => {
        const rolls: Promise<Roll>[] = [];
        rolls.push(actor.rollSkill(dndFlag.skillId, {
          advantage: mode === 'advantage',
          disadvantage: mode === 'disadvantage',
          fastForward: true,
          chatMessage: false,
        }));
        if (userBonus) {
          rolls.push(new Roll(userBonus, actor.getRollData()).roll({async: true}));
        }
        return UtilsRoll.mergeRolls(...(await Promise.all(rolls)))
      });
      await saveRollToMsg(msg, result.result, userBonus);
      showDiceSoNice(msgData, result.rollToDisplay);
    }
  },
  {
    type: 'tool',
    async doRoll(msg: ChatMessage, mode: string | null, userBonus: string | null) {
      const msgData = UtilsFoundry.getModelData(msg);
      const actor = await UtilsDocument.actorFromUuid(`Actor.${msgData.speaker.actor}`);
      const dndFlag = msg.getFlag('dnd5e', 'roll') as {toolId: string };
      const roll = deepClone(getRollFromMsg(msg));
      if (mode == null) {
        mode = getRollMode(roll);
      }
      if (userBonus == null) {
        userBonus = msg.getFlag(staticValues.moduleName, 'userBonus') as string | null;
      }

      const result = await UtilsRoll.modifyRoll(roll, async () => {
        const rolls: Promise<Roll>[] = [];
        rolls.push(actor.rollToolCheck(dndFlag.toolId, {
          advantage: mode === 'advantage',
          disadvantage: mode === 'disadvantage',
          fastForward: true,
          chatMessage: false,
        }));
        if (userBonus) {
          rolls.push(new Roll(userBonus, actor.getRollData()).roll({async: true}));
        }
        return UtilsRoll.mergeRolls(...(await Promise.all(rolls)))
      });
      await saveRollToMsg(msg, result.result, userBonus);
      showDiceSoNice(msgData, result.rollToDisplay);
    }
  },
  {
    type: 'ability',
    async doRoll(msg: ChatMessage, mode: string | null, userBonus: string | null) {
      const msgData = UtilsFoundry.getModelData(msg);
      const actor = await UtilsDocument.actorFromUuid(`Actor.${msgData.speaker.actor}`);
      const dndFlag = msg.getFlag('dnd5e', 'roll') as {abilityId: keyof MyActorData['abilities'] };
      const roll = deepClone(getRollFromMsg(msg));
      if (mode == null) {
        mode = getRollMode(roll);
      }
      if (userBonus == null) {
        userBonus = msg.getFlag(staticValues.moduleName, 'userBonus') as string | null;
      }

      const result = await UtilsRoll.modifyRoll(roll, async () => {
        const rolls: Promise<Roll>[] = [];
        rolls.push(actor.rollAbilityTest(dndFlag.abilityId, {
          advantage: mode === 'advantage',
          disadvantage: mode === 'disadvantage',
          fastForward: true,
          chatMessage: false,
        }));
        if (userBonus) {
          rolls.push(new Roll(userBonus, actor.getRollData()).roll({async: true}));
        }
        return UtilsRoll.mergeRolls(...(await Promise.all(rolls)))
      });
      await saveRollToMsg(msg, result.result, userBonus);
      showDiceSoNice(msgData, result.rollToDisplay);
    }
  },
  {
    type: 'save',
    async doRoll(msg: ChatMessage, mode: string | null, userBonus: string | null) {
      const msgData = UtilsFoundry.getModelData(msg);
      const actor = await UtilsDocument.actorFromUuid(`Actor.${msgData.speaker.actor}`);
      const dndFlag = msg.getFlag('dnd5e', 'roll') as {abilityId: keyof MyActorData['abilities'] };
      const roll = deepClone(getRollFromMsg(msg));
      if (mode == null) {
        mode = getRollMode(roll);
      }
      if (userBonus == null) {
        userBonus = msg.getFlag(staticValues.moduleName, 'userBonus') as string | null;
      }

      const result = await UtilsRoll.modifyRoll(roll, async () => {
        const rolls: Promise<Roll>[] = [];
        rolls.push(actor.rollAbilityTest(dndFlag.abilityId, {
          advantage: mode === 'advantage',
          disadvantage: mode === 'disadvantage',
          fastForward: true,
          chatMessage: false,
        }));
        if (userBonus) {
          rolls.push(new Roll(userBonus, actor.getRollData()).roll({async: true}));
        }
        return UtilsRoll.mergeRolls(...(await Promise.all(rolls)))
      });
      await saveRollToMsg(msg, result.result, userBonus);
      showDiceSoNice(msgData, result.rollToDisplay);
    }
  },
];

@Component({
  tag: ActorRollComponent.getSelector(),
  html: /*html*/`
    <nd5e-roll-d20 *if="this.roll"
      [data-roll]="roll"
      [data-show-bonus]="roll.total != null"
      [data-roll-mode]="this.d20rollMode"
      [data-bonus-formula]="this.userBonus"

      [data-interaction-permission]="this.interactionPermission"
      [data-read-permission]="this.readPermission"
      [data-read-hidden-display-type]="this.readHiddenDisplayType"

      (doRoll)="this.onRollClick($event)"
      (rollMode)="this.onRollMode($event)"
      >
    </nd5e-roll-d20>
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
export class ActorRollComponent implements OnInit {
  public static SUPPORTED_DND5E_TYPES: string[] = rollTypeHandlers.map(h => h.type);

  //#region actions
  private static actionPermissionCheck = createPermissionCheckAction<{messageId: string}>(({messageId}) => {
    const documents: CreatePermissionCheckArgs['documents'] = [];
    const msg = game.messages.get(messageId);
    const msgData = UtilsFoundry.getModelData(msg)
    if (msgData?.speaker?.actor) {
      documents.push({uuid: `Actor.${msgData.speaker.actor}`, permission: 'OWNER', security: true});
    }
    return {documents: documents};
  });

  
  private static rollClick = new Action<{event: CustomEvent<{userBonus?: string}>;} & ChatPartIdData>('ActorCheckOnRollClick')
    .addSerializer(ItemCardHelpers.getRawSerializer('messageId'))
    .addSerializer(ItemCardHelpers.getCustomEventSerializer())
    .setPermissionCheck(ActorRollComponent.actionPermissionCheck)
    .build(async ({messageId, event}) => {
      const msg = game.messages.get(messageId);
      const dndFlag = msg.getFlag('dnd5e', 'roll') as {type: string;};
      for (const handler of rollTypeHandlers) {
        if (handler.type === dndFlag?.type) {
          handler.doRoll(msg, null, event.userBonus);
        }
      }
    })
    
  private static modeChange = new Action<{event: CustomEvent<RollD20EventData<RollMode>>;} & ChatPartIdData>('ActorCheckOnModeChange')
    .addSerializer(ItemCardHelpers.getRawSerializer('messageId'))
    .addSerializer(ItemCardHelpers.getCustomEventSerializer())
    .setPermissionCheck(ActorRollComponent.actionPermissionCheck)
    .build(({messageId, event}) => {
      const msg = game.messages.get(messageId);
      const dndFlag = msg.getFlag('dnd5e', 'roll') as {type: string;};
      for (const handler of rollTypeHandlers) {
        if (handler.type === dndFlag?.type) {
          handler.doRoll(msg, event.data, null);
        }
      }
    });
  //#endregion

  public static getSelector(): string {
    return `${staticValues.code}-actor-check`;
  }

  private messageId: string;
  public roll: Roll;
  public d20rollMode: string = 'normal';
  public userBonus: string = '';
  public interactionPermission: string;
  public readPermission: string;
  public readHiddenDisplayType: string;
  public onInit(args: OnInitParam) {
    const messageIdElement = args.html.closest('[data-message-id]');
    if (!messageIdElement) {
      this.roll = null;
      return;
    }

    this.messageId = messageIdElement.getAttribute('data-message-id');
    args.addStoppable(
      ValueReader.mergeObject({
        message: DocumentListener.listenUuid<ChatMessage>(game.messages.get(this.messageId).uuid),
        readHiddenDisplayType: DocumentListener.listenSettingValue<string>(staticValues.moduleName, 'checkHiddenRoll'),
      })
      .filter((({message}) => message != null))
      .listen(({message, readHiddenDisplayType}) => {
        this.roll = getRollFromMsg(message);
        this.d20rollMode = getRollMode(this.roll);
        this.userBonus = message.getFlag(staticValues.moduleName, 'userBonus') as string;

        const messageData = UtilsFoundry.getModelData(message);
        if (messageData?.speaker?.actor) {
          this.interactionPermission = `OwnerUuid:${messageData.speaker.actor}`;
          this.readPermission = `${staticValues.code}ReadCheckUuid:${messageData.speaker.actor}`;
          this.readHiddenDisplayType = readHiddenDisplayType;
        }
      }),
    );
  }

  public onRollClick(event: CustomEvent<{userBonus?: string}>): void {
    ActorRollComponent.rollClick({event, messageId: this.messageId});
  }

  public onRollMode(event: CustomEvent<RollD20EventData<RollMode>>): void {
    ActorRollComponent.modeChange({event, messageId: this.messageId});
  }

}