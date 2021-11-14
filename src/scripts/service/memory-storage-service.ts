/**
 * 
 */
export class MemoryStorageService {

  private static properties = new Map<string, any>();

  // Store this locally so you do not need to save it on the message => less DMLs and it isn't all that important anyway
  // Dont make it persistant since messages can be deleted and I don't want to write cleanup code (:
  public static isCardCollapsed(messageId: string): boolean {
    const messagePerference = this.properties.get(`cardCollapse.${messageId}`);
    if (messagePerference != null) {
      return messagePerference;
    }

    return !!game.settings.get('dnd5e', 'autoCollapseItemCards');
  }
  
  public static setCardCollapse(messageId: string, value: boolean): void {
    this.properties.set(`cardCollapse.${messageId}`, value);
  }

  public static getFocusedElementSelector(): string | null {
    return this.properties.get(`focusedElementSelector`);
  }

  public static setFocusedElementSelector(selector: string): void {
    console.log('setFocusedElementSelector', selector);
    this.properties.set(`focusedElementSelector`, selector);
  }

}