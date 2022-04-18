import { FoundryDocument, UtilsDocument } from "../lib/db/utils-document";
import { RunOnce } from "../lib/decorator/run-once";
import { staticValues } from "../static-values";
import { MyItem, MyItemData } from "../types/fixed-types";

export class ItemSheetHooks {
  
  @RunOnce()
  public static registerHooks(): void {
    Hooks.once('init', () => {
      libWrapper.register(staticValues.moduleName, 'CONFIG.Item.documentClass.prototype.prepareDerivedData', ItemSheetHooks.prepareDerivedData, 'WRAPPER');
    })
    Hooks.on('renderItemSheet5e', ItemSheetHooks.renderItemSheet);
  }

  private static prepareDerivedData(this: MyItem, wrapped: (...args: any) => any, ...args: any[]): any {
    const result = wrapped(...args);
    const targetFormula = this.getFlag(staticValues.moduleName, 'targetFormula');
    if (targetFormula) {
      const formula = Roll.replaceFormulaData(targetFormula, {item: this.data.data});
      if (this.data.data.target == null) {
        this.data.data.target = {
          type: '',
          units: '',
        };
      };
      this.data.data.target.value = Roll.safeEval(formula);
    }
    return result;
  }

  private static renderItemSheet(sheet: ItemSheet, html: JQuery, arg3: {data: MyItemData['data'], document: MyItem & FoundryDocument}): void {
    const targetInput = <HTMLInputElement> html.find(`input[name="data.target.value"]`).get()[0];
    if (!targetInput) {
      return;
    }
    const targetFormula = (arg3.document as MyItem).getFlag(staticValues.moduleName, 'targetFormula');
    if (targetFormula) {
      targetInput.value = targetFormula;
    }

    targetInput.removeAttribute('name');
    targetInput.addEventListener('change', event => {
      event.stopPropagation();
      const value = targetInput.value;
      if (value == null || value == '') {
        const updateData: DeepPartial<MyItemData> = {
          data: {
            target: {
              value: null
            }
          },
          flags: {
            [staticValues.moduleName]: {
              targetFormula: null,
            }
          }
        };
        UtilsDocument.bulkUpdate([{document: arg3.document, data: updateData}])
        return;
      }

      const valueNr = Number(value);
      if (Number.isNaN(valueNr)) {
        if (!Roll.validate(value)) {
          event.preventDefault();
          return;
        }

        const roll = new Roll(value, arg3.document.getRollData());
        roll.roll({async: true}).then(rollResult => {
          const updateData: DeepPartial<MyItemData> = {
            data: {
              target: {
                value: rollResult.total,// Try not to break other systems/modules
              }
            },
            flags: {
              [staticValues.moduleName]: {
                targetFormula: value,
              }
            }
          };
          UtilsDocument.bulkUpdate([{document: arg3.document, data: updateData}])
        })
      } else {
        const updateData: DeepPartial<MyItemData> = {
          data: {
            target: {
              value: valueNr,
            }
          },
          flags: {
            [staticValues.moduleName]: {
              targetFormula: null,
            }
          }
        };
        UtilsDocument.bulkUpdate([{document: arg3.document, data: updateData}])
      }
    })

  }

}