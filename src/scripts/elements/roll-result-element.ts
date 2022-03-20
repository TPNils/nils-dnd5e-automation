import { buffer } from "../lib/decorator/buffer";
import { RunOnce } from "../lib/decorator/run-once";
import { staticValues } from "../static-values";
import { RollJson } from "../utils/utils-chat-message";

export class RollResultElement extends HTMLElement {

  public static selector(): string {
    return `${staticValues.code}-roll-result`;
  }

  @RunOnce()
  public static registerHooks(): void {
    customElements.define(RollResultElement.selector(), RollResultElement);
  }
  
  public static get observedAttributes() {
    return ['roll', 'override-max-roll', 'compact', 'highlight-total-on-firstTerm', 'override-formula'];
  }

  private elementsBySlotName: Map<string, Element[]> = new Map();
  public connectedCallback(): void {
    const elementsBySlotName = new Map<string, Element[]>();
    this.querySelectorAll('[slot]').forEach(element => {
      if (!elementsBySlotName.has(element.getAttribute('slot'))) {
        elementsBySlotName.set(element.getAttribute('slot'), []);
      }
      elementsBySlotName.get(element.getAttribute('slot')).push(element);
    });
    this.elementsBySlotName = elementsBySlotName;
    this.textContent = '';
    this.calcInner();
  }

  @buffer()
  public attributeChangedCallback(): void {
    this.calcInner();
  }

  private async calcInner(): Promise<void> {
    if (!this.hasAttribute('roll')) {
      this.textContent = '';
      return;
    }
    const rollJson: RollJson = JSON.parse(this.getAttribute('roll'));
    if (!rollJson.evaluated) {
      this.textContent = '';
      return;
    }
    const html = await renderTemplate(
      `modules/${staticValues.moduleName}/templates/roll/roll.hbs`, {
        roll: rollJson,
        overrideFormula: this.getAttribute('override-formula'),
        compact: this.readAttrBoolean('compact'),
        highlightTotalOnFirstTerm: this.readAttrBoolean('highlight-total-on-firstTerm'),
        overrideMaxRoll: this.readAttrInteger('override-max-roll'),
      }
    );

    const root = document.createElement('div');
    root.innerHTML = html;
    for (const slotName of this.elementsBySlotName.keys()) {
      const replaceElements = this.elementsBySlotName.get(slotName);
      const slots = root.querySelectorAll(`slot[name="${slotName}"]`);
      slots.forEach(slot => {
        for (let i = replaceElements.length - 1; i >= 0; i--) {
          slot.parentNode.insertBefore(replaceElements[i].cloneNode(true), slot);
        }
      });
      slots.forEach(slot => {
        slot.parentNode.removeChild(slot);
      });
    }
    this.textContent = '';
    this.append(...Array.from(root.childNodes));
  }

  private readAttrInteger(attr: string): number | undefined {
    if (!this.hasAttribute(attr)) {
      return undefined;
    }
    if (/[0-9]+/.test(this.getAttribute(attr))) {
      return Number(this.getAttribute(attr));
    }
    return undefined;
  }

  private readAttrBoolean(attr: string): boolean {
    if (!this.hasAttribute(attr)) {
      return false;
    }

    const value = this.getAttribute(attr);
    if (value === '') {
      return true;
    }
    if (value.toLowerCase() === 'false') {
      return false;
    }
    return Boolean(value);
  }

}