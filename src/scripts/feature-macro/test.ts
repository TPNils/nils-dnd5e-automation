import { IMacro } from "../macro";
import { MacroContext } from "../macro-context";
import { UtilsInput } from "../utils-input";

export class Test implements IMacro {

  public async macroData(context: MacroContext): Promise<any> {
    return UtilsInput.targets(context, {
      nrOfTargets: 3,
      allowSameTarget: true,
      allPossibleTargets: game.scenes.get(game.user.viewedScene).getEmbeddedCollection('Token').map(token => {
        return {
          uuid: (token as any).uuid,
          type: 'within-range'
        }
      }),
    });
  }
  
  public async run(context: MacroContext, data: any): Promise<void> {
    console.log('run test macro', {context, data});
  }

}