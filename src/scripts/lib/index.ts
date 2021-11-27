import { registerHooks as registerChatMessageHooks } from "./chat-message/client-side-render-override";

export function registerHooks(): void {
  registerChatMessageHooks();
}