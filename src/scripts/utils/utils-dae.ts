import { RunOnce } from "../lib/decorator/run-once";
import { StaticInitFunc } from "../lib/decorator/static-init-func";
import { MyActor } from "../types/fixed-types";
import { UtilsFoundry } from "./utils-foundry";
import { UtilsHooks } from "./utils-hooks";

interface DAE {
  /** Add fields for auto-completion */
  addAutoFields(fields: string[]): void;
  /** Get a key+label map of special durations */
  daeSpecialDurations(): Record<string, string>;
  /** Get a DEA flag from the actor (or the token actor) */
  getFlag<T = any>(actor: MyActor | TokenDocument, flagId: string): T;
}

let daeResolve: () => void;
const daePromise = new Promise<void>((resolve) => daeResolve = resolve);

export class UtilsDae {

  public static async registerSpecialDuration(key: string, label: string): Promise<void> {
    await daePromise;
    if (!UtilsDae.isActive()) {
      // If DAE is not active, don't do any interactions with it.
      return;
    }
    UtilsDae.getDae().daeSpecialDurations()[key] = label;
  }

  public static async addAutocompleteKey(...fields: string[] | Array<string[]>): Promise<void> {
    await daePromise;
    if (!UtilsDae.isActive()) {
      // If DAE is not active, don't do any interactions with it.
      return;
    }

    UtilsDae.getDae().addAutoFields(fields.deepFlatten());
  }

  public static isActive(): boolean {
    return game.modules.get('dae')?.active === true;
  }

  @StaticInitFunc(() => {
    if (!UtilsDae.isActive()) {
      // If DAE is not active, don't do any interactions with it.
      return () => [];
    }

    return (actor: MyActor, key: string) => {
      const effects: ActiveEffect[] = [];

      for (const effect of actor.effects.values()) {
        const specialDuration = getProperty(UtilsFoundry.getModelData(effect).flags, "dae.specialDuration");
        if (specialDuration?.includes(key)) {
          effects.push(effect);
        }
      }
      return effects;
    };
  })
  public static getExpireEffects(actor: MyActor, key: string): ActiveEffect[] {
    throw new Error('Should never get called');
  }

  private static getDae(): DAE {
    return globalThis.DAE;
  }
  
  @RunOnce()
  public static registerHooks() {
    Hooks.once('DAE.setupComplete', daeResolve);
    // fallback
    UtilsHooks.ready(daeResolve);
  }

}