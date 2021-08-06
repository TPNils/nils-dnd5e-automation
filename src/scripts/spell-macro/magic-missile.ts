import { IMacro } from "../macro";
import { MacroContext } from "../macro-context";
import { staticValues } from "../static-values";
import { MyItem } from "../types/fixed-types";
import { UtilsDocument } from "../utils/utils-document";
import { TargetRequest, TargetResponse, UserInputResponse, UtilsInput } from "../utils/utils-input";

interface MagicMissileData {
  targets: UserInputResponse<TargetResponse>;
}

export class MagicMissile implements IMacro<MagicMissileData> {

  public async macroData(context: MacroContext): Promise<any> {
    if (!context.tokenUuid) {
      throw new Error('Select a token first');
    }
    
    const item = await this.getItem(context);

    const targetRequest: TargetRequest = {
      nrOfTargets: item.data.data.target.value || 1,
      allowSameTarget: true,
      scaling: {
        type: 'linear-spell',
        startLevel: 1,
        maxLevel: 9
      },
      allPossibleTargets: game.scenes.get(game.user.viewedScene).getEmbeddedCollection('Token').map(token => {
        return {
          uuid: (token as any).uuid,
          type: 'within-range'
        }
      }),
    };

    // TODO what if you have a cantrip magic missile. Should I respect the custom scaling of the item?
    
    // Override default min level based on a possible homebrew magic missile
    if (context.itemUuid) {
      const item = await UtilsDocument.itemFromUuid(context.itemUuid);
      if (item.type === 'spell') {
        targetRequest.scaling.startLevel = item.data.data.level;
      }
    }

    // Set max level
    if (context.actorUuid) {
      const actor = await UtilsDocument.actorFromUuid(context.actorUuid);
      const spellsObj = actor.data.data.spells;
      const availableSpellLevels: number[] = [];
      if (spellsObj.pact.value > 0) {
        availableSpellLevels.push(spellsObj.pact.level);
      }
      for (const spellKey in spellsObj) {
        if (spellKey.startsWith('spell') && Object.prototype.hasOwnProperty.call(spellsObj, spellKey)) {
          if (spellsObj[spellKey].value > 0) {
            availableSpellLevels.push(Number(spellKey.substr(5)))
          }
        }
      }

      targetRequest.scaling.startLevel = Math.max(targetRequest.scaling.startLevel, Math.min(...availableSpellLevels));
      targetRequest.scaling.maxLevel = Math.min(targetRequest.scaling.maxLevel, Math.max(...availableSpellLevels));
    }

    return {
      targets: await UtilsInput.targets(context, targetRequest)
    };
  }
  
  public async run(context: MacroContext, data: MagicMissileData): Promise<void> {
    console.log(context, data);
    if (data.targets.cancelled === true) {
      return;
    }
    // Default magic missile item
    const item = await this.getItem(context);

    let damageParts = item.data.data.damage.parts;

    // Spell scaling could be different than the damage formula
    const baseDamageFormula = damageParts.map(part => `(${part[0]})[${part[1]}]`).join(' + ');
    const perTargetDamageFormula = new Map<string, string[]>();
    for (const targetUuid of data.targets.data.tokenUuids) {
      if (!perTargetDamageFormula.has(targetUuid)) {
        perTargetDamageFormula.set(targetUuid, []);
      }
      perTargetDamageFormula.get(targetUuid).push(baseDamageFormula);
    }
    // TODO item data
    const damageResults = await Promise.all(data.targets.data.tokenUuids.map(() => new Roll(baseDamageFormula).roll({async: true})));
    

  }

  private getItem(context: MacroContext): Promise<MyItem> {
    return UtilsDocument.itemFromUuid(context.itemUuid || `Compendium.${staticValues.moduleName}.automated-spells.CL8MxStmYoSl5J54`)
  }

}