import { DamageType, MyItemData } from "../types/fixed-types";

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

}