import { PermissionCheck, UtilsDocument } from "../lib/db/utils-document";
import { MyActor, MyItem } from "../types/fixed-types";
import { ActionParam, ActionPermissionCheck } from "./card-part-element";
import { ModularCardPartData } from "./modular-card";

export interface CreatePermissionCheckArgs {
  documents?: Array<{
    uuid: string;
    permission: PermissionCheck['permission'],
    /** 
     * Default: false
     * if false, this permissions is used to determen if this action can run local or must be run by the gm 
     * if true, it will be used to prevent the action
     */
    security?: boolean
  }>;
  /**
   * Default: true
   * When true, this action updates the message, thus requiring the update permission
   */
  updatesMessage?: boolean;
  mustBeGm?: boolean;
}

type PromiseOrSync<T> = T | Promise<T>;
export function createPermissionCheck<T, C = any>(args: CreatePermissionCheckArgs | (({}: ActionParam<T, C>) => PromiseOrSync<CreatePermissionCheckArgs>)): ActionPermissionCheck<T, C> {
  return async (action) => {
    const {mustBeGm, documents, updatesMessage} = typeof args === 'function' ? await args(action) : args;
    const user = game.users.get(action.userId);
    let successAction: 'can-run-local' | 'can-run-as-gm' = 'can-run-local';
    if (user.isGM) {
      // GM can do anything
      return 'can-run-local';
    }
    if (mustBeGm === true && !user.isGM) {
      return 'prevent-action';
    }
    if (updatesMessage !== false) {
      if (!game.messages.get(action.messageId).canUserModify(user, 'update')) {
        successAction = 'can-run-as-gm';
      }
    }
    const permissionChecks: PermissionCheck<{security: boolean}>[] = [];
    if (updatesMessage !== false) {
      permissionChecks.push({
        uuid: game.messages.get(action.messageId).uuid,
        permission: 'update',
        user: user,
        meta: {security: false}
      })
    }
    if (Array.isArray(documents)) {
      for (const document of documents) {
        permissionChecks.push({
          uuid: document.uuid,
          permission: document.permission,
          user: user,
          meta: {security: document.security === true}
        });
      }
    }
    for (const checkResult of await UtilsDocument.hasPermissions(permissionChecks)) {
      if (!checkResult.result) {
        if (checkResult.requestedCheck.meta.security) {
          return 'prevent-action';
        } else {
          successAction = 'can-run-as-gm';
        }
      }
    }
    return successAction;
  }
}

export interface HtmlContext<T = any> {
  messageId: string;
  partId: string;
  data: T;
  allMessageParts: ModularCardPartData[];
}

export interface ModularCardCreateArgs {
  item: MyItem;
  actor?: MyActor;
  token?: TokenDocument;
}

export interface ModularCardPart<D = any> {
  getType(): string;
  create(args: ModularCardCreateArgs): PromiseOrSync<D[]>;
  refresh(data: D[],args: ModularCardCreateArgs): PromiseOrSync<D[]>;
  getHtml?(data: HtmlContext<D>): PromiseOrSync<string | null>;
}