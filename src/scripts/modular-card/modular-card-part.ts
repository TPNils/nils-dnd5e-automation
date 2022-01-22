import { UtilsDocument } from "../lib/db/utils-document";
import { ModularCard } from "./modular-card";

export interface ClickEvent {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}
export interface KeyEvent {
  readonly key: 'Enter' | 'Escape';
}

interface ActionParamBase {
  regexResult: RegExpExecArray;
  messageId: string;
  cardParts: ModularCardPart<any>[];
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

export type ActionParam = ActionParamBase & Partial<ActionParamClick> & Partial<ActionParamKey>;

type PromiseOrSync<T> = T | Promise<T>;
type ActionPermissionCheck = ({}: ActionParam) => PromiseOrSync<'can-run-local' | 'can-run-as-gm' | 'prevent-action'>;
type ActionPermissionExecute = ({}: ActionParam) => PromiseOrSync<void>;

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

export function createPermissionCheck(args: CreatePermissionCheckArgs | (() => PromiseOrSync<CreatePermissionCheckArgs>)): ActionPermissionCheck {
  return async ({userId}) => {
    const {mustBeGm, documents} = typeof args === 'function' ? await args() : args;
    const user = game.users.get(userId);
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

export interface ICallbackAction {
  regex: RegExp;
  permissionCheck?: ActionPermissionCheck;
  execute: ActionPermissionExecute;
}

export interface IModularCardPartProvider<D, T extends ModularCardPart<D>> {
  getType(): string;
  serialize(part: T): {id: string, data: D};
  deserialize({}: {id: string, data: D}): T;
}

export abstract class ModularCardPart<D = any> {
  constructor(
    private readonly id: string,
    protected readonly data: D,
  ) {}

  /**
   * @returns An id which is unique <b>within the modular card</b>
   */
  public getId(): string {
    return this.id;
  }
  public abstract getType(): string;
  public abstract getHtml(): string | Promise<string>;
  public abstract getCallbackActions(): ICallbackAction[];
  public afterCardInit(modularCard: ModularCard): void | Promise<void> {
  }
}