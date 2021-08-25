import { registerHooks as registerItemHooks } from "./item";
import { registerHooks as registerChatMessageHooks } from "./chat-message";

export function registerHooks(): void {
  registerItemHooks();
  registerChatMessageHooks();
}