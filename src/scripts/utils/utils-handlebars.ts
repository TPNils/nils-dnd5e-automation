import { filters } from "pixi.js";
import { MemoryStorageService } from "../service/memory-storage-service";
import { staticValues } from "../static-values";
import { UtilsDocument } from "./utils-document";

type Options = {fn: (argThis: any) => any, inverse: (argThis: any) => any};

export class UtilsHandlebars {

  public static concat(...args: any[]): string {
    // The last argument is a handlebars object which i dont care about
    args = args.slice(0, args.length - 1);
    return args.join('');
  }

  public static hasPermission(...args: any[]): any {
    const secretFilters: string[] = args.slice(0, args.length - 1);
    const options: Options = args[args.length - 1];
    // no filters = always visible
    let matchesFilter = secretFilters.length === 0;

    for (const filter of secretFilters) {
      if ((filter.toLowerCase() === 'gm' || filter.toLowerCase() === 'dm') && game.user.isGM) {
        matchesFilter = true;
      }
      if (filter.toLowerCase() === 'player' && !game.user.isGM) {
        matchesFilter = true;
      }
      if (filter.toLowerCase().startsWith('user:') && filter.substring(5) === game.userId) {
        matchesFilter = true;
      }
      if (filter.toLowerCase().startsWith('actorowneruuid:')) {
        const actor = UtilsDocument.actorFromUuid(filter.substring(15), {sync: true});
        // always show missing/invalid/deleted/null actors
        if (!actor || actor.isOwner) {
          matchesFilter = true;
        }
      }
      if (filter.toLowerCase().startsWith('actorownerid:')) {
        const actor = game.actors.get(filter.substring(13));
        // always show missing/invalid/deleted/null actors
        if (!actor || actor.isOwner) {
          matchesFilter = true;
        }
      }
      // Don't support token owner filter. They are too short lived and are based on actor anyway

      if (matchesFilter) {
        break;
      }
    }

    if (matchesFilter) {
      return options.fn(this);
    } else {
      return options.inverse(this);
    }
  }

  public static missingPermission(...args: any[]): any {
    const secretFilters: string[] = args.slice(0, args.length - 1);
    const options: Options = args[args.length - 1];
    // no filters = always visible
    if (secretFilters.length === 0) {
      return options.fn(this);
    }

    for (const filter of secretFilters) {
      if ((filter.toLowerCase() === 'gm' || filter.toLowerCase() === 'dm') && game.user.isGM) {
        return options.inverse(this);
      }
      if (filter.toLowerCase() === 'player' && !game.user.isGM) {
        return options.inverse(this);
      }
      if (filter.toLowerCase().startsWith('user:') && filter.substring(5) === game.userId) {
        return options.inverse(this);
      }
      if (filter.toLowerCase().startsWith('actorowneruuid:')) {
        const actor = UtilsDocument.actorFromUuid(filter.substring(15), {sync: true});
        // always show missing/invalid/deleted/null actors
        if (!actor || actor.isOwner) {
          return options.inverse(this);
        }
      }
      if (filter.toLowerCase().startsWith('actorownerid:')) {
        const actor = game.actors.get(filter.substring(13));
        // always show missing/invalid/deleted/null actors
        if (!actor || actor.isOwner) {
          return options.inverse(this);
        }
      }
      // Don't support token owner filter. They are too short lived and are based on actor anyway
    }

    return options.fn(this);
  }

  public static isCardCollapse(messageId: string): boolean {
    return MemoryStorageService.isCardCollapsed(messageId);
  }

  public static registerHooks(): void {
    Hooks.on("init", () => {
      Handlebars.registerHelper(`${staticValues.code}Concat`, UtilsHandlebars.concat);
      Handlebars.registerHelper(`${staticValues.code}Perm`, UtilsHandlebars.hasPermission);
      Handlebars.registerHelper(`${staticValues.code}MisPerm`, UtilsHandlebars.missingPermission);
      Handlebars.registerHelper(`${staticValues.code}CardCollapse`, UtilsHandlebars.isCardCollapse);
    });
  }
}