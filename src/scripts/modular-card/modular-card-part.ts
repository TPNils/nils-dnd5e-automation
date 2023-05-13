import { PermissionCheck, UtilsDocument } from "../lib/db/utils-document";
import { MaybeAsyncWrapper } from "../lib/utils/maybe-async-wrapper";
import { ValueProvider, ValueReader } from "../provider/value-provider";
import { MyActor, MyItem } from "../types/fixed-types";
import { ChatPartIdData } from "./item-card-helpers";
import { ModularCardInstance } from "./modular-card";

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

export type ValueReaderOrPromiseOrSync<T> = T | Promise<T> | ValueReader<T>;

export type PermissionResponse = 'can-run-local' | 'can-run-as-gm' | 'prevent-action';
export type ActionPermissionCheck<T = unknown> = ({}: ChatPartIdData & T, user: User) => ValueReaderOrPromiseOrSync<PermissionResponse>;
export type ActionPermissionCheckValueReader<T = unknown> = ({}: ChatPartIdData & T, user: User) => ValueReader<PermissionResponse>;
export function createPermissionCheckAction<T = unknown>(args: CreatePermissionCheckArgs | (({}: ChatPartIdData & T) => ValueReaderOrPromiseOrSync<CreatePermissionCheckArgs>)): ActionPermissionCheckValueReader<T> {
  return (action, user) => {
    const returnValue = new MaybeAsyncWrapper(typeof args === 'function' ? args(action) : args)
    .then(({mustBeGm, documents, updatesMessage}) => {
      let successAction: PermissionResponse = 'can-run-local';
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
      return {
        permissionChecks,
        successAction
      };
    }).then(data => {
      if (typeof data === 'string') {
        return data;
      }
      return ValueReader.mergeObject({
        checkResults: UtilsDocument.hasPermissions(data.permissionChecks),
        successAction: data.successAction,
      })
    }).then(data => {
      if (typeof data === 'string') {
        return data;
      }
      let successAction = data.successAction;

      for (const checkResult of data.checkResults) {
        if (!checkResult.result) {
          if (checkResult.requestedCheck.meta.security) {
            return 'prevent-action';
          } else {
            successAction = 'can-run-as-gm';
          }
        }
      }
      return successAction;
    }).getValue();

    if (returnValue instanceof Promise) {
      return ValueReader.fromPromise(returnValue);
    } else if (returnValue instanceof ValueReader) {
      return returnValue;
    }
    return new ValueProvider(returnValue);
    
  }
}

export interface ModularCardCreateArgs {
  item: MyItem;
  actor?: MyActor;
  token?: TokenDocument;
}

export interface HtmlContext<T = any> {
  messageId: string;
  subType?: string;
  data: T;
  allMessageParts: ModularCardInstance;
}

type PromiseOrSync<T> = T | Promise<T>;
export interface ModularCardPart<D = any> {
  getType(): string; // TODO getType should be static => use as param when registering
  create(args: ModularCardCreateArgs): PromiseOrSync<D>;
  refresh(data: D, args: ModularCardCreateArgs): PromiseOrSync<D>;
  getHtml?(data: HtmlContext<D>): PromiseOrSync<string | null>;
}