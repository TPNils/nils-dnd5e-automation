import { staticValues } from "./static-values";

class HtmlListener {
  private static radioClickedTimeouts = new Map<HTMLInputElement, NodeJS.Timeout>();

  public static registerHooks(): void {
    Hooks.on('ready', () => {
      // Register that a click happend
      document.addEventListener('click', HtmlListener.toggleRadioClick);
      // If a change event is fired immidatly after the click, cancel the delayed click toggle
      document.addEventListener('change', HtmlListener.toggleRadioChange);
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

    HtmlListener.radioClickedTimeouts.set(target, setTimeout(() => {
      target.checked = false;
      const event = document.createEvent("HTMLEvents");
      event.initEvent("change", true, true);
      target.dispatchEvent(event);
      HtmlListener.radioClickedTimeouts.delete(target);
    }, 0))
  }

  private static toggleRadioChange(event: MouseEvent): void {
    if (!HtmlListener.radioClickedTimeouts.has(event.target as any)) {
      return;
    }
    
    const timeout = HtmlListener.radioClickedTimeouts.get(event.target as any);
    clearTimeout(timeout);
    HtmlListener.radioClickedTimeouts.delete(event.target as any);
  }
}

export const registerHooks = HtmlListener.registerHooks;