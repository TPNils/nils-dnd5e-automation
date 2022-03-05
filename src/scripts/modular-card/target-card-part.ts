import { IAfterDmlContext } from "../lib/db/dml-trigger";
import { UtilsDocument } from "../lib/db/utils-document";
import { RunOnce } from "../lib/decorator/run-once";
import { staticValues } from "../static-values";
import { ModularCard, ModularCardPartData, ModularCardTriggerData } from "./modular-card";
import { createPermissionCheck, CreatePermissionCheckArgs, HtmlContext, ICallbackAction, ModularCardPart } from "./modular-card-part";

export interface TargetCardData {
  tokenUuids: string[];
  // TODO add token cache with name and image
}

const visualStates = ['applied', 'partial-applied', 'not-applied', 'disabled'] as const;
export interface State {
  state: typeof visualStates[number];

  /**
   * The applied state to which this applies
   */
  tokenUuid: string;
}
export interface VisualState extends State {
  columns: Array<{
    /**
     * Unique key of the column where the value must be placed
     */
    key: string;
    /**
     * The non-unique label of the column
     */
    label: string;
    /**
     * The value that needs to be displayed.
     * Either a raw string or template + data
     */
    rowValue: string;
  }>;
}

export interface TargetCallbackData {
  readonly messageId: string;
  readonly messageCardParts: ModularCardPartData[];
  readonly targetUuid: string;
  readonly apply: boolean;
}

export interface StateContext {
  messageId: string;
  allMessageParts: ModularCardPartData[];
}

interface TargetIntegrationCallback {
  // TODO onChange context probably needs to change
  onChange(data: TargetCallbackData[]): void | Promise<void>;
  getState(context: StateContext): State[];
  getVisualState(context: StateContext): VisualState[] | Promise<VisualState[]>;
}

export class TargetCardPart implements ModularCardPart<TargetCardData> {

  public static readonly instance = new TargetCardPart();
  private constructor(){}
  
  public generate({}: {}): TargetCardData[] {
    return [{
      tokenUuids: Array.from(game.user.targets).map(t => t.document.uuid),
    }];
  }

  private callbacksByKey = new Map<string, TargetIntegrationCallback>();
  public register(integration: TargetIntegrationCallback): void {
    this.callbacksByKey.set(`${this.callbacksByKey.size}`, integration);
    // TODO unregister, overrides, not using a map, etc...
  }

  @RunOnce()
  public registerHooks(): void {
    ModularCard.registerModularCardPart(staticValues.moduleName, TargetCardPart.instance);
  }

  public getType(): string {
    return this.constructor.name;
  }

  public async getHtml(context: HtmlContext<TargetCardData>): Promise<string> {
    const stateContext: StateContext = {
      messageId: context.messageId,
      allMessageParts: context.allMessageParts,
    };
    const fetchedVisualStates: Promise<VisualState[]>[] = [];
    for (const integration of this.callbacksByKey.values()) {
      if (!integration.getVisualState) {
        continue;
      }

      const visualState = integration.getVisualState(stateContext);
      if (visualState instanceof Promise) {
        fetchedVisualStates.push(visualState);
      } else {
        fetchedVisualStates.push(Promise.resolve(visualState));
      }
    }
    
    const columnsByKey = new Map<string, {label: string}>();
    const columnKeyOrder: string[] = [];
    const tokenData = new Map<string, {state: VisualState['state'], columnData: Map<string, string>}>();
    for (const visualState of await Promise.all(fetchedVisualStates).then(states => states.deepFlatten())) {
      if (!visualState?.tokenUuid) {
        continue;
      }

      if (!tokenData.has(visualState.tokenUuid)) {
        tokenData.set(visualState.tokenUuid, {state: visualState.state, columnData: new Map()});
      }
      const currentData = tokenData.get(visualState.tokenUuid);
      const strictestVisualStateIndex = [visualStates.indexOf(currentData.state), visualStates.indexOf(visualState.state)].sort()[1];
      currentData.state = visualStates[strictestVisualStateIndex];

      if (Array.isArray(visualState.columns)) {
        for (const column of visualState.columns) {
          if (!columnsByKey.has(column.key)) {
            columnsByKey.set(column.key, {label: column.label});
            columnKeyOrder.push(column.key);
          }

          currentData.columnData.set(column.key, column.rowValue);
        }
      }
    }

    const htmlTableHeader: string[] = [];
    for (const key of columnKeyOrder) {
      htmlTableHeader.push(columnsByKey.get(key).label);
    }
    const htmlTableBody: Array<{tokenUuid: string, name: string, state: VisualState['state'], row: string[]}> = [];
    const tokens = Array.from((await UtilsDocument.tokenFromUuid(tokenData.keys())).values());
    for (const token of tokens.sort((a, b) => a.name.localeCompare(b.name))) {
      const row: string[] = [];
      for (const key of columnKeyOrder) {
        row.push(tokenData.get(token.uuid).columnData.get(key) ?? '');
      }
      htmlTableBody.push({
        tokenUuid: token.uuid,
        name: token.name,
        state: tokenData.get(token.uuid).state,
        row: row,
      });
    }

    console.log('parthtml', {
      tableHeader: htmlTableHeader,
      tableBody: htmlTableBody,
      fetchedVisualStates: await Promise.all(fetchedVisualStates)
    })

    return renderTemplate(
      `modules/${staticValues.moduleName}/templates/modular-card/target-part.hbs`, {
        data: {
          tableHeader: htmlTableHeader,
          tableBody: htmlTableBody,
        },
        moduleName: staticValues.moduleName
      }
    );
  }

