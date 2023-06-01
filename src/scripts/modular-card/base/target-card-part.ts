import { DmlTrigger, ITrigger, IAfterDmlContext, IDmlTrigger, IDmlContext } from "../../lib/db/dml-trigger";
import { UtilsDocument } from "../../lib/db/utils-document";
import { RunOnce } from "../../lib/decorator/run-once";
import { Component, OnInit, OnInitParam } from "../../lib/render-engine/component";
import { Stoppable } from "../../lib/utils/stoppable";
import { UtilsCompare } from "../../lib/utils/utils-compare";
import { staticValues } from "../../static-values";
import { MyActor, MyItemData } from "../../types/fixed-types";
import { UtilsFoundry } from "../../utils/utils-foundry";
import { UtilsLog } from "../../utils/utils-log";
import { UtilsTemplate } from "../../utils/utils-template";
import { Action } from "../action";
import { ChatPartIdData, ItemCardHelpers } from "../item-card-helpers";
import { ModularCard, ModularCardTriggerData, ModularCardInstance } from "../modular-card";
import { ModularCardPart, ModularCardCreateArgs, CreatePermissionCheckArgs, HtmlContext, createPermissionCheckAction } from "../modular-card-part";
import { ActiveEffectCardPart } from "./active-effect-card-part";
import { AttackCardData, AttackCardPart } from "./attack-card-part";
import { BaseCardComponent } from "./base-card-component";
import { CheckCardData, CheckCardPart } from "./check-card-part";
import { DamageCardData, DamageCardPart } from "./damage-card-part";
import { ResourceCardData, ResourceCardPart } from "./resources-card-part";

