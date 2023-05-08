import { registerHooks as registerActorHooks } from "./actor";
import { registerHooks as registerItemHooks } from "./item";

export function registerHooks(): void {
  registerActorHooks();
  registerItemHooks();
}