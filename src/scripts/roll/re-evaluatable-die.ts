import { staticValues } from "../static-values";

export type WrappedDie = Die & {
  [`_nils-automated-compendium-original-reroll`]: Die['reroll'];
}

export class ReEvaluatableDie extends Die {

  constructor(delegate: Die) {
    super(delegate as Die.TermData);
  }

  public static wrap(dice: Die | Die[]): void {
    dice = Array.isArray(dice) ? dice : [dice as Die];

    for (const die of dice) {
      (die as WrappedDie)['_nils-automated-compendium-original-reroll'] = die.reroll;
      die.reroll = ReEvaluatableDie.prototype.reroll;
    }
  }

  public static unwrap(dice: Die | Die[]): void {
    dice = Array.isArray(dice) ? dice : [dice as Die];

    for (const die of (dice as WrappedDie[])) {
      if (die['_nils-automated-compendium-original-reroll']) {
        die.reroll = die['_nils-automated-compendium-original-reroll'];
      }
    }
  }

  /**
   * Re-roll the Die, rolling additional results for any values which fall within a target set.
   * If no target number is specified, re-roll the lowest possible result.
   *
   * 20d20r         reroll all 1s
   * 20d20r1        reroll all 1s
   * 20d20r=1       reroll all 1s
   * 20d20r1=1      reroll a single 1
   *
   * @param modifier - The matched modifier query
   * @param recursive - Reroll recursively, continuing to reroll until the condition is no longer met
   * @returns False if the modifier was unmatched
   */
  public reroll(modifier: string, {recursive}: {recursive?: boolean} = {}): boolean | void {
    // Match the re-roll modifier
    const rgx = /rr?([0-9]+)?([<>=]+)?([0-9]+)?/i;
    const match = modifier.match(rgx);
    if ( !match ) return false;
    let [max, comparison, target]: Array<string | number> = match.slice(1);

    // If no comparison or target are provided, treat the max as the target
    if ( max && !(target || comparison) ) {
      target = max;
      max = null;
    }

    // Determine target values
    max = Number.isNumeric(max) ? Number(max) : null;
    target = Number.isNumeric(target) ? parseInt(target) : 1;
    comparison = comparison || "=";

    // Recursively reroll until there are no remaining results to reroll
    let checked = 0;
    let initial = this.results.length;
    while (checked < this.results.length) {
      let r = this.results[checked];
      checked++;
      if (!r.active && !r.rerolled) {
        continue;
      }

      // Maybe we have run out of rerolls
      if ( (max !== null) && (max <= 0) ) {
        break;
      }

      // TODO does not play nice with multiple reroll statements in 1 term when more than 1 reroll statement has a max
      if (DiceTerm.compareResult(r.result, comparison, target) ) {
        const wasRerolled = r.rerolled;
        r.rerolled = true;
        r.active = false;
        if (!wasRerolled) {
          this.roll();
        }
        if (max !== null) {
          max -= 1;
        }
      }

      // Limit recursion
      if ( !recursive && (checked >= initial) ) {
        checked = this.results.length;
      }
      if ( checked > 1000 ) {
        throw new Error("Maximum recursion depth for exploding dice roll exceeded");
      }
    }
  }

}

export function registerHooks(): void {
  Hooks.on('ready', () => {
    // TODO lib wrapper compatibility when a complere solution is found
    // Currently it is solved with the wrap/unwrap methods
    // Die.prototype.reroll = ReEvaluatableDie.prototype.reroll;
  })
}