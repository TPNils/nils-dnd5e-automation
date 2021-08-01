import { registerHooks as registerGlobalApiHooks } from "./global-api";
import { provider } from "./provider/provider";

registerGlobalApiHooks();
provider.registerHooks();