import { hasPermission } from "./custom-permissions";
import { CreateEcho } from "./feature-macro/create-echo";
import { DismissEcho } from "./feature-macro/dismiss-echo";
import { SwapEcho } from "./feature-macro/swap-echo";
import { IMacro } from "./macro";
import { provider } from "./provider/provider";
import { staticValues } from "./static-values";

type MacroCollection = {[key: string]: IMacro};

interface CallMacroResponse {
  success: boolean;
  errorPermissions: boolean;
  errorMessage?: string;
}

const collections: {[key in ('features' | 'spells' | 'items')]: MacroCollection} = {

  features: {
    // TODO link to an item in compedium
    createEcho: new CreateEcho(),
    dismissEcho: new DismissEcho(),
    swapEcho: new SwapEcho(),
  },

  spells: {

  },

  items: {
    
  }

}


function validatePermissions(macro: IMacro): boolean {
  

  return true;
}

async function callMacroInternal(itemType: keyof typeof collections, macroName: string): Promise<CallMacroResponse> {
  const macro = collections[itemType]?.[macroName];
  if (macro == null) {
    return {
      success: false,
      errorPermissions: false,
      errorMessage: `Could not find macro ${itemType}.${macroName}`
    }
  }

  if (!game.user.isGM && macro.requirePermissions != null) {
    for (const permission of macro.requirePermissions()) {
      if (!hasPermission(permission)) {
        return {
          success: false,
          errorPermissions: true,
          errorMessage: `Missing permissions: ${macro.requirePermissions().join(', ')}`
        }
      }
    }
  }

  try {
    await macro.run();
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

  public async callMacro(itemType: keyof typeof collections, macroName: string): Promise<void> {
    let response: CallMacroResponse = await callMacroInternal(itemType, macroName);
    if (response.errorPermissions) {
      const socket = await provider.getSocket();
      response = await socket.executeAsGM('callMacro', {itemType: itemType, macroName: macroName});
    } 

    if (!response.success) {
      ui.notifications.error(response.errorMessage);
    }
  }
  
  public callMacroFromSocket(itemType: keyof typeof collections, macroName: string): Promise<any> {
    return callMacroInternal(itemType, macroName);
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
    socket.register('callMacro', ({itemType, macroName}) => {
      return api.callMacroFromSocket(itemType, macroName);
    })
  });
}