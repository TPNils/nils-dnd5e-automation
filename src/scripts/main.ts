import { registerHooks as registerGlobalApiHooks } from "./global-api";
import { registerHooks as registerHtmlHooks } from "./global-html-listener";
import { registerHooks as registerOverrideHooks } from "./override/index.js";
import { provider } from "./provider/provider";
import { UtilsHandlebars } from "./utils/utils-handlebars";
import { ModularCard } from "./modular-card/modular-card";
import { AttackCardPart } from "./modular-card/attack-card-part";
import { DamageCardPart } from "./modular-card/damage-card-part";
import { staticValues } from "./static-values";
import { DescriptionCardPart } from "./modular-card/description-card-part";
import { PropertyCardPart } from "./modular-card/property-card-part";
import { TemplateCardPart } from "./modular-card/template-card-part";
import { MutableDiceTerm } from "./lib/roll/mutable-dice-term";

registerGlobalApiHooks();
registerHtmlHooks();
provider.registerHooks();
registerOverrideHooks()
MutableDiceTerm.registerHooks();
UtilsHandlebars.registerHooks();
ModularCard.registerHooks();
AttackCardPart.registerHooks();
DamageCardPart.registerHooks();
DescriptionCardPart.registerHooks();
PropertyCardPart.registerHooks();
TemplateCardPart.registerHooks();

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