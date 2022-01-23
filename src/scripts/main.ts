import { registerHooks as registerGlobalApiHooks } from "./global-api";
import { registerHooks as registerHtmlHooks } from "./global-html-listener";
import { registerHooks as registerOverrideHooks } from "./override/index.js";
import { provider } from "./provider/provider";
import { UtilsChatMessage } from "./utils/utils-chat-message";
import { UtilsHandlebars } from "./utils/utils-handlebars";
import { ModularCard } from "./modular-card/modular-card";
import { AttackCardPart } from "./modular-card/attack-card-part";
import { DamageCardPart } from "./modular-card/damage-card-part";

registerGlobalApiHooks();
registerHtmlHooks();
provider.registerHooks();
UtilsChatMessage.registerHooks();
registerOverrideHooks()
UtilsHandlebars.registerHooks();
ModularCard.registerHooks();
AttackCardPart.registerHooks();
DamageCardPart.registerHooks();