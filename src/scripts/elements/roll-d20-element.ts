import { RunOnce } from "../lib/decorator/run-once";
import { staticValues } from "../static-values";
import { RollJson } from "../utils/utils-chat-message";
import { ElementBuilder } from "./element-builder";
import { UtilsElement } from "./utils-element";

export interface RollD20Data {
  roll: RollJson;
  mode: 'advantage' | 'normal' | 'disadvantage';
  overrideMaxRoll?: number;
}

export class RollD20Element {

  public static selector(): string {
    return `${staticValues.code}-roll-d20`;
  }

  @RunOnce()
  public static registerHooks(): void {
    new ElementBuilder()
      .addOnAttributeChange(RollD20Element.doRender)
      .listenForAttribute('data-roll', 'json')
      .listenForAttribute('data-bonus-formula', 'string')
      .listenForAttribute('data-show-bonus', 'boolean')
      .listenForAttribute('data-highlight-total-on-firstTerm', 'boolean')
      .listenForAttribute('data-interaction-permission', 'string')
      .listenForAttribute('data-read-permission', 'string')
      .listenForAttribute('data-read-hidden-display-type', 'string')
      .listenForAttribute('data-label', 'string')
      .listenForAttribute('data-override-formula', 'string')
      .listenForAttribute('data-override-max-roll', 'number')
      .build(RollD20Element.selector())
  }

  private static doRender = async ({element}: {element: HTMLElement}) => {
    const rollJson: RollJson = UtilsElement.readAttrJson(element, 'data-roll');
    if (!rollJson) {
      element.textContent = '';
      return;
    }
    let mode: RollD20Data['mode'] = 'normal';
    const firstTerm: any = rollJson.terms[0];
    if (firstTerm.modifiers?.includes('kh')) {
      mode = 'advantage';
    } else if (firstTerm.modifiers?.includes('kl')) {
      mode = 'disadvantage';
    }
    element.innerHTML = await renderTemplate(
      `modules/${staticValues.moduleName}/templates/roll/roll-d20.hbs`, {
        roll: rollJson,
        mode: mode,
        label: UtilsElement.readAttrString(element, 'data-label'),
        showBonus: UtilsElement.readAttrBoolean(element, 'data-show-bonus'),
        bonusFormula: UtilsElement.readAttrString(element, 'data-bonus-formula'),
        overrideFormula: UtilsElement.readAttrString(element, 'data-override-formula'),
        highlightTotalOnFirstTerm: UtilsElement.readAttrBoolean(element, 'data-highlight-total-on-firstTerm', true),
        interactionPermission: UtilsElement.readAttrString(element, 'data-interaction-permission'),
        readPermission: UtilsElement.readAttrString(element, 'data-read-permission'),
        readHiddenDisplayType: UtilsElement.readAttrString(element, 'data-read-hidden-display-type'),
        overrideMaxRoll: UtilsElement.readAttrInteger(element, 'data-override-max-roll'),
        moduleName: staticValues.moduleName,
      }
    );
  }

}