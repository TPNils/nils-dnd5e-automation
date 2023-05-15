import { staticValues } from "../../static-values";
import { UtilsHooks } from "../../utils/utils-hooks";
import { RunOnce } from "../decorator/run-once";
import { Component, ComponentElement } from "./component";

async function updateMessage(this: ChatLog, wrapped: (...args: any) => any, ...args: any[]): Promise<void> {
  const message: ChatMessage = args[0];
  const notify: boolean = args[1];
  let li = this.element.find(`.message[data-message-id="${message.id}"]`);
  if (li.length) {
    const currentContent = Array.from(li.children(`.message-content`)[0].querySelectorAll(`:scope > *`));
    if (!currentContent.every(element => Component.isComponentElement(element))) {
      // Lets not mess with other messages. If there is am internal bug, don't affect them
      return wrapped(args)
    }

    const updatedHtml = await message.getHTML();
    const updatedContent = Array.from(updatedHtml.children(`.message-content`)[0].querySelectorAll(`:scope > *`));
    if (!updatedContent.every(element => Component.isComponentElement(element))) {
      // Lets not mess with other messages. If there is am internal bug, don't affect them
      return wrapped(args)
    }

    let sameTopLevelLayout = updatedContent.length === currentContent.length;
    if (sameTopLevelLayout) {
      for (let i = 0; i < currentContent.length; i++) {
        // isEqualNode does a deep compare => make shallow copies
        if (currentContent[i].nodeName !== updatedContent[i].nodeName) {
          sameTopLevelLayout = false;
          break;
        }
      }
    }

    if (sameTopLevelLayout) {
      // replace message content
      for (let i = 0; i < currentContent.length; i++) {
        if (Component.isComponentElement(currentContent[i])) {
          const currentElement = (currentContent[i] as ComponentElement);
          const updatedElement = (updatedContent[i] as HTMLElement);
          for (const attr of updatedElement.getAttributeNames()) {
            if (currentElement.getAttribute(attr) !== updatedElement.getAttribute(attr)) {
              currentElement.setAttribute(attr, updatedElement.getAttribute(attr));
            }
          }
          for (const attr of currentElement.getAttributeNames()) {
            if (attr === currentElement.getHostAttribute()) {
              continue;
            }
            if (currentElement.getAttribute(attr) !== updatedElement.getAttribute(attr)) {
              currentElement.removeAttribute(attr);
            }
          }
        } else {
          currentContent[i].replaceWith(updatedContent[i]);
        }
      }

      // Replace non message content
      let messageContentElement: HTMLElement;
      const currentNonContentElements = Array.from(li[0].childNodes);
      for (let i = 0; i < currentNonContentElements.length; i++) {
        const element = currentNonContentElements[i];
        if (element instanceof HTMLElement && element.classList.contains('message-content')) {
          messageContentElement = element;
          continue;
        }
        element.remove();
      }
      let isBeforeMessageContent = true;
      const updatedNonContentElements = Array.from(updatedHtml[0].childNodes);
      for (let i = 0; i < updatedNonContentElements.length; i++) {
        const element = updatedNonContentElements[i];
        if (element instanceof HTMLElement && element.classList.contains('message-content')) {
          isBeforeMessageContent = false;
          continue;
        }

        if (isBeforeMessageContent) {
          li[0].insertBefore(element, messageContentElement);
        } else {
          li[0].append(element);
        }
      }
    } else {
      // sameTopLevelLayout should always be true, but just in case have a fallback
      // Default behaviour isn foundry V9
      li.replaceWith(updatedHtml);
    }
  } else {
    await this.postOne(message, false);
  }

  // Post notification of update
  if (notify) {
    this.notify(message);
  }

  // Update popout tab
  if (this._popout) {
    await this._popout.updateMessage(message, false);
  }
  if (this.popOut) {
    this.setPosition();
  }
}

export class ComponentFoundryConnector {
  
  @RunOnce()
  public static registerHooks(): void {
    // Foundry strips custom elements in the backend => find replace on client side
    UtilsHooks.init().then(() => {
      const attrName = `data-${staticValues.code}-tag-replacer`;
      const observer = new MutationObserver((mutationsList, observer) => {
        for (const mutation of mutationsList) {
          for (const addedNode of Array.from(mutation.addedNodes)) {
            if (addedNode instanceof Element) {
              const queryNode = addedNode.matches(`[${attrName}]`) ? [addedNode] : Array.from(addedNode.querySelectorAll(`[${attrName}]`));
              for (const node of queryNode) {
                if (node.parentNode == null) {
                  // Can't replace top level
                  continue;
                }
                const tagReplacer = node.getAttribute(attrName);
                const elementConstructor = customElements.get(tagReplacer);
                let constructorIter = elementConstructor;
                while (constructorIter !== ComponentElement && constructorIter != null) {
                  constructorIter = Object.getPrototypeOf(constructorIter);
                }

                // Only support Components
                // Main reason is securty like prevent <script> tags
                // Might want to support _all_ custom elements, but we will cross that bridge when we get there.
                if (constructorIter) {
                  const children = Array.from(node.childNodes);
                  for (const child of children) {
                    node.removeChild(child);
                  }

                  const element = new elementConstructor();
                  for (const child of children) {
                    element.append(child);
                  }

                  for (let i = 0; i < node.attributes.length; i++) {
                    const attr = node.attributes[i];
                    if (attr.name === attrName && attr.namespaceURI == null) {
                      continue;
                    }
                    element.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
                  }

                  node.parentNode.replaceChild(element, node);
                }
              }
            }
          }
        }
      });

      // Start observing the target node for configured mutations
      observer.observe(document, { childList: true, subtree: true });
    });

    // Override render behaviour
    UtilsHooks.setup().then(() => {
      libWrapper.register(staticValues.moduleName, 'ChatLog.prototype.updateMessage', updateMessage, 'MIXED');
    });
  }
  
}