import { CreateEcho } from "./feature-macro/create-echo";
import { DismissEcho } from "./feature-macro/dismiss-echo";
import { SwapEcho } from "./feature-macro/swap-echo";
import { IMacro } from "./macro";
import { staticValues } from "./static-values";

function wrapMacro(macro: IMacro): IMacro {
  return {
    run(): Promise<void> {
      return macro.run().catch(err => {
        if (typeof err === 'string') {
          ui.notifications.error(err);
        } else if (err instanceof Error) {
          ui.notifications.error(err.message);
        } else {
          ui.notifications.error(String(err));
        }
      })
    }
  }
}

class GlobalApi {

  public features = {
    // TODO link to an item
    createEcho: wrapMacro(new CreateEcho()),
    dismissEcho: wrapMacro(new DismissEcho()),
    swapEcho: wrapMacro(new SwapEcho()),
  }

}

const api = new GlobalApi();

export function registerHooks(): void {
  Hooks.on('init', () => {
    game[staticValues.moduleName] = {
      api: new GlobalApi()
    }
  });
}