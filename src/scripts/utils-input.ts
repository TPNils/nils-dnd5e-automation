/**
 * Target idea:
 * name | Target1 | T2 | T3
 * 
 * 1 checkbox needs to be selected in each target column
 * define if you can target the same creature twice (bless vs magic missile)
 * 
 * Additional idea:
 * amount of targets often scale with level, checking more targets auto scales the level?
 */

import { MacroContext } from "./macro-context";
import { staticValues } from "./static-values";

interface TargetOption {
  uuid: string; // the UUID of he token which can be targeted
  type: 'within-range' | 'outside-range'
}

interface TargetTemplateData extends TargetOption {
  name: string;
  img: string;
  actorName: string;
  selected: boolean[]; // true/false if target x is this target
}

interface TargetArgs {
  nrOfTargets: number; // How many tokens that should be targeted
  allowSameTarget: boolean; // Can the same token be targeted multiple times
  allPossibleTargets: TargetOption[];
}

export class UtilsInput {

  /**
   * 
   * @param context 
   * @param args 
   * @returns an array of token UUIDs of the targeted tokens.
   */
  public static targets(context: MacroContext, args: TargetArgs): Promise<string[]> {
    if (args.nrOfTargets === context.targetTokenUuids.length) {
      return Promise.resolve(context.targetTokenUuids);
    }

    return UtilsInput.targetDialog(context.targetTokenUuids, args);
  }

  private static async targetDialog(preselectedTargets: string[], args: TargetArgs): Promise<string[]> {
    const fetchedTargets = await Promise.all(args.allPossibleTargets.map(target => fromUuid(target.uuid)))

    const targetDocumentMap = new Map<string, TokenDocument>();
    for (const fetchedTarget of fetchedTargets) {
      if (fetchedTarget.documentName === 'Token') {
        targetDocumentMap.set((fetchedTarget as any).uuid, fetchedTarget as TokenDocument);
      }
    }
    const selectedTimesMap = new Map<string, number>();
    for (const preselectedTarget of preselectedTargets) {
      if (!selectedTimesMap.has(preselectedTarget)) {
        selectedTimesMap.set(preselectedTarget, 1);
      } else {
        selectedTimesMap.set(preselectedTarget, selectedTimesMap.get(preselectedTarget) + 1);
      }
    }

    const targets: TargetTemplateData[] = [];
    for (const possibleTarget of args.allPossibleTargets) {
      const selectedTimes: boolean[] = [];
      for (let i = 0; i < args.nrOfTargets; i++) {
        // TODO
        selectedTimes.push(false);
      }
      const token = targetDocumentMap.get(possibleTarget.uuid);
      targets.push({
        ...possibleTarget,
        name: token.name,
        img: token.data.img,
        actorName: token.parent.name,
        selected: selectedTimes
      });
    }

    const targetNrs: number[] = [];
    for (let i = 0; i < args.nrOfTargets; i++) {
      targetNrs.push(i);
    }

    const dialogHtml = await renderTemplate(`modules/${staticValues.moduleName}/templates/target-dialog.hbs`, {
      staticValues: staticValues,
      allowSameTarget: args.allowSameTarget,
      targets: targets.sort((a, b) => a.actorName.localeCompare(b.actorName)),
      targetNrs: targetNrs,
    });

    console.log(dialogHtml);

    return new Promise<string[]>((resolve, reject) => {
      let submitCalled = false;
      const dialog = new Dialog({
        title: 'Select targets',
        content: dialogHtml,
        buttons: {
          "submit": {
            label: 'Submit',
            callback: (html: JQuery<HTMLElement>) => {
              // TODO
              resolve([]);
            }
          },
          "cancel": {
            label: 'Cancel',
            callback: () => {
              dialog.close();
            }
          }
        },
        close: () => {
          if (!submitCalled) {
            // TODO this should just be a cancel, not an error
            reject();
          }
        },
        default: 'submit'
      });
      dialog.render(true);
    });
  }

}