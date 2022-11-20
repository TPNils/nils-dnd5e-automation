import { UtilsDocument } from "../lib/db/utils-document";
import { RunOnce } from "../lib/decorator/run-once";
import { Attribute, Component, Output } from "../lib/render-engine/component";
import { RollData, UtilsRoll } from "../lib/roll/utils-roll";
import { DamageCardData } from "../modular-card/base";
import { staticValues } from "../static-values";
import { RollResultElement } from "./roll-result-element";

const rollModeOrder = ['normal', 'critical'] as const;
export type RollDamageMode = typeof rollModeOrder[number];

export interface RollDamageEventData<T> {
  quickRoll: boolean;
  data: T;
}

const dedupeEventData = (oldValue: RollDamageEventData<string>, newValue: RollDamageEventData<string>) => {
 return oldValue?.data === newValue?.data;   
}

@Component({
  tag: RollDamageElement.selector(),
  html: /*html*/`
    <div class="roll-wrapper">
      <nac-roll-result *if="this.roll.total != null"
        [data-roll]="this.roll"
        [data-override-formula]="this.overrideFormula"
        [data-display-type]="this.hasReadPermission ? '' : this.readHiddenDisplayType">
        <div slot="top">
          <input *if="this.hasInteractPermission"
            class="user-bonus" placeholder="{{this.localeBonus}}: {{this.localeRollExample}}"
            type="text"
            value="{{this.userBonus}}"
            (blur)="this.onBonusBlur($event)"
            (keyup)="this.onBonusKeyUp($event)"/>
        </div>
      </nac-roll-result>

      <div class="bonus-container" *if="this.roll?.total == null">
        <button class="roll-button" [disabled]="!this.hasInteractPermission" (click)="this.onRollClick($event)">
          <slot name="label">
            <div class="label-text">
              {{ this.rollModeLabel }}
            </div>
          </slot>
        </button>
        
        <input *if="this.showBonus && this.hasInteractPermission"
          autofocus
          class="user-bonus" placeholder="{{this.localeBonus}}: {{this.localeRollExample}}"
          type="text"
          value="{{this.userBonus}}"
          (blur)="this.onBonusBlur($event)"
          (keyup)="this.onBonusKeyUp($event)"/>
      </div>

      <div class="overlay" *if="this.hasInteractPermission">
        <div class="left">
          <button (click)="this.onModeChange($event, '-')" class="mode-minus" [disabled]="this.rollMode === 'normal'"><i class="fas fa-minus"></i></button>
        </div>
        <div class="middel"></div>
        <div class="right">
          <button *if="this.hasVersatile" (click)="this.onRollSourceClick($event)" class="damage-source-toggle source-{{this.rollSource}}">
            <i class="fas fa-hand-holding hand-1" data-fa-transform="rotate-90"></i>
            <i class="fas fa-hand-holding hand-2" data-fa-transform="rotate-90"></i>
          </button>
          <button (click)="this.onModeChange($event, '+')" class="mode-plus" [disabled]="this.rollMode === 'critical'"><i class="fas fa-plus"></i></button>
        </div>
      </div>
    </div>
  `,
  style: /*css*/`
    
    :host {
      display: block;
      font-size: var(--font-size-14, 14px);
    }
    
    :host.snug {
      --button-height: 1.5em;
    }
    
    :host:not(:hover) .roll-wrapper .overlay {
      display: none;
    }
    
    .bonus-container {
      position: relative;
    }
    
    .bonus-container .user-bonus {
      position: absolute;
      background: #c1c1b6;
      margin-left: 2px;
      z-index: 1;
      left: 0;
      top: 100%;
    }
    
    nac-roll-result {
      font-size: 1em;
    }
    
    .roll-wrapper {
      position: relative;
    }
    
    .roll-wrapper .advantage-icon,
    .roll-wrapper .disadvantage-icon,
    .roll-wrapper .normal-mode-icon {
      width: calc(var(--button-height) - 4px);
      height: calc(var(--button-height) - 4px)
    }
    
    .roll-wrapper .advantage-icon .d20 {
      color: green
    }
    
    .roll-wrapper .advantage-icon .arrow-up {
      transform: translate(.15em, .15em);
      color: #000
    }
    
    .roll-wrapper .disadvantage-icon .d20 {
      color: #c81627
    }
    
    .roll-wrapper .disadvantage-icon .arrow-down {
      transform: rotate(180deg) translate(-1.1em, -1.1em);
      color: #000
    }
    
    .roll-wrapper .mode-minus,
    .roll-wrapper .mode-plus,
    .roll-wrapper .damage-source-toggle {
      font-size: 1em;
      background: #f2f2e3;
      border: 1px solid #b5b3a4;
      line-height: 0;
      height: calc(1.5em - 1px);
      width: calc(1.5em - 1px);
      margin: 0 1px;
      padding: 0
    }
    
    .damage-source-toggle {
      position: relative;
    }

    .damage-source-toggle.source-normal .hand-1 {
      opacity: .5;
    }

    .hand-1,
    .hand-2 {
      font-size: 10px;
    }

    .damage-source-toggle .hand-1 {
      transform: translateY(-50%) rotate(90deg) scaleX(-1);
      position: absolute;
      left: 2px;
      top: 50%;
    }

    .damage-source-toggle .hand-2 {
      transform: translateY(-50%) rotate(270deg);
      position: absolute;
      right: 1px;
      top: 50%;
    }
    
    .roll-wrapper .mode-minus>i,
    .roll-wrapper .mode-plus>i {
      font-size: .7em
    }
    
    .roll-wrapper .mode-minus[disabled],
    .roll-wrapper .mode-plus[disabled] {
      color: inherit;
      opacity: .5
    }
    
    .roll-wrapper .mode-minus {
      color: red
    }
    
    .roll-wrapper .mode-plus {
      color: #4f8a10
    }
  `
})
export class RollDamageElement {

