import { registerHooks as registerHtmlHooks } from "./global-html-listener";
import { registerHooks as registerOverrideHooks } from "./override/index.js";
import { provider } from "./provider/provider";
import { staticValues } from "./static-values";
import { ReusableDiceTerm } from "./lib/roll/reusable-dice-term";
import { registerHooks as registerHooksElement } from "./elements/index";
import { ModuleSettings } from "./settings/module-settings";
import { registerHooks as registerModularCardHooks } from "./modular-card/index";
import { VirtualNodeParser } from "./lib/render-engine/virtual-dom/virtual-node-parser";
import { UtilsHooks } from "./utils/utils-hooks";
import { ComponentFoundryConnector } from "./lib/render-engine/component-foundry-connector";

UtilsHooks.registerHooks();
VirtualNodeParser.init();
registerHooksElement();
ReusableDiceTerm.registerHooks();
registerHtmlHooks();
provider.registerHooks();
registerOverrideHooks()
ModuleSettings.registerHooks();
registerModularCardHooks();
ComponentFoundryConnector.registerHooks();

Hooks.on('init', () => {
  const hbsFiles: string[] = [];
  if (game.modules.has(staticValues.moduleName)) {
    const files = game.modules.get(staticValues.moduleName).data.flags?.hbsFiles;
    if (Array.isArray(files)) {
      hbsFiles.push(...files.map(f => `modules/${staticValues.moduleName}/${f}`));
    }
  } else if (game.system.id === staticValues.moduleName) {
    const files = game.system.data.flags?.hbsFiles;
    if (Array.isArray(files)) {
      hbsFiles.push(...files.map(f => `systems/${staticValues.moduleName}/${f}`));
    }
  }
  if (hbsFiles.length > 0) {
    loadTemplates(hbsFiles);
  }
});