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

const partialVisibilitySetting: ClientSettings.PartialSettingConfig<string> = {
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

const partialHidingRollSetting: ClientSettings.PartialSettingConfig<string> = {
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
    game.settings.register<string, string, string>(staticValues.moduleName, 'attackVisibility', {
      ...partialVisibilitySetting,
      name: 'Show attack roll',
    });
    game.settings.register<string, string, string>(staticValues.moduleName, 'attackHiddenRoll', {
      ...partialHidingRollSetting,
      name: 'Hidden attack roll behaviour',
    });
    game.settings.register<string, string, string>(staticValues.moduleName, 'damageVisibility', {
      ...partialVisibilitySetting,
      name: 'Show damage roll',
    });
    game.settings.register<string, string, string>(staticValues.moduleName, 'damageHiddenRoll', {
      ...partialHidingRollSetting,
      name: 'Hidden damage roll behaviour',
    });
    game.settings.register<string, string, string>(staticValues.moduleName, 'immunityVisibility', {
      ...partialVisibilitySetting,
      name: 'Show immunity, resistance & vulnerabilities',
    });
    game.settings.register<string, string, string>(staticValues.moduleName, 'checkVisibility', {
      ...partialVisibilitySetting,
      name: 'Show skill check and saving throw roll',
    });
    game.settings.register<string, string, string>(staticValues.moduleName, 'checkHiddenRoll', {
      ...partialHidingRollSetting,
      name: 'Hidden skill check and saving throw roll behaviour',
    });
    game.settings.register<string, string, string>(staticValues.moduleName, 'checkDcVisibility', {
      ...partialVisibilitySetting,
      name: 'Show skill check DC',
      hint: `
        *All details*: Nothing is hidden, all is visible to everyone.
        *Permission*: Require the observer permission of the item.
        *Player*: You can only see the DC of other players, regardless of permissions.
        *Player or permission*: Match 'Permission' or 'Player'.
      `,
    });
    game.settings.register<string, string, string>(staticValues.moduleName, 'aoeTargetRule', {
      name: 'Area of effect rules (targeting)',
      hint: `
        *DMG*: If a token is standing in an affected query which is at least 50% in the template area.
        *XGE*: If a token is touching the template.
      `,
      scope: 'world',
      config: true,
      type: String,
      choices: {
        dmg: 'DMG - Foundry default',
        xge: 'XGE (experimental)',
      },
      default: 'dmg',
      onChange: () => {
        // redraw
        for (const template of <IterableIterator<MeasuredTemplateDocument>> canvas.scene.getEmbeddedCollection(MeasuredTemplateDocument.documentName).values()) {
          if (template.object) {
            template.object.draw();
          }
        }
      }
    });
  }

  @RunOnce()
  private static registerCustomPermissions(): void {
    for (const permission of [
      {permissionName: `${staticValues.code}ReadAttack`, setting: 'attackVisibility'},
      {permissionName: `${staticValues.code}ReadDamage`, setting: 'damageVisibility'},
      {permissionName: `${staticValues.code}ReadImmunity`, setting: 'immunityVisibility'},
      {permissionName: `${staticValues.code}ReadCheck`, setting: 'checkVisibility'},
      {permissionName: `${staticValues.code}ReadCheckDc`, setting: 'checkDcVisibility'},
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