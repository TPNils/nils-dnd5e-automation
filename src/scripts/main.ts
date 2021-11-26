import { registerHooks as registerGlobalApiHooks } from "./global-api";
import { registerHooks as registerHtmlHooks } from "./global-html-listener";
import { registerHooks as registerOverrideHooks } from "./override/index.js";
import { provider } from "./provider/provider";
import { registerHooks as registerLibHooks } from "./lib/index.js";
import { UtilsChatMessage } from "./utils/utils-chat-message";
import { UtilsHandlebars } from "./utils/utils-handlebars";

registerGlobalApiHooks();
registerHtmlHooks();
provider.registerHooks();
UtilsChatMessage.registerHooks();
registerLibHooks();
registerOverrideHooks()
UtilsHandlebars.registerHooks();