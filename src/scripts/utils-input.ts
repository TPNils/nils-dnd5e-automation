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
  selected: {index: number, name: string, selected: boolean}[]; // true/false if target x is this target
}

interface TargetArgs {
  nrOfTargets: number; // How many tokens that should be targeted
  allowSameTarget: boolean; // Can the same token be targeted multiple times
  allPossibleTargets: TargetOption[];
}

type UserInputResponse<T> = {
  cancelled: true;
} | {
  cancelled: false;
  data: T
}

export class UtilsInput {

  /**
   * @returns an array of token UUIDs of the targeted tokens.
   */
  public static targets(context: MacroContext, args: TargetArgs): Promise<UserInputResponse<string[]>> {
    if (args.nrOfTargets === context.targetTokenUuids.length) {
      return Promise.resolve({cancelled: false, data: context.targetTokenUuids});
    }

    return UtilsInput.targetDialog(context.targetTokenUuids, args);
  }

  private static async targetDialog(preselectedTargets: string[], args: TargetArgs): Promise<UserInputResponse<string[]>> {
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
      const selectedTimes: TargetTemplateData['selected'] = [];
      for (let i = 0; i < args.nrOfTargets; i++) {
        selectedTimes.push({
          index: i,
          name: String(i+1),
          selected: preselectedTargets.length < i ? false : preselectedTargets[i] === possibleTarget.uuid
        });
      }
      const token = targetDocumentMap.get(possibleTarget.uuid);
      targets.push({
        ...possibleTarget,
        name: token.name,
        img: token.data.img,
        actorName: game.actors.get(token.data.actorId)?.name,
        selected: selectedTimes
      });
    }
    console.log({targets, targetDocumentMap})

    const dialogHtml = await renderTemplate(`modules/${staticValues.moduleName}/templates/target-dialog.hbs`, {
      staticValues: staticValues,
      allowSameTarget: args.allowSameTarget,
      targets: targets.sort((a, b) => {
        const actorNameCompare = a.actorName.localeCompare(b.actorName);
        console.log({a: a.actorName, b: b.actorName, r: actorNameCompare})
        if (actorNameCompare !== 0) {
          return actorNameCompare;
        }
        return a.name.localeCompare(b.name);
      }),
    });

    return new Promise<UserInputResponse<string[]>>((resolve, reject) => {
      let submitCalled = false;
      const dialog = new Dialog({
        title: 'Select targets',
        content: dialogHtml,
        buttons: {
          "submit": {
            label: 'Submit',
            callback: (html: JQuery<HTMLElement>) => {
              const formData = new FormData(html[0].querySelector('form'))
              const selectedTokenUuids: string[] = [];
              formData.forEach((value) => {
                selectedTokenUuids.push(value.toString());
              });
              resolve({cancelled: false, data: selectedTokenUuids});
            }
          },
          "cancel": {
            label: 'Cancel',
            callback: () => {
              dialog.close();
            }
          }
        },
        render: (html: JQuery<HTMLElement>) => {
          // Enforce unique targets
          if (!args.allowSameTarget) {
            const form: HTMLFormElement = html[0].querySelector('form');
            const enforceUniqueTargets = () => {
              const inputsByTokenUuid = new Map<string, HTMLInputElement[]>();
              form.querySelectorAll('input[type="radio"]').forEach((input: HTMLInputElement) => {
                if (!inputsByTokenUuid.has(input.value)) {
                  inputsByTokenUuid.set(input.value, []);
                }
                inputsByTokenUuid.get(input.value).push(input);
              });

              inputsByTokenUuid.forEach(inputs => {
                let checkedInput: HTMLInputElement;
                for (const input of inputs) {
                  if (input.checked) {
                    checkedInput = input;
                    break;
                  }
                }

                for (const input of inputs) {
                  if (checkedInput) {
                    // uncheck the other inputs
                    input.checked = input === checkedInput;
                    // disable the other inputs
                    input.disabled = input !== checkedInput;
                  } else {
                    input.disabled = false;
                  }
                }
              })
            }

            form.addEventListener('change', enforceUniqueTargets);
            // Also apply this on load
            enforceUniqueTargets();
          }

          // Foundry overrides the width after render is called
          setTimeout(() => {
            const dialogWrapper = html[0].parentElement.parentElement;
            dialogWrapper.style.width = 'max-content';
          }, 0);
        },
        close: () => {
          if (!submitCalled) {
            // TODO this should just be a cancel, not an error
            resolve({cancelled: true});
          }
        },
        default: 'submit'
      });
      dialog.render(true);
    });
  }

}