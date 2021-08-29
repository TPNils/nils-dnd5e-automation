import { staticValues } from '../static-values';

async function getHTML(this: ChatMessage, wrapped: (...args: any) => any, ...args: any[]): Promise<JQuery> {
  const clientTemplate = this.getFlag(staticValues.moduleName, 'clientTemplate') as string;
  const clientTemplateData = this.getFlag(staticValues.moduleName, 'clientTemplateData') as any;
  if (clientTemplate && clientTemplateData) {
    const options: Partial<Parameters<typeof TextEditor['enrichHTML']>[1]> = {}
    if (game.user.isGM) {
      options.secrets = true;
    }
    this.data.update({content: TextEditor.enrichHTML(await renderTemplate(clientTemplate, clientTemplateData), options as any)})
  }

  return wrapped(args);
}

export function registerHooks(): void {
  Hooks.on('setup', () => {
    libWrapper.register(staticValues.moduleName, 'ChatMessage.prototype.getHTML', getHTML, 'WRAPPER');
  });
}