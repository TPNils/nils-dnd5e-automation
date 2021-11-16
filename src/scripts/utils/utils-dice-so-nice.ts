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

    return (game as any).dice3d.showForRoll(roll, user, synchronize, whispers, blind);
  }

}