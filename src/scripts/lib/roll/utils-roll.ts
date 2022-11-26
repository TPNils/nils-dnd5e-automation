import { ReEvaluatableDie } from "./re-evaluatable-die";
import { DamageType, MyActor, MyActorData, MyItemData } from "../../types/fixed-types";
import { UtilsDiceSoNice } from "./utils-dice-so-nice";
import { ReusableDiceTerm } from "./reusable-dice-term";
import { staticValues } from "../../static-values";

const validDamageTypes: DamageType[] = ['' /* none */, 'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder', 'healing', 'temphp'];

export type TermData = ((PoolTerm.TermData & { class: 'DicePool' }) | DiceTerm.Data) & {
  evaluated: boolean;
}

export interface RollData {
  formula: string;
  terms: Array<TermData>;
  total: number | null;
  evaluated: boolean;
  options: Roll['options'],
}

export interface DamageRollOptions extends Partial<RollTerm.EvaluationOptions> {
  criticalBonusDice?: number;
  criticalMultiplier?: number;
  multiplyNumeric?: boolean;
  powerfulCritical?: boolean;
  criticalBonusDamage?: string;
  critical?: boolean
}

export class UtilsRoll {

  /**
   * @param value valid synax: "fire" or "fire:comment"
   * @returns the damage type or null if no match was found
   */
  public static toDamageType(value: any): DamageType | null {
    if (typeof value !== 'string') {
      return null;
    }
    value = value.toLowerCase();
    const index = value.indexOf(':');
    if (index !== -1) {
      value = value.substring(0, index);
    }
    if (validDamageTypes.includes(value)) {
      return value;
    }
    return null;
  }

  public static getValidDamageTypes(): DamageType[] {
    return [...validDamageTypes];
  }

  public static fromRollData(rollData: RollData): Roll {
    return Roll.fromData(rollData as any);
  }

  public static fromRollTermData(rollTermsData: TermData[]): Roll {
    return Roll.fromTerms(rollTermsData.map(termData => RollTerm.fromData(termData)));
  }

  public static toRollData(roll: Roll): RollData {
    return {
      formula: roll.formula,
      options: roll.options,
      terms: roll.terms.map(t => t.toJSON() as any),
      total: roll.total,
      evaluated: roll.total != null,
    }
  }

