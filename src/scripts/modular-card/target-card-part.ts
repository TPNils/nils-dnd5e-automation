import { data } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/module.mjs";
import { DmlTrigger, IAfterDmlContext, IDmlContext, IDmlTrigger, ITrigger } from "../lib/db/dml-trigger";
import { UtilsDocument } from "../lib/db/utils-document";
import { RunOnce } from "../lib/decorator/run-once";
import { UtilsCompare } from "../lib/utils/utils-compare";
import { staticValues } from "../static-values";
import { MyActor, MyItem } from "../types/fixed-types";
import { createElement, ICallbackAction } from "./card-part-element";
import { ModularCard, ModularCardPartData, ModularCardTriggerData } from "./modular-card";
import { createPermissionCheck, CreatePermissionCheckArgs, HtmlContext, ModularCardCreateArgs, ModularCardPart } from "./modular-card-part";

export interface TargetCardData {
  selectedTokenUuids: string[];
  calc$: {
    expectedTargets?: number;
    tokenData: Array<{
      tokenUuid: string;
      actorUuid: string;
      name: string;
      nameVisibleAnyone: boolean;
      img: string;
    }>
  }
}

const visualStates = ['applied', 'partial-applied', 'not-applied', 'disabled'] as const;
export interface State {
  /**
   * Indicate if the if the actions are applied.
   * null if there is nothing to apply
   */
  state?: typeof visualStates[number];

  /**
   * The applied state to which this applies
   */
  tokenUuid: string;
}
export interface VisualState extends State {
  /**
   * Indicate if the if the actions are applied by the smart state.
   * null if there is nothing to apply
   */
  smartState?: typeof visualStates[number];

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
  readonly apply: 'undo' | 'smart-apply' | 'force-apply'; // TODO 'undo' | 'smart-apply' | 'force-apply' => smart = take into account if target hit
}

export interface StateContext {
  messageId: string;
  selectedTokenUuids: string[];
  allMessageParts: ModularCardPartData[];
}

interface TargetIntegrationCallback {
  onChange?(data: TargetCallbackData[]): void | Promise<void>;
  getState?(context: StateContext): State[];
  getVisualState?(context: StateContext): VisualState[] | Promise<VisualState[]>;
}

// TODO Allow the same tokens to be targeted multiple times
//  Visualization: done
//  Interaction: Add a + & - button in the target table to increase/decrease selecting the same target multipe times
export class TargetCardPart implements ModularCardPart<TargetCardData> {

  public static readonly instance = new TargetCardPart();
  private constructor(){}
  
  public create({item, token}: {item: MyItem, token?: TokenDocument}): TargetCardData {
    const target: TargetCardData = {
      selectedTokenUuids: [],
      calc$: {
        tokenData: [],
      },
    };

    const selectedTargets: TokenDocument[] = [];
    if (item.data.data.target?.type === 'none') {
      // no selection
    } else if (item.data.data.target?.type === 'self' && token) {
      selectedTargets.push(token);
    } else {
      for (const token of game.user.targets) {
        selectedTargets.push(token.document);
      }
    }
    
    for (const token of selectedTargets) {
      target.selectedTokenUuids.push(token.uuid);
    }

    // TODO "item.data.data.target.value" does not support formulas => does not support spell scaling
    //  Solutions: hook into the sheet and add an option for target scaling
    if (item.data.data.target?.value > 0 && ['ally', 'creature', 'enemy', 'object'].includes(item.data.data.target?.type)) {
      target.calc$.expectedTargets = item.data.data.target?.value;
    }

    return target;
  }

  public refresh(data: TargetCardData, args: ModularCardCreateArgs): TargetCardData {
    return data; // There is nothing to refresh
  }

  private callbacks: TargetIntegrationCallback[] = [];
  public registerIntegration(integration: TargetIntegrationCallback): void {
    this.callbacks.push(integration);
    // TODO unregister
  }

  @RunOnce()
  public registerHooks(): void {
    createElement({
      selector: this.getSelector(),
      getHtml: context => this.getElementHtml(context),
      getCallbackActions: () => this.getCallbackActions(),
    });

    ModularCard.registerModularCardPart(staticValues.moduleName, TargetCardPart.instance);
    ModularCard.registerModularCardTrigger(new TargetCardTrigger());
    DmlTrigger.registerTrigger(new DmlTriggerUser());
  }

  public getType(): string {
    return this.constructor.name;
  }

