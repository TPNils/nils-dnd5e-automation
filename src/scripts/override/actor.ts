import { ModularCard, ModularCardInstance } from "../modular-card/modular-card";
import { CheckCardData, CheckCardPart } from "../modular-card/item/base/check-card-part";
import { staticValues } from "../static-values";
import type { D20RollOptions, MyActor, MyActorData } from "../types/fixed-types";
import { UtilsDocument } from "../lib/db/utils-document";
import { UtilsRoll } from "../lib/roll/utils-roll";
import { UtilsLibWrapper } from "../utils/utils-lib-wrapper";

interface CheckMessage {
  chatMessage: ChatMessage;
  modularCard: ModularCardInstance;
  checkPart: CheckCardData;
}

function getLastCheckMessage(): CheckMessage | null {
  // Only check the last X messages, anything older will be offscreen anyway
  let minMessageIndex = Math.max(0, game.messages.contents.length - 10);
  for (let messageIndex = game.messages.contents.length - 1; messageIndex >= minMessageIndex; messageIndex--) {
    const chatMessage = game.messages.contents[messageIndex];
    const parts = ModularCard.readModuleCard(chatMessage);
    if (!parts) {
      continue;
    }

    if (!parts.hasType(CheckCardPart.instance)) {
      // Don't go back further than 1 modular message to avoid rolls being consumed by something old
      // which will look as if no roll has been made.
      return null;
    }

    const clonedParts = parts.deepClone()
    return {
      chatMessage,
      modularCard: clonedParts,
      checkPart: clonedParts.getTypeData(CheckCardPart.instance),
    }
  }
}

function getTokenUuid(options: D20RollOptions) {
  if ((options.messageData as any)?.speaker?.token && (options.messageData as any)?.speaker?.scene) {
    return `Scene.${(options.messageData as any).speaker.scene}.Token.${(options.messageData as any).speaker.token}`;
  }
  return null;
}

async function rollSkill(this: MyActor, wrapped: (...args: any) => any, ...args: [keyof MyActorData['skills'], D20RollOptions]): Promise<Roll> {
  const [skillId, options] = args;
  if (options.chatMessage === false) {
    return wrapped(...args);
  }

  const lastCheckMessage = getLastCheckMessage();
  if (!game.settings.get(staticValues.moduleName, `captureManualRolls`) || lastCheckMessage == null || lastCheckMessage.checkPart.skill !== skillId) {
    return wrapped(...args);
  }

  // Capture the roll request and provide it to the modular message
  let selectionId: string;
  const tokenUuid = getTokenUuid(options);
  if (tokenUuid) {
    // Only for this specific token
    for (const target of lastCheckMessage.checkPart.targetCaches$) {
      if (target.targetUuid$ === tokenUuid && target.phase !== 'result') {
        target.phase = 'result';
        selectionId = target.selectionId$;
        break;
      }
    }
  } else {
    // For the first token matching the actor
    for (const target of lastCheckMessage.checkPart.targetCaches$) {
      if (target.actorUuid$ === this.uuid && target.phase !== 'result') {
        target.phase = 'result';
        selectionId = target.selectionId$;
        break;
      }
    }
  }

  if (!selectionId) {
    // Nothing found to roll in the modular card, just roll normally
    return wrapped(...args);
  }

  await ModularCard.writeModuleCard(lastCheckMessage.chatMessage, lastCheckMessage.modularCard);

  const parts = ModularCard.readModuleCard(await UtilsDocument.chatMessageFromUuid(lastCheckMessage.chatMessage.uuid));
  const target = parts.getTypeData(CheckCardPart.instance)?.targetCaches$?.find(t => t.selectionId$ === selectionId);
  if (!target?.roll$) {
    // This should never happen? but just in case.
    return wrapped(...args);
  }

  return UtilsRoll.fromRollData(target.roll$);
}