export interface TargetCardData {
  selected: Array<{selectionId: string, tokenUuid: string;}>;
  calc$: {
    autoChangeTarget: boolean;
    actorUuid?: string;
    tokenUuid?: string;
    targetDefinition?: MyItemData['target'];
    rangeDefinition?: MyItemData['range'];
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
  readonly messageCardParts: ModularCardInstance;
  readonly selected: TargetCardData['selected'][0];
  readonly apply: 'undo' | 'smart-apply' | 'force-apply';
}

export interface StateContext {
  messageId: string;
  selected: TargetCardData['selected'];
  allMessageParts: ModularCardInstance;
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

let nextCallbackId = 0;
const callbacks = new Map<number, TargetIntegrationCallback>();

@Component({
  tag: TargetCardComponent.getSelector(),
  html: /*html*/`
    <div *if="this.tableBody.length" class="table target-table" style="grid-template-columns: max-content 25px {{this.tableHeader.row.length ? 'repeat(' + this.tableHeader.row.length + ', max-content)' : ''}} auto max-content;">
      <div class="header-cell">
        <button *if="!this.autoChangeTarget" [disabled]="!this.isOwner" (click)="this.onRefreshClick()" class="icon-button reset"><i class="fas fa-bullseye"></i></button>
      </div>
      <div class="header-cell target-amount-summary">
        {{this.tableHeader.currentTargets}}{{this.tableHeader.expectedTargets ? '/' + this.tableHeader.expectedTargets : ''}}
      </div>
      <div *for="let row of this.tableHeader.row" class="header-cell">{{{row}}}</div>
      <div class="header-cell"></div>
      <div class="header-cell one-line">
        <virtual *if="this.tableHeader.canOneActorWrite && this.tableBody.length > 1">
          <button (click)="this.onTargetActionClick('smart-apply', '*')" [data-state]="this.tableHeader.smartState" class="icon-button apply"><i class="fas fa-brain"></i></button>
          <button (click)="this.onTargetActionClick('force-apply', '*')" [data-state]="this.tableHeader.state" class="icon-button apply"><i class="fas fa-check"></i></button>
          <button (click)="this.onTargetActionClick('undo', '*')" [data-state]="this.tableHeader.state" class="icon-button undo"><i class="fas fa-undo"></i></button>
        </virtual>
      </div>
      
      <virtual *for="let target of this.tableBody">
        <virtual *if="target.isPlaceholder">
          <div class="body-cell"><!-- copy/delete --></div>
          <div class="body-cell placeholder">
            <i class="placeholder-image fas fa-bullseye"></i>
          </div>
          <div *for="let row of this.tableHeader.row" class="body-cell placeholder">
            <!-- dummy data rows -->
          </div>
          <div class="body-cell placeholder"><!-- filler --></div>
          <div class="body-cell placeholder"><!-- apply buttons --></div>
        </virtual>
        <virtual *if="!target.isPlaceholder">
          <div class="body-cell">
            <button [disabled]="!this.isOwner || ((target.state === 'partial-applied' || target.state === 'applied'))" (click)="this.onDeleteClick(target.selectionId)" class="icon-button delete"><i class="fas fa-trash"></i></button>
            <button [disabled]="!this.isOwner" (click)="this.onCopyClick(target.tokenUuid)" class="icon-button copy"><i class="far fa-copy"></i></button>
          </div>
          <div class="body-cell" [title]="target.name"><nd5e-token-img [data-token-uuid]="target.tokenUuid" [data-token-img]="target.img"></nd5e-token-img></div>
          <div *for="let row of target.row" class="body-cell">{{{row}}}</div>
          <div class="body-cell"><!-- filler --></div>
          <div class="body-cell one-line">
            <virtual *if="target.canActorWrite">
              <button (click)="this.onTargetActionClick('smart-apply', target.selectionId)" [data-state]="target.smartState" class="icon-button apply"><i class="fas fa-brain"></i></button>
              <button (click)="this.onTargetActionClick('force-apply', target.selectionId)" [data-state]="target.state" class="icon-button apply"><i class="fas fa-check"></i></button>
              <button (click)="this.onTargetActionClick('undo', target.selectionId)" [data-state]="target.state" class="icon-button undo"><i class="fas fa-undo"></i></button>
            </virtual>
          </div>
        </virtual>
      </virtual>
    </div>
  `,
  style: /*css*/`
    :host-context(body.key-shift) :host:hover .copy {
      display: none;
    }
    
    :host-context(body.key-shift) :host:hover .reset {
      visibility: hidden;
    }

    .reset:not([disabled]) {
      color: #bf3434; /*red variant*/
    }
    
    :host-context(body:not(.key-shift)) :host .delete,
    :host:not(:hover) .delete {
      display: none;
    }
    
    .target-table {
      display: grid;
      width: 100%;
    }
  
    .one-line {
      display: flex;
      min-width: max-content;
    }

    .header-cell.target-amount-summary {
      display: flex;
      justify-content: center;
    }

    .placeholder-image {
      margin-left: 4px;;
      opacity: .5;
      color: red;
    }

    .icon-button {
      font-size: 10px;
      height: 2em;
      width: 2em;
      line-height: 1em;
    }
    
    .apply[data-state="applied"] {
      color: green;
    }
    .apply[data-state="disabled"] {
      opacity: .5;
      pointer-events: none;
    }

    .undo[data-state="not-applied"] {
      color: green;
    }
  `
})
export class TargetCardComponent extends BaseCardComponent implements OnInit {
  //#region actions
  
  private static copyUuid = new Action<{uuid: string;} & ChatPartIdData>('TargetCopyUuid')
    .addSerializer(ItemCardHelpers.getRawSerializer('messageId'))
    .addSerializer(ItemCardHelpers.getRawSerializer('uuid'))
    .addEnricher(ItemCardHelpers.getChatEnricher())
    .setPermissionCheck(createPermissionCheckAction<{cardParts: ModularCardInstance}>(({cardParts}) => {
      const part = cardParts.getTypeData<TargetCardData>(TargetCardPart.instance);
      const documents: CreatePermissionCheckArgs['documents'] = [];
      if (part?.calc$?.actorUuid) {
        documents.push({uuid: part.calc$.actorUuid, permission: 'update', security: true});
      }
      return {documents: documents};
    }))
    .build(async ({messageId, cardParts, uuid}) => {
      const part = cardParts.getTypeData<TargetCardData>(TargetCardPart.instance);
      part.selected = uuidsToSelected([...part.selected.map(s => s.tokenUuid), uuid]);
      return ModularCard.setCardPartDatas(game.messages.get(messageId), cardParts);
    })
    
