import { ChatSpeakerDataProperties } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/data/data.mjs/chatSpeakerData";
import { PropertiesToSource } from "@league-of-foundry-developers/foundry-vtt-types/src/types/helperTypes";
import { hasPermission } from "./custom-permissions";
import { CreateEcho } from "./feature-macro/create-echo";
import { DismissEcho } from "./feature-macro/dismiss-echo";
import { SwapEcho } from "./feature-macro/swap-echo";
import { IMacro, IMacroConstructor } from "./macro";
import { MacroContext, MacroContextData } from "./macro-context";
import { provider } from "./provider/provider";
import { staticValues } from "./static-values";

type MacroCollection = {[key: string]: IMacroConstructor};
type MacroArguments = [PropertiesToSource<ChatSpeakerDataProperties>, Actor, Token, Actor];

interface CallMacroResponse {
  success: boolean;
  errorPermissions: boolean;
  errorMessage?: string;
}

const collections: {[key in ('features' | 'spells' | 'items')]: MacroCollection} = {

  features: {
    // TODO link to an item in compedium
    createEcho: CreateEcho,
    dismissEcho: DismissEcho,
    swapEcho: SwapEcho,
  },

  spells: {

  },

  items: {
    
  }

}

async function callMacroInternal(itemType: keyof typeof collections, macroName: string, context: MacroContext): Promise<CallMacroResponse> {
  const macroConstructor = collections[itemType]?.[macroName];
  if (macroConstructor == null) {
    return {
      success: false,
      errorPermissions: false,
      errorMessage: `Could not find macro ${itemType}.${macroName}`
    }
  }
  const macro = new macroConstructor(context);

  if (!game.user.isGM && macro.requirePermissions != null) {
    const permissions = await macro.requirePermissions();
    for (const permission of permissions) {
      if (!hasPermission(permission)) {
        return {
          success: false,
          errorPermissions: true,
          errorMessage: `Missing permissions: ${permissions.join(', ')}`
        }
      }
    }
  }

  try {
    await macro.run();
    return {
      success: true,
      errorPermissions: false,
    }
  } catch (err) {
    if (err instanceof Error) {
      err = err.message;
    }
    
    return {
      success: false,
      errorPermissions: true,
      errorMessage: String(err)
    }
  }
}

class GlobalApi {

  public async callMacro(itemType: keyof typeof collections, macroName: string, macroArguments: MacroArguments): Promise<void> {
    const context = MacroContext.fromVanillaArguments(macroArguments);
    let response: CallMacroResponse = await callMacroInternal(itemType, macroName, context);
    if (response.errorPermissions) {
      const socket = await provider.getSocket();
      response = await socket.executeAsGM('callMacro', {itemType: itemType, macroName: macroName, contextData: context.getMactoContextData()});
    } 

    if (!response.success) {
      ui.notifications.error(response.errorMessage);
    }
  }
  
  public callMacroFromSocket(itemType: keyof typeof collections, macroName: string, contextData: MacroContextData): Promise<CallMacroResponse> {
    return callMacroInternal(itemType, macroName, MacroContext.fromData(contextData));
  }

}

const api = new GlobalApi();

export function registerHooks(): void {
  Hooks.on('init', () => {
    if (!game[staticValues.moduleName]) {
      game[staticValues.moduleName] = {};
    }
    game[staticValues.moduleName].api = api;
  });
  
  provider.getSocket().then(socket => {
    socket.register('callMacro', ({itemType, macroName, contextData}) => {
      return api.callMacroFromSocket(itemType, macroName, contextData);
    })
  });
}