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

  

}

const api = new GlobalApi();

export function registerHooks(): void {
  Hooks.on('init', () => {
    game[staticValues.moduleName] = {
      api: new GlobalApi()
    }
  });
}