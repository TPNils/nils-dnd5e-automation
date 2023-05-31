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
  public static init(): Promise<void>
  public static init<T>(then: () => T): Promise<T>
  public static init(then?: () => any): Promise<void> {
    if (then) {
      return init.then(then);
    }
    return init;
  }
  /**
   * A hook event that fires once Localization translations have been loaded and are ready for use.
   */
  public static i18nInit(): Promise<void>
  public static i18nInit<T>(then: () => T): Promise<T>
  public static i18nInit(then?: () => any): Promise<void> {
    if (then) {
      return i18nInit.then(then);
    }
    return i18nInit;
  }
  /**
   * A hook event that fires when Foundry has finished initializing but before the game state has been set up.
   * Fires before any Documents, UI applications, or the Canvas have been initialized.
   */
  public static setup(): Promise<void>
  public static setup<T>(then: () => T): Promise<T>
  public static setup(then?: () => any): Promise<void> {
    if (then) {
      return setup.then(then);
    }
    return setup;
  }
  /**
   * A hook event that fires when the game is fully ready.
   */
  public static ready(): Promise<void>
  public static ready<T>(then: () => T): Promise<T>
  public static ready(then?: () => any): Promise<void> {
    if (then) {
      return ready.then(then);
    }
    return ready;
  }
  /**
   * A hook event that fires when the chat dom has been initialized
   */
  public static chatRendered(): Promise<void>
  public static chatRendered<T>(then: () => T): Promise<T>
  public static chatRendered(then?: () => any): Promise<void> {
    if (then) {
      return chatRendered.then(then);
    }
    return chatRendered;
  }

  @RunOnce()
  public static registerHooks(): void {
    Hooks.once('init', initResolve);
    UtilsHooks.init().then(() => {
      // Game version is available after init
      if (UtilsFoundry.getGameVersion() >= new Version(9, 240)) {
        Hooks.once('i18nInit', i18nInitResolve);
      } else {
        // Hook does not exist in before 9.240
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