  public getCallbackActions(): ICallbackAction<TargetCardData>[] {
    return [
      {
        regex: /^apply-((?:[a-zA-Z0-9\.]+)|\*)$/,
        permissionCheck: createPermissionCheck<TargetCardData>(({data, regexResult, messageId, allCardParts}) => {
          const documents: CreatePermissionCheckArgs['documents'] = [];
          for (const uuid of this.getTokenUuids([regexResult[1]], data, messageId, allCardParts)) {
            documents.push({uuid: uuid, permission: 'OWNER', security: true});
          }
          return {documents: documents};
        }),
        execute: ({regexResult, data, messageId, allCardParts}) => this.apply([regexResult[1]], data, messageId, allCardParts),
      },
      {
        regex: /^undo-((?:[a-zA-Z0-9\.]+)|\*)$/,
        permissionCheck: createPermissionCheck<TargetCardData>(({data, regexResult, messageId, allCardParts}) => {
          const documents: CreatePermissionCheckArgs['documents'] = [];
          for (const uuid of this.getTokenUuids([regexResult[1]], data, messageId, allCardParts)) {
            documents.push({uuid: uuid, permission: 'OWNER', security: true});
          }
          return {documents: documents};
        }),
        execute: ({regexResult, data, messageId, allCardParts}) => this.undo([regexResult[1]], data, messageId, allCardParts),
      }
    ];
  }

  private async apply(requestUuids: (string | '*')[], data: TargetCardData, messageId: string, allCardParts: ModularCardPartData[]): Promise<void> {
    const callbackData: TargetCallbackData[] = this.getTokenUuids(requestUuids, data, messageId, allCardParts).map(uuid => ({
      messageId: messageId,
      messageCardParts: allCardParts,
      targetUuid: uuid,
      apply: true,
    }));

    for (const integration of this.callbacksByKey.values()) {
      if (integration.onChange) {
        const response = integration.onChange(callbackData);
        if (response instanceof Promise) {
          await response;
        }
      }
    }
  }

  private async undo(requestUuids: (string | '*')[], data: TargetCardData, messageId: string, allCardParts: ModularCardPartData[]): Promise<void> {
    const callbackData: TargetCallbackData[] = this.getTokenUuids(requestUuids, data, messageId, allCardParts).map(uuid => ({
      messageId: messageId,
      messageCardParts: allCardParts,
      targetUuid: uuid,
      apply: false,
    }));

    for (const integration of this.callbacksByKey.values()) {
      if (integration.onChange) {
        const response = integration.onChange(callbackData);
        if (response instanceof Promise) {
          await response;
        }
      }
    }
  }

  private getTokenUuids(requestUuids: (string | '*')[], data: TargetCardData, messageId: string, allMessageParts: ModularCardPartData[]): string[] {
    const allTokenUuids = new Set<string>();
    const stateContext: StateContext = {messageId: messageId, allMessageParts: allMessageParts}
    for (const tokenUuid of data.tokenUuids) {
      allTokenUuids.add(tokenUuid);
    }
    for (const integration of this.callbacksByKey.values()) {
      for (const state of integration.getState(stateContext)) {
        if (state.state === 'disabled') {
          continue;
        }
        allTokenUuids.add(state.tokenUuid);
      }
    }
    
    if (requestUuids.includes('*')) {
      return Array.from(allTokenUuids);
    } else {
      return requestUuids.filter(uuid => allTokenUuids.has(uuid));
    }
  }

  public upsert(context: IAfterDmlContext<ModularCardTriggerData<any>>): void | Promise<void> {
    
  }

}
