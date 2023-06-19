import { ItemSheetHooks } from "./item/item-sheet-hooks";
import { registerHooks as baseRegisterHooks } from "./item/base/index";
import { registerHooks as srdRegisterHooks } from "./item/srd/index";
import { ModularCard } from "./modular-card";
import { RollInjector } from "./actor/roll-injector";
import { ActorRollComponent } from "./actor/actor-roll-component";
import { ModularCardRefresher } from "./modular-card-refresher";

export function registerHooks() {
  ItemSheetHooks.registerHooks();
  ModularCard.registerHooks();
  RollInjector.registerHooks();
  ActorRollComponent.registerHooks();
  ModularCardRefresher.registerHooks();
  baseRegisterHooks();
  srdRegisterHooks();
}