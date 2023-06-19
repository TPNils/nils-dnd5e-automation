import { DocumentListener } from "../lib/db/document-listener";
import { Stoppable } from "../lib/utils/stoppable";
import { ValueProvider, ValueReader } from "../provider/value-provider";
import { MyActor, MyItem } from "../types/fixed-types";
import { ModularCard } from "./modular-card";
import { ModularCardCreateArgs } from "./modular-card-part";
import { RunOnce } from "../lib/decorator/run-once";
import { DmlTrigger } from "../lib/db/dml-trigger";
import { UtilsHooks } from "../utils/utils-hooks";
import { UtilsLog } from "../utils/utils-log";

const onlinePlayersTrigger = new ValueProvider();
const onlinePlayers: ValueReader<User[]> = onlinePlayersTrigger.map(() => {
  if (game.users == null) {
    return [];
  }
  return Array.from(game.users.values()).filter(u => u.active);
});

export class ModularCardRefresher {

  private static uuidOrder: string[] = [];
  private static listenersByUuid = new Map<string, Stoppable>();
  private static maxListeners = 10;

  private static removeUuid(uuid: string): void {
    ModularCardRefresher.uuidOrder.splice(ModularCardRefresher.uuidOrder.indexOf(uuid), 1);
    const stoppable = ModularCardRefresher.listenersByUuid.get(uuid);
    ModularCardRefresher.listenersByUuid.delete(uuid);
    stoppable.stop();
  }

  private static addUuid(uuid: string): void {
    if (ModularCardRefresher.listenersByUuid.has(uuid)) {
      return;
    }

    if (ModularCardRefresher.maxListeners === ModularCardRefresher.listenersByUuid.size) {
      ModularCardRefresher.removeUuid(ModularCardRefresher.uuidOrder[0]);
    }

    ModularCardRefresher.uuidOrder.push(uuid);
    
    let latestCreateArgs: ModularCardCreateArgs;
    ModularCardRefresher.listenersByUuid.set(uuid, DocumentListener.listenUuid<ChatMessage>(uuid)
      .switchMap(message => {
        return ValueReader.mergeObject({
          message: message,
          parts: ModularCard.readModuleCard(message),
          onlinePlayers: onlinePlayers,
        });
      })
      .filter(({message, parts, onlinePlayers}) => {
        // Not a modular message
        if (!parts) {
          return false;
        }

        // If the owner of the message is online, only they should execute the refresh
        const isMessageUserOnline = onlinePlayers.includes(message.user);
        if (isMessageUserOnline) {
          return game.userId === message.user.id;
        }

        // fallback to the first online GM.
        // If no valid users are found, no update will happen (which is fine)
        const gmsSortedIds = onlinePlayers.filter(u => u.isGM).map(u => u.id).sort();
        return gmsSortedIds[0] === game.userId;
      })
      .switchMap(({message, parts}) => {
        return ValueReader.mergeObject({
          message: message,
          parts: parts,
          item: parts.getItemUuid() == null ? null : DocumentListener.listenUuid<MyItem>(parts.getItemUuid()),
          actor: parts.getActorUuid() == null ? null : DocumentListener.listenUuid<MyActor>(parts.getActorUuid()).first(),
          token: parts.getTokenUuid() == null ? null : DocumentListener.listenUuid<TokenDocument>(parts.getTokenUuid()).first(),
        })
      }).listen((async (args) => {
        if (args.item == null || args.actor == null || args.token == null) {
          // Don't refresh
          return;
        }
        if (latestCreateArgs == null) {
          latestCreateArgs = args;
          return;
        }
    
        if (latestCreateArgs.item !== args.item || latestCreateArgs.actor !== args.actor || latestCreateArgs.token !== args.token) {
          const updatedParts = await ModularCard.createInstanceNoDml(args, {type: 'visual', instance: args.parts});
          await ModularCard.writeBulkModuleCards([{message: args.message, data: updatedParts}]);
        }
      }))
    )
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
    })
    
    // Trigger to detect initial online users
    UtilsHooks.ready(() => {
      onlinePlayersTrigger.set(null);
    })
  }

}