  private static deleteUuid = new Action<{uuid: string;} & ChatPartIdData>('TargetDeleteUuid')
    .addSerializer(ItemCardHelpers.getRawSerializer('messageId'))
    .addSerializer(ItemCardHelpers.getRawSerializer('uuid'))
    .addEnricher(ItemCardHelpers.getChatEnricher())
    .setPermissionCheck(createPermissionCheckAction<{cardParts: ModularCardInstance}>(({cardParts}) => {
      const part = cardParts.getTypeData<TargetCardData>(TargetCardPart.instance);
      const documents: CreatePermissionCheckArgs['documents'] = [];
      if (part?.calc$?.actorUuid) {
        documents.push({uuid: part.calc$.actorUuid, permission: 'update', security: true});
      }
      return {documents: documents};
    }))
    .build(async ({messageId, cardParts, uuid, user}) => {
      const part = cardParts.getTypeData<TargetCardData>(TargetCardPart.instance);
      part.selected = part.selected.filter(s => s.selectionId !== uuid);
      await TargetCardComponent.fireEvent('undo', [uuid], part, messageId, cardParts, user.id);
      return ModularCard.setCardPartDatas(game.messages.get(messageId), cardParts);
    })
    
  private static refreshTargets = new Action<ChatPartIdData>('TargetRefresh')
    .addSerializer(ItemCardHelpers.getRawSerializer('messageId'))
    .addEnricher(ItemCardHelpers.getChatEnricher())
    .setPermissionCheck(createPermissionCheckAction<{cardParts: ModularCardInstance}>(({cardParts}) => {
      const part = cardParts.getTypeData<TargetCardData>(TargetCardPart.instance);
      const documents: CreatePermissionCheckArgs['documents'] = [];
      if (part?.calc$?.actorUuid) {
        documents.push({uuid: part.calc$.actorUuid, permission: 'update', security: true});
      }
      return {documents: documents};
    }))
    .build(async ({messageId, cardParts, user}) => {
      const part = cardParts.getTypeData<TargetCardData>(TargetCardPart.instance);
      await setTargetsFromUser(part, user);
      return ModularCard.setCardPartDatas(game.messages.get(messageId), cardParts);
    })
    
  private static setTargetstate = new Action<{action: TargetCallbackData['apply']; targetUuid: string;} & ChatPartIdData>('TargetSetState')
    .addSerializer(ItemCardHelpers.getRawSerializer('messageId'))
    .addSerializer(ItemCardHelpers.getRawSerializer('action'))
    .addSerializer(ItemCardHelpers.getRawSerializer('targetUuid'))
    .addEnricher(ItemCardHelpers.getChatEnricher())
    .setPermissionCheck(createPermissionCheckAction(() => {
      // No need to check for target uuid permissions, this is handled by the build/execute
      return {updatesMessage: true};
    }))
    .build(async ({messageId, cardParts, action, targetUuid, user}) => {
      const part = cardParts.getTypeData<TargetCardData>(TargetCardPart.instance);
      await TargetCardComponent.fireEvent(action, [targetUuid], part, messageId, cardParts, user.id);
      return ModularCard.setCardPartDatas(game.messages.get(messageId), cardParts);
    })
  //#endregion
  
