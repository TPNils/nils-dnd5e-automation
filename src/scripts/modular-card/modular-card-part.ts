import { ITrigger } from "../lib/db/dml-trigger";
import { UtilsDocument } from "../lib/db/utils-document";
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
    permission: keyof typeof foundry.CONST.ENTITY_PERMISSIONS,
    /** 
     * if false or not defined, this permissions is used to determen if this action can run local or must be run by the gm 
     * if true, it will be used to prevent the action
     */
    security?: boolean
  }>;
  mustBeGm?: boolean;
}

export function createPermissionCheck<T>(args: CreatePermissionCheckArgs | (({}: ActionParam<T>) => PromiseOrSync<CreatePermissionCheckArgs>)): ActionPermissionCheck<T> {
  return async (action) => {
    const {mustBeGm, documents} = typeof args === 'function' ? await args(action) : args;
    const user = game.users.get(action.userId);
    let successAction: 'can-run-local' | 'can-run-as-gm' = 'can-run-local';
    if (user.isGM) {
      // GM can do anything
      return 'can-run-local';
    }
    if (mustBeGm === true && !user.isGM) {
      return 'prevent-action';
    }
    if (Array.isArray(documents)) {
      const documentsByUuid = await UtilsDocument.fromUuid(documents.map(d => d.uuid));
      for (const document of documents) {
        if (!documentsByUuid.get(document.uuid).testUserPermission(user, document.permission)) {
          if (document.security === true) {
            return 'prevent-action';
          } else {
            successAction = 'can-run-as-gm';
          }
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
}

export interface ModularCardPart<D = any> extends ITrigger<ModularCardTriggerData> {
  getType(): string;
  getHtml(context: HtmlContext<D>): string | Promise<string>;
  getCallbackActions(): ICallbackAction<D>[];
}