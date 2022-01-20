import { DamageType } from "../types/fixed-types";

export class ItemCardHelpers {
  
  public static get healingDamageTypes(): DamageType[] {
    return Object.keys((CONFIG as any).DND5E.healingTypes) as any;
  }
  
}