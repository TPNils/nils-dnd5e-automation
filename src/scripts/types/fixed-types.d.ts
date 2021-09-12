interface BaseDocument<DATA> {
  id?: string;
  uuid: string;
  data: DATA;
  folder?: string;
  getFlag(moduleName: string, key: string): any;
  testUserPermission(user: User, permission: keyof CONST.ENTITY_PERMISSIONS, exact?: boolean);
  clone(merge: DeepPartial<this>, options?: {keepId: boolean});
  update(data: DeepPartial<DATA> | {[key: string]: any});
  delete();
}

export interface ActorAbility {
  value: number;
  checkBonus: number;
  dc: number;
  mod: number;
  prof: number; // Flat proficiantie bonus
  proficient: number; // Proficiantie multiplier
  save: number; // The bonus on saving throws
  saveBonus: number; // Not sure what this is?
}

export type MyActorData = {
  [key: string]: any;
  name: string;
  data: {
    [key: string]: any;
    abilities: {
      str: ActorAbility;
      dex: ActorAbility;
      con: ActorAbility;
      wis: ActorAbility;
      int: ActorAbility;
      cha: ActorAbility;
    };
    attributes: {
      [key: string]: any;
      ac: {​
        base?: number;
        bonus?: number;
        calc: string;
        cover?: number;
        flat?: number;
        formula?: string;
        min: number;
        shield?: number;
        value: number;
      };
      hp: {
        formula?: string;
        max: number;
        min: number;
        temp: number;
        tempmax: number;
        value: number;
      }
    }
    bonuses: {
      check: {
        check: string;
        save: string;
        skill: string;
      };
      [key: 'mwak' | 'rwak' | 'msak' | 'rsak']: {
        attack: string;
        damage: string;
      };
      spell: {
        dc: string;
      }
    };
    details: {
      alignment?: string;
      appearance?: string;
      background?: string;
      biography?: string;
      bond?: string;
      cr?: number;
      flaw?: string;
      ideal?: string;
      level: number;
      race?: string;
      spellLevel: number;
      trait?: string;
      xp?: {
        max: number;
        min: number;
        pct: number;
        value: number;
      }
    }
    mod: number;
    prof: number;
    traits: {
      armorProf: {
        custom: string;
        value: string[];
      };
      /** condition immunities */
      ci: {
        custom: string;
        value: string[];
      };
      /** damage immunities */
      di: {
        custom: string;
        value: string[];
      };
      /** damage resistances */
      dr: {
        custom: string;
        value: string[];
      };
      /** damage vulnerabilities */
      dv: {
        custom: string;
        value: string[];
      };
    }
  }
}

export type DamageType = '' /* none */ | 'acid' | 'bludgeoning' | 'cold' | 'fire' | 'force' | 'lightning' | 'necrotic' | 'piercing' | 'poison' | 'psychic' | 'radiant' | 'slashing' | 'thunder' | 'healing' | 'temphp';

export type RangeUnits = '' | 'none' | 'self' | 'touch' | 'spec' | 'any' | 'ft' | 'mi' | 'm' | 'km';

export type MyItemData = {
  [key: string]: any;
  name: string;
  data: {
    [key: string]: any;
    ability: '' /* default */ | keyof MyActorData['data']['abilities'];
    actionType?: 'mwak' | 'rwak' | 'msak' | 'rsak' | 'save' | 'heal' | 'abil' | 'util' | 'other';
    attackBonus?: number | string;
    consume: {
      type?: 'ammo' | 'attribute' | 'material' | 'charges';
      target?: string;
      amount?: number;
    }
    damage?: {
      [key: string]: any;
      parts?: [string, DamageType][]; // array of ['damage formula', 'damage type']
      versatile?: string;
    },
    description: {
      value?: string | null;
    },
    level?: number;
    materials: {
      consumed: boolean;
      cost?: number;
      supply?: number;
      value?: string | null;
    },
    proficient: boolean;
    quantity?: number;
    range: {
      value?: number;
      long?: number;
      units: RangeUnits;
    },
    target: {
      value?: number;
      width?: number;
      units: RangeUnits;
      type: '' | 'ally' | 'cone' | 'creature' | 'cube' | 'cylinder' | 'enemy' | 'line' | 'none' | 'object' | 'radius' | 'self' | 'space' | 'sphere' | 'square' | 'wall';
    },
    save: {
      dc?: number;
      ability?: '' | keyof MyActorData['data']['abilities'];
      scaling?: '' | 'spell' | 'flat' | keyof MyActorData['data']['abilities'];
    };
    scaling: {
      mode?: 'none' | 'cantrip' | 'level',
      formula?: string;
    }
  }
}

export type MyItem = Item & BaseDocument<MyItemData> & {
  getChatData: () => any;
  roll({}: {configureDialog?: boolean, rollMode?: ClientSettings.Values[`core.rollMode`], createMessage?: boolean} = {}): Promise<ChatMessage>;
  displayCard({}: {rollMode?: ClientSettings.Values[`core.rollMode`], createMessage?: boolean} = {}): Promise<ChatMessage>;
  protected prepareFinalAttributes: () => void;
  pack?: string;
  hasAreaTarget: boolean;
};

export type MyActor = Actor & BaseDocument<MyActorData> & {
  items: Map<string, MyItem>;
  parent: any;
  pack: any;
  isOwner: boolean;
  update(data: any, context?: any);
}

export type MyCompendiumCollection = CompendiumCollection & BaseDocument<CompendiumCollection.Metadata>;