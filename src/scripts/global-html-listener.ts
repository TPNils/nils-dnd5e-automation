import { staticValues } from "./static-values";

class GlobalHtmlListener {
  private static radioClickedTimeouts = new Map<HTMLInputElement, NodeJS.Timeout>();

  public static registerHooks(): void {
    Hooks.on('ready', () => {
      // Register that a click happend
      document.addEventListener('click', GlobalHtmlListener.toggleRadioClick);
      // If a change event is fired immidatly after the click, cancel the delayed click toggle
      document.addEventListener('change', GlobalHtmlListener.toggleRadioChange);
    });

    
    Hooks.on('renderChatLog', () => {
      if (game.user.isGM) {
        return;
      }
      const chatElement = document.getElementById('chat-log');
      const mutationObserver = new MutationObserver(GlobalHtmlListener.onChatMutation);
      mutationObserver.observe(chatElement, {subtree: true, childList: true});
      GlobalHtmlListener.removeDmSecrets(chatElement);
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

  private static onChatMutation(mutations: MutationRecord[]): void {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(node => {
        if (node instanceof HTMLElement) {
          GlobalHtmlListener.removeDmSecrets(node);
        }
      });
    }
  }

  private static removeDmSecrets(element: HTMLElement): void {
    if (element.classList.contains(`${staticValues.moduleName}-gm-secret`)) {
      element.remove();
      return;
    }
    element.querySelectorAll(`:scope .${staticValues.moduleName}-gm-secret`).forEach(found => {
      found.remove();
    });
  }
}

export const registerHooks = GlobalHtmlListener.registerHooks;