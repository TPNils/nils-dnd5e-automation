import { LayOnHandsCardPart } from "./features/lay-on-hands-card-part";
import { SneakAttackCardPart } from "./features/sneak-attack-card-part";

export function registerHooks() {
  LayOnHandsCardPart.instance.registerHooks();
  SneakAttackCardPart.instance.registerHooks();
}

export * from "./features/lay-on-hands-card-part";