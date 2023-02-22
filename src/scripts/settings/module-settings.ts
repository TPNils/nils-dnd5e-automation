import { UtilsDocument } from "../lib/db/utils-document";
import { RunOnce } from "../lib/decorator/run-once";
import { ModularCard } from "../modular-card/modular-card";
import { staticValues } from "../static-values";
import { MyActor } from "../types/fixed-types";
import { Nd5aSettingsFormApplication, SettingsComponent } from "./settings-component";
import { SettingsItemComponent } from "./settings-item-component";

const refreshMessages = () => {
  for (const message of game.messages.contents) {
    if (ModularCard.getCardPartDatas(message) != null) {
      ui.chat.updateMessage(message);
    }
  }
};

const partialVisibilitySetting: ClientSettings.PartialSettingConfig<string> = {
  hint: `
    <b>All details</b>: Nothing is hidden, all is visible to everyone.<br/>
    <b>Permission</b>: Require the observer permission of the item.<br/>
    <b>Player</b>: You can only see the rolls of other players, regardless of permissions.<br/>
    <b>Player or permission</b>: Match 'Permission' or 'Player'.<br/>
  `,
  scope: 'world',
  config: false,
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
    <b>Hidden</b>: Nothing is shown.<br/>
    <b>Show total</b>: Only the total is shown, the roll result and bonuses are hidden.<br/>
  `,
  scope: 'world',
  config: false,
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
    SettingsItemComponent.registerHooks();
    SettingsComponent.registerHooks();
    ModuleSettings.registerCustomPermissions();

    Hooks.on('init', () => {
      ModuleSettings.registerSettings();
    });
  }

  @RunOnce()
  private static registerSettings(): void {
    game.settings.registerMenu(staticValues.moduleName, 'menu', {
      // @ts-ignore form contructor has arguments, contact here is incorrect => ignore
      type: Nd5aSettingsFormApplication,
      name: "Settings",
      label: "Settings",      
      icon: "fas fa-bars",
      restricted: false,
    })

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
        <b>All details</b>: Nothing is hidden, all is visible to everyone.<br/>
        <b>Permission</b>: Require the observer permission of the item.<br/>
        <b>Player</b>: You can only see the DC of other players, regardless of permissions.<br/>
        <b>Player or permission</b>: Match 'Permission' or 'Player'.<br/>
      `,
    });
    for (const variant of ['gm', 'player']) {
      game.settings.register<string, string, string>(staticValues.moduleName, `${variant}AutorollAttack`, {
        scope: 'world',
        config: false,
        type: String,
        choices: {
          never: 'Never',
          always: 'Always',
        },
        default: 'never',
        name: `${variant.capitalize()}: Auto roll attack`,
        hint: `
          <b>Never</b>: Never auto roll the attack.<br/>
          <b>Always</b>: Always auto roll the attack.<br/>
        `,
      });
      
      game.settings.register<string, string, string>(staticValues.moduleName, `${variant}AutorollDamage`, {
        scope: 'world',
        config: false,
        type: String,
        choices: {
          never: 'Never',
          onAttackHit: 'Attack hits',
          always: 'Always',
        },
        default: 'never',
        name: `${variant.capitalize()}: Auto roll damage`,
        hint: `
          <b>Never</b>: Never auto roll the damage.<br/>
          <b>Attack hits</b>: When hitting a target or if there is no attack, auto roll the damage.<br/>
          <b>Always</b>: Always auto roll the damage.<br/>
        `,
      });
      
      game.settings.register<string, string, string>(staticValues.moduleName, `${variant}AutorollCheck`, {
        scope: 'world',
        config: false,
        type: String,
        choices: {
          never: 'Never',
          always: 'Always',
        },
        default: 'never',
        name: `${variant.capitalize()}: Auto roll skill/ability checks & saves`,
        hint: `
          <b>Never</b>: Never auto roll the skill/ability checks & saves.<br/>
          <b>Always</b>: Always auto roll the skill/ability checks & saves.<br/>
        `,
      });
    }
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