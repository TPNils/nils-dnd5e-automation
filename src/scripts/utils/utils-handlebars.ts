import { MemoryStorageService } from "../service/memory-storage-service";
import { staticValues } from "../static-values";
import { UtilsDocument } from "./utils-document";

interface BlockHelperOptions {
  fn: (argThis: any) => any;
  inverse: (argThis: any) => any
};
interface InlineHelperOption {
  blockParams: any;
  data: {[key: string]: any, root: any};
  hash: any;
  loc: {
    start: {line: number, column: number};
    end: {line: number, column: number};
  };
  lookupProperty: (a: any, b: any) => any
  name: string;
};
type Options = BlockHelperOptions | InlineHelperOption;

export class UtilsHandlebars {

  public static concat(...args: any[]): string {
    // The last argument is a handlebars object which i dont care about
    args = args.slice(0, args.length - 1);
    return args.join('');
  }

  private static hasPermissionCheck(secretFilters: string[]): boolean {
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

    return matchesFilter;
  }

  public static hasPermission(...args: any[]): any {
    const secretFilters: string[] = args.slice(0, args.length - 1);
    const options: Options = args[args.length - 1];
    const matchesFilter = UtilsHandlebars.hasPermissionCheck(secretFilters);
    
    if (!UtilsHandlebars.isBlockHelper(options)) {
      return matchesFilter;
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
    const matchesFilter = !UtilsHandlebars.hasPermissionCheck(secretFilters);
    console.log('missingPermission', {
      secretFilters,
      options,
      matchesFilter,
      blockHelper: UtilsHandlebars.isBlockHelper(options)
    })
    
    if (!UtilsHandlebars.isBlockHelper(options)) {
      return matchesFilter;
    }

    if (matchesFilter) {
      return options.fn(this);
    } else {
      return options.inverse(this);
    }
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

  private static isBlockHelper(options: any): options is BlockHelperOptions {
    return typeof options.fn === 'function' && typeof options.inverse === 'function';
  }
}