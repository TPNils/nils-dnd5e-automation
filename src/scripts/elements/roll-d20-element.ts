import { UtilsDocument } from "../lib/db/utils-document";
import { RunOnce } from "../lib/decorator/run-once";
import { AsyncAttribute, Attribute, Component, OnInit, OnInitParam, Output } from "../lib/render-engine/component";
import { RollData, UtilsRoll } from "../lib/roll/utils-roll";
import { ValueReader } from "../provider/value-provider";
import { staticValues } from "../static-values";
import { RollResultElement } from "./roll-result-element";

const rollModeOrder = ['disadvantage', 'normal', 'advantage'] as const;
export type RollMode = typeof rollModeOrder[number];

export interface RollD20EventData<T> {
  quickRoll: boolean;
  data: T;
}

const dedupeEventData = (oldValue: RollD20EventData<string>, newValue: RollD20EventData<string>) => {
 return oldValue?.data === newValue?.data;   
}

@Component({
  tag: RollD20Element.selector(),
  html: /*html*/`
    <div class="roll-wrapper">
      <nd5e-roll-result *if="this.roll?.total != null && (this.readHiddenDisplayType !== 'hidden' || this.hasInteractPermission)"
        [data-roll]="this.roll"
        [data-override-formula]="this.overrideFormula"
        [data-highlight-total-on-first-term]="this.highlightTotalOnFirstTerm"
        [data-display-type]="this.hasReadPermission ? '' : this.readHiddenDisplayType"
        [data-override-max-roll]="this.overrideMaxRoll">
        <div slot="top">
          <input *if="this.hasInteractPermission"
            class="user-bonus" placeholder="{{this.localeBonus}}: {{this.localeRollExample}}"
            type="text"
            value="{{this.userBonus}}"
            (blur)="this.onBonusBlur($event)"
            (keyup)="this.onBonusKeyUp($event)"/>
        </div>
      </nd5e-roll-result>

      <div class="bonus-container" *if="this.roll?.total == null || (this.readHiddenDisplayType === 'hidden' && !this.hasInteractPermission)">
        <button class="roll-button" [disabled]="!this.hasInteractPermission" (click)="this.onRollClick($event)">
          <slot name="label">
            <div class="label-text" *if="this.label && this.rollMode === 'normal'">
              {{ this.label }}
            </div>
            <div class="label-text" *if="!this.label || this.rollMode !== 'normal'">
              {{ this.rollModeLabel }}
            </div>
            <div class="label-icon">
              <svg class="advantage-icon" *if="this.rollMode === 'advantage'">
                <use class="d20" xlink:href="/modules/${staticValues.moduleName}/assets/icons/d20.svg#d20"/>
                <use class="arrow-up" xlink:href="/modules/${staticValues.moduleName}/assets/icons/arrow-up.svg#arrow-up"  width=".9em" height=".9em"></use>
              </svg>
              <svg class="disadvantage-icon" *if="this.rollMode === 'disadvantage'">
                <use class="d20" xlink:href="/modules/${staticValues.moduleName}/assets/icons/d20.svg#d20"/>
                <use class="arrow-down" xlink:href="/modules/${staticValues.moduleName}/assets/icons/arrow-up.svg#arrow-up"  width=".9em" height=".9em"></use>
              </svg>
              <svg class="normal-mode-icon" *if="this.rollMode === 'normal'">
                <use class="d20" xlink:href="/modules/${staticValues.moduleName}/assets/icons/d20.svg#d20"/>
              </svg>
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
          <button (click)="this.onModeChange($event, '-')" class="mode-minus" [disabled]="this.rollMode === 'disadvantage'"><i class="fas fa-minus"></i></button>
        </div>
        <div class="middle"></div>
        <div class="right">
          <button (click)="this.onModeChange($event, '+')" class="mode-plus" [disabled]="this.rollMode === 'advantage'"><i class="fas fa-plus"></i></button>
        </div>
      </div>
    </div>
  `,
  style: scss`
  @import 'overlay.scss';

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
  
  nd5e-roll-result {
    font-size: 1em;
  }
  
  .roll-wrapper {
    position: relative;
  }
  
  .roll-wrapper .advantage-icon,
  .roll-wrapper .disadvantage-icon,
  .roll-wrapper .normal-mode-icon {
    display: block;
    width: calc(var(--button-height) - var(--button-height) / 5);
    height: calc(var(--button-height) - var(--button-height) / 5);
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
  .roll-wrapper .mode-plus {
    font-size: 1em;
    background: #f2f2e3;
    border: 1px solid #b5b3a4;
    line-height: 0;
    height: calc(var(--button-height) - calc(var(--button-height) / 5));
    width: calc(var(--button-height) - calc(var(--button-height) / 5));
    margin: 0 1px;
    padding: 0;

    > i {
      font-size: .7em;
      transform: translateX(10%);
    }
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

  /* Show only label text by default */
  .label-text {
    display: block;
  }
  .label-icon {
    display: none;
  }
  
  /* Allow to use icons */
  :host[data-label-type="icon"] .label-text {
    display: none;
  }
  :host[data-label-type="icon"] .label-icon {
    display: block;
  }
  `
})
export class RollD20Element implements OnInit {

