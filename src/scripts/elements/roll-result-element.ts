import { RunOnce } from "../lib/decorator/run-once";
import { Attribute, BindEvent, Component } from "../lib/render-engine/component";
import { RollData, UtilsRoll } from "../lib/roll/utils-roll";
import { staticValues } from "../static-values";

const supprtedDisplayTypes = ['hidden', 'total', 'result'] as const;
type DisplayType = typeof supprtedDisplayTypes[number];
const defaultDisplayType: DisplayType = 'result';
@Component({
  tag: RollResultElement.selector(),
  html: /*html*/`
  <div class="wrapper{{this.isOpen ? ' open' : ''}}">
    <div *if="this.displayType === 'hidden'" class="boxed">
      &lt;{{this.i18nHidden}}&gt;
    </div>
    <div *if="this.displayType === 'total'" class="roll-total boxed">
      {{this.roll.total}}
    </div>
    <div *if="this.displayType === 'result'">
      <div class="roll-total boxed {{this.rollCssClass}}">{{this.roll.total}}</div>
    
      <div class="top-slot">
        <slot name="top"></slot>
      </div>
      <div class="terms">
        <virtual *for="let term of this.roll.terms" *if="term.results">
          <div class="term-results">
            <div *for="let res of term.results" class="term-result die {{this.getTermCssClasses(term, res)}}">
              <span class="term-value">{{res.result}}</span>
            </div>
          </div>
          <div class="term-flavor">{{term.flavor}}</div>
          <div class="term-total">{{term.total}}</div>
        </virtual>
      </div>
      <div class="bottom-slot">
        <slot name="bottom"></slot>
      </div>
      <div class="roll-formula boxed">{{this.overrideFormula ? this.overrideFormula : this.roll.formula}}</div>

    </div>
  </div>
  `,
  style: /*css*/`
  
  :host {
    display: block;
    font-size: var(--font-size-14, 14px);
  }
  
  :host-context(.hide-flavor) .term-flavor,
  :host.hide-flavor .term-flavor {
    display: none;
  }
  
  :host-context(.hide-flavor) .terms,
  :host.hide-flavor .terms {
    grid-template-columns: auto max-content;
  }
  
  .wrapper:not(.open) .roll-formula,
  .wrapper:not(.open) .terms,
  .wrapper:not(.open) .bottom-slot,
  .wrapper:not(.open) .top-slot {
    display: none;
  }
  
  .boxed {
    position: relative;
    margin: 0;
    line-height: 1.5em;
    text-align: center;
    background: rgba(0, 0, 0, .1);
    border: 1px solid var(--color-border-light-2, #999);
    border-radius: 3px;
    box-shadow: 0 0 2px #fff inset;
    word-break: break-all;
  }
  
  .roll-total {
    font-weight: 700;
  }
  
  .roll-total.success {
    color: green;
  }
  
  .roll-total.failure {
    color: #aa0200;
  }
  
  .terms {
    display: grid;
    grid-template-columns: auto max-content max-content;
    line-height: 1.5em;
    gap: 0 5px;
    border-left: 1px solid var(--color-border-light-2, #999);
    border-right: 1px solid var(--color-border-light-2, #999);
    border-radius: 3px;
  }
  
  .terms .term-results {
    display: flex;
    flex-wrap: wrap;
    flex-grow: 1;
  }
  
  .terms .term-result {
    width: 1.5em;
    height: 1.5em;
    text-align: center;
  }
  
  .terms .term-result .term-value {
    position: relative;
  }
  
  .terms .term-result::before {
    content: "";
    display: block;
    position: absolute;
    background-image: url(/icons/svg/d20-grey.svg);
    background-size: 1.5em 1.5em;
    width: 1.5em;
    height: 1.5em;
  }
  
  .terms .term-result.d4::before {
    background-image: url(/icons/svg/d4-grey.svg);
  }
  
  .terms .term-result.d6::before {
    background-image: url(/icons/svg/d6-grey.svg);
  }
  
  .terms .term-result.d8::before {
    background-image: url(/icons/svg/d8-grey.svg);
  }
  
  .terms .term-result.d10::before {
    background-image: url(/icons/svg/d10-grey.svg);
  }
  
  .terms .term-result.d12::before {
    background-image: url(/icons/svg/d12-grey.svg);
  }
  
  .terms .term-result.d20::before {
    background-image: url(/icons/svg/d20-grey.svg);
  }
  
  .terms .term-result.min {
    color: #aa0200;
  }
  
  .terms .term-result.min::before {
    filter: sepia(5) hue-rotate(-20deg);
  }
  
  .terms .term-result.max {
    color: #18520b;
  }
  
  .terms .term-result.max::before {
    filter: sepia(.5) hue-rotate(60deg);
  }
  
  .terms .term-result.discarded,
  .terms .term-result.rerolled {
    filter: sepia(.5) contrast(.75) opacity(.4);
  }
  
  .terms .term-result.exploded:before {
    font-size: var(--font-size-8, 8px);
    font-family: "Font Awesome 5 Free";
    content: "\f666";
    position: absolute;
    top: -8px;
    right: 0;
  }
  
  .terms .term-result.success {
    color: #18520b;
    filter: sepia(.5) hue-rotate(60deg);
  }
  
  .terms .term-result.failure {
    color: #aa0200;
    filter: sepia(.5) hue-rotate(-60deg);
  }
  
  .terms .term-flavor {
    font-size: .85em;
    color: var(--color-text-dark-secondary, #4b4a4b);
  }
  
  .terms .term-total {
    text-align: center;
    font-weight: 700;
    padding: 0 5px;
    background: rgba(0, 0, 0, .1);
    border-left: 1px solid var(--color-text-light, #999);
  }
  
  .terms .term-total:nth-child(3) {
    border-top-left-radius: 3px;
  }
  
  .terms .term-total:last-child {
    border-bottom-left-radius: 3px;
  }
  `
})
export class RollResultElement {

