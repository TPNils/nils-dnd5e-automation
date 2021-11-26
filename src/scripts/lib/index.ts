import { registerHooks as registerChatMessageHooks } from "../lib/chat-message.ts/client-side-render-override";

export function registerHooks(): void {
  registerChatMessageHooks();
}