  public static selector(): string {
    return `${staticValues.code}-roll-d20`;
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
    this.calcRollMode();
  }
  
  private _label: string;
  @Attribute({name: 'data-label', dataType: 'string'})
  public get label(): string {
    return this._label;
  }
  public set label(v: string) {
    this._label = game.i18n.localize(v);
  }

  @Attribute({name: 'data-bonus-formula', dataType: 'string'})
  public set setUserBonus(value: string) {
    if (value == null) {
      this.userBonus = '';
    } else {
      this.userBonus = value;
    }
  }

  /**
   * The roll mode when the roll was not rolled yet
   */
  @Attribute({name: 'data-roll-mode', dataType: 'string'})
  public set setRollMode(value: RollMode) {
    value = value.toLowerCase() as RollMode;
    if (this._roll == null || !rollModeOrder.includes(value)) {
      return;
    }
    this.rollMode = value;
    this.calcRollMode();
  }

  @Attribute({name: 'data-override-formula', dataType: 'string'})
  public overrideFormula: string;

  @Attribute({name: 'data-highlight-total-on-firstTerm', dataType: 'boolean'})
  public highlightTotalOnFirstTerm: boolean = true;

  @AsyncAttribute({name: 'data-interaction-permission'})
  private interactionPermission: ValueReader<string | string[]>;

  @AsyncAttribute({name: 'data-read-permission'})
  private readPermission: ValueReader<string | string[]>;
  
  @Attribute({name: 'data-read-hidden-display-type', dataType: 'string'})
  public readHiddenDisplayType: RollResultElement['displayType'] | 'hidden';

  @Attribute({name: 'data-override-max-roll', dataType: 'number'})
  public overrideMaxRoll: string;
  //#endregion

  public localeBonus = game.i18n.localize(`DND5E.Bonus`);
  public localeRollExample = game.i18n.localize(`DND5E.RollExample`);

  public rollMode: RollMode = 'normal';
  public rollModeLabel = game.i18n.localize(`DND5E.${this.rollMode.capitalize()}`);
  private calcRollMode() {
    if (this._roll != null) {
      const firstTerm = this._roll.terms[0] as DiceTerm;
      if (firstTerm?.modifiers?.includes('kh')) {
        this.rollMode = 'advantage';
      } else if (firstTerm?.modifiers?.includes('kl')) {
        this.rollMode = 'disadvantage';
      } else {
        this.rollMode = 'normal';
      }
    }

    if (this.hasReadPermission && this.readHiddenDisplayType !== 'result') {
      this.rollModeLabel = game.i18n.localize(`DND5E.${this.rollMode.capitalize()}`);
    } else {
      if (this._roll?.total == null || this.readHiddenDisplayType === 'hidden') {
        this.rollModeLabel = game.i18n.localize(`DND5E.Normal`);
      } else {
        this.rollModeLabel = `<${game.i18n.localize(`Hidden`)}>`;
      }
    }
  }
  
  public hasReadPermission = true;
  public hasInteractPermission = true;
  public onInit(args: OnInitParam): void {
    args.addStoppable(
      this.readPermission
        .map(value => Array.isArray(value) ? value : [value])
        .switchMap(readPermission => UtilsDocument.hasPermissionsFromString(readPermission))
        .listen(response => {
          this.hasReadPermission = response.some(check => check.result);
          this.calcRollMode();
        }),
      this.interactionPermission
        .map(value => Array.isArray(value) ? value : [value])
        .switchMap(interactionPermission => UtilsDocument.hasPermissionsFromString(interactionPermission))
        .listen(response => {
          this.hasInteractPermission = response.some(check => check.result);
        })
    )
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
  private rollModechange: RollD20EventData<RollMode>;
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
    // If no roll is passed, set the new rollmode manually
    this.rollMode = rollModeOrder[newIndex];
    // If a roll is present, recalc it
    this.calcRollMode();
    
    this.rollModechange = {
      quickRoll: event.shiftKey,
      data: rollModeOrder[newIndex],
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