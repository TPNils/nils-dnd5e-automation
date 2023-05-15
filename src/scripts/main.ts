import { registerHooks as registerHtmlHooks } from "./global-html-listener";
import { registerHooks as registerOverrideHooks } from "./override/index.js";
import { provider } from "./provider/provider";
import { ModularCard } from "./modular-card/modular-card";
import { staticValues } from "./static-values";
import { ReusableDiceTerm } from "./lib/roll/reusable-dice-term";
import { RollResultElement } from "./elements/roll-result-element";
import { RollD20Element } from "./elements/roll-d20-element";
import { ModuleSettings } from "./settings/module-settings";
import { registerHooks as registerModularCardBaseHooks } from "./modular-card/base/index";
import { registerHooks as registerModularCardSrdHooks } from "./modular-card/srd/index";
import MyAbilityTemplate from "./pixi/ability-template";
import { ItemSheetHooks } from "./modular-card/item-sheet-hooks";
import { TokenImgElement } from "./elements/token-img-element";
import { VirtualNodeParser } from "./lib/render-engine/virtual-dom/virtual-node-parser";
import { RollDamageElement } from "./elements/roll-damage-element";
import { UtilsHooks } from "./utils/utils-hooks";
import { ComponentFoundryConnector } from "./lib/render-engine/component-foundry-connector";

UtilsHooks.registerHooks();
VirtualNodeParser.init();
TokenImgElement.registerHooks();
RollResultElement.registerHooks();
RollD20Element.registerHooks();
RollDamageElement.registerHooks();
ReusableDiceTerm.registerHooks();
MyAbilityTemplate.registerHooks();
ItemSheetHooks.registerHooks();
registerHtmlHooks();
provider.registerHooks();
registerOverrideHooks()
ModularCard.registerHooks();
ModuleSettings.registerHooks();
registerModularCardBaseHooks();
registerModularCardSrdHooks();
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