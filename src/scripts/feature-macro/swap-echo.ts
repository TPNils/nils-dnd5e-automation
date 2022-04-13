/* TODO convert to modular card
import { IMacro } from "../macro";
import { MacroContext } from "../macro-context";
import { UtilsDocument } from "../lib/db/utils-document";

export class SwapEcho implements IMacro {

  public async run(context: MacroContext): Promise<void> {
    if (game.paused && !game.user.isGM) {
      return;
    }
    const actor = await UtilsDocument.actorFromUuid(context.actorUuid);
    const isEchoOf = actor.getFlag('world', 'is-echo-of');
    const echoActorId = actor.getFlag('world', 'echo-actor-id');
  
    const swapCharacters = [];
    if (isEchoOf) {
      swapCharacters.push({
        char1: actor.data._id,
        char2: isEchoOf,
      });
    } else if (echoActorId) {
      swapCharacters.push({
        char1: actor.data._id,
        char2: echoActorId,
      });
    }
    if (swapCharacters.length === 0) {
      ui.notifications.error(`${actor.data.name} doesn't have an echo`);
      return;
    }
  
    const currentScene = game.scenes.get(game.user.viewedScene);
    const updateTokens = [];
    for (const swapCharacter of swapCharacters) {
      // It's possible the actor has 2 token instances
      let token1 = [];
      let token2 = [];
  
      for (const token of currentScene.data.tokens) {
        if (token.data.actorId === swapCharacter.char1) {
          token1.push(token.data);
        }
        if (token.data.actorId === swapCharacter.char2) {
          token2.push(token.data);
        }
      }
  
      // If the actor as multiple tokens, throw an error
      // If needed, this can be updated later by filtering on player selected tokens
      if (token1.length !== 1) {
        ui.notifications.error(`Actor ${game.actors.get(swapCharacter.char1).name} needs to have 1 token in the current scene, found: ${token1.length}`)
      }
      if (token2.length !== 1) {
        ui.notifications.error(`Actor ${game.actors.get(swapCharacter.char2).name} needs to have 1 token in the current scene, found: ${token2.length}`)
      }
      if (token1.length !== 1 || token2.length !== 1) {
        return;
      }
  
      updateTokens.push({
        _id: token1[0]._id,
        x: token2[0].x,
        y: token2[0].y
      })
      updateTokens.push({
        _id: token2[0]._id,
        x: token1[0].x,
        y: token1[0].y
      })
    }
  
    currentScene.updateEmbeddedDocuments('Token', updateTokens, {animate: false} as any)
  }

}
*/