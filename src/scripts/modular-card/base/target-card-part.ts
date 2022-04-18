import { ElementBuilder, ElementCallbackBuilder, OnAttributeChange } from "../../elements/element-builder";
import { DmlTrigger, ITrigger, IAfterDmlContext, IDmlTrigger, IDmlContext } from "../../lib/db/dml-trigger";
import { UtilsDocument } from "../../lib/db/utils-document";
import { RunOnce } from "../../lib/decorator/run-once";
import { Stoppable } from "../../lib/utils/stoppable";
import { UtilsCompare } from "../../lib/utils/utils-compare";
import MyAbilityTemplate from "../../pixi/ability-template";
import { staticValues } from "../../static-values";
import { MyActor, MyItemData } from "../../types/fixed-types";
import { UtilsTemplate } from "../../utils/utils-template";
import { ItemCardHelpers } from "../item-card-helpers";
import { ModularCardPartData, ModularCard, ModularCardTriggerData } from "../modular-card";
import { ModularCardPart, ModularCardCreateArgs, createPermissionCheck, CreatePermissionCheckArgs, HtmlContext } from "../modular-card-part";

export interface TargetCardData {
  selected: Array<{selectionId: string, tokenUuid: string;}>;
  calc$: {
    actorUuid?: string;
    tokenUuid?: string;
    targetDefinition?: MyItemData['data']['target'];
    rangeDefinition?: MyItemData['data']['range'];
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
  selectionId: string;
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
  readonly selected: TargetCardData['selected'][0];
  readonly apply: 'undo' | 'smart-apply' | 'force-apply';
}

export interface StateContext {
  messageId: string;
  selected: TargetCardData['selected'];
  allMessageParts: ModularCardPartData[];
}

interface TargetIntegrationCallback {
  onChange?(data: TargetCallbackData[]): void | Promise<void>;
  getState?(context: StateContext): State[];
  getVisualState?(context: StateContext): VisualState[] | Promise<VisualState[]>;
}

export function uuidsToSelected(uuids: string[]): TargetCardData['selected'] {
  const selected: TargetCardData['selected'] = [];
  const indexByUuids = new Map<string, number>();
  for (const uuid of uuids) {
    const idIndex = (indexByUuids.get(uuid) ?? 0) + 1;
    selected.push({
      selectionId: `${uuid}.${idIndex}`,
      tokenUuid: uuid,
    });
    indexByUuids.set(uuid, idIndex);
  }
  return selected;
}

export class TargetCardPart implements ModularCardPart<TargetCardData> {

  public static readonly instance = new TargetCardPart();
  private constructor(){}
  
