import { provider } from "../provider/provider";
import { ValueReader } from "../provider/value-provider";
import { staticValues } from "../static-values";
import { ChatPartIdData } from "./item/item-card-helpers";
import { ActionPermissionCheck } from "./modular-card-part";

type ServerResponse<T> = {success: true; response: T} | {success: false; errorMessage: any[], stackTrace?: string[], errorType: 'warn' | 'error'};

export interface ActionResponse<ClientData, ServerData, R> {
  client: (data: ClientData) => Promise<ServerResponse<R>>;
  server: (data: ServerData, userId: string) => Promise<ServerResponse<R>>;
}

/* Using this symbol as a security measure to prevent full GM access */
const runningLocalSymbol = Symbol('runningLocal');
export type PermissionCheckResult = 'can-run-local' | 'can-run-as-gm' | 'prevent-action';
export class Action<ClientData, ServerData = {user: User}> {

  constructor(private readonly name: string){}

  private serializerFuncs: Array<(args: ClientData) => any> = [];
  /**
   * <b>Optional*</b>
   * <p>At least 1 serializer would be required if you wish to enable 'can-run-as-gm' from the permission support</p>
   * The serializer should gather all the data of _this_ instance and transform it into
   * input data which can be processed in the _global_ context
   * The return values of all serializers will be combined, passed to the enrichers and then passed to the permission check and execute.
   * The serialized data should contain the minimum data and use lookups to records.
   * 
   * Also see enricher
   * 
   * @param serializerFunc function to transform the event to input data
   * @returns this
   */
  public addSerializer<T extends object>(serializerFunc: (args: ClientData) => T): Action<ClientData, T & ServerData> {
    this.serializerFuncs.push(serializerFunc);
    return this as Action<ClientData, any>;
  }

  private enricherFuncs: Array<(serializedData: ServerData) => any> = [];
  /**
   * <b>Optional</b>
   * The serialized data contains the bare minimum.
   * To help the permission check and execute,
   * 
   * @param enricher function which return data which should be extended to the serialized data
   * @returns {this}
   */
  public addEnricher<T extends object>(enricher: (serializedData: ServerData) => T | Promise<T>): Action<ClientData, T & ServerData> {
    this.enricherFuncs.push(enricher);
    return this as Action<ClientData, any>;
  }

  private permissionCheckFunc: ActionPermissionCheck<ServerData>;
  /**
   * <b>Optional</b>
   * Validate if the user is allowed to execute this action
   * 
   * @param permissionCheckFunc function which will do the permission check
   * @returns this
   */
  public setPermissionCheck(permissionCheckFunc: ActionPermissionCheck<ServerData>): this {
    this.permissionCheckFunc = permissionCheckFunc;
    return this;
  }

  public build<R = any>(serverExecutor: (data: ServerData) => R | Promise<R>): (data: ClientData) => Promise<R> {
    const callbackId = Action.getNextCallbackId(this.name);
    const server = async (serializedData: ServerData, userId: string | typeof runningLocalSymbol): Promise<ServerResponse<R>> => {
      const user = userId === runningLocalSymbol ? game.user : game.users.get(userId);
      try {
        if (user.isGM && userId !== runningLocalSymbol) {
          throw new Error('Security alert, someone is trying to impersonate a GM.');
        }
        
        let enrichedData = deepClone(serializedData) as ServerData & {user: User};
        for (const enricher of this.enricherFuncs) {
          // await in loop => wait before the next is called as it might depend on the previous enriched data
          enrichedData = {...enrichedData, ...await enricher(enrichedData)};
        }
        enrichedData.user = user;
        
        if (this.permissionCheckFunc && !user.isGM) {
          let permissionResponse = await this.permissionCheckFunc(enrichedData as typeof enrichedData & ChatPartIdData, user);
          if (permissionResponse instanceof ValueReader) {
            permissionResponse = await permissionResponse.firstPromise();
          }
          if (permissionResponse === 'can-run-local' || (permissionResponse === 'can-run-as-gm' && game.user.isGM)) {
            const response = await serverExecutor(enrichedData);
            return {success: true, response: response};
          } else if (permissionResponse === 'can-run-as-gm') {
            return provider.getSocket().then(socket => socket.executeAsGM(callbackId, {data: serializedData, userId: game.userId}));
          } else {
            return {success: false, errorType: 'warn', errorMessage: [`Missing permission for action ${this.name}. Data:`, enrichedData]};
          }
        } else {
          const response = await serverExecutor(enrichedData);
          return {success: true, response: response};
        }


      } catch (err) {
        if (user.id === game.userId) {
          throw err;
        }
        if (err instanceof Error) {
          return {
            success: false,
            errorMessage: [err.message],
            stackTrace: err.stack.split('\n'),
            errorType: 'error'
          }
        } else if (Action.isExecuteResponse(err)) {
          return err;
        } else {
          return {
            success: false,
            errorMessage: [String(err)],
            errorType: 'error'
          }
        }
      }
    }
    
    provider.getSocket().then(socket => {
      socket.register(`${callbackId}`, async serializedData => {
        return await server(serializedData.data, serializedData.userId)
      });
    });
    
    const client = async (data: ClientData): Promise<R> => {
      let serializedData = {} as ServerData;
      if (this.serializerFuncs.length > 0) {
        serializedData = this.serializerFuncs[0](data);
        for (let i = 1; i < this.serializerFuncs.length; i++) {
          serializedData = {...serializedData, ...this.serializerFuncs[i](data)}
        }
      }

      const response = await server(serializedData, runningLocalSymbol);
      if (response.success === true) {
        return response.response;
      }

      const notificationType = response.errorType === 'error' ? ui.notifications.error : ui.notifications.warn;
      notificationType.call(ui.notifications, response.errorMessage.join('\n'));
      throw new Error(response.errorMessage.join('\n') + '\n\nStack:\n' + response.stackTrace);
    }

    return client;
  }

  private static nextCallbackIds = new Map<string, number>();
  private static getNextCallbackId(name: string): string {
    if (!Action.nextCallbackIds.has(name)) {
      Action.nextCallbackIds.set(name, 0);
    }
    const id = Action.nextCallbackIds.get(name);
    Action.nextCallbackIds.set(name, id+1);
    return `${staticValues.moduleName}-${name}-${id}`;
  }

  private static isExecuteResponse(value: any): value is ServerResponse<any> {
    if (typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }
  
    if (value.success === true) {
      return true;
    }
    if (value.errorType === 'error' || value.errorType === 'warn') {
      return true;
    }
    return false;
  }

}