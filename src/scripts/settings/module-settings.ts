import { DocumentListener } from "../lib/db/document-listener";
import { FoundryDocument, PermissionCheckHandler, UtilsDocument } from "../lib/db/utils-document";
import { RunOnce } from "../lib/decorator/run-once";
import { ValueProvider } from "../provider/value-provider";
import { staticValues } from "../static-values";
import { MyActor } from "../types/fixed-types";
import { UtilsFoundry } from "../utils/utils-foundry";
import { UtilsHooks } from "../utils/utils-hooks";
import { Nd5aSettingsFormApplication, SettingsComponent } from "./settings-component";
import { SettingsItemComponent } from "./settings-item-component";

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
};

const partialHidingRollSetting: ClientSettings.PartialSettingConfig<string> = {
  hint: `
    <b>Hidden</b>: The player does not know if a roll happened.<br/>
    <b>Rolled</b>: The player knows if the GM has rolled or not, but not what was rolled.<br/>
    <b>Show total</b>: The player can see the total result, the individual rolls, bonuses and critical hits/misses are hidden.<br/>
  `,
  scope: 'world',
  config: false,
  type: String,
  choices: {
    hidden: 'Hidden',
    rolled: 'Rolled',
    total: 'Show total',
  },
  default: 'total',
};

function partialRollModeSetting(): ClientSettings.PartialSettingConfig<string> {
  const hintLines = [
    `<b>Default</b>: Use the same default roll mode for all chat messages.`
  ];
  const choices = {
    default: game.i18n.localize(`CHAT.RollDefault`),
  }

  const rollModes = UtilsFoundry.getDiceRoleModes();
  for (const key in rollModes) {
    const i18n = game.i18n.localize(`CHAT.Roll${key.toLowerCase().capitalize()}`);
    choices[key.toLowerCase()] = i18n;
    hintLines.push(`<b>${i18n}</b>: Force this kind of message as a ${i18n}`);
  }

  return {
    hint: hintLines.join('<br/>'),
    scope: 'world',
    config: false,
    type: String,
    choices: choices,
    default: 'default',
  }
}

export class ModuleSettings {

  @RunOnce()
  public static registerHooks(): void {
    SettingsItemComponent.registerHooks();
    SettingsComponent.registerHooks();
    ModuleSettings.registerCustomPermissions();

    UtilsHooks.i18nInit().then(() => {
      ModuleSettings.registerSettings()
    });
  }