  public create({item, token, actor}: ModularCardCreateArgs): TargetCardData {
    const target: TargetCardData = {
      selected: [],
      calc$: {
        actorUuid: actor?.uuid,
        tokenUuid: token?.uuid,
        targetDefinition: deepClone(item.data.data.target),
        rangeDefinition: deepClone(item.data.data.range),
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
    
    target.selected = uuidsToSelected(selectedTargets.map(t => t.uuid));

    // TODO "item.data.data.target.value" does not support formulas => does not support spell scaling
    //  Solutions: hook into the sheet and add an option for target scaling
    if (item.data.data.target?.value > 0 && ['ally', 'creature', 'enemy', 'object'].includes(item.data.data.target?.type)) {
      // Should not be any units, if units is specified, assume its in a radius
      if ([''].includes(item.data.data.target?.units)) {
        target.calc$.expectedTargets = item.data.data.target?.value;
      }
    }

    return target;
  }

  public refresh(data: TargetCardData, args: ModularCardCreateArgs): TargetCardData {
    return data; // TODO
  }

  private nextCallbackId = 0;
  private callbacks = new Map<number, TargetIntegrationCallback>();
  public registerIntegration(integration: TargetIntegrationCallback): Stoppable {
    const id = this.nextCallbackId++;
    this.callbacks.set(id, integration);
    return {
      stop: () => this.callbacks.delete(id),
    }
  }

  @RunOnce()
  public registerHooks(): void {
    new ElementBuilder()
      .listenForAttribute('data-part-id', 'string')
      .listenForAttribute('data-message-id', 'string')
      .addListener(new ElementCallbackBuilder()
        .setEvent('click')
        .addSelectorFilter('[data-action="copy"][data-copy-uuid]')
        .addSerializer(ItemCardHelpers.getChatPartIdSerializer())
        .addSerializer(ItemCardHelpers.getUserIdSerializer())
        .addSerializer(context => {
          return {copyUuid: (context.event.target as HTMLElement).closest('[data-copy-uuid]').getAttribute('data-copy-uuid')};
        })
        .addEnricher(ItemCardHelpers.getChatPartEnricher<TargetCardData>())
        .setPermissionCheck(createPermissionCheck<{part: {data: TargetCardData}}>(({part}) => {
          const documents: CreatePermissionCheckArgs['documents'] = [];
          if (part.data.calc$.actorUuid) {
            documents.push({uuid: part.data.calc$.actorUuid, permission: 'update', security: true});
          }
          return {documents: documents};
        }))
        .setExecute(async ({messageId, part, allCardParts, copyUuid}) => {
          part.data.selected = uuidsToSelected([...part.data.selected.map(s => s.tokenUuid), copyUuid]);
          return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
        })
      )
      .addListener(new ElementCallbackBuilder()
        .setEvent('click')
        .addSelectorFilter('[data-action="delete"][data-delete-uuid]')
        .addSerializer(ItemCardHelpers.getChatPartIdSerializer())
        .addSerializer(ItemCardHelpers.getUserIdSerializer())
        .addSerializer(context => {
          return {deleteUuid: (context.event.target as HTMLElement).closest('[data-delete-uuid]').getAttribute('data-delete-uuid')};
        })
        .addEnricher(ItemCardHelpers.getChatPartEnricher<TargetCardData>())
        .setPermissionCheck(createPermissionCheck<{part: {data: TargetCardData}}>(({part}) => {
          const documents: CreatePermissionCheckArgs['documents'] = [];
          if (part.data.calc$.actorUuid) {
            documents.push({uuid: part.data.calc$.actorUuid, permission: 'update', security: true});
          }
          return {documents: documents};
        }))
        .setExecute(async ({messageId, part, allCardParts, deleteUuid, userId}) => {
          part.data.selected = part.data.selected.filter(s => s.selectionId !== deleteUuid);
          await this.fireEvent('undo', [deleteUuid], part.data, messageId, allCardParts, userId);
          return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
        })
      )
      .addListener(new ElementCallbackBuilder()
        .setEvent('click')
        .addSelectorFilter('[data-action="force-apply"][data-target-uuid],[data-action="smart-apply"][data-target-uuid],[data-action="undo"][data-target-uuid]')
        .addSerializer(ItemCardHelpers.getChatPartIdSerializer())
        .addSerializer(ItemCardHelpers.getUserIdSerializer())
        .addSerializer(context => {
          return {
            action: (context.event.target as HTMLElement).closest('[data-action]').getAttribute('data-action') as TargetCallbackData['apply'],
            targetUuid: (context.event.target as HTMLElement).closest('[data-target-uuid]').getAttribute('data-target-uuid'),
          };
        })
        .addEnricher(ItemCardHelpers.getChatPartEnricher<TargetCardData>())
        .setPermissionCheck(createPermissionCheck<{part: {data: TargetCardData}}>(({part}) => {
          const documents: CreatePermissionCheckArgs['documents'] = [];
          if (part.data.calc$.actorUuid) {
            documents.push({uuid: part.data.calc$.actorUuid, permission: 'update', security: true});
          }
          return {documents: documents};
        }))
        .setExecute(async ({messageId, part, allCardParts, action, targetUuid, userId}) => {
          await this.fireEvent(action, [targetUuid], part.data, messageId, allCardParts, userId);
          return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
        })
      )
      .addOnAttributeChange(args => this.setElementHtml(args))
      .build(this.getSelector())

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

  private setElementHtml(context: Parameters<OnAttributeChange<{['data-message-id']: string; ['data-part-id']: string;}>>[0]): Promise<void> {
    return ItemCardHelpers.ifAttrData<TargetCardData>({attr: context.attributes, element: context.element, type: this, callback: async ({allParts, part}) => {
      // TODO check if token is invisible
      const stateContext: StateContext = {
        messageId: context.attributes['data-message-id'],
        selected: part.data.selected,
        allMessageParts: allParts,
      };
      const fetchedVisualStates: Promise<VisualState[]>[] = [];
      for (const integration of this.callbacks.values()) {
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
      const tokenData = new Map<string, {uuid: string, state?: VisualState['state'], smartState?: VisualState['state'], columnData: Map<string, string>}>();
      for (const selected of part.data.selected) {
        tokenData.set(selected.selectionId, {uuid: selected.tokenUuid, columnData: new Map()});
      }
      for (const visualState of await Promise.all(fetchedVisualStates).then(states => states.deepFlatten())) {
        if (!visualState?.selectionId) {
          continue;
        }
  
        if (!tokenData.has(visualState.selectionId)) {
          tokenData.set(visualState.selectionId, {uuid: visualState.tokenUuid, state: visualState.state, smartState: visualState.smartState, columnData: new Map()});
        }
        const currentData = tokenData.get(visualState.selectionId);
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
  
      if (columnsByKey.size === 0 && part.data.calc$.expectedTargets < 1) {
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
        expectedTargets: part.data.calc$.expectedTargets,
        row: [],
        state: 'not-applied',
        smartState: 'not-applied'
      };
      for (const key of columnKeyOrder) {
        htmlTableHeader.row.push(columnsByKey.get(key).label);
      }
      const htmlTableBody: Array<{
        selectionId: string;
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
  
      const tokenCacheByUuid = new Map<string, TargetCardData['calc$']['tokenData'][number]>();
      for (const token of part.data.calc$.tokenData) {
        tokenCacheByUuid.set(token.tokenUuid, token);
      }
      
      const sortedSelectionIds = Array.from(tokenData.entries())
        .filter(([key, token]) => tokenCacheByUuid.has(token.uuid))
        .sort((a, b) => {
          const aToken = tokenCacheByUuid.get(a[1].uuid);
          const bToken = tokenCacheByUuid.get(b[1].uuid);
          
          // Since tokens are displayed with their image, group them together
          let compare = aToken.img.localeCompare(bToken.img);
          if (compare !== 0) {
            return compare;
          }
  
          compare = aToken.name.localeCompare(bToken.name);
          if (compare !== 0) {
            return compare;
          }
  
          return a[0].localeCompare(b[0]);
        })
        .map(([key]) => key);
      const allStates = new Set<VisualState['state']>();
      const allSmartStates = new Set<VisualState['state']>();
      const hardSelectionIds = part.data.selected.map(sel => sel.selectionId);
      const notAppliedValues = [null, undefined, 'not-applied'];
      for (const selectionId of sortedSelectionIds) {
        const data = tokenData.get(selectionId);
        if (notAppliedValues.includes(data.state) && notAppliedValues.includes(data.smartState) && !hardSelectionIds.includes(selectionId)) {
          // Only show non selected tokens which have something applied to them (to show undo button)
          continue;
        }
        const tokenCache = tokenCacheByUuid.get(data.uuid);
        const row: string[] = [];
        for (const key of columnKeyOrder) {
          row.push(data.columnData.get(key) ?? '');
        }
        allStates.add(data.state);
        allSmartStates.add(data.smartState);
        htmlTableBody.push({
          selectionId: selectionId,
          tokenUuid: tokenCache.tokenUuid,
          actorUuid: tokenCache.actorUuid,
          name: tokenCache.name,
          nameVisibleAnyone: tokenCache.nameVisibleAnyone,
          img: tokenCache.img,
          state: data.state,
          smartState: data.smartState,
          row: row,
          isPlaceholder: false
        });
      }
      for (let i = htmlTableBody.length; i < part.data.calc$.expectedTargets; i++) {
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

      htmlTableHeader.currentTargets = htmlTableBody.filter(row => !row.isPlaceholder).length;
  
      context.element.innerHTML = await renderTemplate(
        `modules/${staticValues.moduleName}/templates/modular-card/target-part.hbs`, {
          data: {
            tableHeader: htmlTableHeader,
            tableBody: htmlTableBody,
          },
          actorUuid: part.data.calc$.actorUuid,
          moduleName: staticValues.moduleName
        }
      );
    }})
  }

  private async fireEvent(type: TargetCallbackData['apply'], requestIds: (string | '*')[], data: TargetCardData, messageId: string, allCardParts: ModularCardPartData[], userId: string): Promise<void> {
    const tokenPermissions = await UtilsDocument.hasPermissions(this.getSelected(requestIds, data, messageId, allCardParts).map(selected => ({
      uuid: selected.tokenUuid,
      permission: 'update',
      user: game.users.get(userId),
      meta: {
        selectionId: selected.selectionId
      }
    })));
    
    const callbackData: TargetCallbackData[] = tokenPermissions.filter(permission => permission.result).map(permission => ({
      messageId: messageId,
      messageCardParts: allCardParts,
      selected: {
        tokenUuid: permission.requestedCheck.uuid,
        selectionId: permission.requestedCheck.meta.selectionId
      },
      apply: type,
    }));

    for (const integration of this.callbacks.values()) {
      if (integration.onChange) {
        const response = integration.onChange(callbackData);
        if (response instanceof Promise) {
          await response;
        }
      }
    }
  }

  private getSelected(requestSelectIds: (string | '*')[], data: TargetCardData, messageId: string, allMessageParts: ModularCardPartData[]): Array<TargetCardData['selected'][0] & {state: typeof visualStates[number]}> {
    const allSelected = new Map<string, TargetCardData['selected'][0] & {state: typeof visualStates[number]}>();
    const stateContext: StateContext = {messageId: messageId, allMessageParts: allMessageParts, selected: data.selected};
    for (const selected of data.selected) {
      allSelected.set(selected.selectionId, {...selected, state: 'not-applied'});
    }
    for (const integration of this.callbacks.values()) {
      if (!integration.getState) {
        continue;
      }
      for (const state of integration.getState(stateContext)) {
        if (state.state === 'disabled' || state.state === 'not-applied') {
          continue;
        }
        allSelected.set(state.selectionId, {selectionId: state.selectionId, tokenUuid: state.tokenUuid, state: state.state});
      }
    }
    
    if (requestSelectIds.includes('*')) {
      return Array.from(allSelected.values());
    } else {
      return Array.from(allSelected.values()).filter(selected => requestSelectIds.includes(selected.selectionId))
    }
  }
  //#endregion

}

class TargetCardTrigger implements ITrigger<ModularCardTriggerData> {

  //#region afterCreate
  public async afterCreate(context: IAfterDmlContext<ModularCardTriggerData>): Promise<void> {
    await this.setTargets(context);
  }
  
  private async setTargets(context: IAfterDmlContext<ModularCardTriggerData>): Promise<void> {
    for (const {newRow, changedByUserId} of context.rows) {
      if (game.userId !== changedByUserId) {
        continue;
      }
      if (!this.isTargetTriggerType(newRow)) {
        continue;
      }
      if (newRow.data.calc$.tokenUuid == null) {
        continue;
      }
      if (newRow.data.calc$.rangeDefinition?.units !== 'self') {
        continue;
      }
      const token = await UtilsDocument.tokenFromUuid(newRow.data.calc$.tokenUuid);
      if (token == null) {
        continue;
      }

      if (newRow.data.calc$.targetDefinition.type === 'self') {
        await UtilsDocument.setTargets({tokenUuids: [newRow.data.calc$.tokenUuid]});
        return;
      }

      const template = MyAbilityTemplate.fromItem({
        target: newRow.data.calc$.targetDefinition,
        flags: {
          [staticValues.moduleName]: {
            dmlCallbackMessageId: newRow.messageId,
            dmlCallbackPartId: newRow.id,
          }
        }
      });
      if (!template) {
        continue;
      }
      template.document.data.update({
        x: token.data.x + ((token.data.width * template.document.parent.data.grid) / 2),
        y: token.data.y + ((token.data.height * template.document.parent.data.grid) / 2),
      });
      const templateDetails = UtilsTemplate.getTemplateDetails(template.document);

      const autoTargetTokens: string[] = [];
      const allTokens = template.document.parent.getEmbeddedCollection('Token').values() as IterableIterator<TokenDocument>;
      for (const sceneToken of allTokens) {
        // Since its an AOE which always targets itself, *assume* it should not target itself.
        if (token.uuid !== sceneToken.uuid) {
          if (UtilsTemplate.isTokenInside(templateDetails, sceneToken, true)) {
            autoTargetTokens.push(sceneToken.uuid)
          }
        }
      }

      if (autoTargetTokens.length === 0) {
        return;
      }

      await UtilsDocument.setTargets({tokenUuids: autoTargetTokens});
      return;
    }
  }
  //#endregion

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
      for (const selected of newRow.data.selected) {
        if (!cachedUuids.includes(selected.tokenUuid)) {
          missingTokenCaches.add(selected.tokenUuid);
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
      for (const selected of newRow.data.selected) {
        if (!cache.has(selected.tokenUuid) && tokenMap.has(selected.tokenUuid)) {
          const token = tokenMap.get(selected.tokenUuid);
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
      const itemTargetUuids = new Set<string>(targetData.selected.map(s => s.tokenUuid));
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
        for (const selected of targetData.selected) {
          // The same target could have been originally targeted twice, keep that amount
          if (currentTargetUuids.has(selected.tokenUuid)) {
            targetsUuids.push(selected.tokenUuid);
          }
        }
        for (const currentTargetUuid of currentTargetUuids) {
          if (!targetsUuids.includes(currentTargetUuid)) {
            targetsUuids.push(currentTargetUuid);
          }
        }
        targetData.selected = uuidsToSelected(targetsUuids);
        
        await ModularCard.setCardPartDatas(chatMessage, parts);
      }
    }
  }
  

}