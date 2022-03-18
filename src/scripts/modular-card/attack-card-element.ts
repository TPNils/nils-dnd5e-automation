import { RunOnce } from "../lib/decorator/run-once";
import { staticValues } from "../static-values";
import { ModularCard } from "./modular-card";

export class AttackCardElement extends HTMLElement {
  constructor() {
    super();
  }

  public static get selector(): string {
    return `${staticValues.code}-attack-card`;
  }

  @RunOnce()
  public static async registerHooks(): Promise<void> {
    customElements.define(AttackCardElement.selector, AttackCardElement);
  }
  
  public static get observedAttributes() {
    return ['data-message-id', 'data-part-id'];
  }

  public attributeChangedCallback(name: string, oldValue: string, newValue: string): void {
    this.calcInner();
  }

  public connectedCallback(): void {
    // If the message/part id is written on a parent node
    this.calcInner();
  }

  public adoptedCallback(): void {
    // If the element is moved and the message/part id is written on a parent node
    this.calcInner();
  }
  
  private renderedKey: string;
  private async calcInner(): Promise<void> {
    const messageId = this.closest('[data-message-id]')?.getAttribute('data-message-id');
    const partId = this.closest('[data-part-id]')?.getAttribute('data-part-id');
    const renderKey = `${messageId}/${partId}`;
    if (this.renderedKey === renderKey) {
      return;
    }
    if (!messageId || !partId || !game.messages.has(messageId)) {
      if (this.innerHTML !== '') {
        this.innerHTML = '';
      }
      return;
    } 
    const cardPart = (ModularCard.getCardPartDatas(game.messages.get(messageId)) ?? []).find(part => part.id === partId);
    // TODO store item uuid in message to allow for dynamic part creation (maybe? does not solve upcasting)
    if (!cardPart) {
      if (this.innerHTML !== '') {
        this.innerHTML = '';
      }
      return;
    }

    this.renderedKey = renderKey;
    const html = await renderTemplate(
      `modules/${staticValues.moduleName}/templates/modular-card/attack-part.hbs`, {
        data: cardPart.data,
        moduleName: staticValues.moduleName
      }
    );
    
    this.innerHTML = html;
  }

}