  public static selector(): string {
    return `${staticValues.code}-roll-result`;
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
    this.calcRollCssClass();
  }
  
  private _highlightTotalOnFirstTerm = false;
  @Attribute({name: 'data-highlight-total-on-firstTerm', dataType: 'boolean'})
  public get highlightTotalOnFirstTerm(): boolean {
    return this._highlightTotalOnFirstTerm;
  }
  public set highlightTotalOnFirstTerm(v: boolean) {
    this._highlightTotalOnFirstTerm = v;
    this.calcRollCssClass();
  }

  @Attribute('data-override-formula')
  public overrideFormula: string;

  private _displayType: string = defaultDisplayType;
  @Attribute({name: 'data-display-type', dataType: 'string'})
  public get displayType(): string {
    return this._displayType;
  }
  public set displayType(value: string) {
    value = value?.toLowerCase();
    if (supprtedDisplayTypes.includes(value as DisplayType)) {
      this._displayType = value;
    } else {
      this._displayType = defaultDisplayType;
    }
  }

  private _overrideMaxRoll: number;
  @Attribute({name: 'data-override-max-roll', dataType: 'number'})
  public get overrideMaxRoll(): number {
    return this._overrideMaxRoll;
  }
  public set overrideMaxRoll(v: number) {
    this._overrideMaxRoll = v;
    this.calcRollCssClass();
  }
  //#endregion

  public i18nHidden = game.i18n.localize('Hidden');

  public rollCssClass = '';
  private calcRollCssClass(): void {
    if (this._roll == null) {
      this.rollCssClass = '';
      return;
    }

    let max = true;
    let min = true;
    let hasDie = false;

    for (const term of this._roll.terms) {
      if (term instanceof Die) {
        hasDie = true;
        for (const result of term.results) {
          if (result.active && result.result < (this.overrideMaxRoll ?? (term as DiceTerm.Data).faces)) {
            max = false;
          }
          if (result.active && result.result > 1) {
            min = false;
          }
        }
        if (this.highlightTotalOnFirstTerm) {
          break;
        }
      }
    }

    if (!hasDie) {
      this.rollCssClass = '';
    } else if (max) {
      this.rollCssClass = 'success';
    } else if (min) {
      this.rollCssClass = 'failure';
    } else {
      this.rollCssClass = '';
    }
  }

  public getTermCssClasses(term: DiceTerm, dieResult: DiceTerm.Result): string {
    const classes: string[] = [`d${term.faces}`];

    if (dieResult.success) {
      classes.push('success');
    }
    if (dieResult.failure) {
      classes.push('failure');
    }
    if (dieResult.exploded) {
      classes.push('exploded');
    }
    if (dieResult.discarded) {
      classes.push('discarded');
    }
    if (dieResult.success) {
      classes.push('success');
    }
    if (term.faces === dieResult.result) {
      classes.push('max');
    }
    if (1 === dieResult.result) {
      classes.push('min');
    }

    return ' ' + classes.join(' ');
  }

  public isOpen = false;
  @BindEvent('click')
  public onclick(event: MouseEvent): void {
    if (event.target instanceof HTMLInputElement) {
      return;
    }
    if (event.target instanceof HTMLButtonElement) {
      return;
    }
    if (event.target instanceof HTMLSelectElement) {
      return;
    }

    this.isOpen = !this.isOpen;
  }

  @RunOnce()
  public static registerHooks(): void {
  }

}