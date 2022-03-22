import { RunOnce } from "../lib/decorator/run-once";
import { MemoryStorageService } from "../service/memory-storage-service";
import { staticValues } from "../static-values";
import { MyActor } from "../types/fixed-types";
import { createElement, ICallbackAction } from "./card-part-element";
import { ModularCard } from "./modular-card";
import { createPermissionCheck, CreatePermissionCheckArgs, HtmlContext, ModularCardCreateArgs, ModularCardPart } from "./modular-card-part";

interface CheckCardData {
  ability: keyof MyActor['data']['data']['abilities'];
  dc: number;
  label?: string;
  skill?: string;
  iSave?: boolean;
  calc$: {
    
  }
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

  public getElementHtml(context: HtmlContext<CheckCardData>): string | Promise<string> {
    return renderTemplate(
      `modules/${staticValues.moduleName}/templates/modular-card/check-part.hbs`, {
        data: context.data,
      }
    );
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

}