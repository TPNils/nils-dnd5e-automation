import { ChatSpeakerDataProperties } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/data/data.mjs/chatSpeakerData";
import { PropertiesToSource } from "@league-of-foundry-developers/foundry-vtt-types/src/types/helperTypes";
import { MyActor, MyItem } from "./types/fixed-types";

export type VanillaMacroArguments = [
  PropertiesToSource<ChatSpeakerDataProperties>, // Speaker
  Actor, // actor
  Token, // token
  Actor, // character
  MyItem?, // Item macros called from midi will provide a 5th item argument
];

export interface MacroContext {
  actorUuid: string;
  tokenUuid: string;
  itemUuid?: string;
  selectedTokenUuids: string[];
  targetTokenUuids: string[];
}

export function macroContextFromVanillaArguments(args: VanillaMacroArguments): MacroContext {
  return {
    actorUuid: args[1].uuid,
    tokenUuid: args[2].document.uuid,
    itemUuid: args.length > 4 && args[4] != null ? args[4].uuid : undefined,
    selectedTokenUuids: canvas.tokens.controlled.map(token => token.document.uuid),
    targetTokenUuids: Array.from(game.user.targets).map(token => token.document.uuid),
  }
}