  private static async fireEvent(type: TargetCallbackData['apply'], requestIds: (string | '*')[], data: TargetCardData, messageId: string, allCardParts: ModularCardInstance, userId: string): Promise<void> {
    const tokenPermissions = await UtilsDocument.hasPermissions(TargetCardComponent.getSelected(requestIds, data, messageId, allCardParts).map(selected => ({
      uuid: selected.tokenUuid,
      permission: 'update',
      user: game.users.get(userId),
      meta: {
        selectionId: selected.selectionId
      }
    }))).listenFirst();
    
    const callbackData: TargetCallbackData[] = tokenPermissions.filter(permission => permission.result).map(permission => ({
      messageId: messageId,
      messageCardParts: allCardParts,
      selected: {
        tokenUuid: permission.requestedCheck.uuid,
        selectionId: permission.requestedCheck.meta.selectionId
      },
      apply: type,
    }));

    for (const integration of callbacks.values()) {
      if (integration.onChange) {
        try {
          const response = integration.onChange(callbackData);
          if (response instanceof Promise) {
            await response;
          }
        } catch (e) {
          UtilsLog.error(`Error during target interaction`, {integration}, '\nError', e)
        }
      }
    }
  }

  private static getSelected(requestSelectIds: (string | '*')[], data: TargetCardData, messageId: string, allMessageParts: ModularCardInstance): Array<TargetCardData['selected'][0] & {state: typeof visualStates[number]}> {
    const allSelected = new Map<string, TargetCardData['selected'][0] & {state: typeof visualStates[number]}>();
    const stateContext: StateContext = {messageId: messageId, allMessageParts: allMessageParts, selected: data.selected};
    for (const selected of data.selected) {
      allSelected.set(selected.selectionId, {...selected, state: 'not-applied'});
    }
    for (const integration of callbacks.values()) {
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
  
  public static getSelector(): string {
    return `${staticValues.code}-target-part`;
  }

  public onInit(args: OnInitParam) {
    args.addStoppable(
      this.getData(TargetCardPart.instance).listen(({message, allParts, part}) => this.calc(message, allParts, part))
    );
  }

  public tableHeader: {
    currentTargets: number;
    expectedTargets?: number;
    canOneActorWrite: boolean;
    row: string[];
    state: VisualState['state'];
    smartState: VisualState['state'];
  };
  public tableBody: Array<{
    selectionId: string;
    tokenUuid: string;
    actorUuid: string;
    canActorWrite: boolean;
    name: string;
    img: string;
    state: VisualState['state'];
    smartState: VisualState['state'];
    row: string[];
    isPlaceholder: false;
  } | {
    isPlaceholder: true;
  }> = [];
  public isOwner = false;
  public autoChangeTarget = false;
  private async calc(message: ChatMessage, allParts: ModularCardInstance, part: TargetCardData) {
    this.autoChangeTarget = part.calc$.autoChangeTarget;
    UtilsDocument.hasAllPermissions([{uuid: part.calc$.actorUuid, permission: 'OWNER', user: game.user}]).listenFirst().then(isOwner => {
      this.isOwner = isOwner;
    });

    // TODO check if token is invisible
    const stateContext: StateContext = {
      messageId: message.id,
      selected: part.selected,
      allMessageParts: allParts,
    };
    const fetchedVisualStates: Promise<VisualState[]>[] = [];
    for (const integration of callbacks.values()) {
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
        UtilsLog.error('Error during getVisualState()', e);
      }
    }
    
    const columnsByKey = new Map<string, {label: string}>();
    const columnKeyOrder: string[] = [];
    const tokenData = new Map<string, {uuid: string, state?: VisualState['state'], smartState?: VisualState['state'], columnData: Map<string, string>}>();
    for (const selected of part.selected) {
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

    if (columnsByKey.size === 0 && part.calc$.expectedTargets < 1) {
      return '';
    }

    const htmlTableHeader: this['tableHeader'] = {
      currentTargets: tokenData.size,
      expectedTargets: part.calc$.expectedTargets,
      canOneActorWrite: false,
      row: [],
      state: 'not-applied',
      smartState: 'not-applied'
    };
    for (const key of columnKeyOrder) {
      htmlTableHeader.row.push(columnsByKey.get(key).label);
    }
    const htmlTableBody: this['tableBody'] = [];

    const tokenCacheByUuid = new Map<string, TargetCardData['calc$']['tokenData'][number]>();
    for (const token of part.calc$.tokenData) {
      tokenCacheByUuid.set(token.tokenUuid, token);
    }
    
    const sortedSelectionIds = Array.from(tokenData.entries())
      .filter(([key, token]) => tokenCacheByUuid.has(token.uuid))
      .sort((a, b) => {
        const aToken = tokenCacheByUuid.get(a[1].uuid);
        const bToken = tokenCacheByUuid.get(b[1].uuid);
        
        // Since tokens are displayed with their image, group them together
        let compare: number;
        if (UtilsFoundry.usesDataModel()) {
          compare = aToken.img.localeCompare(bToken.img)
        } else {
          compare = aToken.img.localeCompare(bToken.img)
        }
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
    const hardSelectionIds = part.selected.map(sel => sel.selectionId);
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
      const permissions = await UtilsDocument.hasPermissions([
        {uuid: tokenCache.actorUuid, permission: 'LIMITED', user: game.user},
        {uuid: tokenCache.actorUuid, permission: 'UPDATE', user: game.user},
      ]).listenFirst();
      // TODO keep listening
      const canRead = permissions.find(p => p.requestedCheck.permission === 'LIMITED').result;
      const canWrite = permissions.find(p => p.requestedCheck.permission === 'UPDATE').result;
      htmlTableBody.push({
        selectionId: selectionId,
        tokenUuid: tokenCache.tokenUuid,
        actorUuid: tokenCache.actorUuid,
        name: (tokenCache.nameVisibleAnyone || canRead) ? tokenCache.name : '',
        canActorWrite: canWrite,
        img: tokenCache.img,
        state: data.state,
        smartState: data.smartState,
        row: row,
        isPlaceholder: false
      });
    }
    for (let i = htmlTableBody.length; i < part.calc$.expectedTargets; i++) {
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
    htmlTableHeader.canOneActorWrite = htmlTableBody.find(row => row.isPlaceholder === false && row.canActorWrite) != null;

    this.tableHeader = htmlTableHeader;
    this.tableBody = htmlTableBody;
  }

  public onCopyClick(uuid: string) {
    TargetCardComponent.copyUuid({
      messageId: this.messageId,
      uuid: uuid,
    });
  }
  
  public onDeleteClick(uuid: string) {
    TargetCardComponent.deleteUuid({
      messageId: this.messageId,
      uuid: uuid,
    });
  }
  
  public onRefreshClick() {
    TargetCardComponent.refreshTargets({
      messageId: this.messageId,
    });
  }
  
  public onTargetActionClick(action: TargetCallbackData['apply'], targetUuid: string) {
    TargetCardComponent.setTargetstate({
      messageId: this.messageId,
      action: action,
      targetUuid: targetUuid,
    });
  }

}

export class TargetCardPart implements ModularCardPart<TargetCardData> {

  public static readonly instance = new TargetCardPart();
  private constructor(){}
  
  public create({item, token, actor}: ModularCardCreateArgs): TargetCardData {
    const itemData = UtilsFoundry.getSystemData(item);
    const target: TargetCardData = {
      selected: [],
      calc$: {
        autoChangeTarget: true,
        actorUuid: actor?.uuid,
        tokenUuid: token?.uuid,
        targetDefinition: deepClone(itemData.target),
        rangeDefinition: deepClone(itemData.range),
        tokenData: [],
      },
    };

    const selectedTargets: TokenDocument[] = [];
    if (itemData.target?.type === 'none') {
      // no selection
    } else if (itemData.target?.type === 'self' && token) {
      selectedTargets.push(token);
    } else {
      for (const token of game.user.targets) {
        selectedTargets.push(token.document);
      }
    }
    
    target.selected = uuidsToSelected(selectedTargets.map(t => t.uuid));

    if (itemData.target?.value > 0 && ['ally', 'creature', 'enemy', 'object'].includes(itemData.target?.type)) {
      // Should not be any units, if units is specified, assume its in a radius
      if ([''].includes(itemData.target?.units)) {
        target.calc$.expectedTargets = itemData.target?.value;
      }
    } else if (['', null].includes(itemData.target?.type)) {
      // Target None => probably not configured
      // This is also home some dnd5e compendium weapons are configured
      if (item.hasAttack || item.hasDamage) {
        target.calc$.expectedTargets = 1;
      }
    }

    return target;
  }

  public refresh(oldData: TargetCardData, args: ModularCardCreateArgs): TargetCardData {
    const newData = this.create(args);
    if (!newData && !oldData) {
      return null;
    }
    newData.selected = oldData.selected;
    newData.calc$.tokenData = oldData.calc$.tokenData;
    return newData;
  }

  public registerIntegration(integration: TargetIntegrationCallback): Stoppable {
    const id = nextCallbackId++;
    callbacks.set(id, integration);
    return {
      stop: () => callbacks.delete(id),
    }
  }

  @RunOnce()
  public registerHooks(): void {
    ModularCard.registerModularCardPart(staticValues.moduleName, TargetCardPart.instance);
    ModularCard.registerModularCardTrigger(this, new TargetCardTrigger());
    DmlTrigger.registerTrigger(new DmlTriggerUser());
  }

  public getType(): string {
    return 'TargetCardPart';
  }

  //#region Front end

  public getHtml(data: HtmlContext): string {
    return `<${TargetCardComponent.getSelector()} data-message-id="${data.messageId}"></${TargetCardComponent.getSelector()}>`
  }
  //#endregion

}

class TargetCardTrigger implements ITrigger<ModularCardTriggerData<TargetCardData>> {

  //#region beforeUpsert
  public beforeUpsert(context: IDmlContext<ModularCardTriggerData<TargetCardData>>): boolean | void {
    this.calcAutoChangeTarget(context);
  }

  private calcAutoChangeTarget(context: IDmlContext<ModularCardTriggerData<TargetCardData>>): void {
    rowLoop: for (const {newRow} of context.rows) {
      if (!newRow.part.calc$.autoChangeTarget) {
        continue;
      }
      if (newRow.part.selected.length < newRow.part.calc$.expectedTargets ?? 1) {
        // Don't disable autoChangeTarget while it's active and not all selected
        continue;
      }

      const attackCardData = newRow.allParts.getTypeData<AttackCardData>(AttackCardPart.instance);
      const checkCardData = newRow.allParts.getTypeData<CheckCardData>(CheckCardPart.instance);
      const damageCardData = newRow.allParts.getTypeData<DamageCardData>(DamageCardPart.instance);
      const resourceCardData = newRow.allParts.getTypeData<ResourceCardData>(ResourceCardPart.instance);

      if (damageCardData != null && damageCardData.phase === 'result') {
        newRow.part.calc$.autoChangeTarget = false;
        continue rowLoop;
      }
      if (attackCardData != null && attackCardData.phase === 'result') {
        newRow.part.calc$.autoChangeTarget = false;
        continue rowLoop;
      }
      if (checkCardData != null) {
        for (const cache of checkCardData.targetCaches$) {
          if (cache.phase === 'result') {
            newRow.part.calc$.autoChangeTarget = false;
            continue rowLoop;
          }
        }
      }
      if (resourceCardData != null) {
        for (const cache of resourceCardData.consumeResources) {
          if (cache.calc$.appliedChange > 0) {
            newRow.part.calc$.autoChangeTarget = false;
            continue rowLoop;
          }
        }
      }
    }
  }
  //#endregion

  //#region afterCreate
  public async afterCreate(context: IAfterDmlContext<ModularCardTriggerData<TargetCardData>>): Promise<void> {
    await this.setTargets(context);
    await this.markOlderAutoChangeTarget(context);
  }
  
  private async setTargets(context: IAfterDmlContext<ModularCardTriggerData<TargetCardData>>): Promise<void> {
    for (const {newRow, changedByUserId} of context.rows) {
      if (game.userId !== changedByUserId) {
        continue;
      }
      if (newRow.part.calc$.tokenUuid == null) {
        continue;
      }
      if (newRow.part.calc$.rangeDefinition?.units !== 'self') {
        continue;
      }
      
      let hasTargettableAction = false;
      if (newRow.allParts.hasType(ActiveEffectCardPart.instance)) {
        hasTargettableAction = true;
      } else if (newRow.allParts.hasType(AttackCardPart.instance)) {
        hasTargettableAction = true;
      } else if (newRow.allParts.hasType(DamageCardPart.instance)) {
        hasTargettableAction = true;
      } else if (newRow.allParts.hasType(CheckCardPart.instance)) {
        hasTargettableAction = true;
      }
      if (!hasTargettableAction) {
        continue;
      }

      if (newRow.part.calc$.targetDefinition.type === 'self') {
        await UtilsDocument.setTargets({tokenUuids: [newRow.part.calc$.tokenUuid]});
        return;
      }

      // TODO V10
      const template = UtilsTemplate.fromItem(await UtilsDocument.itemFromUuid(newRow.allParts.getItemUuid()), newRow.messageId);
      if (!template) {
        continue;
      }

      const token = await UtilsDocument.tokenFromUuid(newRow.part.calc$.tokenUuid);
      if (token == null) {
        continue;
      }
      const tokenData = UtilsFoundry.getModelData(token);
      const templateData = UtilsFoundry.getModelData(template.document);
      let grid = UtilsFoundry.getModelData(template.document.parent).grid;
      // Foundry V9 has grid as a number, V10 as an object
      if (typeof grid === 'object') {
        grid = grid.size;
      }
      templateData.update({
        x: tokenData.x + ((tokenData.width * grid) / 2),
        y: tokenData.y + ((tokenData.height * grid) / 2),
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

  private async markOlderAutoChangeTarget(context: IAfterDmlContext<ModularCardTriggerData<TargetCardData>>): Promise<void> {
    const activeGm = Array.from(game.users.values()).filter(user => user.isGM).sort((a, b) => a.id.localeCompare(b.id))[0];
    // If a GM is active, the GM should update old messages
    // Otherwise (further down) the author needs to update
    // If neither are online... well to bad I guess, not the end of the world
    if (activeGm && game.userId !== activeGm.id) {
      return;
    }

    const timestamps: number[] = [];
    const excludeMessageIds = new Set<string>();
    for (const {newRow} of context.rows) {
      excludeMessageIds.add(newRow.messageId);
      timestamps.push(UtilsFoundry.getModelData(game.messages.get(newRow.messageId)).timestamp);
    }
    const newestMessageCreatedDate = timestamps.sort()[timestamps.length - 1];
    
    const bulkUpdateRequest: Parameters<typeof ModularCard.setBulkCardPartDatas>[0] = [];
    for (let messageIndex = game.messages.contents.length - 1; messageIndex >= 0; messageIndex--) {
      const chatMessage = game.messages.contents[messageIndex];
      // If active gm is not null, current user i active gm
      if (activeGm == null && !chatMessage.isAuthor) {
        continue;
      }
      if (excludeMessageIds.has(chatMessage.id)) {
        continue;
      }

      if (UtilsFoundry.getModelData(chatMessage).timestamp >= newestMessageCreatedDate) {
        return;
      }
      const parts = ModularCard.getCardPartDatas(chatMessage);
      if (!parts) {
        continue;
      }

      const targetData = parts.getTypeData<TargetCardData>(TargetCardPart.instance);
      if (targetData) {
        if (targetData.calc$.autoChangeTarget) {
          const partsClone = deepClone(parts);
          targetData.calc$.autoChangeTarget = false;
          bulkUpdateRequest.push({message: chatMessage, data: partsClone});
        } else {
          // Once you find 1 which is marked false, assume all of the previous have aswel
          break;
        }
      }
    }
    ModularCard.setBulkCardPartDatas(bulkUpdateRequest);
  }
  //#endregion

  //#region upsert
  public async upsert(context: IAfterDmlContext<ModularCardTriggerData<TargetCardData>>): Promise<void> {
    await this.calcTargetCache(context);
  }

  private async calcTargetCache(context: IAfterDmlContext<ModularCardTriggerData<TargetCardData>>): Promise<void> {
    const missingTokenCaches = new Set<string>();
    for (const {newRow} of context.rows) {
      const cachedUuids = newRow.part.calc$.tokenData.map(t => t.tokenUuid);
      for (const selected of newRow.part.selected) {
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
      const cache = new Map<string, TargetCardData['calc$']['tokenData'][0]>();
      for (const entry of newRow.part.calc$.tokenData) {
        cache.set(entry.tokenUuid, entry);
      }
      for (const selected of newRow.part.selected) {
        if (!cache.has(selected.tokenUuid) && tokenMap.has(selected.tokenUuid)) {
          const token = tokenMap.get(selected.tokenUuid);
          cache.set(token.uuid, {
            tokenUuid: token.uuid,
            actorUuid: (token.getActor() as MyActor)?.uuid,
            name: UtilsFoundry.getModelData(token).name,
            nameVisibleAnyone: [CONST.TOKEN_DISPLAY_MODES.HOVER, CONST.TOKEN_DISPLAY_MODES.ALWAYS as number].includes(UtilsFoundry.getModelData(token).displayName),
            img: UtilsFoundry.usesDataModel(token) ? (token as any).texture.src : token.data.img,
          })
        }
      }

      if (cache.size !== newRow.part.calc$.tokenData.length) {
        newRow.part.calc$.tokenData = Array.from(cache.values());
      }
    }
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

    let chatMessage: ChatMessage;
    let partsWithTarget: ModularCardInstance;
    for (let messageIndex = game.messages.contents.length - 1; messageIndex >= 0; messageIndex--) {
      chatMessage = game.messages.contents[messageIndex];
      const parts = ModularCard.getCardPartDatas(chatMessage);
      if (!parts) {
        continue;
      }

      if (parts.hasType(TargetCardPart.instance)) {
        partsWithTarget = parts.deepClone();
      }
    }

    if (!partsWithTarget) {
      return;
    }
    
    const targetData = partsWithTarget.getTypeData<TargetCardData>(TargetCardPart.instance);
    const chatMessageUser = UtilsFoundry.getModelData(chatMessage).user as User | string;
    // V9 this is the user id, V10 this is the user model
    if (!targetData.calc$.autoChangeTarget || ((chatMessageUser instanceof User) ? (chatMessageUser.id !== game.userId) : (chatMessageUser !== game.userId))) {
      return;
    }
    
    // Assume targets did not changes when non are selected at this time
    if (game.user.targets.size === 0) {
      return;
    }

    // Don't auto change targets after
    await setTargetsFromUser(targetData, game.user);
    await ModularCard.setCardPartDatas(chatMessage, partsWithTarget);
  }
  
}

async function setTargetsFromUser(targetData: TargetCardData, user: User): Promise<void> {
    
  // Re-evaluate the targets, the user may have changed targets
  const currentTargetUuids = new Set<string>(Array.from(game.user.targets).map(token => token.document.uuid));

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
  }
}