async function rollAbilityTest(this: MyActor, wrapped: (...args: any) => any, ...args: [keyof MyActorData['abilities'], D20RollOptions]): Promise<Roll> {
  const [abilityId, options] = args;
  if (options.chatMessage === false) {
    return wrapped(...args);
  }

  const lastCheckMessage = getLastCheckMessage();
  if (!game.settings.get(staticValues.moduleName, `captureManualRolls`) || lastCheckMessage == null || lastCheckMessage.checkPart.isSave || lastCheckMessage.checkPart.ability !== abilityId) {
    return wrapped(...args);
  }

  // Capture the roll request and provide it to the modular message
  let selectionId: string;
  const tokenUuid = getTokenUuid(options);
  if (tokenUuid) {
    // Only for this specific token
    for (const target of lastCheckMessage.checkPart.targetCaches$) {
      if (target.targetUuid$ === tokenUuid && target.phase !== 'result') {
        target.phase = 'result';
        selectionId = target.selectionId$;
        break;
      }
    }
  } else {
    // For the first token matching the actor
    for (const target of lastCheckMessage.checkPart.targetCaches$) {
      if (target.actorUuid$ === this.uuid && target.phase !== 'result') {
        target.phase = 'result';
        selectionId = target.selectionId$;
        break;
      }
    }
  }

  if (!selectionId) {
    // Nothing found to roll in the modular card, just roll normally
    return wrapped(...args);
  }

  await ModularCard.writeModuleCard(lastCheckMessage.chatMessage, lastCheckMessage.modularCard);

  const parts = ModularCard.readModuleCard(await UtilsDocument.chatMessageFromUuid(lastCheckMessage.chatMessage.uuid));
  const target = parts.getTypeData(CheckCardPart.instance)?.targetCaches$?.find(t => t.selectionId$ === selectionId);
  if (!target?.roll$) {
    // This should never happen? but just in case.
    return wrapped(...args);
  }

  return UtilsRoll.fromRollData(target.roll$);
}

async function rollAbilitySave(this: MyActor, wrapped: (...args: any) => any, ...args: [keyof MyActorData['abilities'], D20RollOptions]): Promise<Roll> {
  const [abilityId, options] = args;
  if (options.chatMessage === false) {
    return wrapped(...args);
  }

  const lastCheckMessage = getLastCheckMessage();
  if (!game.settings.get(staticValues.moduleName, `captureManualRolls`) || lastCheckMessage == null || !lastCheckMessage.checkPart.isSave || lastCheckMessage.checkPart.ability !== abilityId) {
    return wrapped(...args);
  }

  // Capture the roll request and provide it to the modular message
  let selectionId: string;
  const tokenUuid = getTokenUuid(options);
  if (tokenUuid) {
    // Only for this specific token
    for (const target of lastCheckMessage.checkPart.targetCaches$) {
      if (target.targetUuid$ === tokenUuid && target.phase !== 'result') {
        target.phase = 'result';
        selectionId = target.selectionId$;
        break;
      }
    }
  } else {
    // For the first token matching the actor
    for (const target of lastCheckMessage.checkPart.targetCaches$) {
      if (target.actorUuid$ === this.uuid && target.phase !== 'result') {
        target.phase = 'result';
        selectionId = target.selectionId$;
        break;
      }
    }
  }

  if (!selectionId) {
    // Nothing found to roll in the modular card, just roll normally
    return wrapped(...args);
  }

  await ModularCard.writeModuleCard(lastCheckMessage.chatMessage, lastCheckMessage.modularCard);

  const parts = ModularCard.readModuleCard(await UtilsDocument.chatMessageFromUuid(lastCheckMessage.chatMessage.uuid));
  const target = parts.getTypeData(CheckCardPart.instance)?.targetCaches$?.find(t => t.selectionId$ === selectionId);
  if (!target?.roll$) {
    // This should never happen? but just in case.
    return wrapped(...args);
  }

  return UtilsRoll.fromRollData(target.roll$);
}


export function registerHooks(): void {
  UtilsLibWrapper.mixed('CONFIG.Actor.documentClass.prototype.rollSkill', rollSkill);
  UtilsLibWrapper.mixed('CONFIG.Actor.documentClass.prototype.rollAbilityTest', rollAbilityTest);
  UtilsLibWrapper.mixed('CONFIG.Actor.documentClass.prototype.rollAbilitySave', rollAbilitySave);
}