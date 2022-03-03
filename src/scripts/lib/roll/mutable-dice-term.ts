import { RunOnce } from "../decorator/run-once";

/**
 * Allow to change the number of dice, its modifiers and allowing to reevaluate it.
 */
export class MutableDiceTerm extends Die {

  public static SERIALIZE_ATTRIBUTES: string[] = [...Die.SERIALIZE_ATTRIBUTES, 'allResults'].filter(attr => attr !== 'results');

  public allResults: number[] = [];
  public deactivatedResults: number[] = [];

  constructor(args: Partial<Omit<Die.TermData, 'results'> & {allResults: MutableDiceTerm['allResults']}>) {
    super(args);
    this.allResults = args.allResults ?? [];
    if (this.allResults.length > 0) {
      this.evaluate();
    }
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
    this.results = [];
    this.deactivatedResults = deepClone(this.allResults);
    for (let i = this.results.length; i < this.number; i++) {
      this.roll({minimize, maximize});
    }
    this._evaluateModifiers();
    
    return this;
  }

  public roll(args: { minimize: boolean; maximize: boolean; } = {minimize: false, maximize: false}): DiceTerm.Result {
    // Recycle deactivated rolls
    if (args.minimize || args.maximize) {
      // Do not add min & max rolls to allRolls
      // This is to ensure a real roll may be returned from the cache
      return super.roll(args)
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
    this.allResults.push(result.result);
    return result;
  }

  @RunOnce()
  public static registerHooks(): void {
    Hooks.on('ready', () => {
      CONFIG.Dice.termTypes[MutableDiceTerm.name] = MutableDiceTerm;
    })
  }
  
}