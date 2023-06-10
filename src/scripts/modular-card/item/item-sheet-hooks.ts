import { FoundryDocument, DmlUpdateRequest, UtilsDocument } from "../../lib/db/utils-document";
import { RunOnce } from "../../lib/decorator/run-once";
import { staticValues } from "../../static-values";
import { MyItem, MyItemData } from "../../types/fixed-types";
import { UtilsFoundry } from "../../utils/utils-foundry";
import { UtilsLibWrapper } from "../../utils/utils-lib-wrapper";


/**
 * Implement formulas for amount og targets
 */
export class ItemSheetHooks {
  
  @RunOnce()
  public static registerHooks(): void {
    UtilsLibWrapper.wrapper('CONFIG.Item.documentClass.prototype.prepareDerivedData', ItemSheetHooks.prepareDerivedData);
    Hooks.on('renderItemSheet5e', ItemSheetHooks.renderItemSheet);
  }

  private static prepareDerivedData(this: MyItem, wrapped: (...args: any) => any, ...args: any[]): any {
    const result = wrapped(...args);
    const targetFormula = this.getFlag(staticValues.moduleName, 'targetFormula');
    if (targetFormula) {
      const onActorDataIsSet = () => {
        const itemData = UtilsFoundry.getSystemData(this);
        const formula = Roll.replaceFormulaData(targetFormula, this.getRollData());
        if (itemData?.target == null) {
          itemData.target = {
            type: '',
            units: '',
          };
        };
        try {
          itemData.target.value = Roll.safeEval(formula);
        } catch {/* ignore, probably an error for a formula referring to actor data, while not having an actor */}
      }

      if (this.actor == null || UtilsFoundry.getSystemData(this.actor) != null) {
        onActorDataIsSet();
      } else {
        setTimeout(() => {
          // this.actor.data is sometimes null, causing an error for this.getRollData()
          onActorDataIsSet();
        }, 10);
      }
    }
    return result;
  }

  private static renderItemSheet(sheet: ItemSheet, html: JQuery, arg3: {data: MyItemData, document: MyItem & FoundryDocument}): void {
    const targetInput = <HTMLInputElement> html.find(`input[name="data.target.value"],input[name="system.target.value"]`).get()[0];
    if (!targetInput) {
      return;
    }

    targetInput.removeAttribute('name');
    targetInput.setAttribute('type', 'text');
    
    const targetFormula = (arg3.document as MyItem).getFlag(staticValues.moduleName, 'targetFormula');
    if (targetFormula) {
      targetInput.value = targetFormula;
    }
    targetInput.addEventListener('change', event => {
      event.stopPropagation();
      const value = targetInput.value;
      if (value == null || value == '') {
        const updateData: DmlUpdateRequest<MyItem> = {
          document: arg3.document,
          systemData: {
            target: {
              value: null
            }
          },
          rootData: {
            flags: {
              [staticValues.moduleName]: {
                targetFormula: null,
              }
            }
          }
        };
        UtilsDocument.bulkUpdate([updateData])
        return;
      }

      const valueNr = Number(value);
      if (Number.isNaN(valueNr)) {
        if (!Roll.validate(value)) {
          targetInput.setCustomValidity('Not a valid roll formula')
          event.preventDefault();
          return;
        }

        const roll = new Roll(value, arg3.document.getRollData());
        roll.roll({async: true}).then(rollResult => {
          const updateData: DmlUpdateRequest<MyItem> = {
            document: arg3.document,
            systemData: {
              target: {
                value: rollResult.total,// Try not to break other systems/modules
              }
            },
            rootData: {
              flags: {
                [staticValues.moduleName]: {
                  targetFormula: value,
                }
              }
            }
          };
          UtilsDocument.bulkUpdate([updateData])
        })
      } else {
        const updateData: DmlUpdateRequest<MyItem> = {
          document: arg3.document,
          systemData: {
            target: {
              value: valueNr,
            }
          },
          rootData: {
            flags: {
              [staticValues.moduleName]: {
                targetFormula: null,
              }
            }
          }
        };
        UtilsDocument.bulkUpdate([updateData])
      }
    })

  }

}