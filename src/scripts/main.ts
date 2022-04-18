import { registerHooks as registerHtmlHooks } from "./global-html-listener";
import { registerHooks as registerOverrideHooks } from "./override/index.js";
import { provider } from "./provider/provider";
import { UtilsHandlebars } from "./utils/utils-handlebars";
import { ModularCard } from "./modular-card/modular-card";
import { staticValues } from "./static-values";
import { MutableDiceTerm } from "./lib/roll/mutable-dice-term";
import { RollResultElement } from "./elements/roll-result-element";
import { RollD20Element } from "./elements/roll-d20-element";
import { ModuleSettings } from "./module-settings";
import { registerHooks as registerModularCardBaseHooks } from "./modular-card/base/index";
import { registerHooks as registerModularCardSrdHooks } from "./modular-card/srd/index";
import MyAbilityTemplate from "./pixi/ability-template";

RollResultElement.registerHooks();
RollD20Element.registerHooks();
MutableDiceTerm.registerHooks();
MyAbilityTemplate.registerHooks();
registerHtmlHooks();
provider.registerHooks();
registerOverrideHooks()
UtilsHandlebars.registerHooks();
ModularCard.registerHooks();
ModuleSettings.registerHooks();
registerModularCardBaseHooks();
registerModularCardSrdHooks();

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