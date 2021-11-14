import { MemoryStorageService } from "../service/memory-storage-service";
import { staticValues } from "../static-values";
import { MyActor } from "../types/fixed-types";
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

  private static documentPermission = /(actor)(exact)?(owner|observer|limited|none)(uuid|id):(.*)/i;
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
      const documentMatch = UtilsHandlebars.documentPermission.exec(filter);
      if (documentMatch) {
        switch (documentMatch[1].toLocaleLowerCase()) {
          case 'actor': {
            let actor: MyActor;
            if (documentMatch[4].toLocaleLowerCase() === 'uuid') {
              actor = UtilsDocument.actorFromUuid(documentMatch[5], {sync: true});
            } else {
              game.actors.get(documentMatch[5]);
            }
            // always show missing/invalid/deleted/null actors
            if (actor == null) {
              matchesFilter = true;
            } else {
              const exactMatch = documentMatch[2] != null;
              if (actor.testUserPermission(game.user, CONST.ENTITY_PERMISSIONS[documentMatch[3].toLocaleLowerCase().toUpperCase()], exactMatch)) {
                matchesFilter = true;
              }
            }
            break;
          }
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

  public static translateProperty(propertyPath: string): string {
    const parts = propertyPath.split('.');

    switch (parts[0]) {
      case 'data': {
        switch (parts[1]) {
          case 'spells': {
            let spellLevel;
            if (parts[2] === 'pact') {
              spellLevel = game.i18n.localize('DND5E.PactMagic');
            } else {
              spellLevel = parts[2].substring(5);
            }
            return `${game.i18n.localize('DND5E.SpellLevel')}: ${spellLevel}`;
          }
        }
      }
    }

    return propertyPath;
  }

  public static math(...args: any[]): number {
    const parts: string[] = args.slice(0, args.length - 1);
    return new Roll(parts.join(' ')).roll({async: false}).total;
  }

  public static capitalize(value: string): string {
    if (typeof value !== 'string') {
      return value;
    }
    return value.toLocaleLowerCase().capitalize();
  }

  public static registerHooks(): void {
    Hooks.on("init", () => {
      Handlebars.registerHelper(`${staticValues.code}Concat`, UtilsHandlebars.concat);
      Handlebars.registerHelper(`${staticValues.code}Perm`, UtilsHandlebars.hasPermission);
      Handlebars.registerHelper(`${staticValues.code}MisPerm`, UtilsHandlebars.missingPermission);
      Handlebars.registerHelper(`${staticValues.code}CardCollapse`, UtilsHandlebars.isCardCollapse);
      Handlebars.registerHelper(`${staticValues.code}TranslateProperty`, UtilsHandlebars.translateProperty);
      Handlebars.registerHelper(`${staticValues.code}Math`, UtilsHandlebars.math);
      Handlebars.registerHelper(`${staticValues.code}Capitalize`, UtilsHandlebars.capitalize);
    });
  }

  private static isBlockHelper(options: any): options is BlockHelperOptions {
    return typeof options.fn === 'function' && typeof options.inverse === 'function';
  }
}