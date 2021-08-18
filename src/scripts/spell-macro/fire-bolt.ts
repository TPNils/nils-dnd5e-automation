import { IMacro } from "../macro";
import { MacroContext } from "../macro-context";
import { staticValues } from "../static-values";
import { MyItem } from "../types/fixed-types";
import { UtilsChatMessage } from "../utils/utils-chat-message";
import { UtilsDocument } from "../utils/utils-document";
import { TargetRequest, TargetResponse, UserInputResponse, UtilsInput } from "../utils/utils-input";

interface FireBoltData {
  targets: UserInputResponse<TargetResponse>;
}

export class FireBolt implements IMacro<FireBoltData> {

  public async macroData(context: MacroContext): Promise<any> {
    if (!context.tokenUuid) {
      throw new Error('Select a token first');
    }
    
    const item = await this.getItem(context);

    const targetRequest: TargetRequest = {
      nrOfTargets: item.data.data.target.value || 1,
      allowSameTarget: true,
      allPossibleTargets: game.scenes.get(game.user.viewedScene).getEmbeddedCollection('Token').map(token => {
        return {
          uuid: (token as any).uuid,
          type: 'within-range'
        }
      }),
    };

    return {
      targets: await UtilsInput.targets(context, targetRequest)
    };
  }
  
  public async run(context: MacroContext, data: FireBoltData): Promise<void> {
    console.log(context, data);
    if (data.targets.cancelled === true) {
      return;
    }
    // Default magic missile item
    const item = await this.getItem(context);
    
    const actor = context.actorUuid == null ? null : (await UtilsDocument.actorFromUuid(context.actorUuid));
    UtilsChatMessage.createCard({
      actor: context.actorUuid == null ? null : {uuid: context.actorUuid},
      token: context.tokenUuid == null ? null : {uuid: context.tokenUuid},
      items: [
        UtilsChatMessage.createDefaultItemData({
          actor: actor,
          item: item,
        })
      ],
    })
  }

  private getItem(context: MacroContext): Promise<MyItem> {
    return UtilsDocument.itemFromUuid(context.itemUuid || `Compendium.${staticValues.moduleName}.automated-spells.CL8MxStmYoSl5J54`)
  }

}