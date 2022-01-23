import { MemoryStorageService } from "../service/memory-storage-service";
import { staticValues } from "../static-values";
import { MyActor, MyActorData, SpellData } from "../types/fixed-types";
import { ItemCardItem } from "./utils-chat-message";
import { UtilsDocument } from "../lib/db/utils-document";

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

  private static documentPermission = /(actor)?(exact)?(owner|observer|limited|none)(uuid|id):(.*)/i;
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
        if (documentMatch[5].length === 0) {
          // No uuid/id = don't need permissions
          return true;
        }
        let document: foundry.abstract.Document<any, any>;
        if (documentMatch[4].toLocaleLowerCase() === 'uuid') {
          document = UtilsDocument.fromUuid(documentMatch[5], {sync: true});
        } else {
          switch (documentMatch[1].toLocaleLowerCase()) {
            // Don't support token owner filter. They are too short lived and are based on actor anyway
            case 'actor': {
              document = game.actors.get(documentMatch[5]);
              break;
            }
          }
        }
        if (document == null) {
          // always show missing/invalid/deleted/null actors for gms
          return game.user.isGM;
        }

        if (document.testUserPermission(game.user, CONST.ENTITY_PERMISSIONS[documentMatch[3].toLocaleLowerCase().toUpperCase()], {exact: documentMatch[2] != null})) {
          return true;
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

  public static translateUsage(usage: ItemCardItem['consumeResources'][number]): string {
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

  public static isMaxRoll(...args: [ReturnType<Roll['toJSON']>, Options]): any
  public static isMaxRoll(...args: [ReturnType<Roll['toJSON']>, boolean, Options]): any
  public static isMaxRoll(...args: [ReturnType<Roll['toJSON']>, boolean, number, Options]): any
  public static isMaxRoll(...args: any[]): any {
    let roll: ReturnType<Roll['toJSON']> = args[0];
    let options: Options = args[args.length - 1];
    let highlightTotalOnFirstTerm = false;
    let overrideMaxRoll: number;
    if (args.length >= 3) {
      highlightTotalOnFirstTerm = Boolean(args[1]);
    }
    if (args.length >= 4) {
      overrideMaxRoll = Number(args[2]);
    }
    let max = true;
    let hasDie = false;

    for (const term of roll.terms as Array<RollTerm & DiceTerm.TermData & {class: string}>) {
      if (term.class === 'Die') {
        hasDie = true;
        for (const result of term.results) {
          if (result.active && result.result < (overrideMaxRoll ?? term.faces)) {
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

  public static isMinRoll(...args: [ReturnType<Roll['toJSON']>, Options]): any
  public static isMinRoll(...args: [ReturnType<Roll['toJSON']>, boolean, Options]): any
  public static isMinRoll(...args: [ReturnType<Roll['toJSON']>, boolean, number, Options]): any
  public static isMinRoll(...args: any[]): any {
    let roll: ReturnType<Roll['toJSON']> = args[0];
    let options: Options = args[args.length - 1];
    let highlightTotalOnFirstTerm = false;
    let minRoll = 1;
    if (args.length === 3) {
      highlightTotalOnFirstTerm = Boolean(args[1]);
    }
    if (args.length === 4) {
      minRoll = Number(args[2]);
    }
    let min = true;
    let hasDie = false;

    for (const term of roll.terms as Array<RollTerm & DiceTerm.TermData & {class: string}>) {
      if (term.class === 'Die') {
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

  public static registerHooks(): void {
    Hooks.on("init", () => {
      Handlebars.registerHelper(`${staticValues.code}Concat`, UtilsHandlebars.concat);
      Handlebars.registerHelper(`${staticValues.code}Perm`, UtilsHandlebars.hasPermission);
      Handlebars.registerHelper(`${staticValues.code}MisPerm`, UtilsHandlebars.missingPermission);
      Handlebars.registerHelper(`${staticValues.code}Expr`, UtilsHandlebars.expression);
      Handlebars.registerHelper(`${staticValues.code}CardCollapse`, UtilsHandlebars.isCardCollapse);
      Handlebars.registerHelper(`${staticValues.code}TranslateUsage`, UtilsHandlebars.translateUsage);
      Handlebars.registerHelper(`${staticValues.code}Math`, UtilsHandlebars.math);
      Handlebars.registerHelper(`${staticValues.code}Capitalize`, UtilsHandlebars.capitalize);
      Handlebars.registerHelper(`${staticValues.code}SpellLevels`, UtilsHandlebars.spellLevels);
      Handlebars.registerHelper(`${staticValues.code}IsMinRoll`, UtilsHandlebars.isMinRoll);
      Handlebars.registerHelper(`${staticValues.code}IsMaxRoll`, UtilsHandlebars.isMaxRoll);
    });
  }

  private static isBlockHelper(options: any): options is BlockHelperOptions {
    return typeof options.fn === 'function' && typeof options.inverse === 'function';
  }
}