  //#region Front end
  public getSelector(): string {
    return `${staticValues.code}-target-part`;
  }

  public getHtml(data: HtmlContext): string {
    return `<${this.getSelector()} data-part-id="${data.partId}" data-message-id="${data.messageId}"></${this.getSelector()}>`
  }

  public async getElementHtml(context: HtmlContext<TargetCardData>): Promise<string> {
    const stateContext: StateContext = {
      messageId: context.messageId,
      selectedTokenUuids: context.data.selectedTokenUuids,
      allMessageParts: context.allMessageParts,
    };
    const fetchedVisualStates: Promise<VisualState[]>[] = [];
    for (const integration of this.callbacks) {
      if (!integration.getVisualState) {
        continue;
      }

      try {
        const visualState = integration.getVisualState(stateContext);
        if (visualState instanceof Promise) {
          fetchedVisualStates.push(visualState);
        } else {
          fetchedVisualStates.push(Promise.resolve(visualState));
        }
      } catch (e) {
        console.error('Error during getVisualState()', e);
      }
    }
    
    const columnsByKey = new Map<string, {label: string}>();
    const columnKeyOrder: string[] = [];
    const tokenData = new Map<string, {state?: VisualState['state'], smartState?: VisualState['state'], columnData: Map<string, string>}>();
    for (const targetUuid of context.data.selectedTokenUuids) {
      tokenData.set(targetUuid, {columnData: new Map()});
    }
    for (const visualState of await Promise.all(fetchedVisualStates).then(states => states.deepFlatten())) {
      if (!visualState?.tokenUuid) {
        continue;
      }

      if (!tokenData.has(visualState.tokenUuid)) {
        tokenData.set(visualState.tokenUuid, {state: visualState.state, smartState: visualState.smartState, columnData: new Map()});
      }
      const currentData = tokenData.get(visualState.tokenUuid);
      {
        const strictestVisualStateIndex = [visualStates.indexOf(currentData.state), visualStates.indexOf(visualState.state)].sort()[1];
        if (strictestVisualStateIndex >= 0) {
          currentData.state = visualStates[strictestVisualStateIndex];
        }
      }
      {
        const strictestVisualStateIndex = [visualStates.indexOf(currentData.smartState), visualStates.indexOf(visualState.smartState)].sort()[1];
        if (strictestVisualStateIndex >= 0) {
          currentData.smartState = visualStates[strictestVisualStateIndex];
        }
      }

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

    if (columnsByKey.size === 0 && context.data.calc$.expectedTargets < 1) {
      return '';
    }

    const htmlTableHeader: {
      currentTargets: number;
      expectedTargets?: number;
      row: string[];
      state: VisualState['state'];
      smartState: VisualState['state'];
    } = {
      currentTargets: tokenData.size,
      expectedTargets: context.data.calc$.expectedTargets,
      row: [],
      state: 'not-applied',
      smartState: 'not-applied'
    };
    for (const key of columnKeyOrder) {
      htmlTableHeader.row.push(columnsByKey.get(key).label);
    }
    const htmlTableBody: Array<{
      tokenUuid: string;
      actorUuid: string;
      name: string;
      nameVisibleAnyone: boolean;
      img: string;
      state: VisualState['state'];
      smartState: VisualState['state'];
      row: string[];
      isPlaceholder: false;
    } | {
      isPlaceholder: true;
    }> = [];
    const tokens = context.data.calc$.tokenData
      .filter(t => tokenData.has(t.tokenUuid))
      .sort((a, b) => {
        // Since tokens are displayed with their image, group them together
        let compare = a.img.localeCompare(b.img);
        if (compare !== 0) {
          return compare;
        }

        return a.name.localeCompare(b.name);
      });
    const allStates = new Set<VisualState['state']>();
    const allSmartStates = new Set<VisualState['state']>();
    for (const token of tokens) {
      const row: string[] = [];
      for (const key of columnKeyOrder) {
        row.push(tokenData.get(token.tokenUuid).columnData.get(key) ?? '');
      }
      allStates.add(tokenData.get(token.tokenUuid).state);
      allSmartStates.add(tokenData.get(token.tokenUuid).smartState);
      htmlTableBody.push({
        tokenUuid: token.tokenUuid,
        actorUuid: token.actorUuid,
        name: token.name,
        nameVisibleAnyone: token.nameVisibleAnyone,
        img: token.img,
        state: tokenData.get(token.tokenUuid).state,
        smartState: tokenData.get(token.tokenUuid).smartState,
        row: row,
        isPlaceholder: false
      });
    }
    for (let i = htmlTableBody.length; i < context.data.calc$.expectedTargets; i++) {
      htmlTableBody.push({isPlaceholder: true});
    }
    allStates.delete(null);
    allStates.delete(undefined);
    {
      let allStatesArray = Array.from(allStates);
      // If all are disabled
      if (allStatesArray.length === 1) {
        htmlTableHeader.state = allStatesArray[0];
      }
      allStatesArray = allStatesArray.filter(state => state !== 'disabled');
      // If all are the same or disabled
      if (allStatesArray.length === 1) {
        htmlTableHeader.state = allStatesArray[0];
      } else {
        htmlTableHeader.state = 'partial-applied';
      }
    }
    
    {
      let allSmartStatesArray = Array.from(allSmartStates);
      if (allSmartStatesArray.length === 1) {
        htmlTableHeader.smartState = allSmartStates[0];
      }
      allSmartStatesArray = allSmartStatesArray.filter(state => state !== 'disabled');
      // If all are the same or disabled
      if (allSmartStatesArray.length === 1) {
        htmlTableHeader.smartState = allSmartStatesArray[0];
      } else {
        htmlTableHeader.smartState = 'partial-applied';
      }
    }

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
        regex: /^(force-apply|smart-apply|undo)-((?:[a-zA-Z0-9\.]+)|\*)$/,
        permissionCheck: createPermissionCheck<TargetCardData>(({data, regexResult, messageId, allCardParts}) => {
          if (regexResult[2] === '*') {
            // select all is filtered in the execute => always have permission for this
            return {};
          }
          const documents: CreatePermissionCheckArgs['documents'] = [];
          for (const uuid of this.getTokenUuids([regexResult[2]], data, messageId, allCardParts)) {
            documents.push({uuid: uuid, permission: 'update', security: true});
          }
          return {documents: documents};
        }),
        execute: ({regexResult, data, messageId, allCardParts, userId}) => this.fireEvent(regexResult[1] as TargetCallbackData['apply'], [regexResult[2]], data, messageId, allCardParts, userId),
      }
    ];
  }

  private async fireEvent(type: TargetCallbackData['apply'], requestUuids: (string | '*')[], data: TargetCardData, messageId: string, allCardParts: ModularCardPartData[], userId: string): Promise<void> {
    const tokenPermissions = await UtilsDocument.hasPermissions(this.getTokenUuids(requestUuids, data, messageId, allCardParts).map(uuid => ({
      uuid: uuid,
      permission: 'update',
      user: game.users.get(userId),
    })));
    
    const callbackData: TargetCallbackData[] = tokenPermissions.filter(permission => permission.result).map(permission => ({
      messageId: messageId,
      messageCardParts: allCardParts,
      targetUuid: permission.requestedCheck.uuid,
      apply: type,
    }));

    for (const integration of this.callbacks) {
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
    const stateContext: StateContext = {messageId: messageId, allMessageParts: allMessageParts, selectedTokenUuids: data.selectedTokenUuids};
    for (const tokenUuid of data.selectedTokenUuids) {
      allTokenUuids.add(tokenUuid);
    }
    for (const integration of this.callbacks) {
      if (!integration.getState) {
        continue;
      }
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
  //#endregion

}

class TargetCardTrigger implements ITrigger<ModularCardTriggerData> {

  //#region upsert
  public async upsert(context: IAfterDmlContext<ModularCardTriggerData>): Promise<void> {
    await this.calcTargetCache(context);
  }

  private async calcTargetCache(context: IAfterDmlContext<ModularCardTriggerData>): Promise<void> {
    const missingTokenCaches = new Set<string>();
    for (const {newRow} of context.rows) {
      if (!this.isTargetTriggerType(newRow)) {
        continue;
      }

      const cachedUuids = newRow.data.calc$.tokenData.map(t => t.tokenUuid);
      for (const tokenUuid of newRow.data.selectedTokenUuids) {
        if (!cachedUuids.includes(tokenUuid)) {
          missingTokenCaches.add(tokenUuid);
        }
      }
    }

    if (missingTokenCaches.size === 0) {
      return;
    }

    const tokenMap = await UtilsDocument.tokenFromUuid(missingTokenCaches);
    for (const {newRow} of context.rows) {
      if (!this.isTargetTriggerType(newRow)) {
        continue;
      }

      const cache = new Map<string, TargetCardData['calc$']['tokenData'][0]>();
      for (const entry of newRow.data.calc$.tokenData) {
        cache.set(entry.tokenUuid, entry);
      }
      for (const tokenUuid of newRow.data.selectedTokenUuids) {
        if (!cache.has(tokenUuid) && tokenMap.has(tokenUuid)) {
          const token = tokenMap.get(tokenUuid);
          cache.set(token.uuid, {
            tokenUuid: token.uuid,
            actorUuid: (token.getActor() as MyActor)?.uuid,
            name: token.data.name,
            nameVisibleAnyone: [CONST.TOKEN_DISPLAY_MODES.HOVER, CONST.TOKEN_DISPLAY_MODES.ALWAYS as number].includes(token.data.displayName),
            img: token.data.img,
          })
        }
      }

      if (cache.size !== newRow.data.calc$.tokenData.length) {
        newRow.data.calc$.tokenData = Array.from(cache.values());
      }
    }
  }
  //#endregion
  
  //#region helpers
  private isTargetTriggerType(row: ModularCardTriggerData): row is ModularCardTriggerData<TargetCardData> {
    return row.typeHandler instanceof TargetCardPart;
  }
  //#endregion

}

class DmlTriggerUser implements IDmlTrigger<User> {

  get type(): typeof User {
    return User;
  }

  public async afterUpdate(context: IDmlContext<User>): Promise<void> {
    await this.recalcTargets(context);
  }

  private async recalcTargets(context: IDmlContext<User>): Promise<void> {
    let thisUserChanged = false;
    for (const {newRow, oldRow} of context.rows) {
      if (newRow.id === game.userId) {
        // Check if targets have changed
        thisUserChanged = !UtilsCompare.deepEquals(
          Array.from(newRow.targets).map(t => t.document.uuid).sort(),
          Array.from(oldRow.targets).map(t => t.document.uuid).sort(),
        );
        break;
      }
    }
    if (!thisUserChanged) {
      return;
    }

    // Specifically the last general message, not of the user.
    // There needs to be some way of cutting off the ability to retarget when they are not relevant anymore
    // TODO this should probably be improved
    //  Idea: Provide a visual to indiate which card is selected to targets (cached on user?)
    //  Can press this visual to change card target (is this even relevant?)

    let chatMessage: ChatMessage;
    let parts: ModularCardPartData[];
    let targetData: TargetCardData;
    for (let messageIndex = game.messages.contents.length - 1; messageIndex >= 0; messageIndex--) {
      chatMessage = game.messages.contents[messageIndex];
      parts = ModularCard.getCardPartDatas(chatMessage);
      if (!parts) {
        continue;
      }
      // To allow editing, need to clone parts so its not updating the instance which is in the message itself
      // Otherwise when updating, change detection won't pick it up
      // TODO This should be improved by not updating this instance, but since saving does some custom stuff, it makes it tricky
      parts = deepClone(parts);

      targetData = parts.find(part => ModularCard.getTypeHandler(part.type) instanceof TargetCardPart)?.data;
      if (targetData) {
        break;
      }
    }

    if (!targetData || chatMessage.data.user !== game.userId) {
      return;
    }
    
    // Re-evaluate the targets, the user may have changed targets
    const currentTargetUuids = new Set<string>(Array.from(game.user.targets).map(token => token.document.uuid));

    // Assume targets did not changes when non are selected at this time
    if (currentTargetUuids.size !== 0) {
      const itemTargetUuids = new Set<string>(targetData.selectedTokenUuids);
      let targetsChanged = itemTargetUuids.size !== currentTargetUuids.size;
      
      if (!targetsChanged) {
        for (const uuid of itemTargetUuids.values()) {
          if (!currentTargetUuids.has(uuid)) {
            targetsChanged = true;
            break;
          }
        }
      }

      if (targetsChanged) {
        const targetsUuids: string[] = [];
        for (const tokenUuid of targetData.selectedTokenUuids) {
          // The same target could have been originally targeted twice, keep that amount
          if (currentTargetUuids.has(tokenUuid)) {
            targetsUuids.push(tokenUuid);
          }
        }
        for (const currentTargetUuid of currentTargetUuids) {
          if (!targetsUuids.includes(currentTargetUuid)) {
            targetsUuids.push(currentTargetUuid);
          }
        }
        targetData.selectedTokenUuids = targetsUuids;
        
        await ModularCard.setCardPartDatas(chatMessage, parts);
      }
    }
  }
  

}