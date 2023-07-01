import { MyActor, MyActorData, MyItemData } from "../types/fixed-types";

export class UtilsDnd5e {

  public static getAbilityKeys(): keyof MyActorData['abilities'] {
    return Object.keys((game as any).dnd5e.config.abilities) as any;
  }

  public static getSkillKeys(): keyof MyActorData['skills'] {
    return Object.keys((game as any).dnd5e.config.skills) as any;
  }

  public static getItemActionTypeKeys(): MyItemData['actionType'] {
    return Object.keys((game as any).dnd5e.config.itemActionTypes) as any;
  }

  public static getCreatureTypeKeys(): MyActorData['details']['type']['value'] {
    return Object.keys((game as any).dnd5e.config.creatureTypes) as any;
  }

}