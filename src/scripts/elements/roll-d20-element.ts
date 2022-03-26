import { buffer } from "../lib/decorator/buffer";
import { RunOnce } from "../lib/decorator/run-once";
import { staticValues } from "../static-values";
import { RollJson } from "../utils/utils-chat-message";
import { UtilsElement } from "./utils-element";

export interface RollD20Data {
  roll: RollJson;
  mode: 'advantage' | 'normal' | 'disadvantage';
  overrideMaxRoll?: number;
}

export class RollD20Element extends HTMLElement {

  public static selector(): string {
    return `${staticValues.code}-roll-d20`;
  }

  @RunOnce()
  public static registerHooks(): void {
    customElements.define(RollD20Element.selector(), RollD20Element);
  }
  
  public static get observedAttributes() {
    return [
      // Required
      'data-roll',
      // Optional
      'data-bonus-formula',
      'data-show-bonus',
      'data-compact',
      'data-highlight-total-on-firstTerm',
      'data-interaction-permission',
      'data-label',
      'data-override-formula',
      'data-override-max-roll',
      'data-roll-id',
    ];
  }

  public connectedCallback(): void {
    this.calcInner();
  }

  @buffer({bufferTime: 0})
  public attributeChangedCallback(): void {
    this.calcInner();
  }

  private async calcInner(): Promise<void> {
    const rollJson: RollJson = UtilsElement.readAttrJson(this, 'data-roll');
    if (!rollJson) {
      this.textContent = '';
      return;
    }
    let mode: RollD20Data['mode'] = 'normal';
    const firstTerm: any = rollJson.terms[0];
    if (firstTerm.modifiers?.includes('kh')) {
      mode = 'advantage';
    } else if (firstTerm.modifiers?.includes('kl')) {
      mode = 'disadvantage';
    }
    this.innerHTML = await renderTemplate(
      `modules/${staticValues.moduleName}/templates/roll/roll-d20.hbs`, {
        roll: rollJson,
        mode: mode,
        label: UtilsElement.readAttrString(this, 'data-label'),
        showBonus: UtilsElement.readAttrBoolean(this, 'data-show-bonus'),
        bonusFormula: UtilsElement.readAttrString(this, 'data-bonus-formula'),
        overrideFormula: UtilsElement.readAttrString(this, 'data-override-formula'),
        compact: UtilsElement.readAttrBoolean(this, 'data-compact'),
        highlightTotalOnFirstTerm: UtilsElement.readAttrBoolean(this, 'data-highlight-total-on-firstTerm', true),
        interactionPermission: UtilsElement.readAttrString(this, 'data-interaction-permission'),
        overrideMaxRoll: UtilsElement.readAttrInteger(this, 'data-override-max-roll'),
        rollId: UtilsElement.readAttrString(this, 'data-roll-id'),
      }
    );
  }

}