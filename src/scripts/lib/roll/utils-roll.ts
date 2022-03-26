import { ReEvaluatableDie } from "./re-evaluatable-die";
import { DamageType, MyActor, MyActorData, MyItemData } from "../../types/fixed-types";
import { UtilsDiceSoNice } from "./utils-dice-so-nice";
import { MutableDiceTerm } from "./mutable-dice-term";

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

  public static isValidDamageType(value: any): value is DamageType {
    if (typeof value === 'string') {
      value = value.toLowerCase();
    }
    return validDamageTypes.includes(value);
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

  public static damagePartsToRoll(parts: MyItemData['data']['damage']['parts'], rollData?: any): Roll {
    return new Roll(parts.map(([formula, damageType]) => {
      if (damageType) {
        return `${formula}[${damageType.toLowerCase()}]`
      } else {
        return formula;
      }
    }).join(' + '), rollData);
  }

  /**
   * Example formula and how it gets parsed (this is based on how I believe it will be user friendly)
   * 1d12 + 1d10[cold] + 1d8 + 1d6[fire] + 1d4 
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
      if (UtilsRoll.isValidDamageType(flavor)) {
        if (!damageFormulaMap.has(flavor)) {
          damageFormulaMap.set(flavor, []);
        }
        if (damageFormulaMap.has(null)) {
          damageFormulaMap.get(flavor).push(...damageFormulaMap.get(null));
          damageFormulaMap.delete(null);
        }
        latestDamageType = flavor;
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
   * @param original The original roll where you wish to retain any existing roll results from
   * @param newFormula What the new roll formula should be
   * @returns the new result roll and any new terms which have been rolled if the original was already rolled
   */
  public static async setRoll(original: Roll, newFormula: string): Promise<{result: Roll, rollToDisplay: Roll | null}>
  public static async setRoll(original: RollTerm[], newFormula: string): Promise<{result: RollTerm[], rollToDisplay: Roll | null}>
  public static async setRoll(original: RollTerm[] | Roll, newFormula: string): Promise<{result: RollTerm[] | Roll, rollToDisplay: Roll | null}> {
    const originalWasRoll = original instanceof Roll;
    original = original = (original instanceof Roll ? original.terms : original);

    {
      const hasAnyOriginalEvaluated = original.find(term => (term as any)._evaluated) != null;
      if (!hasAnyOriginalEvaluated) {
        const newRoll = new Roll(newFormula);
        if (originalWasRoll) {
          return {result: newRoll, rollToDisplay: null};
        }
        return {result: newRoll.terms, rollToDisplay: null};
      }
    }

    original = original.map(t => {
      if (t instanceof Die) {
        return MutableDiceTerm.fromDie(t);
      }
      return t;
    });
    const newTerms = new Roll(newFormula).terms.map(t => {
      if (t instanceof Die) {
        return MutableDiceTerm.fromDie(t);
      }
      return t;
    });

    const originalResultsFromByDieFaces = new Map<number, MutableDiceTerm[]>();
    for (const term of original) {
      if (term instanceof MutableDiceTerm) {
        if (!originalResultsFromByDieFaces.has(term.faces)) {
          originalResultsFromByDieFaces.set(term.faces, []);
        }
        originalResultsFromByDieFaces.get(term.faces).push(term);
      }
    }

    for (const term of newTerms) {
      if (term instanceof MutableDiceTerm) {
        if (originalResultsFromByDieFaces.get(term.faces)?.length) {
          const originalTerm = originalResultsFromByDieFaces.get(term.faces).splice(0, 1)[0];
          term.results = [...originalTerm.results];
        }
      }
    }

    for (let term of Array.from(originalResultsFromByDieFaces.values()).deepFlatten()) {
      if (newTerms.length > 0) {
        newTerms.push(new OperatorTerm({operator: '+'}));
      }
      term = MutableDiceTerm.fromData(deepClone(term.toJSON())) as MutableDiceTerm;
      term.number = 0;
      newTerms.push(term);
    }

    const pendingTermRolls: Promise<RollTerm>[] = [];
    for (const term of newTerms) {
      // @ts-expect-error
      if (!term._evaluated) {
        pendingTermRolls.push(term.evaluate({async: true}));
      }
    }

    let termsToDisplay: RollTerm[] = [];
    for (const term of await Promise.all(pendingTermRolls)) {
      if (termsToDisplay.length > 0) {
        termsToDisplay.push(await new OperatorTerm({operator: '+'}).evaluate({async: true}));
      }
      if (term instanceof MutableDiceTerm) {
        if (term.newRollsSinceEvaluate.length > 0) {
          termsToDisplay.push(new Die({
            number: term.newRollsSinceEvaluate.length,
            faces: term.faces,
            results: term.newRollsSinceEvaluate,
          }))
          term.newRollsSinceEvaluate = [];
        }
      } else if (term instanceof DiceTerm) {
        termsToDisplay.push(term);
      }
    }

    termsToDisplay = UtilsRoll.simplifyTerms(termsToDisplay);
    termsToDisplay = (await UtilsRoll.rollUnrolledTerms(termsToDisplay, {async: true})).results;

    return {
      result: originalWasRoll ? Roll.fromTerms(newTerms) : newTerms,
      rollToDisplay: termsToDisplay.length > 0 ? Roll.fromTerms(termsToDisplay) : null,
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
   * TODO remove
   * @deprecated
   */
  public static async setRollMode(roll: Roll, mode: 'disadvantage' |'normal' | 'advantage', options: {skipDiceSoNice?: boolean} = {}): Promise<Roll> {
    const terms = roll.terms.map(t => RollTerm.fromJSON(JSON.stringify(t.toJSON())))
    const d20Term = terms[0] as (Die & {_evaluated: boolean, _evaluateModifiers: () => void});
    if (d20Term.faces !== 20) {
      throw new Error(`The first roll term needs to be a d20. Roll formula: ${roll.formula}`)
    }

    // Modify the term definition
    const oldNumber = d20Term.number;
    const originalResultLength = d20Term.results.length;
    const excludeModifiers: Array<keyof Die.Modifiers> = ['d', 'dh', 'dl', 'k', 'kh', 'kl'];
    d20Term.modifiers = d20Term.modifiers ? d20Term.modifiers.filter((mod: keyof Die.Modifiers) => !excludeModifiers.includes(mod)) : [];
    d20Term.number = Math.max(d20Term.number, mode === 'normal' ? 1 : 2);
    if (mode === 'advantage') {
      d20Term.modifiers.push('kh');
    } else if (mode === 'disadvantage') {
      d20Term.modifiers.push('kl');
    }

    // If the term was already rolled, add potential new rolls and/or calculate new result
    if (d20Term._evaluated) {
      if (d20Term.number > oldNumber) {
        const missingDice = d20Term.number - oldNumber;
        const d20s = await new Roll(`${missingDice}d20`).roll({async: true});
        const rolledTerm: typeof d20Term = (d20s.terms[0] as any);
        for (const result of rolledTerm.results) {
          d20Term.results.push(result);
        }
      }

      // Reset the results
      for (const result of d20Term.results) {
        if (result.discarded) {
          result.active = true;
          delete result.discarded;
        }
      }
      // Evaluate the results
      ReEvaluatableDie.wrap(d20Term);
      d20Term._evaluateModifiers();
      ReEvaluatableDie.unwrap(d20Term);

      // If new rolled happend (adv, rerolls, exploding, etc...) display them
      if (!options.skipDiceSoNice && originalResultLength < d20Term.results.length) {
        const newResults: RollTerm[] = [];
        for (let i = originalResultLength; i < d20Term.results.length; i++) {
          const result = new Die({faces: 20, number: 1}) as typeof d20Term;
          result._evaluated = true;
          result.results.push({
            result: d20Term.results[i].result,
            active: true,
          });
          if (newResults.length > 0) {
            const term = new OperatorTerm({operator: '+'});
            term.evaluate({async: false});
            newResults.push(term);
          }
          newResults.push(result);
        }
        if (newResults.length > 0) {
          UtilsDiceSoNice.showRoll({roll: Roll.fromTerms(newResults)});
        }
      }

      // Drop extra rolls. Example, when advantage is rolled and you revert back to normal, discard the most right rolls
      let activeDice = 0;
      for (const result of d20Term.results) {
        if (result.active) {
          activeDice++;
          if (1 < activeDice) {
            result.discarded = true;
            result.active = false;
          }
        }
      }
    }

    return Roll.fromTerms(terms);
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
   * TODO Should use the standard dnd5e module for custom crit rules
   */
  public static getCriticalBonusRoll(normal: RollTerm[]): RollTerm[] {
    const critTerms: RollTerm[] = [];
    // new Roll(formula) will ensure we create a new instance
    for (const normalTerm of normal) {
      if (normalTerm instanceof NumericTerm) {
        // Do not add numeric terms to the crit bonus
        // also remove operators related to that numeric term
        while (critTerms.length > 0 && critTerms[critTerms.length - 1] instanceof OperatorTerm) {
          critTerms.pop();
        }
        continue;
      } 
      
      critTerms.push(...new Roll(normalTerm.formula).terms);
    }

    return critTerms;
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

  /**
   * normal: 1d10 + 1d10 + 1d6
   * crit:   1d10 + 1d10 + 1d8
   * result: 2d20 + 2d10 + 1d6 + 1d8
   * TODO remove, should be replace with setRollMode
   * @deprecated
   */
  public static mergeCritRoll(normalTerms: RollTerm[], critTerms: RollTerm[]): RollTerm[] {
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
      let termTypeNr = 0;
      for (const contextTerm of context) {
        if (contextTerm === term) {
          break;
        } else if (contextTerm.constructor.name === term.constructor.name) {
          termTypeNr++;
        }
      }
      optionsParts = optionsParts.sort();
      if (term instanceof DiceTerm) {
        return `${termTypeNr}/${operator}/${term.constructor.name}/${term.faces}/${term.modifiers.join('-')}/${optionsParts.join('-')}`;
      } else if (term.constructor === NumericTerm.prototype.constructor) {
        return `${termTypeNr}/${operator}/${term.constructor.name}/${optionsParts.join('-')}`;
      }
      return null;
    }

    return UtilsRoll.mergeTerms([normalTerms, critTerms], getMergeKey);
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
        const operator = new OperatorTerm({operator: '+'});
        if ((added.terms[0] as any)._evaluated) {
          operator.evaluate({async: false});
        }
        baseTerms.push(...Roll.simplifyTerms([operator, ...added.terms]));
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