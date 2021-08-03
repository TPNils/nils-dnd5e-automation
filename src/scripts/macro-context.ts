import { ChatSpeakerDataProperties } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/data/data.mjs/chatSpeakerData";
import { PropertiesToSource } from "@league-of-foundry-developers/foundry-vtt-types/src/types/helperTypes";
import { MyActor, MyItem } from "./types/fixed-types";

export type VanillaMacroArguments = [
  PropertiesToSource<ChatSpeakerDataProperties>, // Speaker
  Actor | undefined, // actor
  Token | undefined, // token
  Actor | undefined, // character
];

// module: item-macro
export type ItemMacroMacroArguments = [
  MyItem,
  PropertiesToSource<ChatSpeakerDataProperties>, // Speaker
  Actor | undefined, // actor
  Token | undefined, // token
  Actor | undefined, // character
  any | undefined, // event (?)
  any | undefined, // args (?)
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

export function macroContextFromArgs(args: VanillaMacroArguments | ItemMacroMacroArguments): MacroContext {
  const context: MacroContext = {
    selectedTokenUuids: canvas.tokens.controlled.map(token => token.document.uuid),
    targetTokenUuids: Array.from(game.user.targets).map(token => token.document.uuid),
  }
  if (args.length === 4) {
    // Macro called by foundry (from the hotbar)
    if (args[1] != null) {
      context.actorUuid = args[1].uuid;
    }
    if (args[2] != null) {
      context.tokenUuid = args[2].document.uuid;
    }
  } else if (args.length === 7) {
    // Macro called by the item-macro module
    if (args[0] != null) {
      context.itemUuid = args[0].uuid;
    }
    if (args[2] != null) {
      context.actorUuid = args[2].uuid;
    }
    if (args[3] != null) {
      context.tokenUuid = args[3].document.uuid;
    }
  }
  return context;
}