  public static selector(): string {
    return `${staticValues.code}-roll-damage`;
  }

  //#region input
  private _roll: Roll;
  @Attribute({name: 'data-roll', dataType: 'object'})
  public get roll(): Roll {
    return this._roll;
  }
  public set roll(value: Roll | RollData) {
    if (value instanceof Roll) {
      this._roll = value;
    } else if (value == null) {
      this._roll = null;
    } else {
      this._roll = UtilsRoll.fromRollData(value);
    }
    this.calcRollModeLabel();
  }
  
  private _label: string;
  @Attribute({name: 'data-label', dataType: 'string'})
  public get label(): string {
    return this._label;
  }
  public set label(v: string) {
    this._label = game.i18n.localize(v);
    this.calcRollModeLabel();
  }

  @Attribute({name: 'data-bonus-formula', dataType: 'string'})
  public set setUserBonus(value: string) {
    if (value == null) {
      this.userBonus = '';
    } else {
      this.userBonus = value;
    }
  }

  @Attribute({name: 'data-override-formula', dataType: 'string'})
  public overrideFormula: string;

  private _interactionPermission: string[];
  @Attribute({name: 'data-interaction-permission'})
  public get setInteractionPermission(): string[] {
    return this._interactionPermission;
  }
  public set setInteractionPermission(v: string | string[]) {
    this._interactionPermission = Array.isArray(v) ? v : [v];
    this.calcInteractPermission();
  }

  private _readPermission: string[];
  @Attribute({name: 'data-read-permission'})
  public get readPermission(): string[] {
    return this._readPermission;
  }
  public set readPermission(v: string | string[]) {
    this._readPermission = Array.isArray(v) ? v : [v];
    this.calcReadPermission();
  }
  
  private _readHiddenDisplayType : RollResultElement['displayType'];
  @Attribute({name: 'data-read-hidden-display-type', dataType: 'string'})
  public get readHiddenDisplayType(): RollResultElement['displayType'] {
    return this._readHiddenDisplayType;
  }
  public set readHiddenDisplayType(v: RollResultElement['displayType']) {
    this._readHiddenDisplayType = v;
    this.calcRollModeLabel();
  }

  private _rollMode : RollDamageMode = 'normal';
  @Attribute({name: 'data-roll-mode', dataType: 'string'})
  public get rollMode() : RollDamageMode {
    return this._rollMode;
  }
  public set rollMode(v : RollDamageMode) {
    this._rollMode = v;
    this.calcRollModeLabel();
  }
  
  private _rollSource: DamageCardData['source'] = 'normal';
  @Attribute({name: 'data-roll-source', dataType: 'string'})
  public get rollSource(): DamageCardData['source'] {
    return this._rollSource;
  }
  public set rollSource(v: DamageCardData['source']) {
    this._rollSource = v;
    this.calcRollModeLabel();
  }

  private _hasVersatile = false;
  @Attribute({name: 'data-has-versatile', dataType: 'boolean'})
  public get hasVersatile(): boolean {
    return this._hasVersatile;
  }
  public set hasVersatile(v: boolean) {
    this._hasVersatile = v;
  }
  
  //#endregion

  public localeBonus = game.i18n.localize(`DND5E.Bonus`);
  public localeRollExample = game.i18n.localize(`DND5E.RollExample`);
  