  @RunOnce()
  private static registerSettings(): void {
    game.settings.registerMenu(staticValues.moduleName, 'menu', {
      // @ts-ignore form constructor has arguments, contact here is incorrect => ignore
      type: Nd5aSettingsFormApplication,
      name: "Settings",
      label: "Settings",      
      icon: "fas fa-bars",
      restricted: false,
    })

    // Define a new setting which can be stored and retrieved
    game.settings.register<string, string, string>(staticValues.moduleName, 'itemNameVisibility', {
      ...partialVisibilitySetting,
      name: 'Show item name',
    });
    game.settings.register<string, string, string>(staticValues.moduleName, 'itemImageVisibility', {
      ...partialVisibilitySetting,
      name: 'Show item image',
    });
    game.settings.register<string, string, string>(staticValues.moduleName, 'itemDescriptionVisibility', {
      ...partialVisibilitySetting,
      name: 'Show item description',
    });
    game.settings.register<string, string, string>(staticValues.moduleName, 'attackVisibility', {
      ...partialVisibilitySetting,
      name: 'Show attack roll',
    });
    game.settings.register<string, string, string>(staticValues.moduleName, 'attackHiddenRoll', {
      ...partialHidingRollSetting,
      name: 'Hidden attack roll behavior',
    });
    game.settings.register<string, string, string>(staticValues.moduleName, 'damageVisibility', {
      ...partialVisibilitySetting,
      name: 'Show damage roll',
    });
    game.settings.register<string, string, string>(staticValues.moduleName, 'damageHiddenRoll', {
      ...partialHidingRollSetting,
      name: 'Hidden damage roll behavior',
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
      name: 'Hidden skill check and saving throw roll behavior',
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
    game.settings.register<string, string, string>(staticValues.moduleName, 'autoConsumeResources', {
      name: 'Auto consume resources (spell slots, item usage, ...)',
      scope: 'client',
      config: false,
      type: String,
      choices: {
        never: 'Never',
        detection: 'Detection',
        always: 'Always',
      },
      default: 'detection',
      hint: `
        <b>Never</b>: Will need to manually click. Not recommended for those who forget a lot.<br>
        <b>Always</b>: resources will be used when the on item use.<br/>
        <b>Detection</b>: Auto consume after an interaction. Possible interactions:
          <ul>
            <li>Attack rolled</li>
            <li>Damage rolled</li>
            <li>Saving throw rolled</li>
            <li>Template placed rolled</li>
            <li>If the item has non of these, use the same rule as "Always"</li>
          </ul><br/>
        <p>
          <b>NOTE</b>: You can easily undo the usage and in my experience people will remember the undo button faster than the apply button for manual actions.
        </p>
      `,
    });
    game.settings.register<string, string, string>(staticValues.moduleName, 'forceRollModeItem', {
      ...partialRollModeSetting(),
      name: 'Force roll mode for item usage',
    });
    for (const variant of ['gm', 'player']) {
      const scope = variant === 'player' ? 'client' : 'world';
      game.settings.register<string, string, string>(staticValues.moduleName, `${variant}AutorollAttack`, {
        scope: scope,
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
        scope: scope,
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
      game.settings.register<string, string, string>(staticValues.moduleName, `${variant}AutorollOther`, {
        scope: scope,
        config: false,
        type: String,
        choices: {
          never: 'Never',
          always: 'Always',
        },
        default: 'never',
        name: `${variant.capitalize()}: Auto roll ${game.i18n.localize('DND5E.OtherFormula').toLowerCase()}`,
        hint: `
          <b>Never</b>: Never auto roll the ${game.i18n.localize('DND5E.OtherFormula').toLowerCase()}.<br/>
          <b>Always</b>: Always auto roll the ${game.i18n.localize('DND5E.OtherFormula').toLowerCase()}.<br/>
        `,
      });
      
      game.settings.register<string, string, string>(staticValues.moduleName, `${variant}AutorollCheck`, {
        scope: scope,
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
    
    game.settings.register<string, string, boolean>(staticValues.moduleName, 'captureManualRolls', {
      name: 'Capture manual rolls',
      hint: `When rolling a save manually (example: from the character sheet) and not from a item/spell message, capture the roll and use it on the item/spell message.`,
      scope: 'client',
      config: false,
      type: Boolean,
      default: true,
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
    function findActorUuid(document: FoundryDocument): string | null {
      let actorUuid: string | null = null;
      while (document) {
        // Unlinked token permissions are wonky
        if (document instanceof TokenDocument && document.actor instanceof Actor) {
          return document.actor.uuid;
        }
        if (document instanceof Actor) {
          actorUuid = document.uuid;
          break;
        }
        document = document.parent;
      }
      return actorUuid;
    }

    for (const permission of [
      {permissionName: `${staticValues.code}ReadItemName`, setting: 'itemNameVisibility'},
      {permissionName: `${staticValues.code}ReadItemImage`, setting: 'itemImageVisibility'},
      {permissionName: `${staticValues.code}ReadItemDescription`, setting: 'itemDescriptionVisibility'},
      {permissionName: `${staticValues.code}ReadAttack`, setting: 'attackVisibility'},
      {permissionName: `${staticValues.code}ReadDamage`, setting: 'damageVisibility'},
      // Since it's listed in the UI with damage, treat it with the same rule set
      // May want to change depending on user feedback
      {permissionName: `${staticValues.code}ReadOther`, setting: 'damageVisibility'},
      {permissionName: `${staticValues.code}ReadImmunity`, setting: 'immunityVisibility'},
      {permissionName: `${staticValues.code}ReadCheck`, setting: 'checkVisibility'},
      {permissionName: `${staticValues.code}ReadCheckDc`, setting: 'checkDcVisibility'},
    ]) {
      const syncHandler: PermissionCheckHandler['sync'] = args => {
        const setting = game.settings.get(staticValues.moduleName, permission.setting) as keyof (typeof partialVisibilitySetting)['choices'];
        switch (setting) {
          case 'allDetails': {
            return true;
          }
          case 'permission': {
            return UtilsDocument.getPermissionHandler('Observer').sync(args);
          }
          case 'player': {
            let actorUuid = findActorUuid(args.document);
            if (!actorUuid) {
              return false;
            }
            for (const user of game.users.values()) {
              if ((user.character as MyActor)?.uuid === actorUuid) {
                return true;
              }
            }
            return false;
          }
          default: /* playerOrPermission */ {
            let actorUuid = findActorUuid(args.document);
            if (!actorUuid) {
              return false;
            }
            for (const user of game.users.values()) {
              if ((user.character as MyActor)?.uuid === actorUuid) {
                return true;
              }
            }
            return UtilsDocument.getPermissionHandler('Observer').sync(args);
          }
        }
      }
      const asyncHandler: PermissionCheckHandler['async'] = args => {
        return DocumentListener.listenSettingValue<keyof (typeof partialVisibilitySetting)['choices']>(staticValues.moduleName, permission.setting).switchMap(setting => {
          switch (setting) {
            case 'allDetails': {
              return new ValueProvider(true);
            }
            case 'permission': {
              return UtilsDocument.getPermissionHandler('Observer').async(args);
            }
            case 'player': {
              let actorUuid = findActorUuid(args.document);
              if (!actorUuid) {
                return new ValueProvider(false);
              }
              for (const user of game.users.values()) {
                if ((user.character as MyActor)?.uuid === actorUuid) {
                  return new ValueProvider(true);
                }
              }
              return new ValueProvider(false);
            }
            default: /* playerOrPermission */ {
              let actorUuid = findActorUuid(args.document);
              if (!actorUuid) {
                return new ValueProvider(false);
              }
              for (const user of game.users.values()) {
                if ((user.character as MyActor)?.uuid === actorUuid) {
                  return new ValueProvider(true);
                }
              }
              return UtilsDocument.getPermissionHandler('Observer').async(args);
            }
          }
        })
        
      }
      UtilsDocument.registerCustomPermission(permission.permissionName, {
        sync: syncHandler,
        async: asyncHandler,
      });
    }
  }

}