import { staticValues } from "../static-values";
import { PermissionCheck, UtilsDocument } from "../lib/db/utils-document";
import { RollData, UtilsRoll } from "../lib/roll/utils-roll";
import { ResourceCardData } from "../modular-card/base/index";

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

  private static documentPermission = /^(.+?)(uuid|actorid):(.*)/i;
  private static hasPermissionCheck(secretFilters: string[]): boolean {
    // no filters = always visible
    if (secretFilters.length === 0) {
      return true;
    }

    const permissionChecks: PermissionCheck[] = [];
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
        const matchType = documentMatch[2].toLowerCase();
        const matchValue = documentMatch[3];
        let uuid: string;

        switch (matchType) {
          case 'uuid': {
            uuid = matchValue;
            break;
          }
          case 'actorid': {
            uuid = game.actors.get(matchValue).uuid;
            break;
          }
        }
        if (document == null) {
          // always show invalid parts to GM
          return game.user.isGM;
        }
        
        permissionChecks.push({
          permission: documentMatch[1],
          uuid: uuid,
          user: game.user,
        });
      }
    }

    return UtilsDocument.hasPermissions(permissionChecks, {sync: true}).find(response => response.result) != null;
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

  public static translateUsage(usage: ResourceCardData['consumeResources'][number]): string {
    const uuidParts = usage.calc$.uuid.split('.');
    const pathParts = usage.calc$.path.split('.');

    const documentName = uuidParts[uuidParts.length - 2];
    if (documentName === (Actor as any).documentName) {
      switch (pathParts[0]) {
        case 'data': {
          switch (pathParts[1]) {
            case 'attributes': {
              if (pathParts[2] === 'hp') {
                return `${game.i18n.localize('DND5E.HP')}`;
              }
            }
            case 'currency': {
              return `${game.i18n.localize('DND5E.Currency' + pathParts[2].capitalize())}`;
            }
            case 'resources': {
              if (pathParts[3] === 'value') {
                const actor = UtilsDocument.actorFromUuid(usage.calc$.uuid, {sync: true});
                if (actor?.data?.data?.resources[pathParts[2]].label) {
                  return actor.data.data.resources[pathParts[2]].label;
                }
                return `${game.i18n.localize('DND5E.Resource' + pathParts[2].capitalize())}`;
              }
            }
            case 'spells': {
              let spellLevel;
              if (pathParts[2] === 'pact') {
                spellLevel = game.i18n.localize('DND5E.PactMagic');
              } else {
                spellLevel = pathParts[2].substring(5);
              }
              return `${game.i18n.localize('DND5E.SpellLevel')}: ${spellLevel}`;
            }
          }
        }
      }
    } else if (documentName === (Item as any).documentName) {
      const item = UtilsDocument.itemFromUuid(usage.calc$.uuid, {sync: true});
      if (item) {
        return item.name;
      }
    }

    return usage.calc$.path;
  }

  public static math(...args: any[]): number {
    const parts: string[] = args.slice(0, args.length - 1);
    return new Roll(parts.join(' ')).roll({async: false}).total;
  }

  public static isMaxRoll(...args: [RollData | Roll, Options]): any
  public static isMaxRoll(...args: [void, boolean, Options]): any
  public static isMaxRoll(...args: [RollData | Roll, boolean, number, Options]): any
  public static isMaxRoll(...args: any[]): any {
    let roll = args[0] as RollData | Roll;
    if (!(roll instanceof Roll)) {
      roll = UtilsRoll.fromRollData(roll);
    }
    let options: Options = args[args.length - 1];
    let highlightTotalOnFirstTerm = false;
    let overrideMaxRoll: number;
    if (args.length >= 3 && args[1] != null) {
      highlightTotalOnFirstTerm = Boolean(args[1]);
    }
    if (args.length >= 4 && args[2] != null) {
      overrideMaxRoll = Number(args[2]);
    }
    let max = true;
    let hasDie = false;

    for (const term of roll.terms) {
      if (term instanceof Die) {
        hasDie = true;
        for (const result of term.results) {
          if (result.active && result.result < (overrideMaxRoll ?? (term as DiceTerm.Data).faces)) {
            max = false;
            break;
          }
        }
        if (highlightTotalOnFirstTerm) {
          break;
        }
      }
    }

    const matches = hasDie && max;
    
    if (!UtilsHandlebars.isBlockHelper(options)) {
      return matches;
    }

    if (matches) {
      return options.fn(this);
    } else {
      return options.inverse(this);
    }
  }

  public static isMinRoll(...args: [RollData | Roll, Options]): any
  public static isMinRoll(...args: [RollData | Roll, boolean, Options]): any
  public static isMinRoll(...args: [RollData | Roll, boolean, number, Options]): any
  public static isMinRoll(...args: any[]): any {
    let roll = args[0] as RollData | Roll;
    if (!(roll instanceof Roll)) {
      roll = UtilsRoll.fromRollData(roll);
    }
    let options: Options = args[args.length - 1];
    let highlightTotalOnFirstTerm = false;
    let minRoll = 1;
    if (args.length >= 3 && args[1] != null) {
      highlightTotalOnFirstTerm = Boolean(args[1]);
    }
    if (args.length >= 4 && args[2] != null) {
      minRoll = Number(args[2]);
    }
    let min = true;
    let hasDie = false;

    for (const term of roll.terms) {
      if (term instanceof Die) {
        hasDie = true;
        for (const result of term.results) {
          if (result.active && result.result > minRoll) {
            min = false;
            break;
          }
        }
        if (highlightTotalOnFirstTerm) {
          break;
        }
      }
    }

    const matches = hasDie && min;
    
    if (!UtilsHandlebars.isBlockHelper(options)) {
      return matches;
    }

    if (matches) {
      return options.fn(this);
    } else {
      return options.inverse(this);
    }
  }

  public static capitalize(value: string): string {
    if (typeof value !== 'string') {
      return value;
    }
    return value.toLocaleLowerCase().capitalize();
  }

  public static getSetting(settingName: string): any {
    return game.settings.get(staticValues.moduleName, settingName);
  }

  public static toJsonString(value: any): string {
    return JSON.stringify(value);
  }

  public static registerHooks(): void {
    Hooks.on("init", () => {
      Handlebars.registerHelper(`${staticValues.code}Concat`, UtilsHandlebars.concat);
      Handlebars.registerHelper(`${staticValues.code}Perm`, UtilsHandlebars.hasPermission);
      Handlebars.registerHelper(`${staticValues.code}MisPerm`, UtilsHandlebars.missingPermission);
      Handlebars.registerHelper(`${staticValues.code}Expr`, UtilsHandlebars.expression);
      Handlebars.registerHelper(`${staticValues.code}TranslateUsage`, UtilsHandlebars.translateUsage);
      Handlebars.registerHelper(`${staticValues.code}Math`, UtilsHandlebars.math);
      Handlebars.registerHelper(`${staticValues.code}Capitalize`, UtilsHandlebars.capitalize);
      Handlebars.registerHelper(`${staticValues.code}Setting`, UtilsHandlebars.getSetting);
      Handlebars.registerHelper(`${staticValues.code}IsMinRoll`, UtilsHandlebars.isMinRoll);
      Handlebars.registerHelper(`${staticValues.code}IsMaxRoll`, UtilsHandlebars.isMaxRoll);
      Handlebars.registerHelper(`${staticValues.code}ToJsonString`, UtilsHandlebars.toJsonString);
    });
  }

  private static isBlockHelper(options: any): options is BlockHelperOptions {
    return typeof options.fn === 'function' && typeof options.inverse === 'function';
  }

}