import { MemoryStorageService } from "../service/memory-storage-service";
import { staticValues } from "../static-values";
import { MyActor, MyActorData, SpellData } from "../types/fixed-types";
import { UtilsDocument } from "./utils-document";

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
interface BlockHelperOptions extends InlineHelperOption {
  fn: (argThis: any) => any;
  inverse: (argThis: any) => any
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
    if (secretFilters.length === 0) {
      return true;
    }

    for (const filter of secretFilters) {
      if ((filter.toLowerCase() === 'gm' || filter.toLowerCase() === 'dm') && game.user.isGM) {
        return true;
      }
      if (filter.toLowerCase() === 'player' && !game.user.isGM) {
        return true;
      }
      if (filter.toLowerCase().startsWith('user:') && filter.substring(5) === game.userId) {
        return true;
      }
      const documentMatch = UtilsHandlebars.documentPermission.exec(filter);
      if (documentMatch) {
        switch (documentMatch[1].toLocaleLowerCase()) {
          // Don't support token owner filter. They are too short lived and are based on actor anyway
          case 'actor': {
            let actor: MyActor;
            if (documentMatch[4].toLocaleLowerCase() === 'uuid') {
              actor = UtilsDocument.actorFromUuid(documentMatch[5], {sync: true});
            } else {
              game.actors.get(documentMatch[5]);
            }
            // always show missing/invalid/deleted/null actors for gms
            if (actor == null && game.user.isGM) {
              return true;
            } else {
              const exactMatch = documentMatch[2] != null;
              if (actor.testUserPermission(game.user, CONST.ENTITY_PERMISSIONS[documentMatch[3].toLocaleLowerCase().toUpperCase()], exactMatch)) {
                return true;
              }
            }
            break;
          }
        }
      }
    }

    return false;
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

  public static expressionCheck(v1: any, operator: string, v2: any): boolean {
    switch (operator) {
        case '==':
            return v1 == v2;
        case '===':
            return v1 === v2;
        case '!=':
            return v1 != v2;
        case '!==':
            return v1 !== v2;
        case '<':
            return v1 < v2;
        case '<=':
            return v1 <= v2;
        case '>':
            return v1 > v2;
        case '>=':
            return v1 >= v2;
        case '&&':
            return v1 && v2;
        case '||':
            return v1 || v2;
        default:
            return false;
    }
  }
  
  public static spellLevels(options: Options): any {
    const actor = UtilsDocument.actorFromUuid(options.hash.actorUuid, {sync: true});
    let spellLevels: {type: 'pact' | 'spell', level: number, maxSlots: number; availableSlots: number;}[] = [];

    for (const spellKey in actor.data.data.spells) {
      const spellData: SpellData = actor.data.data.spells[spellKey];
      if (spellData.max <= 0) {
        continue;
      }
      if (spellKey.startsWith('spell')) {
        spellLevels.push({
          type: 'spell',
          level: Number.parseInt(spellKey.substring(5)),
          maxSlots: spellData.max,
          availableSlots: spellData.value
        });
      } else if (spellKey === 'pact') {
        spellLevels.push({
          type: 'pact',
          level: (spellData as MyActorData['data']['spells']['pact']).level,
          maxSlots: spellData.max,
          availableSlots: spellData.value
        });
      }
    }

    // Sort pact before spell levels
    spellLevels = spellLevels.sort((a, b) => {
      let diff = a.type.localeCompare(b.type);
      if (diff) {
        return diff;
      }
      return a.level - b.level;
    });

    if (options.hash.minLevel != null) {
      spellLevels = spellLevels.filter(lvl => lvl.level >= options.hash.minLevel);
    }

    if (UtilsHandlebars.isBlockHelper(options)) {
      return options.fn(spellLevels);
    } else {
      return spellLevels;
    }
  }
  
  public static expression(v1: any, operator: string, v2: any, options: Options): any {
    const pass = UtilsHandlebars.expressionCheck(v1, operator, v2);
    
    if (!UtilsHandlebars.isBlockHelper(options)) {
      return pass;
    }

    if (pass) {
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
      Handlebars.registerHelper(`${staticValues.code}Expr`, UtilsHandlebars.expression);
      Handlebars.registerHelper(`${staticValues.code}CardCollapse`, UtilsHandlebars.isCardCollapse);
      Handlebars.registerHelper(`${staticValues.code}TranslateProperty`, UtilsHandlebars.translateProperty);
      Handlebars.registerHelper(`${staticValues.code}Math`, UtilsHandlebars.math);
      Handlebars.registerHelper(`${staticValues.code}Capitalize`, UtilsHandlebars.capitalize);
      Handlebars.registerHelper(`${staticValues.code}SpellLevels`, UtilsHandlebars.spellLevels);
    });
  }

  private static isBlockHelper(options: any): options is BlockHelperOptions {
    return typeof options.fn === 'function' && typeof options.inverse === 'function';
  }
}