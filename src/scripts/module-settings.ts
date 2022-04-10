import { UtilsDocument } from "./lib/db/utils-document";
import { RunOnce } from "./lib/decorator/run-once";
import { ModularCard } from "./modular-card/modular-card";
import { staticValues } from "./static-values";
import { MyActor } from "./types/fixed-types";

const refreshMessages = () => {
  for (const message of game.messages.contents) {
    if (ModularCard.getCardPartDatas(message) != null) {
      ui.chat.updateMessage(message);
    }
  }
};

const partialVisibilitySetting = {
  hint: `
    *All details*: Nothing is hidden, all is visible to everyone.
    *Permission*: Require the observer permission of the item.
    *Player*: You can only see the rolls of other players, regardless of permissions.
    *Player or permission*: Match 'Permission' or 'Player'.
  `,
  scope: 'world',
  config: true,
  type: String,
  choices: {
    allDetails: 'All details',
    permission: 'Permission',
    player: 'Player',
    playerOrPermission: 'Player or permission',
  },
  default: 'playerOrPermission',
  onChange: refreshMessages,
};

const partialHidingRollSetting = {
  hint: `
    *Hidden*: Nothing is shown.
    *Show total*: Only the total is shown, the roll result and bonuses are hidden.
  `,
  scope: 'world',
  config: true,
  type: String,
  choices: {
    hidden: 'Hidden',
    total: 'Show total',
  },
  default: 'total',
  onChange: refreshMessages,
};

export class ModuleSettings {

  @RunOnce()
  public static registerHooks(): void {
    ModuleSettings.registerCustomPermissions();

    Hooks.on('init', () => {
      ModuleSettings.registerSettings();
    });
  }

  @RunOnce()
  private static registerSettings(): void {
    // Define a new setting which can be stored and retrieved
    game.settings.register(staticValues.moduleName, 'attackVisibility', {
      ...partialVisibilitySetting,
      name: 'Show attack roll',
    });
    game.settings.register(staticValues.moduleName, 'attackHiddenRoll', {
      ...partialHidingRollSetting,
      name: 'Hidden attack roll behaviour',
    });
    game.settings.register(staticValues.moduleName, 'damageVisibility', {
      ...partialVisibilitySetting,
      name: 'Show damage roll',
    });
    game.settings.register(staticValues.moduleName, 'damageHiddenRoll', {
      ...partialHidingRollSetting,
      name: 'Hidden damage roll behaviour',
    });
    game.settings.register(staticValues.moduleName, 'checkVisibility', {
      ...partialVisibilitySetting,
      name: 'Show skill check and saving throw roll',
    });
    game.settings.register(staticValues.moduleName, 'checkHiddenRoll', {
      ...partialHidingRollSetting,
      name: 'Hidden skill check and saving throw roll behaviour',
    });
  }

  @RunOnce()
  private static registerCustomPermissions(): void {
    for (const permission of [
      {permissionName: `${staticValues.code}ReadAttack`, setting: 'attackVisibility'},
      {permissionName: `${staticValues.code}ReadDamage`, setting: 'damageVisibility'},
      {permissionName: `${staticValues.code}ReadCheck`, setting: 'checkVisibility'},
    ]) {
      UtilsDocument.registerCustomPermission(permission.permissionName, args => {
        const setting = game.settings.get(staticValues.moduleName, permission.setting) as keyof (typeof partialVisibilitySetting)['choices'];
        switch (setting) {
          case 'allDetails': {
            return true;
          }
          case 'permission': {
            return UtilsDocument.getPermissionHandler('Observer')(args);
          }
          case 'player': {
            for (const user of game.users.values()) {
              if ((user.character as MyActor)?.uuid === args.document.uuid) {
                return true;
              }
            }
            return false;
          }
          default: /* playerOrPermission */ {
            for (const user of game.users.values()) {
              if ((user.character as MyActor)?.uuid === args.document.uuid) {
                return true;
              }
            }
            return UtilsDocument.getPermissionHandler('Observer')(args);
          }
        }
      });
    }
  }

}