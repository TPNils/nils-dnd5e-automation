import { registerHooks as registerGlobalApiHooks } from "./global-api";
import { registerHooks as registerHtmlHooks } from "./global-html-listener";
import { registerHooks as registerOverrideHooks } from "./override/index.js";
import { provider } from "./provider/provider";
import { registerHooks as registerReEvaluatableDieHooks } from "./roll/re-evaluatable-die";
import { UtilsChatMessage } from "./utils/utils-chat-message";
import { UtilsHandlebars } from "./utils/utils-handlebars";

registerGlobalApiHooks();
registerHtmlHooks();
provider.registerHooks();
UtilsChatMessage.registerHooks();
registerReEvaluatableDieHooks();
registerOverrideHooks()
UtilsHandlebars.registerHooks();