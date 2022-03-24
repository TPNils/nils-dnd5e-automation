import { RollD20Element } from "../elements/roll-d20-element";
import { UtilsElement } from "../elements/utils-element";
import { RunOnce } from "../lib/decorator/run-once";
import { staticValues } from "../static-values";
import { MyActor } from "../types/fixed-types";
import { RollJson } from "../utils/utils-chat-message";
import { createElement, HtmlContext, ICallbackAction } from "./card-part-element";
import { ModularCard } from "./modular-card";
import { createPermissionCheck, CreatePermissionCheckArgs, ModularCardCreateArgs, ModularCardPart } from "./modular-card-part";

interface TargetCache {
  selectionId: string;
  targetUuid: string;
  actorUuid: string;
  
  mode: 'normal' | 'advantage' | 'disadvantage';
  phase: 'mode-select' | 'bonus-input' | 'result';
  userBonus: string;
  hasHalflingLucky: boolean;
  reliableTalent: boolean;
  roll?: RollJson;
}

export interface CheckCardData {
  ability: keyof MyActor['data']['data']['abilities'];
  dc: number;
  label?: string;
  skill?: string;
  iSave?: boolean;
  calc$: {
    targetCaches: TargetCache[];
  }
}

function getTargetCache(cache: CheckCardData, selectionId: string): TargetCache | null {
  if (!cache.calc$.targetCaches) {
    return null;
  }
  for (const targetCache of cache.calc$.targetCaches) {
    if (targetCache.selectionId === selectionId) {
      return targetCache;
    }
  }
  return null;
}

export class CheckCardPart implements ModularCardPart<CheckCardData> {

  public static readonly instance = new CheckCardPart();
  private constructor(){}
  
  public create({item, actor}: ModularCardCreateArgs): CheckCardData {
    if (!actor || item.data.data.save?.dc == null || !item.data.data.save?.ability) {
      return null;
    }

    return {
      ability: item.data.data.save?.ability,
      dc: item.data.data.save.dc,
      iSave: true,
      calc$: {
        targetCaches: []
      }
    };
  }

  public refresh(oldData: CheckCardData, args: ModularCardCreateArgs): CheckCardData {
    const newData = this.create(args);

    if (!newData) {
      return null;
    }
    if (!oldData) {
      return newData;
    }

    const result = deepClone(oldData);
    result.calc$ = newData.calc$;
    return result;
  }

  @RunOnce()
  public registerHooks(): void {
    createElement({
      selector: this.getSelector(),
      hasSubType: true,
      getHtml: context => this.getElementHtml(context),
      getCallbackActions: () => this.getCallbackActions(),
    });
    ModularCard.registerModularCardPart(staticValues.moduleName, this);
  }

  public getType(): string {
    return this.constructor.name;
  }

  //#region Front end
  public getSelector(): string {
    return `${staticValues.code}-check-part`;
  }

  public getElementHtml({data, subType}: HtmlContext<CheckCardData>): string | Promise<string> {
    const cache = getTargetCache(data, subType);
    if (!cache) {
      return '';
    }
    const attributes = {
      ['data-roll']: cache.roll,
      ['data-bonus-formula']: cache.userBonus,
      ['data-show-bonus']: cache.phase === 'bonus-input',
      ['data-compact']: true,
      ['data-label']: 'DND5E.Attack',
    };
    if (cache.actorUuid) {
      attributes['data-interaction-permission'] = `OwnerUuid:${cache.actorUuid}`
    }
    const attributeArray: string[] = [];
    for (let [attr, value] of Object.entries(attributes)) {
      attributeArray.push(`${attr}="${UtilsElement.serializeAttr(value)}"`);
    }
    return `<${RollD20Element.selector()} ${attributeArray.join(' ')}></${RollD20Element.selector()}>`
  }

  public getCallbackActions(): ICallbackAction<CheckCardData>[] {
    const permissionCheck = createPermissionCheck<CheckCardData>(({data, subType}) => {
      const documents: CreatePermissionCheckArgs['documents'] = [];
      // TODO if (data.calc$.actorUuid) {
      //   documents.push({uuid: data.calc$.actorUuid, permission: 'OWNER', security: true});
      // }
      return {documents: documents};
    })
    return [
      
    ]
  }
  //#endregion
  

  //#region Target
  //#endregion

}