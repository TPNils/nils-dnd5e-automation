import { staticValues } from '../static-values';

async function getHTML(this: ChatMessage, wrapped: (...args: any) => any, ...args: any[]): Promise<any> {
  let response: JQuery | Promise<JQuery> = wrapped(args);
  if (response instanceof Promise) {
    response = await response;
  }
  if (!game.user.isGM) {
    response.find(`.${staticValues.moduleName}-gm-secret`).remove();
  }
  return response;
}

export function registerHooks(): void {
  Hooks.on('setup', () => {
    libWrapper.register(staticValues.moduleName, 'ChatMessage.prototype.getHTML', getHTML, 'WRAPPER');
  });
}