interface ForceClientSettingsPreV2 {
  readonly forcedSettings: {[settingKey: string]: boolean};

  setup(): void;
  clickToggleForceSettings(event: MouseEvent): Promise<void>;
  renderSettingsConfig(app: any, html: JQuery): void;
}

interface ForceClientSettingsV2 {
  setup(): void;
  clickToggleForceSettings(event: MouseEvent, key: string, app: JQuery): Promise<void>;

  /**
   * modes:
   *  - hard: treat it as if the setting scope is "world"
   *  - soft: may optionally be edited by the clients, otherwise follows the simulated "world" scope
   *  - open (not in map): no interaction from force-client-settings
   */
  readonly forced: ReadonlyMap<string, {mode: 'soft' | 'hard'}>;
  forceSetting(key: string, mode: 'soft' | 'hard'): Promise<void>;
  unforceSetting(key: string): Promise<void>;
  
  readonly unlocked: ReadonlyMap<string, boolean>;
  /**
   * When soft locked, lock the setting to follow the "world" scope setting for this client.
   */
  lockSetting(key: string): Promise<void>;
  /**
   * When soft locked, unlock the setting so this client can have a different setting than the "world" scope.
   */
  unlockSetting(key: string): Promise<void>;
}

type ForceClientSettings = ForceClientSettingsPreV2 | ForceClientSettingsV2;

declare global {
  var ForceClientSettings: ForceClientSettings;
}

export type ForceClientSettingsState = 'open' | 'soft' | 'hard';

export class UtilsForceClientSettings {

  public static isActive(): boolean {
    return !!game.modules.get('force-client-settings')?.active;
  }

  public static async toggle(settingKey: string): Promise<void> {
    if (!UtilsForceClientSettings.isActive()) {
      return;
    }
    
    if (UtilsForceClientSettings.isForceClientSettingsPreV2(ForceClientSettings)) {
      const html = $(`
      <div class="form-group">
        <label>
          <span></span>
        </label>
        <div class="form-fields">
          <input name="${settingKey}"/>
        </div>
      </div>`);
      const eventTarget: EventTarget = html.find('label span')[0];

      return ForceClientSettings.clickToggleForceSettings({currentTarget: eventTarget} as MouseEvent)
    } else {
      if (game.user.isGM) {
        const mode = ForceClientSettings.forced.get(settingKey)?.mode;
        switch (mode) {
          case null:
          case undefined: {
            await ForceClientSettings.forceSetting(settingKey, "soft");
            break;
          }
          case 'soft': {
            await ForceClientSettings.forceSetting(settingKey, "hard");
            break;
          }
          case 'hard': {
            await ForceClientSettings.unforceSetting(settingKey);
            break;
          }
        }
      } else {
        if (ForceClientSettings.forced.get(settingKey)?.mode === "soft") {
          if (ForceClientSettings.unlocked.has(settingKey)) {
            await ForceClientSettings.lockSetting(settingKey);
          } else {
            await ForceClientSettings.unlockSetting(settingKey);
          }
        }
      }
    }
  }

  public static getState(settingKey: string): ForceClientSettingsState {
    if (!UtilsForceClientSettings.isActive()) {
      return 'open';
    }

    if (UtilsForceClientSettings.isForceClientSettingsPreV2(ForceClientSettings)) {
      return !!ForceClientSettings.forcedSettings[settingKey] ? 'hard' : 'open';
    } else {
      return ForceClientSettings.forced.get(settingKey)?.mode || 'open';
    }
  }

  public static isForceClientSettingsPreV2(setting: ForceClientSettings): setting is ForceClientSettingsPreV2 {
    return typeof (setting as ForceClientSettingsPreV2).forcedSettings === 'object';
  }

}