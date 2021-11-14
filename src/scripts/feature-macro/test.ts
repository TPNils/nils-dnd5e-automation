import { IMacro } from "../macro";
import { MacroContext } from "../macro-context";
import { UtilsInput } from "../utils/utils-input";

let calls = 0;

export class Test implements IMacro<ReturnType<typeof UtilsInput['targets']>> {

  public async macroData(context: MacroContext): Promise<ReturnType<typeof UtilsInput['targets']>> {
    return UtilsInput.targets(context.targetTokenUuids, {
      nrOfTargets: 3,
      allowSameTarget: calls++ % 2 == 1,
      allPossibleTargets: game.scenes.get(game.user.viewedScene).getEmbeddedCollection('Token').map(token => {
        return {
          uuid: (token as any).uuid,
          type: 'within-range'
        }
      }),
    });
  }
  
  public async run(context: MacroContext, data: ReturnType<typeof UtilsInput['targets']>): Promise<void> {
    console.debug('run test macro', {context, data});
  }

}