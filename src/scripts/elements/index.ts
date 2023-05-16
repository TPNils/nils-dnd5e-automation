import { RollD20Element } from "./roll-d20-element";
import { RollDamageElement } from "./roll-damage-element";
import { RollResultElement } from "./roll-result-element";
import { TokenImgElement } from "./token-img-element";


export function registerHooks() {
  RollResultElement.registerHooks();
  RollDamageElement.registerHooks();
  RollD20Element.registerHooks();
  TokenImgElement.registerHooks();
}

export * from "./roll-d20-element";
export * from "./roll-damage-element";
export * from "./roll-result-element";
export * from "./token-img-element";