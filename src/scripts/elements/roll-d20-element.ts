import { RunOnce } from "../lib/decorator/run-once";
import { RollData } from "../lib/roll/utils-roll";
import { staticValues } from "../static-values";
import { ElementBuilder, OnAttributeChange } from "./element-builder";
import { UtilsElement } from "./utils-element";

export interface RollD20Data {
  roll: RollData;
  mode: 'advantage' | 'normal' | 'disadvantage';
  overrideMaxRoll?: number;
}

const elementsBySlotNameSymbol = Symbol('elementsBySlotName');

export class RollD20Element {

  public static selector(): string {
    return `${staticValues.code}-roll-d20`;
  }

  @RunOnce()
  public static registerHooks(): void {
    new ElementBuilder()
      .listenForAttribute('data-roll', 'json')
      .listenForAttribute('data-bonus-formula', 'string')
      .listenForAttribute('data-show-bonus', 'boolean')
      .listenForAttribute('data-highlight-total-on-firstTerm', 'nullableBoolean')
      .listenForAttribute('data-interaction-permission', 'string')
      .listenForAttribute('data-read-permission', 'string')
      .listenForAttribute('data-read-hidden-display-type', 'string')
      .listenForAttribute('data-label', 'string')
      .listenForAttribute('data-override-formula', 'string')
      .listenForAttribute('data-override-max-roll', 'number')
      .addOnAttributeChange(async ({element, attributes}) => {
        const rollJson: RollData = attributes['data-roll'];
        if (!rollJson) {
          element.textContent = '';
          return;
        }
        let mode: RollD20Data['mode'] = 'normal';
        const firstTerm: any = rollJson.terms[0];
        if (firstTerm?.modifiers?.includes('kh')) {
          mode = 'advantage';
        } else if (firstTerm?.modifiers?.includes('kl')) {
          mode = 'disadvantage';
        }
        const root = document.createElement('div');
        root.innerHTML = await renderTemplate(
          `modules/${staticValues.moduleName}/templates/roll/roll-d20.hbs`, {
            roll: rollJson,
            mode: mode,
            label: attributes['data-label'],
            showBonus: attributes['data-show-bonus'],
            bonusFormula: attributes['data-bonus-formula'],
            overrideFormula: attributes['data-override-formula'],
            highlightTotalOnFirstTerm: attributes['data-highlight-total-on-firstTerm'] ?? true,
            interactionPermission: attributes['data-interaction-permission'],
            readPermission: attributes['data-read-permission'],
            readHiddenDisplayType: attributes['data-read-hidden-display-type'],
            overrideMaxRoll: attributes['data-override-max-roll'],
            moduleName: staticValues.moduleName,
          }
        );
        RollD20Element.injectSlots({element, detatchedRoot: root});
        
        const fragment = document.createDocumentFragment();
        fragment.append(...Array.from(root.childNodes));
        element.textContent = '';
        element.append(fragment);
      })
      .addOnInit(RollD20Element.extractInputSlots)
      .build(RollD20Element.selector())
  }

  // TODO either don't support slots or solve it in element builder => can't find a simple solution there
  private static extractInputSlots({element}: {element: HTMLElement}): void {
    const elementsBySlotName = new Map<string, Element[]>();
    element.querySelectorAll('[slot]').forEach(element => {
      if (!elementsBySlotName.has(element.getAttribute('slot'))) {
        elementsBySlotName.set(element.getAttribute('slot'), []);
      }
      elementsBySlotName.get(element.getAttribute('slot')).push(element);
    });
    element[elementsBySlotNameSymbol] = elementsBySlotName;
  }

  private static injectSlots({element, detatchedRoot}: {element: HTMLElement, detatchedRoot?: HTMLElement}): void {
    const elementsBySlotName: Map<string, Element[]> = element[elementsBySlotNameSymbol];
    if (!elementsBySlotName) {
      return
    }
    for (const slotName of elementsBySlotName.keys()) {
      const replaceElements = elementsBySlotName.get(slotName);
      const slots = (detatchedRoot == null ? element : detatchedRoot).querySelectorAll(`slot[name="${slotName}"]`);
      slots.forEach(slot => {
        for (let i = replaceElements.length - 1; i >= 0; i--) {
          slot.parentNode.insertBefore(replaceElements[i], slot);
        }
      });
      slots.forEach(slot => {
        slot.parentNode.removeChild(slot);
      });
    }
  }

}