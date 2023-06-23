import { RunOnce } from "../lib/decorator/run-once";
import { StaticInitFunc } from "../lib/decorator/static-init-func";
import { MyActor } from "../types/fixed-types";
import { UtilsFoundry } from "./utils-foundry";
import { UtilsHooks } from "./utils-hooks";

interface DAE {
  /** Get a key+label map of special durations */
  daeSpecialDurations(): Record<string, string>;
  /** Get a DEA flag from the actor (or the token actor) */
  getFlag(actor: MyActor | TokenDocument, flagId: string);
}

let daeResolve: () => void;
const daePromise = new Promise<void>((resolve) => daeResolve = resolve);

export class UtilsDae {

  @StaticInitFunc(async () => {
    await daePromise;
    if (!UtilsDae.isActive()) {
      return async (...args: any[]) => {};
    }

    return async (key: string, label: string) => UtilsDae.getDae().daeSpecialDurations()[key] = label;
  }, {async: true})
  public static async registerSpecialDuration(key: string, label: string): Promise<void> {
    // TODO idea: when an effect is removed, create a chat message (?) to inform the player
    //   Probably better a card part to manually undo & redo the delete?
    //   Functionaly, the component should hold deleted items, allowing to revert the delete
    throw new Error('Should never get called');
  }

  public static isActive(): boolean {
    return game.modules.get('dae').active;
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