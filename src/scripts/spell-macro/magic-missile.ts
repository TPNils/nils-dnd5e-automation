import { IMacro } from "../macro";
import { MacroContext } from "../macro-context";
import { staticValues } from "../static-values";
import { MyItem } from "../types/fixed-types";
import { UtilsChatMessage } from "../utils/utils-chat-message";
import { UtilsDocument } from "../utils/utils-document";
import { TargetRequest, TargetResponse, UserInputResponse, UtilsInput } from "../utils/utils-input";
import { TemplateDetails, UtilsTemplate } from "../utils/utils-template";

interface MagicMissileData {
  targets: UserInputResponse<TargetResponse>;
}

export class MagicMissile implements IMacro<MagicMissileData> {

  public async macroData(context: MacroContext): Promise<any> {
    if (!context.tokenUuid) {
      throw new Error('Select a token first');
    }
    
    const item = await this.getItem(context);

    const token = await UtilsDocument.tokenFromUuid(context.tokenUuid);
    const scene = token.parent;
    const rangeShape: TemplateDetails = {
      x: token.data.x,
      y: token.data.y,
      shape: new PIXI.Circle(0, 0, UtilsTemplate.getFeet(item.data.data.range) * scene.data.grid / scene.data.gridDistance)
    }
    const targetRequest: TargetRequest = {
      nrOfTargets: item.data.data.target.value || 1,
      allowSameTarget: true,
      scaling: {
        type: 'linear-spell',
        startLevel: 1,
        maxLevel: 9
      },
      allPossibleTargets: scene.getEmbeddedCollection('Token').map(token => {
        return {
          uuid: (token as any).uuid,
          type: UtilsTemplate.isTokenInside(rangeShape, (token as TokenDocument), true) ? 'within-range' : 'outside-range'
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
      targets: await UtilsInput.targets(context.targetTokenUuids, targetRequest)
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
    
    const actor = context.actorUuid == null ? null : (await UtilsDocument.actorFromUuid(context.actorUuid));
    const itemCardData = await UtilsChatMessage.createDefaultItemData({
      actor: actor,
      item: item,
    });
    UtilsChatMessage.setTargets(itemCardData, data.targets.data.tokenUuids);
    UtilsChatMessage.createCard({
      actor: context.actorUuid == null ? null : {uuid: context.actorUuid},
      token: context.tokenUuid == null ? null : {uuid: context.tokenUuid},
      items: [itemCardData],
    });
  }

  private getItem(context: MacroContext): Promise<MyItem> {
    return UtilsDocument.itemFromUuid(context.itemUuid || `Compendium.${staticValues.moduleName}.automated-spells.CL8MxStmYoSl5J54`)
  }

}