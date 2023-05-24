import { UtilsDocument } from "../lib/db/utils-document";
import { RunOnce } from "../lib/decorator/run-once";
import { AsyncAttribute, Attribute, Component, OnInit, OnInitParam, Output } from "../lib/render-engine/component";
import { RollData, UtilsRoll } from "../lib/roll/utils-roll";
import { ValueReader } from "../provider/value-provider";
import { staticValues } from "../static-values";
import { RollResultElement } from "./roll-result-element";

export interface RollEventData<T> {
  quickRoll: boolean;
  data: T;
}

@Component({
  tag: RollElement.selector(),
  html: /*html*/`
    <div class="roll-wrapper">
      <nd5a-roll-result *if="this.roll?.total != null && (this.readHiddenDisplayType !== 'hidden' || this.hasInteractPermission)"
        [data-roll]="this.roll"
        [data-override-formula]="this.overrideFormula"
        [data-highlight-total-on-firstTerm]="this.highlightTotalOnFirstTerm"
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
      </nd5a-roll-result>

      <div class="bonus-container" *if="this.roll?.total == null || (this.readHiddenDisplayType === 'hidden' && !this.hasInteractPermission)">
        <button class="roll-button" [disabled]="!this.hasInteractPermission" (click)="this.onRollClick($event)">
          <slot name="label">
            <div class="label-text">
              {{ this.localeRoll }}
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
  
  nd5a-roll-result {
    font-size: 1em;
  }
  
  .roll-wrapper {
    position: relative;
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
export class RollElement implements OnInit {

  public static selector(): string {
    return `${staticValues.code}-roll`;
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

  @Attribute({name: 'data-highlight-total-on-firstTerm', dataType: 'boolean'})
  public highlightTotalOnFirstTerm: boolean = true;

  @AsyncAttribute({name: 'data-can-interact'})
  private canInteract$: ValueReader<boolean>;

  @AsyncAttribute({name: 'data-can-read'})
  private canRead$: ValueReader<boolean>;
  
  @Attribute({name: 'data-read-hidden-display-type', dataType: 'string'})
  public readHiddenDisplayType: RollResultElement['displayType'] | 'hidden';

  @Attribute({name: 'data-override-max-roll', dataType: 'number'})
  public overrideMaxRoll: string;
  //#endregion

  public localeBonus = game.i18n.localize(`DND5E.Bonus`);
  public localeRoll = game.i18n.localize(`DND5E.Roll`);
  public localeRollExample = game.i18n.localize(`DND5E.RollExample`);
  
  public hasReadPermission = true;
  public hasInteractPermission = true;
  public onInit(args: OnInitParam): void {
    args.addStoppable(
      this.canRead$.listen(response => this.hasReadPermission = response),
      this.canInteract$.listen(response => this.hasInteractPermission = response),
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