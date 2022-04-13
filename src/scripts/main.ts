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
import { TargetCardPart } from "./modular-card/target-card-part";
import { SpellLevelCardPart } from "./modular-card/spell-level-card-part";
import { RollResultElement } from "./elements/roll-result-element";
import { RollD20Element } from "./elements/roll-d20-element";
import { CheckCardPart } from "./modular-card/check-card-part";
import { ResourceCardPart } from "./modular-card/resources-card-part";
import { LayOnHandsCardPart } from "./modular-card/features/lay-on-hands-card-part";
import { ModuleSettings } from "./module-settings";
import { ActiveEffectCardPart } from "./modular-card/active-effect-card-part";

RollResultElement.registerHooks();
RollD20Element.registerHooks();
MutableDiceTerm.registerHooks();
registerHtmlHooks();
provider.registerHooks();
registerOverrideHooks()
UtilsHandlebars.registerHooks();
ModularCard.registerHooks();
AttackCardPart.instance.registerHooks();
CheckCardPart.instance.registerHooks();
DamageCardPart.instance.registerHooks();
DescriptionCardPart.instance.registerHooks();
PropertyCardPart.instance.registerHooks();
SpellLevelCardPart.instance.registerHooks();
TargetCardPart.instance.registerHooks();
TemplateCardPart.instance.registerHooks();
ResourceCardPart.instance.registerHooks();
ActiveEffectCardPart.instance.registerHooks();
LayOnHandsCardPart.instance.registerHooks();
ModuleSettings.registerHooks();

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