import { RunOnce } from "../decorator/run-once";

interface DiceTermResult extends DiceTerm.Result {
  notRolled?: boolean;
}

/**
 * Allow to change the number of dice, its modifiers and allowing to reevaluate it.
 */
export class MutableDiceTerm extends Die {

  public static SERIALIZE_ATTRIBUTES: string[] = [...Die.SERIALIZE_ATTRIBUTES];

  public deactivatedResults: number[] = [];
  public newRollsSinceEvaluate: Die['results'] = [];

  constructor(args: Partial<Die.TermData>) {
    super(args);
    if (this.results.length > 0) {
      this.evaluate();
    }
  }

  public static fromDie(die: Die): MutableDiceTerm {
    if (die instanceof MutableDiceTerm) {
      return die;
    }
    return new MutableDiceTerm(deepClone(die.toJSON()));
  }

  public evaluate(options?: Partial<RollTerm.EvaluationOptions & { async: false }>): this;
  public evaluate(options: Partial<RollTerm.EvaluationOptions> & { async: true }): Promise<this>;
  public evaluate({async, minimize, maximize}: Partial<RollTerm.EvaluationOptions> = {}): this | Promise<this> {
    this._evaluated = true;
    return async ? this._evaluate({minimize, maximize}) : this._evaluateSync({minimize, maximize});
  }

  protected async _evaluate({minimize=false, maximize=false}={}): Promise<this> {
    return this._evaluateSync({minimize, maximize})
  }
  
  protected _evaluateSync({minimize=false, maximize=false}={}) {
    if (this.number > 999) {
      throw new Error(`You may not evaluate a DiceTerm with more than 999 requested results`);
    }
    this.deactivatedResults = this.results.filter((r: DiceTermResult) => !r.notRolled).map(r => r.result);
    this.results = [];
    this.newRollsSinceEvaluate = [];
    for (let i = this.results.length; i < this.number; i++) {
      this.roll({minimize, maximize});
    }
    this._evaluateModifiers();
    for (const deactivated of this.deactivatedResults) {
      this.results.push({result: deactivated, active: false, discarded: true})
    }
    this.deactivatedResults = [];
    
    return this;
  }

  public roll(args: { minimize: boolean; maximize: boolean; } = {minimize: false, maximize: false}): DiceTerm.Result {
    // Recycle deactivated rolls
    if (args.minimize || args.maximize) {
      const result: DiceTermResult = super.roll(args);
      result.notRolled = true; // Track that this was never rolled and can be discarded on reroll (without min/max)
      this.newRollsSinceEvaluate.push(result);
      this.results.push(result);
      return result;
    }
    if (this.deactivatedResults.length > 0) {
      const result: DiceTerm.Result = {
        result: this.deactivatedResults.splice(0, 1)[0],
        active: true
      };
      this.results.push(result);
      return result;
    }
    const result = super.roll(args);
    // super.roll already adds result to this.results
    this.newRollsSinceEvaluate.push(result);
    return result;
  }

  @RunOnce()
  public static registerHooks(): void {
    Hooks.on('ready', () => {
      CONFIG.Dice.termTypes[MutableDiceTerm.name] = MutableDiceTerm;
    })
  }
  
}