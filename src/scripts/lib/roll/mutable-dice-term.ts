import { RunOnce } from "../decorator/run-once";

/**
 * Allow to change the number of dice, its modifiers and allowing to reevaluate it.
 */
export class MutableDiceTerm extends Die {

  public static SERIALIZE_ATTRIBUTES: string[] = [...Die.SERIALIZE_ATTRIBUTES, 'allResults'];

  public allResults: number[] = [];
  public deactivatedResults: number[] = [];
  public newRollsSinceEvaluate: Die['results'] = [];

  constructor(args: Partial<Die.TermData & {allResults: MutableDiceTerm['allResults']}>) {
    super(args);
    this.allResults = args.allResults ?? [];
    if (this.allResults.length > 0) {
      this.evaluate();
    }
  }

  public static fromDie(die: Die): MutableDiceTerm {
    if (die instanceof MutableDiceTerm) {
      return die;
    }
    const dieData: any = die.toJSON();
    dieData.allResults = (dieData.results as Die['results']).map(r => r.result);
    delete dieData.results;
    return new MutableDiceTerm(dieData);
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
    this.newRollsSinceEvaluate = [];
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
      const result = super.roll(args);
      this.newRollsSinceEvaluate.push(result);
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
    this.allResults.push(result.result);
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