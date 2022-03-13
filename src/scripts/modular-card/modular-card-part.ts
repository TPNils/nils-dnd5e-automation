import { ITrigger } from "../lib/db/dml-trigger";
import { PermissionCheck, UtilsDocument } from "../lib/db/utils-document";
import { MyActor, MyItem } from "../types/fixed-types";
import { ModularCardPartData, ModularCardTriggerData } from "./modular-card";

export interface ClickEvent {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}
export interface KeyEvent {
  readonly key: 'Enter' | 'Escape';
}

interface ActionParamBase<T> {
  partId: string;
  data: T;
  regexResult: RegExpExecArray;
  messageId: string;
  allCardParts: ModularCardPartData[];
  userId: string;
}

interface ActionParamClick {
  clickEvent: ClickEvent;
  inputValue: boolean | number | string
}

interface ActionParamKey {
  keyEvent: KeyEvent;
  inputValue: boolean | number | string
}

export type ActionParam<T> = ActionParamBase<T> & Partial<ActionParamClick> & Partial<ActionParamKey>;

type PromiseOrSync<T> = T | Promise<T>;
type ActionPermissionCheck<T> = ({}: ActionParam<T>) => PromiseOrSync<'can-run-local' | 'can-run-as-gm' | 'prevent-action'>;
type ActionPermissionExecute<T> = ({}: ActionParam<T>) => PromiseOrSync<void>;

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

export function createPermissionCheck<T>(args: CreatePermissionCheckArgs | (({}: ActionParam<T>) => PromiseOrSync<CreatePermissionCheckArgs>)): ActionPermissionCheck<T> {
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

export interface ICallbackAction<T> {
  regex: RegExp;
  permissionCheck?: ActionPermissionCheck<T>;
  execute: ActionPermissionExecute<T>;
}

export interface HtmlContext<T> {
  messageId: string;
  partId: string;
  data: T;
  allMessageParts: ModularCardPartData[];
}

export interface ModularCardPart<D = any> {
  getType(): string;
  generate(args: {actor?: MyActor, token?: TokenDocument, item: MyItem}): PromiseOrSync<D[]>;
  getHtml(context: HtmlContext<D>): PromiseOrSync<string>;
  getCallbackActions(): ICallbackAction<D>[];
}