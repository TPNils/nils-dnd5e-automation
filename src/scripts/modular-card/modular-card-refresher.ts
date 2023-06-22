import { DocumentListener } from "../lib/db/document-listener";
import { ValueProvider, ValueReader } from "../provider/value-provider";
import { MyActor, MyItem } from "../types/fixed-types";
import { ModularCard, ModularCardInstance } from "./modular-card";
import { RunOnce } from "../lib/decorator/run-once";
import { DmlTrigger } from "../lib/db/dml-trigger";
import { UtilsHooks } from "../utils/utils-hooks";

const onlinePlayersTrigger = new ValueProvider();
const onlinePlayers: ValueReader<User[]> = onlinePlayersTrigger.map(() => {
  if (game.users == null) {
    return [];
  }
  return Array.from(game.users.values()).filter(u => u.active);
});

export class ModularCardRefresher {

  private static uuidOrder = new ValueProvider<string[]>([]);
  private static maxListeners = 5;

  private static removeUuid(uuid: string): void {
    ModularCardRefresher.uuidOrder.set(
      ModularCardRefresher.uuidOrder.get().filter(id => id !== uuid)
    );
  }

  private static addUuid(uuid: string): void {
    if (ModularCardRefresher.uuidOrder.get().includes(uuid)) {
      return;
    }

    if (ModularCardRefresher.maxListeners <= ModularCardRefresher.uuidOrder.get().length) {
      ModularCardRefresher.removeUuid(ModularCardRefresher.uuidOrder.get()[0]);
    }

    ModularCardRefresher.uuidOrder.set([...ModularCardRefresher.uuidOrder.get(), uuid]);
  }

  @RunOnce()
  public static registerHooks(): void {
    // On initial document load, listen to the latest X messages
    UtilsHooks.ready(() => {
      for (let i = Math.max(0, game.messages.contents.length - ModularCardRefresher.maxListeners); i < game.messages.contents.length; i++) {
        ModularCardRefresher.addUuid(game.messages.contents[i].uuid);
      }
    });

    // Listen to the latest new messages
    DmlTrigger.registerTrigger({
      type: ChatMessage,
      afterCreate(context) {
        for (const {newRow} of context.rows) {
          ModularCardRefresher.addUuid(newRow.uuid);
        }
      },
      afterDelete(context) {
        for (const {oldRow} of context.rows) {
          ModularCardRefresher.removeUuid(oldRow.uuid);
        }
      },
    });

    // Track online players
    Hooks.on('userConnected', (user: User, isConnected: boolean) => {
      onlinePlayersTrigger.set(null);
    });
    
    // Trigger to detect initial online users
    UtilsHooks.ready(() => {
      onlinePlayersTrigger.set(null);
    });

    // Start listening for changes
    {
      const cacheByMsgUuid = new Map<string, {item: MyItem, actor: MyActor, token: TokenDocument}>();
      ModularCardRefresher.uuidOrder
        .switchMap(uuids => {
          return ValueReader.mergeObject({
            chatMessages: DocumentListener.listenUuid<ChatMessage>(uuids),
            onlinePlayers: onlinePlayers,
          })
        })
        .map(({chatMessages, onlinePlayers}) => {
          const modularInstances: Array<{msg: ChatMessage, inst: ModularCardInstance}> = [];
          for (const msg of chatMessages) {
            const inst = ModularCard.readModuleCard(msg);
            if (inst == null) {
              continue;
            }
            
            // If the owner of the message is online, only they should execute the refresh
            const isMessageUserOnline = onlinePlayers.includes(msg.user);
            if (isMessageUserOnline && game.userId !== msg.user.id) {
              continue;
            }

            // fallback to the first online GM.
            // If no valid users are found, no update will happen (which is fine)
            const gmsSortedIds = onlinePlayers.filter(u => u.isGM).map(u => u.id).sort();
            if (gmsSortedIds.length === 0 || gmsSortedIds[0] !== game.userId) {
              continue;
            }

            modularInstances.push({msg, inst});
          }
          return modularInstances;
        })
        .switchMap(modularInstances => {
          const itemUuids = new Set<string>();
          const actorUuids = new Set<string>();
          const tokenUuids = new Set<string>();
          for (const modularInstance of modularInstances) {
            itemUuids.add(modularInstance.inst.getItemUuid());
            actorUuids.add(modularInstance.inst.getActorUuid());
            tokenUuids.add(modularInstance.inst.getTokenUuid());
          }
          itemUuids.delete(null);
          actorUuids.delete(null);
          tokenUuids.delete(null);
          itemUuids.delete(undefined);
          actorUuids.delete(undefined);
          tokenUuids.delete(undefined);
          return ValueReader.mergeObject({
            modularInstances: modularInstances,
            items: DocumentListener.listenUuid<MyItem>(itemUuids),
            actors: DocumentListener.listenUuid<MyActor>(actorUuids),
            tokens: DocumentListener.listenUuid<TokenDocument>(tokenUuids),
          });
        })
        .listen(async ({modularInstances, items, actors, tokens}) => {
          const msgByUuid = new Map<string, ChatMessage>();
          const itemByUuid = new Map<string, MyItem>();
          const actorByUuid = new Map<string, MyActor>();
          const tokenByUuid = new Map<string, TokenDocument>();
          for (const modularInstance of modularInstances) {
            msgByUuid.set(modularInstance.msg.uuid, modularInstance.msg);
          }
          for (const item of items) {
            itemByUuid.set(item.uuid, item);
          }
          for (const actor of actors) {
            actorByUuid.set(actor.uuid, actor);
          }
          for (const token of tokens) {
            tokenByUuid.set(token.uuid, token);
          }
          
          const updatesByMsgUuid = new Map<string, Promise<{message: ChatMessage, data: ModularCardInstance}>>();
          for (const modularInstance of modularInstances) {
            const item = itemByUuid.get(modularInstance.inst.getItemUuid());
            const actor = actorByUuid.get(modularInstance.inst.getActorUuid());
            const token = tokenByUuid.get(modularInstance.inst.getTokenUuid());
            if (item == null || actor == null || token == null) {
              // Don't refresh
              continue;
            }
            
            let latestCreateArgs = cacheByMsgUuid.get(modularInstance.msg.uuid);
            if (latestCreateArgs == null) {
              cacheByMsgUuid.set(modularInstance.msg.uuid, {item, actor, token});
              continue;
            }
            
      
            if (latestCreateArgs.item !== item || latestCreateArgs.actor !== actor || latestCreateArgs.token !== token) {
              updatesByMsgUuid.set(modularInstance.msg.uuid, 
                ModularCard.createInstanceNoDml({item, actor, token}, {type: 'visual', instance: modularInstance.inst}).then(dml => (
                  {
                    message: modularInstance.msg,
                    data: dml
                  }
                )))
            }
          }

          if (updatesByMsgUuid.size === 0) {
            return;
          }

          await ModularCard.writeBulkModuleCards(await Promise.all(updatesByMsgUuid.values()));
        })

    }
  }

}