  private static damagePartsEndWithComment = /(.*)\[([^\]]*)\]$/;
  public static damagePartsToRoll(parts: MyItemData['data']['damage']['parts'], rollData?: any): Roll {
    return new Roll(parts.map(([formula, damageType]) => {
      if (damageType) {
        const match = UtilsRoll.damagePartsEndWithComment.exec(formula);
        if (match) {
          // Already ends with a comment, overwrite it
          return `${match[1]}[${damageType.toLowerCase()}:${match[2]}]`
        }
        return `${formula}[${damageType.toLowerCase()}]`
      } else {
        return formula;
      }
    }).join(' + '), rollData);
  }

  /**
   * Example formula and how it gets parsed (this is based on how I believe it will be user friendly)
   * 1d12 + 1d10[cold] + 1d8 + 1d6[fire: my comment] + 1d4 
   *  everything unlisted inherits from the right 
   *   => 1d12 & 1d10 = cold
   *   => 1d8  & 1d6  = fire
   *  Everything at the end which is unlisted inherits from the left
   *   => 1d4 = fire
   */
  public static rollToDamageResults(roll: Roll): Map<DamageType, number> {
    const damageFormulaMap = new Map<DamageType, Array<string | number>>();

    const terms = roll.terms;
    let latestDamageType: DamageType | null = null;
    damageFormulaMap.set(latestDamageType, []);
    for (let i = terms.length-1; i >= 0; i--) {
      const flavor = terms[i].options?.flavor?.toLowerCase();
      const damageType = UtilsRoll.toDamageType(flavor);
      if (damageType != null) {
        if (!damageFormulaMap.has(damageType)) {
          damageFormulaMap.set(damageType, []);
        }
        if (damageFormulaMap.has(null)) {
          damageFormulaMap.get(damageType).push(...damageFormulaMap.get(null));
          damageFormulaMap.delete(null);
        }
        latestDamageType = damageType;
      }
      if (typeof terms[i].total === 'number') {
        damageFormulaMap.get(latestDamageType).unshift(terms[i].total);
      } else if (typeof (terms[i] as any).operator === 'string') {
        const formula = damageFormulaMap.get(latestDamageType);
        formula[0] = `${(terms[i] as any).operator}${formula[0]}`;
      }
    }

    const damageMap = new Map<DamageType, number>();

    for (const [type, formula] of damageFormulaMap.entries()) {
      const total = Roll.safeEval(formula.join(' + '));
      if (total != 0) {
        damageMap.set(type, total);
      }
    }

    return damageMap;
  }

  /**
   * @param originalRoll The original roll where you wish to retain any existing roll results from
   * @param newFormula What the new roll formula should be
   * @returns the new result roll and any new terms which have been rolled if the original was already rolled
   */
  public static async setRoll(originalRoll: Roll, newFormula: string): Promise<{result: Roll, rollToDisplay: Roll | null}> {
    let originalTerms = originalRoll.terms;
    {
      const hasAnyOriginalEvaluated = originalTerms.find(term => (term as any)._evaluated) != null;
      if (!hasAnyOriginalEvaluated) {
        return {result: new Roll(newFormula), rollToDisplay: null};
      }
    }

    if (originalRoll.options == null) {
      originalRoll.options = {};
    }
    if (originalRoll.options[staticValues.moduleName] == null) {
      originalRoll.options[staticValues.moduleName] = {};
    }
    if (originalRoll.options[staticValues.moduleName].allRolledResults == null) {
      originalRoll.options[staticValues.moduleName].allRolledResults = {};
    }
    // TODO only allow 1 instance to run at a time
    //  Solve with an annotation
    //  Provide these options globally
    //  MutableDiceTerm should overwrite the default Die functions or whatever it needs to do to exist
    const mutableDiceOptions: ReusableDiceTerm.Options = {
      prerolledPool: originalRoll.options[staticValues.moduleName].allRolledResults,
      newRolls: {},
    };

    try {
      // Wrap dice to be mutable
      ReusableDiceTerm.pushOptions(mutableDiceOptions);
  
      const rollResult = await new Roll(newFormula).roll({async: true});

      let termsToDisplay: RollTerm[] = []
      for (const faceStr of Object.keys(mutableDiceOptions.newRolls) as `${number}`[]) {
        let activeResults = 0;
        for (const result of mutableDiceOptions.newRolls[faceStr]) {
          if (result.active) {
            activeResults++;
          }
        }
        termsToDisplay.push(new Die({
          faces: Number(faceStr),
          number: activeResults,
          results: mutableDiceOptions.newRolls[faceStr],
        }));
        termsToDisplay.push(new OperatorTerm({operator: '+'}));
      }
  
      if (termsToDisplay.length > 0) {
        termsToDisplay = termsToDisplay.splice(0, 1);
        termsToDisplay = (await UtilsRoll.rollUnrolledTerms(termsToDisplay, {async: true})).results;
      }

      if (rollResult.options == null) {
        rollResult.options = {};
      }
      if (rollResult.options[staticValues.moduleName] == null) {
        rollResult.options[staticValues.moduleName] = {};
      }
      const allRolledResults: ReusableDiceTerm.Options['prerolledPool'] = {};
      for (const term of rollResult.terms) {
        if (term instanceof DiceTerm) {
          const faces = String(term.faces);
          if (!allRolledResults[faces]) {
            allRolledResults[faces] = [];
          }
          for (const result of term.results) {
            allRolledResults[faces].push(result.result);
          }
        }
      }
      // Any prerolledPool not consumed by mutable dice should be re-added 
      for (const faces of Object.keys(mutableDiceOptions.prerolledPool) as `${number}`[]) {
        if (!allRolledResults[faces]) {
          allRolledResults[faces] = [];
        }
        for (const result of mutableDiceOptions.prerolledPool[faces]) {
          allRolledResults[faces].push(result);
        }
      }
      rollResult.options[staticValues.moduleName].allRolledResults = allRolledResults;
      return {
        result: rollResult,
        rollToDisplay: termsToDisplay.length > 0 ? Roll.fromTerms(termsToDisplay) : null,
      }
    } finally {
      ReusableDiceTerm.popOptions();
    }
  }

  public static createDamageRoll(roll: string | RollTerm[], options: DamageRollOptions = {}): Roll {
    const DamageRoll = CONFIG.Dice.rolls.find(a => a.name === 'DamageRoll') as typeof Roll;
    // Whats the point of having this damage roll? If someone else adds custom crit rules I still need to implement them.
    // You can use damageRoll, but that always rolls the dice which I can't use since it doesnt HAVE to be rolled
    options = {
      multiplyNumeric: game.settings.get("dnd5e", "criticalDamageModifiers") === true,
      powerfulCritical: game.settings.get("dnd5e", "criticalDamageMaxDice") === true,
      ...options
    }
    // TODO critical does not work for complexer rolls like sneak attack => (ceil(7 /2))d6
    let dmgRoll: Roll;
    if (Array.isArray(roll)) {
      dmgRoll = new DamageRoll('0', {}, options) as Roll & {configureDamage: () => void};
      dmgRoll.terms = roll;
      (dmgRoll as Roll & {configureDamage: () => void}).configureDamage();
    } else {
      dmgRoll = new DamageRoll(roll, {}, options);
    }
    return dmgRoll;
  }

  /**
   * TODO check if this can use the standard dnd5e module for potentially better integration
   */
  public static getAbilityRoll(actor: MyActor, {ability, skill, addSaveBonus}: {ability: keyof MyActorData['data']['abilities'], skill?: string, addSaveBonus?: boolean}): Roll {
    const actorAbility = actor.data.data.abilities[ability];
    const actorSkill = actor.data.data.skills[skill];
    const bonuses = getProperty(actor.data.data, 'bonuses.abilities') || {};

    let baseRoll = new Die();
    baseRoll.faces = 20;
    baseRoll.number = 1;
    if (actor.getFlag("dnd5e", "halflingLucky")) {
      // reroll a base roll 1 once
      baseRoll.modifiers.push('r1');
    }
    const parts: string[] = [
      baseRoll.formula
    ];

    // Compose roll parts and data
    const data: {[key: string]: any} = {};

    parts.push('@abilityMod');
    data.abilityMod = actorAbility.mod;

    if (addSaveBonus && actorAbility.prof !== 0) {
      parts.push('@abilitySaveProf');
      data.abilitySaveProf = actorAbility.prof;
      
      if ( bonuses.save ) {
        parts.push("@abilitySaveBonus");
        data.abilitySaveBonus = bonuses.save;
      }
    }
    
    // Ability test bonus
    if (bonuses.check) {
      data.abilityBonus = bonuses.check;
      parts.push("@abilityBonus");
    }

    if (skill) {
      // Reliable Talent applies to any skill check we have full or better proficiency in
      if (actorSkill.value >= 1 && actor.getFlag("dnd5e", "reliableTalent")) {
        // minimum base roll is 10
        baseRoll.modifiers.push('min10');
      }
      parts.push('@skillProf');
      data.skillProf = actorSkill.prof;
      
      // Skill check bonus
      if (bonuses.skill) {
        data["skillBonus"] = bonuses.skill;
        parts.push("@skillBonus");
      }
    }

    return new Roll(parts.join(' + '), data);
  }

  /**
   * roll1:  1d10 + 1d10 + 1d6
   * roll2:  1d10 + 1d10 + 1d8
   * result: 4d10 + 1d6 + 1d8
   */
  public static mergeRolls(...rolls: Roll[]): Roll {
    // return null when merge is not supported
    const getMergeKey = (context: RollTerm[], term: RollTerm): string | null => {
      let optionsParts: string[] = [];
      if (term.options) {
        for (const key of Object.keys(term.options)) {
          if (term.options[key] != null) {
            optionsParts.push(`${key}:${term.options[key]}`);
          }
        }
      }
      const index = context.indexOf(term);
      let operator = '+';
      if (index > 0 && context[index - 1] instanceof OperatorTerm) {
        operator = (context[index - 1] as OperatorTerm).operator;
      }
      optionsParts = optionsParts.sort();
      if (term instanceof DiceTerm) {
        return `${operator}/${term.constructor.name}/${term.faces}/${term.modifiers.join('-')}/${optionsParts.join('-')}`;
      } else if (term.constructor === NumericTerm.prototype.constructor) {
        return `${operator}/${term.constructor.name}/${optionsParts.join('-')}`;
      }
      return null;
    }

    return Roll.fromTerms(UtilsRoll.mergeTerms(rolls.map(r => r.terms), getMergeKey));
  }

  private static mergeTerms(termsCollection: Array<RollTerm[]>, getMergeKey: (context: RollTerm[], term: RollTerm) => string | null): RollTerm[] {
    if (termsCollection.length === 0) {
      return [];
    }
    if (termsCollection.length === 1) {
      return termsCollection[0].map(term => RollTerm.fromData(deepClone(term.toJSON())));
    }
    const baseTerms: RollTerm[] = termsCollection[0].map(t => RollTerm.fromJSON(JSON.stringify(t.toJSON())));
    const additionalTermsByMergeKey = new Map<string, {merged: boolean, terms: RollTerm[]}>()

    for (let i = 1; i < termsCollection.length; i++) {
      for (const term of termsCollection[i]) {
        const mergeKey = getMergeKey(termsCollection[i], term);
        if (!additionalTermsByMergeKey.has(mergeKey)) {
          additionalTermsByMergeKey.set(mergeKey, {
            merged: false,
            terms: []
          });
        }
        additionalTermsByMergeKey.get(mergeKey).terms.push(term);
      }
    }

    for (const baseTerm of baseTerms) {
      const mergeKey = getMergeKey(baseTerms, baseTerm);
      if (mergeKey != null && additionalTermsByMergeKey.get(mergeKey)?.merged === false) {
        const added = additionalTermsByMergeKey.get(mergeKey);
        added.merged = true;

        for (const addedTerm of added.terms) {
          if (baseTerm instanceof DiceTerm) {
            baseTerm.number += (addedTerm as DiceTerm).number;
            baseTerm.results.push(...(addedTerm as DiceTerm).results);
          } else if (baseTerm instanceof NumericTerm) {
            baseTerm.number += (addedTerm as NumericTerm).number;
          }
        }
      }
    }

    for (const added of additionalTermsByMergeKey.values()) {
      if (!added.merged) {
        if (added.terms.length > 0 && !(added.terms[0] instanceof OperatorTerm)) {
          const operator = new OperatorTerm({operator: '+'});
          if ((added.terms[0] as any)._evaluated) {
            operator.evaluate({async: false});
          }
          baseTerms.push(operator);
        }
        baseTerms.push(...Roll.simplifyTerms([...added.terms]));
      }
    }

    while (baseTerms[baseTerms.length - 1] instanceof OperatorTerm) {
      baseTerms.pop();
    }

    return baseTerms.map(t => RollTerm.fromData(deepClone(t.toJSON())));
  }

  public static rollUnrolledTerms(terms: RollTerm[], options?: Partial<RollTerm.EvaluationOptions> & {async: false}): {results: RollTerm[], newRolls?: RollTerm[]}
  public static rollUnrolledTerms(terms: RollTerm[], options?: Partial<RollTerm.EvaluationOptions> & {async: true}): Promise<{results: RollTerm[], newRolls?: RollTerm[]}>
  public static rollUnrolledTerms(terms: RollTerm[], options?: Partial<RollTerm.EvaluationOptions>): {results: RollTerm[], newRolls?: RollTerm[]} | Promise<{results: RollTerm[], newRolls?: RollTerm[]}> {
    const termResults$: Array<RollTerm | Promise<RollTerm>> = [];
    const newRolledTerms$: Array<RollTerm | Promise<RollTerm>> = [];

    // TODO allow dice terms to increase their nr of dice (for simplifying crits)
    for (let i = 0; i < terms.length; i++) {
      if (!(terms[i] as any)._evaluated) {
        // TODO evaluate the terms using the Roll class
        //  If an other module sends the rolls to an external service, you don't want it to send each individual term
        //  or cause a bug and it wont be send at all
        //  These modules will most likely hook into the Roll class
        const result = terms[i].evaluate(options);
        newRolledTerms$.push(result);
        termResults$.push(result);
      } else {
        termResults$.push(terms[i]);
      }
    }

    if (options.async === false) {
      if (newRolledTerms$.length > 0) {
        return {results: termResults$ as RollTerm[], newRolls: newRolledTerms$ as RollTerm[]};
      } else {
        return {results: termResults$ as RollTerm[]};
      }
    }

    return Promise.all([
      Promise.all(termResults$),
      Promise.all(newRolledTerms$),
    ]).then(([termResults, newRolledTerms]) => {
      if (newRolledTerms.length > 0) {
        return {results: termResults, newRolls: newRolledTerms};
      } else {
        return {results: termResults};
      }
    });
  }

  public static simplifyTerms(roll: RollTerm[]): RollTerm[]
  public static simplifyTerms(roll: Roll): Roll
  public static simplifyTerms(roll: RollTerm[] | Roll): RollTerm[] | Roll {
    let terms: (RollTerm & {operator?: string})[] = [];
    const inputTerms = (roll instanceof Roll ? roll.terms : roll) as (RollTerm & {operator?: string})[]
    for (const term of inputTerms) {
      if (terms.length > 0) {
        if (term.operator === '+') {
          if (terms[terms.length-1].operator) {
            // An operator with an additional '+' does nothing => visual clutter
            continue;
          }
        } else if (term.operator === '-') {
          if (terms[terms.length-1].operator === '+') {
            // invert +
            terms[terms.length-1] = term;
            continue;
          } else if (terms[terms.length-1].operator === '-') {
            // invert -
            terms[terms.length-1] = new OperatorTerm({operator: '+', options: term.options});
            continue;
          }
        }
      }
      terms.push(term);
    }

    // Remove suffixed operators
    for (let i = terms.length - 1; i >= 0; i--) {
      if (terms[i].operator != null) {
        terms.splice(i, 1);
      } else {
        break;
      }
    }

    if (roll instanceof Roll) {
      return Roll.fromTerms(terms);
    }
    return terms;
  }

}