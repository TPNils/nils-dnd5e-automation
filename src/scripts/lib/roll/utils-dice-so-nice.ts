export interface ShowRollRequest {
  roll: Roll;
  user?: User;
  rollMode?: ClientSettings.Values['core.rollMode'];
}

export class UtilsDiceSoNice {

  /**
  * @returns {Promise<boolean>} when resolved true if the animation was displayed, false if not.
   */
  public static async showRoll({roll, user, rollMode}: ShowRollRequest): Promise<boolean> {
    if (!(game as any).dice3d) {
      return false;
    }
    if (user == null) {
      user = game.user;
    }
    if (rollMode == null) {
      rollMode = game.settings.get('core', 'rollMode');
    }

    const synchronize = rollMode === 'roll';
    const blind = rollMode === 'blindroll';
    let whispers: string[] = null;
    if (rollMode === 'gmroll' || rollMode === 'blindroll') {
      whispers = [];
      for (const gameUser of Array.from(game.users.values())) {
        if (gameUser.isGM) {
          whispers.push(gameUser.id);
        }
      }
    }

    // DiceSoNice does something weird to find the dice, but I think this is to solve some weird foundry behaviour
    // Simplified: only give DiceSoNice vanilla foundry dice
    const vanillaTerms: RollTerm[] = [];
    let hasCustomTerms = false;
    for (const term of roll.terms) {
      if (term instanceof Die && term.constructor !== Die) {
        vanillaTerms.push(new Die(term.toJSON()));
        hasCustomTerms = true;
      } else if (term instanceof FateDie && term.constructor !== FateDie) {
        vanillaTerms.push(new FateDie(term.toJSON()));
        hasCustomTerms = true;
      } else if (term instanceof Coin && term.constructor !== Coin) {
        vanillaTerms.push(new Coin(term.toJSON()));
        hasCustomTerms = true;
      } else {
        vanillaTerms.push(term);
      }
    }

    if (hasCustomTerms) {
      roll = Roll.fromTerms(vanillaTerms);
    }

    return (game as any).dice3d.showForRoll(roll, user, synchronize, whispers, blind);
  }

}