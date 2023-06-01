import { RunOnce } from "../lib/decorator/run-once.js";
import { MyItem } from "../types/fixed-types.js";
import { UtilsHooks } from "../utils/utils-hooks.js";
import { UtilsFoundry, Version } from "../utils/utils-foundry.js";
import { staticValues } from "../static-values.js";
import { UtilsLog } from "../utils/utils-log.js";

export interface AbilityTemplate extends MeasuredTemplate {
  drawPreview?: () => void
}

let Nd5aAbilityTemplate: typeof MeasuredTemplate & {fromItem: (item: MyItem) => AbilityTemplate};
function getTemplateClass() {
  if (Nd5aAbilityTemplate == null) {
    let baseClass: typeof Nd5aAbilityTemplate;
    if ('dnd5e' in globalThis) {
      baseClass = (globalThis.dnd5e as any).canvas.AbilityTemplate;
    } else {
      baseClass = (game as any).dnd5e.canvas.AbilityTemplate;
    }

    Nd5aAbilityTemplate = class a extends baseClass {

      private simulateId = false;
      /**
       * Required to make highlightGrid work
       */
      public get id(): string {
        if (!super.id && this.simulateId) {
          return 'null';
        }
        return super.id;
      }
      
      public refresh(): this {
        const value = super.refresh()
        if (this.template) {
          this.highlightGrid();
        }
        return value;
      }
      
      public highlightGrid(): void {
        this.simulateId = true;
        super.highlightGrid()
        this.simulateId = false;
      }
    }
  }

  return Nd5aAbilityTemplate;
}

/**
 * Basically a copy from DND5e AbilityTemplate, except that actorSheet can be null
 */
export default class MyAbilityTemplate {

  @RunOnce()
  public static registerHooks() {
  }

  public static fromItem(item: MyItem, dmlCallbackMessageId: string): AbilityTemplate {
    const template = getTemplateClass().fromItem(item);
    const dataUpdate = {
      flags: {
        [staticValues.moduleName]: {
          dmlCallbackMessageId: dmlCallbackMessageId,
        }
      }
    };
    if (UtilsFoundry.usesDataModel<MeasuredTemplateDocument>(template.document)) {
      template.document.updateSource(dataUpdate)
    } else if (UtilsFoundry.usesDocumentData<MeasuredTemplateDocument>(template.document)) {
      template.document.data.update(dataUpdate);
    }
    return template;
  }
}
