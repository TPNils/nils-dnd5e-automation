import { staticValues } from '../static-values';
import { UtilsDocument } from '../utils/utils-document';

async function getHTML(this: ChatMessage, wrapped: (...args: any) => any, ...args: any[]): Promise<any> {
  let response: JQuery | Promise<JQuery> = wrapped(args);
  if (response instanceof Promise) {
    response = await response;
  }

  try {
    const secrets = response.find(`[data-${staticValues.moduleName}-secret]`);
    for (const item of secrets) {
      const secretFilters = item.getAttribute(`data-${staticValues.moduleName}-secret`).split(';');
      let matchesFilter = false;

      for (const filter of secretFilters) {
        if ((filter.toLowerCase() === 'gm' || filter.toLowerCase() === 'dm') && game.user.isGM) {
          matchesFilter = true;
        }
        if (filter.toLowerCase() === 'player' && !game.user.isGM) {
          matchesFilter = true;
        }
        if (filter.toLowerCase().startsWith('user:') && filter.substring(5) === game.userId) {
          matchesFilter = true;
        }
        if (filter.toLowerCase().startsWith('actorowneruuid:')) {
          const actor = await UtilsDocument.actorFromUuid(filter.substring(15));
          // always show deleted actors
          if (!actor || actor.isOwner) {
            matchesFilter = true;
          }
        }
        if (filter.toLowerCase().startsWith('actorownerid:')) {
          const actor = game.actors.get(filter.substring(13));
          // always show deleted actors
          if (!actor || actor.isOwner) {
            matchesFilter = true;
          }
        }
        // Don't support token owner filter. They are too short lived and are based on actor anyway

        if (matchesFilter) {
          break;
        }
      }

      if (!matchesFilter) {
        item.remove();
      }
    }
  } catch {
    // do nothing, just return the response
  }

  return response;
}

export function registerHooks(): void {
  Hooks.on('setup', () => {
    libWrapper.register(staticValues.moduleName, 'ChatMessage.prototype.getHTML', getHTML, 'WRAPPER');
  });
}