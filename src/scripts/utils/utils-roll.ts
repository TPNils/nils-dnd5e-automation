import { DamageType, MyItemData } from "../types/fixed-types";
import { UtilsDiceSoNice } from "./utils-dice-so-nice";

const validDamageTypes: DamageType[] = ['' /* none */, 'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder', 'healing', 'temphp'];

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

  public static damagePartsToRoll(parts: MyItemData['data']['damage']['parts'], rollData?: any): Roll {
    // TODO can be improved when the first formula is a negative number, don't need to join with a +
    return UtilsRoll.damageFormulaToRoll(parts.map(([formula, damageType]) => {
      if (damageType) {
        return `${formula}[${damageType.toLowerCase()}]`
      } else {
        return formula;
      }
    }).join(' + '), rollData);
  }

  public static damageFormulaToRoll(damageFormula: string, rollData?: any): Roll {
    return new Roll(damageFormula, rollData);
  }

  public static damageFormulaToDamageParts(formula: string): MyItemData['data']['damage']['parts'] {
    return UtilsRoll.rollToDamageParts(new Roll(formula));
  }

  public static rollToDamageParts(roll: Roll): MyItemData['data']['damage']['parts'] {
    const parts: MyItemData['data']['damage']['parts'] = [];

    const terms = roll.terms;
    let formulaBuilder: string[] = [];
    let latestDamageType: DamageType = '';
    const convertToParts = () => {
      if (formulaBuilder.length > 0 && formulaBuilder[0].trim() === '+') {
        formulaBuilder = formulaBuilder.splice(1)
      }
      if (formulaBuilder.length > 0) {
        parts.unshift([formulaBuilder.join('').trim(), latestDamageType]);
        formulaBuilder = [];
      }
    }
    for (let i = terms.length-1; i >= 0; i--) {
      const flavor = terms[i].options?.flavor?.toLowerCase();
      if (UtilsRoll.isValidDamageType(flavor)) {
        convertToParts();
        latestDamageType = flavor;
      }
      formulaBuilder.unshift(terms[i].expression);
    }
    convertToParts();

    return parts;
  }

  public static rollToDamageResults(roll: Roll): Map<DamageType, number> {
    const damageFormulaMap = new Map<DamageType, Array<string | number>>();

    const terms = roll.terms;
    let latestDamageType: DamageType = '';
    for (let i = terms.length-1; i >= 0; i--) {
      const flavor = terms[i].options?.flavor?.toLowerCase();
      if (UtilsRoll.isValidDamageType(flavor)) {
        latestDamageType = flavor;
      }
      if (!damageFormulaMap.has(latestDamageType)) {
        damageFormulaMap.set(latestDamageType, []);
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

  public static async setRollMode(roll: Roll, mode: 'disadvantage' |'normal' | 'advantage', options: {skipDiceSoNice?: boolean} = {}): Promise<Roll> {
    const terms = deepClone(roll.terms);
    const d20Term = terms[0] as (Die & {_evaluated: boolean, _evaluateModifiers: () => void});
    if (d20Term.faces !== 20) {
      throw new Error(`The first roll term needs to be a d20. Roll formula: ${roll.formula}`)
    }

    // Modify the term definition
    d20Term.number = Math.max(d20Term.number, mode === 'normal' ? 1 : 2);
    if (mode === 'advantage') {
      d20Term.modifiers = d20Term.modifiers ? [...d20Term.modifiers.filter(mod => mod !== 'kl' && mod !== 'kh'), 'kh'] : ['kh'];
    } else if (mode === 'disadvantage') {
      d20Term.modifiers = d20Term.modifiers ? [...d20Term.modifiers.filter(mod => mod !== 'kl' && mod !== 'kh'), 'kl'] : ['kl'];
    } else {
      d20Term.modifiers = d20Term.modifiers ? [...d20Term.modifiers.filter(mod => mod !== 'kl' && mod !== 'kh')] : [];
    }

    // If the term was already rolled, add potential new rolls and/or calculate new result
    if (d20Term._evaluated) {
      if (d20Term.number > d20Term.results.length) {
        const missingDice = d20Term.number - d20Term.results.length;
        const d20s = await new Roll(`${missingDice}d20`).roll({async: true});
        if (!options.skipDiceSoNice) {
          UtilsDiceSoNice.showRoll({roll: d20s});
        }
        const rolledTerm: typeof d20Term = (d20s.terms[0] as any);
        for (const result of rolledTerm.results) {
          d20Term.results.push(result);
        }
      }

      // Reset the results
      d20Term.results = d20Term.results.map(r => { return {result: r.result, active: true} });
      // Evaluate the results
      d20Term._evaluateModifiers();

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

}