import EmbeddedCollection from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/abstract/embedded-collection.mjs";
import { ActorData } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/data/module.mjs";

export type DataHolderV8<SYSTEM extends object> = {
  data: foundry.abstract.DocumentData<any, SYSTEM> & SYSTEM;
}

export type DataHolderV10<SYSTEM extends object, DATA extends object = object> = foundry.abstract.DataModel<SYSTEM, DATA>

export type DataHolder<SYSTEM extends object, DATA extends object = object> = Partial<DataHolderV8<DATA> | DataHolderV10<SYSTEM, DATA>>

export interface BaseDocument<SYSTEM extends object, DATA extends object = object> {
  id?: string;
  uuid: string;
  getFlag(moduleName: string, key: string): any;
  testUserPermission(user: User, permission: keyof CONST.DOCUMENT_PERMISSION_LEVELS, exact?: boolean);
  getEmbeddedCollection(embeddedName: string): EmbeddedCollection<any, any>;
  createEmbeddedDocuments(embeddedName: string, data: any[]): Promise<Array<Document<any, this>>>;
  updateEmbeddedDocuments(embeddedName: string, updates?: Array<Record<string, unknown>>, context?: DocumentModificationContext): Promise<Array<Document<any, this>>>;
  deleteEmbeddedDocuments(embeddedName: string, ids: string[], context?: DocumentModificationContext): Promise<Array<Document<any, this>>>;
  
  /** @private only used to find the implicit type */
  ___GENERIC_DATA_TYPE___?: DATA & {_id?: string};
  ___GENERIC_SYSTEM_TYPE___?: SYSTEM;
}


export interface BaseDocumentV8<SYSTEM extends object, DATA extends object = object> {
  data: foundry.abstract.DocumentData<any, SYSTEM> & SYSTEM;
  clone(merge: DeepPartial<DATA & {data: SYSTEM}>, options?: {keepId?: boolean});
  
  /** @private only used to find the implicit type */
  ___GENERIC_DATA_TYPE___?: DATA;
  ___GENERIC_SYSTEM_TYPE___?: SYSTEM;
}

