import { MyActor } from "./types/fixed-types";

type Request<T extends Object> = Partial<Record<keyof T, true>>;
type Response<T extends Object, REQ extends Request<T>> = Pick<T, (keyof REQ & keyof T)>;

interface Selected {
  actor: MyActor;
  tokenCanvas: Token;
  tokenDocument: TokenDocument;
}

interface TokenRequestArg {
  tokenCanvas: Token;
  tokenDocument: TokenDocument;
}

export class MacroUtils {

  public static getActorFromToken(token: Partial<TokenRequestArg>): MyActor {
    if (token.tokenDocument) {
      return token.tokenDocument.getActor();
    }
    if (token.tokenCanvas) {
      return (token.tokenCanvas.scene.getEmbeddedDocument('Token', token.tokenCanvas.data._id) as TokenDocument).getActor();
    }
    throw new Error('Illegal argument: ' + token); 
  }

  public static getActorFromContext(): MyActor | null {
    // @ts-ignore
    if (typeof actor !== 'undefined') {
      // Fired from a macro linked to a character
      // @ts-ignore
      return actor;
    }
    if (!game.user.isGM) {
      return game.user.character;
    }

    return null;
  }

  public static getSingleSelected<REQ extends Request<Selected>>(request: REQ): Response<Selected, REQ> {
    if (canvas.tokens.controlled.length !== 1) {
      throw new Error('You must select a token first');
    }

    const response: Partial<Response<Selected, REQ>> = {};
    const tokenCanvas = canvas.tokens.controlled[0];
    if (request.tokenCanvas) {
      response.tokenCanvas = tokenCanvas;
    }
    if (request.tokenDocument) {
      response.tokenDocument = tokenCanvas.scene.getEmbeddedDocument('Token', tokenCanvas.data._id) as TokenDocument
    }
    if (request.actor) {
      response.actor = MacroUtils.getActorFromToken({tokenCanvas: tokenCanvas});
    }

    return response as Response<Selected, REQ>;
  }

  public static getAllSelected<REQ extends Request<Selected>>(request: REQ, options: {disableErrorNonSelected?: true} = {}): Response<Selected, REQ>[] {
    if (options.disableErrorNonSelected !== true && canvas.tokens.controlled.length === 0) {
      throw new Error('You must select a token first');
    }

    return canvas.tokens.controlled.map(tokenCanvas => {
      const response: Partial<Response<Selected, REQ>> = {};
      if (request.tokenCanvas) {
        response.tokenCanvas = tokenCanvas;
      }
      if (request.tokenDocument) {
        response.tokenDocument = tokenCanvas.scene.getEmbeddedDocument('Token', tokenCanvas.data._id) as TokenDocument
      }
      if (request.actor) {
        response.actor = MacroUtils.getActorFromToken({tokenCanvas: tokenCanvas});
      }
  
      return response as Response<Selected, REQ>;
    });
  }

}