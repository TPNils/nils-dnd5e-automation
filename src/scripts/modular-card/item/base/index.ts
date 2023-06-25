import { ActiveEffectCardPart } from "./active-effect-card-part";
import { AttackCardPart } from "./attack-card-part";
import { CheckCardPart } from "./check-card-part";
import { DamageCardPart } from "./damage-card-part";
import { DeletedDocumentsCardPart } from "./deleted-documents-card-part";
import { DescriptionCardPart } from "./description-card-part";
import { OtherCardPart } from "./other-card-part";
import { PropertyCardPart } from "./property-card-part";
import { ResourceCardPart } from "./resources-card-part";
import { SpellLevelCardPart } from "./spell-level-card-part";
import { TargetCardPart } from "./target-card-part";
import { TemplateCardPart } from "./template-card-part";

export function registerHooks() {
  ActiveEffectCardPart.instance.registerHooks();
  AttackCardPart.instance.registerHooks();
  CheckCardPart.instance.registerHooks();
  DamageCardPart.instance.registerHooks();
  DeletedDocumentsCardPart.instance.registerHooks();
  DescriptionCardPart.instance.registerHooks();
  OtherCardPart.instance.registerHooks();
  PropertyCardPart.instance.registerHooks();
  SpellLevelCardPart.instance.registerHooks();
  TargetCardPart.instance.registerHooks();
  TemplateCardPart.instance.registerHooks();
  ResourceCardPart.instance.registerHooks();
}

export * from "./active-effect-card-part";
export * from "./attack-card-part";
export * from "./check-card-part";
export * from "./damage-card-part";
export * from "./deleted-documents-card-part";
export * from "./property-card-part";
export * from "./description-card-part";
export * from "./other-card-part";
export * from "./resources-card-part";
export * from "./spell-level-card-part";
export * from "./target-card-part";
export * from "./template-card-part";