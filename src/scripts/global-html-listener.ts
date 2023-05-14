import { staticValues } from "./static-values";
import { UtilsHooks } from "./utils/utils-hooks";

class GlobalHtmlListener {
  private static radioClickedTimeouts = new Map<HTMLInputElement, NodeJS.Timeout>();

  public static registerHooks(): void {
    UtilsHooks.chatRendered().then(() => {
      // Register that a click happend
      document.addEventListener('click', GlobalHtmlListener.toggleRadioClick);
      // If a change event is fired immidatly after the click, cancel the delayed click toggle
      document.addEventListener('change', GlobalHtmlListener.toggleRadioChange);
      
      document.addEventListener('keyup', GlobalHtmlListener.onKeyPress);
      document.addEventListener('keydown', GlobalHtmlListener.onKeyPress);

      // Create an observer instance linked to the callback function
      const observer = new MutationObserver((mutationsList, observer) => {
        for (const mutation of mutationsList) {
          for (const addedNode of Array.from(mutation.addedNodes)) {
            if (addedNode instanceof Element) {
              const queryNode = addedNode.matches(`[autofocus]`) ? addedNode : addedNode.querySelector(`[autofocus]`);
              if (queryNode instanceof HTMLElement) {
                queryNode.focus();
                // Only focus once
                return;
              }
            }
          }
        }
      });

      // Start observing the target node for configured mutations
      observer.observe(document, { childList: true, subtree: true });
    });
  }

  private static toggleRadioClick(event: MouseEvent): void {
    if (!(event.target instanceof HTMLInputElement)) {
      return;
    }
    const target = event.target;
    if (target.getAttribute('type') !== 'radio' || !target.hasAttribute(`${staticValues.moduleName}-allow-unset`)) {
      return;
    }

    GlobalHtmlListener.radioClickedTimeouts.set(target, setTimeout(() => {
      target.checked = false;
      const event = document.createEvent("HTMLEvents");
      event.initEvent("change", true, true);
      target.dispatchEvent(event);
      GlobalHtmlListener.radioClickedTimeouts.delete(target);
    }, 0))
  }

  private static toggleRadioChange(event: MouseEvent): void {
    if (!GlobalHtmlListener.radioClickedTimeouts.has(event.target as any)) {
      return;
    }
    
    const timeout = GlobalHtmlListener.radioClickedTimeouts.get(event.target as any);
    clearTimeout(timeout);
    GlobalHtmlListener.radioClickedTimeouts.delete(event.target as any);
  }

  private static onKeyPress(event: KeyboardEvent): void {
    if (event.shiftKey) {
      if (!document.body.classList.contains('key-shift')) {
        document.body.classList.add('key-shift');
      }
    } else {
      if (document.body.classList.contains('key-shift')) {
        document.body.classList.remove('key-shift');
      }
    }
  }
}

export const registerHooks = GlobalHtmlListener.registerHooks;