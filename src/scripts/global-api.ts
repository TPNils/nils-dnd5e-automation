import { ChatSpeakerDataProperties } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/data/data.mjs/chatSpeakerData";
import { PropertiesToSource } from "@league-of-foundry-developers/foundry-vtt-types/src/types/helperTypes";
import { hasPermission } from "./custom-permissions";
import { DevTools } from "./dev-tools";
import { CreateEcho } from "./feature-macro/create-echo";
import { DismissEcho } from "./feature-macro/dismiss-echo";
import { SwapEcho } from "./feature-macro/swap-echo";
import { Test } from "./feature-macro/test";
import { IMacroConstructor } from "./macro";
import { MacroContext, macroContextFromArgs } from "./macro-context";
import { provider } from "./provider/provider";
import { FireBolt } from "./spell-macro/fire-bolt";
import { MagicMissile } from "./spell-macro/magic-missile";
import { staticValues } from "./static-values";

type MacroCollection = {[key: string]: IMacroConstructor};
type MacroArguments = [PropertiesToSource<ChatSpeakerDataProperties>, Actor, Token, Actor];

interface CallMacroResponse {
  success: boolean;
  errorMessage?: string;
}

const collections: {[key in ('features' | 'spells' | 'items')]: MacroCollection} = {

  features: {
    // TODO link to an item in compedium
    createEcho: CreateEcho,
    dismissEcho: DismissEcho,
    swapEcho: SwapEcho,
    test: Test
  },

  spells: {
    magicMissile: MagicMissile,
    fireBolt: FireBolt,
  },

  items: {
    
  }

}

async function callMacroLocal(itemType: keyof typeof collections, macroName: string, context: MacroContext): Promise<void> {
  const macroConstructor = collections[itemType]?.[macroName];
  if (macroConstructor == null) {
    throw new Error(`Could not find macro ${itemType}.${macroName}`);
  }
  const macro = new macroConstructor();

  if (!game.user.isGM && macro.requirePermissions != null) {
    const permissions = await macro.requirePermissions(context);
    for (const permission of permissions) {
      if (!hasPermission(permission)) {
        let macroData = null;
        if (macro.macroData) {
          macroData = await macro.macroData(context);
        }
        const socket = await provider.getSocket();
        const response: CallMacroResponse = await socket.executeAsGM('callMacro', {itemType: itemType, macroName: macroName, contextData: context, macroData: macroData});
        if (!response.success) {
          throw new Error(response.errorMessage);
        }
      }
    }
  }

  let macroData = null;
  if (macro.macroData) {
    macroData = await macro.macroData(context);
  }
  await macro.run(context, macroData);
}

async function callMacroFromSocket(itemType: keyof typeof collections, macroName: string, context: MacroContext, macroData: any): Promise<CallMacroResponse> {
  const macroConstructor = collections[itemType]?.[macroName];
  if (macroConstructor == null) {
    return {
      success: false,
      errorMessage: `Could not find macro ${itemType}.${macroName}`
    }
  }
  const macro = new macroConstructor();

  if (!game.user.isGM && macro.requirePermissions != null) {
    const permissions = await macro.requirePermissions(context);
    for (const permission of permissions) {
      if (!hasPermission(permission)) {
        return {
          success: false,
          errorMessage: `Missing permissions: ${permissions.join(', ')}`
        }
      }
    }
  }

  try {
    await macro.run(context, macroData);
    return {
      success: true
    }
  } catch (err) {
    if (err instanceof Error) {
      err = err.message;
    }
    
    return {
      success: false,
      errorMessage: String(err)
    }
  }
}

class GlobalApi {

  public static async callMacro(itemType: keyof typeof collections, macroName: string, macroArguments: MacroArguments): Promise<void> {
    const context = macroContextFromArgs(macroArguments);
    try {
      await callMacroLocal(itemType, macroName, context)
    } catch (err) {
      if (err instanceof Error) {
        err = err.message;
      }
      ui.notifications.error(String(err));
    }
  }

}

export function registerHooks(): void {
  Hooks.on('init', () => {
    if (!game[staticValues.moduleName]) {
      game[staticValues.moduleName] = {};
    }
    game[staticValues.moduleName].api = GlobalApi;
    if (location.hostname === 'localhost') {
      game[staticValues.moduleName].devTools = DevTools;
    }
  });
  
  provider.getSocket().then(socket => {
    socket.register('callMacro', ({itemType, macroName, contextData, macroData}) => {
      return callMacroFromSocket(itemType, macroName, contextData, macroData);
    })
  });
}