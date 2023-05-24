import { RunOnce } from "../lib/decorator/run-once";
import { UtilsFoundry, Version } from "./utils-foundry";

type HookResolve<T = void> = (value: T | PromiseLike<T>) => void;

let initResolve: HookResolve;
const init = new Promise<void>((resolve) => initResolve = resolve);

let i18nInitResolve: HookResolve;
const i18nInit = new Promise<void>((resolve) => i18nInitResolve = resolve);

let setupResolve: HookResolve;
const setup = new Promise<void>((resolve) => setupResolve = resolve);

let readyResolve: HookResolve;
const ready = new Promise<void>((resolve) => readyResolve = resolve);

let chatRenderedResolve: HookResolve;

const chatRendered = new Promise<void>(async (resolve) => {
  await init;
  const observer = new MutationObserver((mutationsList, observer) => {
    for (const mutation of mutationsList) {
      for (const addedNode of Array.from(mutation.addedNodes)) {
        if (addedNode instanceof Element) {
          const queryNode = addedNode.matches(`#chat`) ? addedNode : addedNode.querySelector(`#chat`);
          if (queryNode instanceof HTMLElement) {
            resolve();
            observer.disconnect();
            return;
          }
        }
      }
    }
  });

  // Start observing the target node for configured mutations
  observer.observe(document, { childList: true, subtree: true });
});

export class UtilsHooks {

  /**
   * A hook event that fires as Foundry is initializing, right before any initialization tasks have begun.
   */
  public static init(): Promise<void> {
    return init;
  }
  /**
   * A hook event that fires once Localization translations have been loaded and are ready for use.
   */
  public static i18nInit(): Promise<void> {
    return i18nInit;
  }
  /**
   * A hook event that fires when Foundry has finished initializing but before the game state has been set up.
   * Fires before any Documents, UI applications, or the Canvas have been initialized.
   */
  public static setup(): Promise<void> {
    return setup;
  }
  /**
   * A hook event that fires when the game is fully ready.
   */
  public static ready(): Promise<void> {
    return ready;
  }
  /**
   * A hook event that fires when the chat dom has been initialized
   */
  public static chatRendered(): Promise<void> {
    return chatRendered;
  }

  @RunOnce()
  public static registerHooks(): void {
    Hooks.once('init', initResolve);
    UtilsHooks.init().then(() => {
      // Game version is available after init
      if (UtilsFoundry.getGameVersion() >= new Version(9)) {
        Hooks.once('i18nInit', i18nInitResolve);
      } else {
        // Hook does not exist in V8 or lower
        // i18n is init during setup in V8, not during init
        setup.then(i18nInitResolve)
      }

      if (game.view === 'game') {
        Hooks.once('setup', setupResolve);
        Hooks.once('ready', readyResolve);
      } else {
        // fallback for "/stream" url
        chatRendered.then(setupResolve);
        chatRendered.then(readyResolve);
      }
    });
    Hooks.once('init', chatRenderedResolve);
  }

}