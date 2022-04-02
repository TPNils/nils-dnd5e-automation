import { RunOnce } from "../lib/decorator/run-once";
import { RollData, UtilsRoll } from "../lib/roll/utils-roll";
import { MemoryStorageService } from "../service/memory-storage-service";
import { staticValues } from "../static-values";
import { ElementBuilder, ElementCallbackBuilder } from "./element-builder";

const elementsBySlotNameSymbol = Symbol('elementsBySlotName');

export class RollResultElement {

  public static selector(): string {
    return `${staticValues.code}-roll-result`;
  }

  @RunOnce()
  public static registerHooks(): void {
    new ElementBuilder()
      .listenForAttribute('data-roll', 'json')
      .listenForAttribute('data-highlight-total-on-firstTerm', 'boolean')
      .listenForAttribute('data-override-formula', 'string')
      .listenForAttribute('data-override-max-roll', 'number')
      .addOnInit(RollResultElement.extractInputSlots)
      .addOnInit((context) => {
        context.addStoppable(MemoryStorageService.getElementValue(context.element, 'roll-open').listen(value => RollResultElement.setOpenState(context.element, !!value)));
      })
      .addOnAttributeChange(async ({element, attributes}) => {
        const rollJson: RollData = attributes['data-roll'];
        if (!rollJson?.evaluated) {
          element.textContent = '';
          return;
        }
        const html = await renderTemplate(
          `modules/${staticValues.moduleName}/templates/roll/roll.hbs`, {
            roll: UtilsRoll.fromRollData(rollJson),
            overrideFormula: attributes['data-override-formula'],
            highlightTotalOnFirstTerm: attributes['data-highlight-total-on-firstTerm'],
            overrideMaxRoll: attributes['data-override-max-roll'],
          }
        );

        const root = document.createElement('div');
        root.innerHTML = html;
        RollResultElement.injectSlots({element, detatchedRoot: root});
        
        const fragment = document.createDocumentFragment();
        fragment.append(...Array.from(root.childNodes));
        element.textContent = '';
        element.append(fragment);
        RollResultElement.setOpenState(element, !!MemoryStorageService.getElementValue(element, 'roll-open').get());
      })
      .addListener(new ElementCallbackBuilder()
        .setEvent('click')
        .setExecute(({element}) => {
          const value = MemoryStorageService.getElementValue(element, 'roll-open');
          value.set(!value.get());
        }))
      .build(RollResultElement.selector())
  }

  // TODO either don't support slots (dont use it anyway) or solve it in element builder => can't find a simple solution there
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
          slot.parentNode.insertBefore(replaceElements[i].cloneNode(true), slot);
        }
      });
      slots.forEach(slot => {
        slot.parentNode.removeChild(slot);
      });
    }
  }

  private static setOpenState(element: HTMLElement, shouldBeOpen: boolean): void {
    const wrapper = element.querySelector(':scope > .wrapper');
    if (!wrapper) {
      return;
    }
    
    const isCurrentlyOpen = wrapper.classList.contains('open');
    if (isCurrentlyOpen != shouldBeOpen) {
      if (shouldBeOpen) {
        wrapper.classList.add('open');
      } else {
        wrapper.classList.remove('open');
      }
    }
  }

}