export type BaseDocumentV10<SYSTEM extends object, DATA extends object = object> = foundry.abstract.DataModel<SYSTEM, DATA> & {
  clone(merge: DeepPartial<DATA & {system: SYSTEM}>, options?: {keepId?: boolean});
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

export interface ActorSkill {
  value: number; // Proficiantie multiplier
  ability: keyof MyActorData['abilities'];
  bonus: number;
  mod: number;
  prof: {
    multiplier: number;
    rounding: "down";
  },
  proficient: number;
  total: number;
  passive: number;
}

export interface SpellData {
  max: number;
  override?: number | null;
  slotsAvailable: boolean;
  value: number;
}

export interface ActorData {
  _id: string;
  name: string;
  type: string;
  img: string;
  items: Map<string, MyItem>;
  effects: Map<string, ActiveEffect>;
  sort: number;
  folder?: Folder;
  flags: Record<string, Record<string, any>>;
  
  // V10
  // prototypeToken: TokenDocument;
  /** @deprecated since V10 */
  // token: TokenDocument;
}
export type MyActorData = {
  // [key: string]: any;
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
    ac: {
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
    death?: {
      success?: number;
      failure?: number;
    }
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
    /** NPC only */
    type?: {
      custom?: string;
      subtype?: string;
      swarm?: '' | 'tiny' | 'sm' | 'med' | 'lg' | 'huge' | 'grg';
      value?: 'aberration' | 'beast' | 'celestial' | 'construct' | 'dragon' | 'elemental' | 'fey' | 'fiend' | 'giant' | 'humanoid' | 'monstrosity' | 'ooze' | 'plant' | 'undead';
    }
    trait?: string;
    xp?: {
      max: number;
      min: number;
      pct: number;
      value: number;
    }
  }
  mod: number;
  prof?: {
    hasProficiency: boolean;
    term: string;
  };
  resources: {
    [key: 'primary' | 'secondary' | 'tertiary']: {​​​​​
      label: string;
      max: number | string;
      sr: boolean;
      lr: false;
      value: number | string;
    }
  }
  skills: {
    acr: ActorSkill;
    ani: ActorSkill;
    arc: ActorSkill;
    ath: ActorSkill;
    dec: ActorSkill;
    his: ActorSkill;
    ins: ActorSkill;
    itm: ActorSkill;
    inv: ActorSkill;
    med: ActorSkill;
    nat: ActorSkill;
    prc: ActorSkill;
    prf: ActorSkill;
    per: ActorSkill;
    rel: ActorSkill;
    slt: ActorSkill;
    ste: ActorSkill;
    sur: ActorSkill;
  }
  spells: {
    pact: SpellData & {
      level: number;
    }
    spell1: SpellData;
    spell2: SpellData;
    spell3: SpellData;
    spell4: SpellData;
    spell5: SpellData;
    spell6: SpellData;
    spell7: SpellData;
    spell8: SpellData;
    spell9: SpellData;
  }
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

export type DamageType = '' /* none */ | 'acid' | 'bludgeoning' | 'cold' | 'fire' | 'force' | 'lightning' | 'necrotic' | 'piercing' | 'poison' | 'psychic' | 'radiant' | 'slashing' | 'thunder' | 'healing' | 'temphp';

export type RangeUnits = '' | 'none' | 'self' | 'touch' | 'spec' | 'any' | 'ft' | 'mi' | 'm' | 'km';

export interface ItemData {
  _id: string,
  name: string,
  type: string,
  img: string,
  effects: Map<string, ActiveEffect>;
  sort: number;
  folder?: Folder;
  flags: Record<string, Record<string, any>>;
}
export type MyItemData = {
  // [key: string]: any;
  ability: '' /* default */ | keyof MyActorData['abilities'];
  actionType?: 'mwak' | 'rwak' | 'msak' | 'rsak' | 'save' | 'heal' | 'abil' | 'util' | 'other';
  attackBonus?: number | string;
  consume: {
    type?: 'ammo' | 'attribute' | 'material' | 'charges';
    target?: string;
    amount?: number;
  }
  critical?: {
    threshold?: number;
    damage?: string;
  }
  damage?: {
    [key: string]: any;
    parts?: [string, DamageType][]; // array of ['damage formula', 'damage type']
    versatile?: string;
  },
  description: {
    value?: string | null;
  },
  /** "Other" damage */
  formula?: string;
  level?: number;
  materials: {
    consumed: boolean;
    cost?: number;
    supply?: number;
    value?: string | null;
  },
  prof?: {
    hasProficiency: boolean;
    term?: string;
  }
  proficient: boolean;
  preparation: {
    mode: 'always' | 'atwill' | 'innate' | 'pact' | 'prepared';
    prepared: boolean;
  }
  properties: {
    ada: boolean; // Adamantine
    amm: boolean; // Ammo
    fin: boolean; // Finesse
    fir: boolean; // firearm
    foc: boolean; // focus
    hvy: boolean; // heavy
    lgt: boolean; // light
    lod: boolean; // loading
    mgc: boolean; // magical
    rch: boolean; // reach
    rel: boolean; // reload
    ret: boolean; // returning
    sil: boolean; // silvered
    spc: boolean; // special
    thr: boolean; // thrown
    two: boolean; // twohanded
    ver: boolean; // versatile
  }
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
    ability?: '' | keyof MyActorData['abilities'];
    scaling?: '' | 'spell' | 'flat' | keyof MyActorData['abilities'];
  };
  scaling: {
    mode?: 'none' | 'cantrip' | 'level',
    formula?: string;
  };
  uses?: {
    max?: string | number;
    value?: number;
    per?: 'sr' | 'lr' | 'day' | 'charges' | '';
    autoDestroy?: boolean;
  }
}

export interface D20RollOptions {
  /** The dice roll component parts, excluding the initial d20 */
  parts?: string[];
  /** Actor or item data against which to parse the roll */
  data?: object;
  /** Apply advantage to the roll (unless otherwise specified) */
  advantage?: boolean;
  /** Apply disadvantage to the roll (unless otherwise specified) */
  disadvantage?: boolean;
  /** The value of d20 result which represents a critical success */
  critical?: number;
  /** The value of d20 result which represents a critical failure */
  fumble?: number;
  /** Assign a target value against which the result of this roll should be compared */
  targetValue?: number;
  /** Allow Elven Accuracy to modify this roll? */
  elvenAccuracy?: boolean;
  /** Allow Halfling Luck to modify this roll? */
  halflingLucky?: boolean;
  /** Allow Reliable Talent to modify this roll? */
  reliableTalent?: boolean;
  /** Choose the ability modifier that should be used when the roll is made */
  chooseModifier?: boolean;
  /** Allow fast-forward advantage selection */
  fastForward?: boolean;
  /** The triggering event which initiated the roll */
  event?: Event;
  /** The HTML template used to render the roll dialog */
  template?: string;
  /** The dialog window title */
  title?: string;
  /** Modal dialog options */
  dialogOptions?: object;
  /** Automatically create a Chat Message for the result of this roll */
  chatMessage?: boolean;
  /** Additional data which is applied to the created Chat Message, if any */
  messageData?: object;
  /** A specific roll mode to apply as the default for the resulting roll */
  rollMode?: string;
  /** The ChatMessage speaker to pass when creating the chat */
  speaker?: object;
  /** Flavor text to use in the posted chat message */
  flavor?: string;
}

export interface DamageRollConfig {
  /** The dice roll component parts, excluding the initial d20 */
  parts?: string[];
  /** Actor or item data against which to parse the roll */
  data?: Record<string, any>;
  
  /** Flag this roll as a critical hit for the purposes of fast-forward or default dialog action */
  critical?: boolean;
  /** A number of bonus damage dice that are added for critical hits */
  criticalBonusDice?: number;
  /** A critical hit multiplier which is applied to critical hits */
  criticalMultiplier?: number;
  /** Multiply numeric terms by the critical multiplier */
  multiplyNumeric?: boolean;
  /** Apply the "powerful criticals" house rule to critical hits */
  powerfulCritical?: boolean;
  /** An extra damage term that is applied only on a critical hit */
  criticalBonusDamage?: string;
  
  /** Allow fast-forward advantage selection */
  fastForward?: boolean;
  /** The triggering event which initiated the roll */
  event?: Event;
  /** Allow the opportunity for a critical hit to be rolled */
  allowCritical?: boolean;
  /** The HTML template used to render the roll dialog */
  template?: string;
  /** The dice roll UI window title */
  title?: string;
  /** Configuration dialog options */
  dialogOptions?: Record<string, any>;
  
  /** Automatically create a Chat Message for the result of this roll */
  chatMessage?: boolean;
  /** Additional data which is applied to the created Chat Message, if any */
  messageData?: Record<string, any>;
  /** A specific roll mode to apply as the default for the resulting roll */
  rollMode?: string;
  /** The ChatMessage speaker to pass when creating the chat */
  speaker?: Record<string, any>;
  /** Flavor text to use in the posted chat message */
  flavor?: string;
}

export interface MyItem extends BaseDocument<MyItemData, ItemData> {
  name: string;
  img: string;
  type: 'weapon' | 'equipment' | 'consumable' | 'tool' | 'loot' | 'class' | 'spell' | 'feat' | 'backpack';
  actor?: MyActor;
  parent?: MyActor;
  readonly abilityMod: keyof MyActorData['abilities']
  readonly hasAttack: boolean;
  readonly hasDamage: boolean;
  getRollData: () => {[key: string]: any};
  getChatData: () => any;
  rollAttack(options?: D20RollOptions): Promise<Roll | null>;
  rollDamage(args?: {critical?: boolean, spellLevel?: MyItemData['level'], versatile?: boolean, options?: DamageRollConfig}): Promise<Roll>;
  rollFormula(options?: {spellLevel?: number; chatMessage?: boolean;}): Promise<Roll | null>;
  roll({}: {configureDialog?: boolean, rollMode?: ClientSettings.Values[`core.rollMode`], createMessage?: boolean} = {}): Promise<ChatMessage>;
  displayCard({}: {rollMode?: ClientSettings.Values[`core.rollMode`], createMessage?: boolean} = {}): Promise<ChatMessage>;
  getCriticalThreshold(): number | null;
  protected prepareFinalAttributes: () => void;
  pack?: string;
  hasAreaTarget: boolean;
  effects: Map<string, ActiveEffect & foundry.abstract.Document<any, ActiveEffectData> & BaseDocument<ActiveEffectData>>;
};

export type MyActor = BaseDocument<MyActorData, ActorData> & {
  img: string;
  type: 'character' | 'npc' | 'vehicle';
  items: Map<string, MyItem>;
  parent: any;
  pack: any;
  isOwner: boolean;
  isToken: boolean;
  update(data: any, context?: any);
  rollSkill(skillId: keyof MyActorData['skills'], options?: D20RollOptions): Promise<Roll>;
  rollAbilityTest(abilityId: keyof MyActorData['abilities'], options?: D20RollOptions): Promise<Roll>;
  rollAbilitySave(abilityId: keyof MyActorData['abilities'], options?: D20RollOptions): Promise<Roll>;
}

export type MyCompendiumCollection = CompendiumCollection & BaseDocument<CompendiumCollection.Metadata>;