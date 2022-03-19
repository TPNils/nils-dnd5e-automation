export abstract class UtilsElement {
  
  public static addEventListener<K extends keyof HTMLElementEventMap>(element: Element, selector: string, type: K, listener: (this: HTMLElement, ev: HTMLElementEventMap[K]) => any, options?: boolean | AddEventListenerOptions): void {
    element.addEventListener(type, (event: HTMLElementEventMap[K]) => {
      let el = event.target as Element;

      do {
        if (el.matches(selector)) {
          listener.call(element, event);
          return;
        } else if (el === element) {
          // Only listen within the element
          return;
        }
        el = el.parentElement || el.parentNode as Element;
      } while (el != null && el.nodeType === 1);
    })
  }

}
