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
  // Actor/Token can be null in the context of a DM (or player without character I guess)
  actorUuid?: string;
  tokenUuid?: string;
  // Item is only provided when the macro is called from an item context
  itemUuid?: string;
  // Arrays are never null, but can be empty
  selectedTokenUuids: string[];
  targetTokenUuids: string[];
}

export function macroContextFromVanillaArguments(args: VanillaMacroArguments): MacroContext {
  const context: MacroContext = {
    selectedTokenUuids: canvas.tokens.controlled.map(token => token.document.uuid),
    targetTokenUuids: Array.from(game.user.targets).map(token => token.document.uuid),
  }
  console.log({args, length: args.length})
  if (args.length > 1 && args[1] != null) {
    context.actorUuid = args[1].uuid;
  }
  if (args.length > 2 && args[2] != null) {
    context.tokenUuid = args[2].document.uuid;
  }
  if (args.length > 4 && args[4] != null) {
    context.itemUuid = args[4].uuid;
  }
  return context;
}