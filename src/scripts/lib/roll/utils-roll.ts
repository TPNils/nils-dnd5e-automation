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
  
  public static versatilePartsToRoll(parts: MyItemData['data']['damage']['parts'], versatile: string, rollData?: any): Roll | null {
    if (versatile == null) {
      return null;
    }
    return new Roll(parts.map(([formula, damageType], index) => {
      if (index === 0) {
        formula = versatile;
      }
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

  public static getNewRolledTerms(originalRoll: Roll | RollData | null, newRoll: Roll | RollData): Roll | null {
    const inputNewRoll = newRoll;
    if (originalRoll instanceof Roll) {
      originalRoll = UtilsRoll.toRollData(originalRoll);
    }
    if (newRoll instanceof Roll) {
      newRoll = UtilsRoll.toRollData(newRoll);
    }

    {
      const hasAnyEvaluated = newRoll.terms.some(term => term.evaluated);
      if (!hasAnyEvaluated) {
        return null; // new is not evaluated => no rolls => nothing to show
      }
    }
    {
      const hasAnyEvaluated = originalRoll == null ? false : (originalRoll?.terms?.some(term => term.evaluated));
      if (!hasAnyEvaluated) {
        return inputNewRoll instanceof Roll ? inputNewRoll : UtilsRoll.fromRollData(inputNewRoll); // new is evaluated, old is not => everything is new
      }
    }
    
    const newDisplayedRollesByFace = new Map<number, number[]>();
    const oldDisplayedRollesByFace = new Map<number, number[]>();
    for (const term of newRoll.terms) {
      if ((term as DiceTerm.Data).faces == null) {
        continue;
      }

      const face = (term as DiceTerm.Data).faces;
      if (!newDisplayedRollesByFace.has(face)) {
        newDisplayedRollesByFace.set(face, []);
      }
      for (const result of term.results) {
        newDisplayedRollesByFace.get(face).push(result.result);
      }
    }
    for (const face of newDisplayedRollesByFace.keys()) {
      oldDisplayedRollesByFace.set(face, []);
    }
    
    if (originalRoll) {
      for (const term of originalRoll.terms) {
        if ((term as DiceTerm.Data).faces == null) {
          continue;
        }

        const face = (term as DiceTerm.Data).faces;
        if (!oldDisplayedRollesByFace.has(face)) {
          oldDisplayedRollesByFace.set(face, []);
        }
        for (const result of term.results) {
          oldDisplayedRollesByFace.get(face).push(result.result);
        }
      }
    }

    const newRollsByFace = new Map<number, number[]>();
    for (const [face, newRolls] of newDisplayedRollesByFace.entries()) {
      const oldRolls = oldDisplayedRollesByFace.get(face);
      for (const result of newRolls) {
        const oldIndex = oldRolls.indexOf(result);
        if (oldIndex === -1) {
          if (!newRollsByFace.has(face)) {
            newRollsByFace.set(face, []);
          }
          newRollsByFace.get(face).push(result);
        } else {
          oldRolls.splice(oldIndex, 1);
        }
      }
    }

    if (newRollsByFace.size === 0) {
      return null;
    }

    const newRollTerms: RollTerm[] = [];
    for (const [face, results] of newRollsByFace.entries()) {
      newRollTerms.push(new Die({
        faces: face,
        number: results.length,
        results: results.map(r => ({result: r, active: true}))
      }))
      
      const plus = new OperatorTerm({operator: '+'});
      // @ts-ignore
      plus._evaluated = true;
      newRollTerms.push(plus);
    }
    newRollTerms.pop(); // Remove the trailing '+'
    
    return Roll.fromTerms(newRollTerms);
  }

  /**
   * @param originalRoll The original roll where you wish to retain any existing roll results from
   * @param newRollOrFormula What the new roll should be, either a formula or a factory wich returns a new roll
   * @returns The new modified roll
   */
  public static async modifyRoll(originalRoll: Roll, newRollOrFormula: string | Roll | (() => Roll | Promise<Roll>)): Promise<{result: Roll, rollToDisplay: Roll | null}> {
    {
      const hasAnyOriginalEvaluated = originalRoll == null ? false : originalRoll.terms?.find(term => (term as any)._evaluated) != null;
      if (!hasAnyOriginalEvaluated) {
        return {result: await UtilsRoll.parseRollRequest(newRollOrFormula), rollToDisplay: null};
      }
    }
    const mutableDiceOptions: ReusableDiceTerm.Options = {
      prerolledPool: {},
      newRolls: {},
    };

    for (const term of originalRoll.terms) {
      if (term instanceof DiceTerm) {
        const faces = String(term.faces) as `${number}`;
        if (!mutableDiceOptions.prerolledPool[faces]) {
          mutableDiceOptions.prerolledPool[faces] = [];
        }
        for (const result of term.results) {
          mutableDiceOptions.prerolledPool[faces].push(result.result);
        }
      }
    }

    try {
      // Wrap dice to be mutable
      ReusableDiceTerm.pushOptions(mutableDiceOptions);
  
      let rollResult = await UtilsRoll.parseRollRequest(newRollOrFormula, true);

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
      const unusedTerms: RollTerm[] = [];
      for (const faces of Object.keys(mutableDiceOptions.prerolledPool) as `${number}`[]) {
        if (mutableDiceOptions.prerolledPool[faces].length === 0) {
          continue;
        }
        unusedTerms.push(new Die({
          faces: Number(faces),
          number: 0,
          results: mutableDiceOptions.prerolledPool[faces].map(r => ({result: r, active: false, discarded: true}))
        }))
      }

      if (unusedTerms.length > 0) {
        const terms = [...rollResult.terms];
        if (terms.length > 0) {
          terms.push(new OperatorTerm({operator: '+'}));
        }
        for (const unusedTerm of unusedTerms) {
          terms.push(unusedTerm);
          terms.push(new OperatorTerm({operator: '+'}));
        }
        terms.pop(); // Remove the trailing '+'
        rollResult = Roll.fromTerms((await UtilsRoll.rollUnrolledTerms(terms, {async: true})).results);
      }
      return {
        result: rollResult,
        rollToDisplay: termsToDisplay.length > 0 ? Roll.fromTerms(termsToDisplay) : null,
      }
    } finally {
      ReusableDiceTerm.popOptions();
    }
  }

  private static parseRollRequest(newRollOrFormula: string | Roll | (() => Roll | Promise<Roll>), ensureEvaluated = false): Promise<Roll> {
    let roll: Promise<Roll>;
    if (typeof newRollOrFormula === 'string') {
      roll = Promise.resolve(new Roll(newRollOrFormula));
    } else if (newRollOrFormula instanceof Roll) {
      roll = Promise.resolve(newRollOrFormula);
    } else {
      let result = newRollOrFormula();
      if (!(result instanceof Promise)) {
        result = Promise.resolve(result);
      }
      roll = result;
    }

    if (ensureEvaluated) {
      roll = roll.then(r => {
        if (!r.total) {
          return r.evaluate({async: true});
        }
        return r;
      })
    }
    return roll;
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

    return Roll.fromTerms(UtilsRoll.simplifyTerms(UtilsRoll.mergeTerms(rolls.map(r => r.terms), getMergeKey)));
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
        // Roll.simplifyTerms only works for evaluated terms
        const isEvaluated = added.terms.some(t => (t.toJSON() as TermData).evaluated);
        if (isEvaluated) {
          baseTerms.push(...Roll.simplifyTerms([...added.terms]));
        } else {
          baseTerms.push(...added.terms);
        }
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