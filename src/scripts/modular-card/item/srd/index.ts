import { SrdLayOnHandsCardPart } from "./features/lay-on-hands-card-part";
import { SrdSneakAttackCardPart } from "./features/sneak-attack-card-part";

export function registerHooks() {
  SrdLayOnHandsCardPart.instance.registerHooks();
  SrdSneakAttackCardPart.instance.registerHooks();
}

export * from "./features/lay-on-hands-card-part";
export * from "./features/sneak-attack-card-part";