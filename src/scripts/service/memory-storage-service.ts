/**
 * 
 */
export class MemoryStorageService {

  private static properties = new Map<string, any>();

  public static get(property: string): any | null {
    return this.properties.get(property);
  }
  
  public static set(property: string, value: any): void {
    this.properties.set(property, value);
  }

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

}