  public rollModeLabel = game.i18n.localize(`DND5E.${this.rollMode.capitalize()}`);
  private calcRollModeLabel() {
    if (this.rollMode == null) {
      // Fallback
      this.rollModeLabel = game.i18n.localize(`DND5E.Normal`);
    } else if (!this.hasReadPermission && this.readHiddenDisplayType !== 'result') {
      // Can't see roll details => don't show if it's normal or crit
      this.rollModeLabel = game.i18n.localize(`DND5E.Normal`);
    } else {
      if (this.label && this.rollMode.toLowerCase() === 'normal') {
        this.rollModeLabel = this.label;
      } else {
        this.rollModeLabel = game.i18n.localize(`DND5E.${this.rollMode.capitalize()}`);
      }
    }
  }
  
  public hasReadPermission = true;
  private async calcReadPermission() {
    if (!this.readPermission || this.readPermission.length === 0) {
      this.hasReadPermission = true;
    }

    const response = await UtilsDocument.hasPermissionsFromString(this.readPermission);
    this.hasReadPermission = response.some(check => check.result);
    this.calcRollModeLabel();
  }
  
  public hasInteractPermission = true;
  private async calcInteractPermission() {
    if (!this.setInteractionPermission || this.setInteractionPermission.length === 0) {
      this.hasInteractPermission = true;
    }

    const response = await UtilsDocument.hasPermissionsFromString(this.setInteractionPermission);
    this.hasInteractPermission = response.some(check => check.result);
  }

  //#region template callbacks
  private userBonus: string = '';
  public onBonusBlur(event: FocusEvent): void {
    if (event.relatedTarget instanceof HTMLElement) {
      // Do not fire this if roll is pressed (focusout triggers first)
      if (event.relatedTarget.matches(`.roll-button`) || event.relatedTarget.closest(`.roll-button`) != null) {
        return;
      }
    }
    this.showBonus = false;
    if (event.target instanceof HTMLInputElement) {
      const userBonus = event.target.value == null ? '' : event.target.value;
      if (this.userBonus === userBonus) {
        return;
      }
      if (userBonus && !Roll.validate(userBonus)) {
        ui.notifications.error(game.i18n.localize('Error') + ': ' + game.i18n.localize('Roll Formula'));
        event.target.value = this.userBonus;
        return;
      }
      this.userBonus = userBonus;
      if (this.roll?.total != null) {
        this.doRollEmitter = {userBonus: this.userBonus};
      }
    }
  }
  public onBonusKeyUp(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement) {
      switch (event.key) {
        case 'Enter':
          const userBonus = event.target.value == null ? '' : event.target.value;
          if (userBonus && !Roll.validate(userBonus)) {
            ui.notifications.error(game.i18n.localize('Error') + ': ' + game.i18n.localize('Roll Formula'));
            event.target.value = this.userBonus;
            return;
          }
          this.userBonus = userBonus;
          this.doRollEmitter = {userBonus: this.userBonus};
          event.target.blur();
          break;
        case 'Escape':
          event.target.blur();
          break;
      }
    }
  }

  @Output({eventName: 'rollMode', deduplicate: dedupeEventData})
  private rollModeChange: RollDamageEventData<RollDamageMode>;
  public onModeChange(event: MouseEvent, action: '+' | '-'): void {
    let modifier = action === '+' ? 1 : -1;
    if (event.shiftKey && modifier > 0) {
      modifier++;
    } else if (event.shiftKey && modifier < 0) {
      modifier--;
    }
    
    const newIndex = Math.max(0, Math.min(rollModeOrder.length-1, rollModeOrder.indexOf(this.rollMode) + modifier));
    if (this.rollMode === rollModeOrder[newIndex]) {
      return;
    }
    this.rollModeChange = {
      quickRoll: event.shiftKey,
      data: rollModeOrder[newIndex],
    };
  }

  @Output({eventName: 'rollSource', deduplicate: dedupeEventData})
  private rollSourceChange: RollDamageEventData<DamageCardData['source']>;
  public onRollSourceClick(event: MouseEvent) {
    this.rollSourceChange = {
      quickRoll: event.shiftKey,
      data: this.rollSource === 'normal' ? 'versatile' : 'normal',
    };
  }
  
  public showBonus = false;
  @Output('doRoll')
  public doRollEmitter: {userBonus?: string;};
  public onRollClick(event: MouseEvent): void {
    if (this.roll?.total != null) {
      this.showBonus = !this.showBonus;
      return;
    }

    if (!event.shiftKey && !this.showBonus) {
      this.showBonus = true;
      return;
    }
    
    if (this.showBonus) {
      this.doRollEmitter = {userBonus: this.userBonus};
    } else {
      this.doRollEmitter = {};
    }
  }
  //#endregion

  @RunOnce()
  public static registerHooks(): void {
    
  }

}