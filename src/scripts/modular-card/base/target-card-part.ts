import { DmlTrigger, ITrigger, IAfterDmlContext, IDmlTrigger, IDmlContext } from "../../lib/db/dml-trigger";
import { UtilsDocument } from "../../lib/db/utils-document";
import { RunOnce } from "../../lib/decorator/run-once";
import { Component, OnInit, OnInitParam } from "../../lib/render-engine/component";
import { Stoppable } from "../../lib/utils/stoppable";
import { UtilsCompare } from "../../lib/utils/utils-compare";
import MyAbilityTemplate from "../../pixi/ability-template";
import { staticValues } from "../../static-values";
import { MyActor, MyItemData } from "../../types/fixed-types";
import { UtilsLog } from "../../utils/utils-log";
import { UtilsTemplate } from "../../utils/utils-template";
import { Action } from "../action";
import { ChatPartIdData, ItemCardHelpers } from "../item-card-helpers";
import { ModularCardPartData, ModularCard, ModularCardTriggerData } from "../modular-card";
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

let nextCallbackId = 0;
const callbacks = new Map<number, TargetIntegrationCallback>();

@Component({
  tag: TargetCardComponent.getSelector(),
  html: /*html*/`
    <div *if="this.tableBody.length" class="table target-table" style="grid-template-columns: max-content 25px {{this.tableHeader.row.length ? 'repeat(' + this.tableHeader.row.length + ', min-content)' : ''}} auto max-content;">
      <div class="header-cell">
        <button *if="this.autoChangeTarget" [disabled]="!this.isOwner" (click)="this.onRefreshClick()" class="icon-button reset"><i class="fas fa-bullseye"></i></button>
      </div>
      <div class="header-cell target-amount-summary">
        {{this.tableHeader.currentTargets}}{{this.tableHeader.expectedTargets ? '/' + this.tableHeader.expectedTargets : ''}}
      </div>
      <div *for="let row of this.tableHeader.row" class="header-cell" [innerHTML]="row"></div>
      <div class="header-cell"></div>
      <div class="header-cell one-line">
        <virtual *if="this.tableHeader.canOneActorWrite">
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
          <div class="body-cell" [title]="target.name"><nac-token-img [data-token-uuid]="target.tokenUuid" [data-token-img]="target.img"></nac-token-img></div>
          <div *for="let row of target.row" class="body-cell" [innerHTML]="row"></div>
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
    .addSerializer(ItemCardHelpers.getRawSerializer('partId'))
    .addSerializer(ItemCardHelpers.getRawSerializer('uuid'))
    .addEnricher(ItemCardHelpers.getChatPartEnricher<TargetCardData>())
    .setPermissionCheck(createPermissionCheckAction<{part: {data: TargetCardData}}>(({part}) => {
      const documents: CreatePermissionCheckArgs['documents'] = [];
      if (part.data.calc$.actorUuid) {
        documents.push({uuid: part.data.calc$.actorUuid, permission: 'update', security: true});
      }
      return {documents: documents};
    }))
    .build(async ({messageId, part, allCardParts, uuid}) => {
      part.data.selected = uuidsToSelected([...part.data.selected.map(s => s.tokenUuid), uuid]);
      return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
    })
    
  private static deleteUuid = new Action<{uuid: string;} & ChatPartIdData>('TargetDeleteUuid')
    .addSerializer(ItemCardHelpers.getRawSerializer('messageId'))
    .addSerializer(ItemCardHelpers.getRawSerializer('partId'))
    .addSerializer(ItemCardHelpers.getRawSerializer('uuid'))
    .addEnricher(ItemCardHelpers.getChatPartEnricher<TargetCardData>())
    .setPermissionCheck(createPermissionCheckAction<{part: {data: TargetCardData}}>(({part}) => {
      const documents: CreatePermissionCheckArgs['documents'] = [];
      if (part.data.calc$.actorUuid) {
        documents.push({uuid: part.data.calc$.actorUuid, permission: 'update', security: true});
      }
      return {documents: documents};
    }))
    .build(async ({messageId, part, allCardParts, uuid, user}) => {
      part.data.selected = part.data.selected.filter(s => s.selectionId !== uuid);
      await TargetCardComponent.fireEvent('undo', [uuid], part.data, messageId, allCardParts, user.id);
      return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
    })
    
  private static refreshTargets = new Action<ChatPartIdData>('TargetRefresh')
    .addSerializer(ItemCardHelpers.getRawSerializer('messageId'))
    .addSerializer(ItemCardHelpers.getRawSerializer('partId'))
    .addEnricher(ItemCardHelpers.getChatPartEnricher<TargetCardData>())
    .setPermissionCheck(createPermissionCheckAction<{part: {data: TargetCardData}}>(({part}) => {
      const documents: CreatePermissionCheckArgs['documents'] = [];
      if (part.data.calc$.actorUuid) {
        documents.push({uuid: part.data.calc$.actorUuid, permission: 'update', security: true});
      }
      return {documents: documents};
    }))
    .build(async ({messageId, part, allCardParts, user}) => {
      await setTargetsFromUser(part.data, user);
      return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
    })
    
  private static setTargetstate = new Action<{action: TargetCallbackData['apply']; targetUuid: string;} & ChatPartIdData>('TargetSetState')
    .addSerializer(ItemCardHelpers.getRawSerializer('messageId'))
    .addSerializer(ItemCardHelpers.getRawSerializer('partId'))
    .addSerializer(ItemCardHelpers.getRawSerializer('action'))
    .addSerializer(ItemCardHelpers.getRawSerializer('targetUuid'))
    .addEnricher(ItemCardHelpers.getChatPartEnricher<TargetCardData>())
    .setPermissionCheck(createPermissionCheckAction<{part: {data: TargetCardData}, targetUuid: string}>(({part, targetUuid}) => {
      const documents: CreatePermissionCheckArgs['documents'] = [];
      documents.push({uuid: part.data.selected.find(s => s.selectionId === targetUuid).tokenUuid, permission: 'update', security: true});
      return {documents: documents};
    }))
    .build(async ({messageId, part, allCardParts, action, targetUuid, user}) => {
      await TargetCardComponent.fireEvent(action, [targetUuid], part.data, messageId, allCardParts, user.id);
      return ModularCard.setCardPartDatas(game.messages.get(messageId), allCardParts);
    })
  //#endregion
  
  private static async fireEvent(type: TargetCallbackData['apply'], requestIds: (string | '*')[], data: TargetCardData, messageId: string, allCardParts: ModularCardPartData[], userId: string): Promise<void> {
    const tokenPermissions = await UtilsDocument.hasPermissions(TargetCardComponent.getSelected(requestIds, data, messageId, allCardParts).map(selected => ({
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

    for (const integration of callbacks.values()) {
      if (integration.onChange) {
        const response = integration.onChange(callbackData);
        if (response instanceof Promise) {
          await response;
        }
      }
    }
  }

  private static getSelected(requestSelectIds: (string | '*')[], data: TargetCardData, messageId: string, allMessageParts: ModularCardPartData[]): Array<TargetCardData['selected'][0] & {state: typeof visualStates[number]}> {
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
  private async calc(message: ChatMessage, allParts: Array<ModularCardPartData>, part: ModularCardPartData<TargetCardData>) {
    this.autoChangeTarget = part.data.calc$.autoChangeTarget;
    UtilsDocument.hasAllPermissions([{uuid: part.data.calc$.actorUuid, permission: 'OWNER', user: game.user}]).then(isOwner => {
      this.isOwner = isOwner;
    });

    // TODO check if token is invisible
    const stateContext: StateContext = {
      messageId: message.id,
      selected: part.data.selected,
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

    const htmlTableHeader: this['tableHeader'] = {
      currentTargets: tokenData.size,
      expectedTargets: part.data.calc$.expectedTargets,
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
      const permissions = await UtilsDocument.hasPermissions([
        {uuid: tokenCache.actorUuid, permission: 'LIMITED', user: game.user},
        {uuid: tokenCache.actorUuid, permission: 'UPDATE', user: game.user},
      ]);
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
    htmlTableHeader.canOneActorWrite = htmlTableBody.find(row => row.isPlaceholder === false && row.canActorWrite) != null;

    this.tableHeader = htmlTableHeader;
    this.tableBody = htmlTableBody;
  }

  public onCopyClick(uuid: string) {
    TargetCardComponent.copyUuid({
      messageId: this.messageId,
      partId: this.partId,
      uuid: uuid,
    });
  }
  
  public onDeleteClick(uuid: string) {
    TargetCardComponent.deleteUuid({
      messageId: this.messageId,
      partId: this.partId,
      uuid: uuid,
    });
  }
  
  public onRefreshClick() {
    TargetCardComponent.refreshTargets({
      messageId: this.messageId,
      partId: this.partId,
    });
  }
  
  public onTargetActionClick(action: TargetCallbackData['apply'], targetUuid: string) {
    TargetCardComponent.setTargetstate({
      messageId: this.messageId,
      partId: this.partId,
      action: action,
      targetUuid: targetUuid,
    });
  }

}

export class TargetCardPart implements ModularCardPart<TargetCardData> {

  public static readonly instance = new TargetCardPart();
  private constructor(){}
  
  public create({item, token, actor}: ModularCardCreateArgs): TargetCardData {
    const target: TargetCardData = {
      selected: [],
      calc$: {
        autoChangeTarget: true,
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

    if (item.data.data.target?.value > 0 && ['ally', 'creature', 'enemy', 'object'].includes(item.data.data.target?.type)) {
      // Should not be any units, if units is specified, assume its in a radius
      if ([''].includes(item.data.data.target?.units)) {
        target.calc$.expectedTargets = item.data.data.target?.value;
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
    return this.constructor.name;
  }

  //#region Front end

  public getHtml(data: HtmlContext): string {
    return `<${TargetCardComponent.getSelector()} data-test data-part-id="${data.partId}" data-message-id="${data.messageId}"></${TargetCardComponent.getSelector()}>`
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
      if (!newRow.part.data.calc$.autoChangeTarget) {
        continue;
      }

      let attackCardData: AttackCardData;
      let checkCardData: CheckCardData;
      let damageCardData: DamageCardData;
      let resourceCardData: ResourceCardData;
      for (const part of newRow.allParts) {
        const handler = ModularCard.getTypeHandler(part.type);
        if (handler instanceof AttackCardPart) {
          attackCardData = part.data;
        } else if (handler instanceof CheckCardPart) {
          checkCardData = part.data;
        } else if (handler instanceof DamageCardPart) {
          damageCardData = part.data;
        } else if (handler instanceof ResourceCardPart) {
          resourceCardData = part.data;
        }
      }

      if (damageCardData != null && damageCardData.phase === 'result') {
        newRow.part.data.calc$.autoChangeTarget = false;
        continue rowLoop;
      }
      if (attackCardData != null && attackCardData.phase === 'result') {
        newRow.part.data.calc$.autoChangeTarget = false;
        continue rowLoop;
      }
      if (checkCardData != null) {
        for (const cache of checkCardData.targetCaches$) {
          if (cache.phase === 'result') {
            newRow.part.data.calc$.autoChangeTarget = false;
            continue rowLoop;
          }
        }
      }
      if (resourceCardData != null) {
        for (const cache of resourceCardData.consumeResources) {
          if (cache.calc$.appliedChange > 0) {
            newRow.part.data.calc$.autoChangeTarget = false;
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
      if (newRow.part.data.calc$.tokenUuid == null) {
        continue;
      }
      if (newRow.part.data.calc$.rangeDefinition?.units !== 'self') {
        continue;
      }
      
      let hasTargettableAction = false;
      for (const part of newRow.allParts) {
        if (ModularCard.isType(ActiveEffectCardPart.instance, part)) {
          hasTargettableAction = true;
          break;
        }
        if (ModularCard.isType(AttackCardPart.instance, part)) {
          hasTargettableAction = true;
          break;
        }
        if (ModularCard.isType(DamageCardPart.instance, part)) {
          hasTargettableAction = true;
          break;
        }
        if (ModularCard.isType(CheckCardPart.instance, part)) {
          hasTargettableAction = true;
          break;
        }
      }
      if (!hasTargettableAction) {
        continue;
      }

      if (newRow.part.data.calc$.targetDefinition.type === 'self') {
        await UtilsDocument.setTargets({tokenUuids: [newRow.part.data.calc$.tokenUuid]});
        return;
      }

      const template = MyAbilityTemplate.fromItem({
        target: newRow.part.data.calc$.targetDefinition,
        flags: {
          [staticValues.moduleName]: {
            dmlCallbackMessageId: newRow.messageId,
            dmlCallbackPartId: newRow.part.id,
          }
        }
      });
      if (!template) {
        continue;
      }

      const token = await UtilsDocument.tokenFromUuid(newRow.part.data.calc$.tokenUuid);
      if (token == null) {
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

  private async markOlderAutoChangeTarget(context: IAfterDmlContext<ModularCardTriggerData<TargetCardData>>): Promise<void> {
    const timestamps: number[] = [];
    const excludeMessageIds = new Set<string>();
    for (const {newRow} of context.rows) {
      excludeMessageIds.add(newRow.messageId);
      timestamps.push(game.messages.get(newRow.messageId).data.timestamp);
    }
    const newestMessageCreatedDate = timestamps.sort()[timestamps.length - 1];
    
    const bulkUpdateRequest: Parameters<typeof ModularCard.setBulkCardPartDatas>[0] = [];
    for (let messageIndex = game.messages.contents.length - 1; messageIndex >= 0; messageIndex--) {
      const chatMessage = game.messages.contents[messageIndex];
      if (chatMessage.data.timestamp <= newestMessageCreatedDate || excludeMessageIds.has(chatMessage.id)) {
        continue;
      }
      const parts = ModularCard.getCardPartDatas(chatMessage);
      if (!parts) {
        continue;
      }

      const targetIndex = parts.findIndex(part => ModularCard.getTypeHandler(part.type) instanceof TargetCardPart);
      if (targetIndex) {
        if ((parts[targetIndex].data as TargetCardData).calc$.autoChangeTarget) {
          const partsClone = deepClone(parts);
          (partsClone[targetIndex].data as TargetCardData).calc$.autoChangeTarget = false;
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
      const cachedUuids = newRow.part.data.calc$.tokenData.map(t => t.tokenUuid);
      for (const selected of newRow.part.data.selected) {
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
      for (const entry of newRow.part.data.calc$.tokenData) {
        cache.set(entry.tokenUuid, entry);
      }
      for (const selected of newRow.part.data.selected) {
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

      if (cache.size !== newRow.part.data.calc$.tokenData.length) {
        newRow.part.data.calc$.tokenData = Array.from(cache.values());
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

      const targetIndex = parts.findIndex(part => ModularCard.getTypeHandler(part.type) instanceof TargetCardPart);
      if (targetIndex) {
        // To allow editing, need to clone parts so its not updating the instance which is in the message itself
        // Otherwise when updating, change detection won't pick it up
        // TODO This should be improved by not updating this instance, but since saving does some custom stuff, it makes it tricky
        parts = deepClone(parts);
        targetData = parts[targetIndex].data;
        break;
      }
    }

    if (!targetData || !targetData.calc$.autoChangeTarget || chatMessage.data.user !== game.userId) {
      return;
    }
    
    // Assume targets did not changes when non are selected at this time
    if (game.user.targets.size === 0) {
      return;
    }

    // Don't auto change targets after
    await setTargetsFromUser(targetData, game.user);
    await ModularCard.setCardPartDatas(chatMessage, parts);
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