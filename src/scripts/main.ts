import { registerHooks as registerGlobalApiHooks } from "./global-api";
import { registerHooks as registerHtmlHooks } from "./html-listener";
import { provider } from "./provider/provider";

registerGlobalApiHooks();
registerHtmlHooks();
provider.registerHooks();