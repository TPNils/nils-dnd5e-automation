import { ReEvaluatableDie } from "../roll/re-evaluatable-die";
import { DamageType, MyActor, MyActorData, MyItemData } from "../types/fixed-types";
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

}