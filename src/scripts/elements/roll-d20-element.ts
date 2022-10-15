import { UtilsDocument } from "../lib/db/utils-document";
import { RunOnce } from "../lib/decorator/run-once";
import { Attribute, Component, Output } from "../lib/render-engine/component";
import { RollData, UtilsRoll } from "../lib/roll/utils-roll";
import { staticValues } from "../static-values";

const rollModeOrder = ['disadvantage', 'normal', 'advantage'] as const;
export type RollMode = typeof rollModeOrder[number];

const userBonus = /*html*/`
<input *if="this.showBonus && this.hasInteractPermission" class="user-bonus" placeholder="{{this.localeBonus}}: {{this.localeRollExample}}" type="text" value="{{this.bonusFormula}}" (blur)="this.onBonusChange($event)" data-action="user-bonus"/>
`;
@Component({
  tag: RollD20Element.selector(),
  html: /*html*/`
    <div class="flavor">
      <slot name="label" *if="this.roll.total != null">
        {{ this.rollModeLabel }}
      </slot>
    </div>
    <div class="roll-wrapper">
      <nac-roll-result *if="this.roll.total != null"
        [data-roll]="this.roll"
        [data-override-formula]="this.overrideFormula"
        [data-highlight-total-on-firstTerm]="this.highlightTotalOnFirstTerm"
        [data-display-type]="this.hasReadPermission ? '' : readHiddenDisplayType"
        [data-override-max-roll]="this.overrideMaxRoll">
        <div slot="top" *if="this.showBonus">
          ${userBonus}
        </div>
      </nac-roll-result>

      <div class="bonus-container" *if="this.roll.total == null">
        <button data-action="roll" class="roll-button" [disabled]="!this.hasInteractPermission">
          <slot name="label">
            <virtual *if="this.label && this.mode === 'normal'">
              {{ this.label }}
            </virtual>
            <virtual *if="this.label && this.mode !== 'normal'">
              {{ this.rollModeLabel }}
            </virtual>
            <virtual *if="!this.label">
              <svg class="advantage-icon" *if="this.mode === 'advantage'">
                <use class="d20" xlink:href="/modules/{{@root.moduleName}}/assets/icons/d20.svg#d20"/>
                <use class="arrow-up" xlink:href="/modules/{{@root.moduleName}}/assets/icons/arrow-up.svg#arrow-up"  width=".9em" height=".9em"></use>
              </svg>
              <svg class="disadvantage-icon" *if="this.mode === 'disadvantage'">
                <use class="d20" xlink:href="/modules/{{@root.moduleName}}/assets/icons/d20.svg#d20"/>
                <use class="arrow-down" xlink:href="/modules/{{@root.moduleName}}/assets/icons/arrow-up.svg#arrow-up"  width=".9em" height=".9em"></use>
              </svg>
              <svg class="normal-mode-icon" *if="this.mode === 'normal'">
                <use class="d20" xlink:href="/modules/{{@root.moduleName}}/assets/icons/d20.svg#d20"/>
              </svg>
            </virtual>
          </slot>
        </button>
        
        ${userBonus}
      </div>

      <div class="overlay" *if="this.hasInteractPermission">
        <div class="left">
          <button (click)="this.onModeChange($event, '-')" class="mode-minus" [disabled]="this.mode === 'disadvantage'"><i class="fas fa-minus"></i></button>
        </div>
        <div class="middel"></div>
        <div class="right">
          <button (click)="this.onModeChange($event, '+')" class="mode-plus" [disabled]="this.mode === 'advantage'"><i class="fas fa-plus"></i></button>
        </div>
      </div>
    </div>
  `,
  style: /*css*/`
  :host-context(.hide-flavor) .flavor,
  :host.hide-flavor .flavor {
    display: none;
  }
  
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
  
  .flavor {
    margin-top: 2px;
    text-align: center;
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
  .roll-wrapper .mode-plus {
    font-size: 1em;
    background: #f2f2e3;
    border: 1px solid #b5b3a4;
    line-height: 0;
    height: calc(1.5em - 1px);
    width: calc(1.5em - 1px);
    margin: 0 1px;
    padding: 0
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
export class RollD20Element {

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

  @Attribute({name: 'data-show-bonus', dataType: 'boolean'})
  public showBonus: string;

  @Attribute({name: 'data-bonus-formula', dataType: 'string'})
  @Output({eventName: 'data-bonus-formula', deduplicate: true})
  public bonusFormula: string = '';

  @Attribute({name: 'data-override-formula', dataType: 'string'})
  public overrideFormula: string;

  @Attribute({name: 'data-highlight-total-on-firstTerm', dataType: 'boolean'})
  public highlightTotalOnFirstTerm: boolean = true;

  private _interactionPermission: string[];
  @Attribute({name: 'data-interaction-permission'})
  public get interactionPermission(): string[] {
    return this._interactionPermission;
  }
  public set interactionPermission(v: string | string[]) {
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
  
  @Attribute({name: 'data-read-hidden-display-type', dataType: 'string'})
  public readHiddenDisplayType: string;

  @Attribute({name: 'data-override-max-roll', dataType: 'number'})
  public overrideMaxRoll: string;
  //#endregion

  public localeBonus = game.i18n.localize(`DND5E.Bonus`);
  public localeRollExample = game.i18n.localize(`DND5E.RollExample`);

  public rollMode: RollMode = 'normal';
  public rollModeLabel = game.i18n.localize(`DND5E.${this.rollMode.capitalize()}`);
  private calcRollMode() {
    if (this._roll == null) {
      this.rollMode = 'normal';
    } else {
      const firstTerm = this._roll.terms[0] as DiceTerm;
      if (firstTerm?.modifiers?.includes('kh')) {
        this.rollMode = 'advantage';
      } else if (firstTerm?.modifiers?.includes('kl')) {
        this.rollMode = 'disadvantage';
      } else {
        this.rollMode = 'normal';
      }
    }

    this.rollModeLabel = game.i18n.localize(`DND5E.${this.rollMode.capitalize()}`);
  }
  
  public hasReadPermission = true;
  private async calcReadPermission() {
    if (!this.readPermission || this.readPermission.length === 0) {
      this.hasReadPermission = true;
    }

    const response = await UtilsDocument.hasPermissionsFromString(this.readPermission);
    this.hasReadPermission = response.some(check => check.result);
  }
  
  public hasInteractPermission = true;
  private async calcInteractPermission() {
    if (!this.interactionPermission || this.interactionPermission.length === 0) {
      this.hasInteractPermission = true;
    }

    const response = await UtilsDocument.hasPermissionsFromString(this.interactionPermission);
    this.hasInteractPermission = response.some(check => check.result);
  }

  //#region template callbacks
  public onBonusChange(event: FocusEvent): void {
    if (event.target instanceof HTMLInputElement) {
      this.bonusFormula = event.target.value;
    }
  }
  @Output('roll-mode')
  public rollModeEmitter: RollMode;
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
    this.rollModeEmitter = rollModeOrder[newIndex];
  }
  //#endregion

  @RunOnce()
  public static registerHooks(): void {
    
  }

}