import { RunOnce } from "../lib/decorator/run-once";
import { Attribute, Component, Output } from "../lib/render-engine/component";
import { staticValues } from "../static-values";

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

@Component({
  tag: SettingsItemComponent.selector(),
  html: /*html*/`
    <label *if="this.renderType" for="this.settingKey + ''">
      <div class="label-text">
        <div class="integration-dummy form-group" *if="this.forceClientSettings.render">
          <label class="integration-dummy">
            <span [title]="this.forceClientSettings.hint" class="fa {{this.forceClientSettings.icon}}" (click)="this.toggleForceClientSetting($event)">&nbsp;</span>
          </label>
          <div class="integration-dummy form-fields">
            <input [name]="this.settingKey"/>
          </div>
        </div>
        {{this.setting.name}}
      </div>
      <input *if="this.renderType === 'string'" type="string" [value]="this.currentValue" [disabled]="!this.canEdit" (blur)="this.setValue($event)"/>

      <select *if="this.renderType === 'picklist'" [disabled]="!this.canEdit" (change)="this.setValue($event)">
        <option *for="let key in this.setting.choices" [value]="key" [selected]="this.currentValue === key">{{this.setting.choices[key]}}</option>
      </select>

      <input *if="this.renderType === 'number'" type="number" [value]="this.currentValue" [disabled]="!this.canEdit" (blur)="this.setValue($event)"/>

      <input *if="this.renderType === 'boolean'" type="checkbox" [checked]="!!this.currentValue" [disabled]="!this.canEdit" (change)="this.setValue($event)">
    </label>
    <p class="notes" *if="this.renderType && this.setting?.hint">{{{this.setting.hint}}}</p>
  `,
  style: /*css*/`
    :host {
      display: block;
    }

    label {
      display: flex;
      align-items: center;
    }

    .label-text {
      display: block;
      font-weight: bold;
      flex-grow: 1;
    }

    /* Used to help with 3th party integrations who count on a fixed html structure */
    .integration-dummy {
      display: contents !important;
    }
    .integration-dummy input {
      display: none !important;
    }
  `
})
export class SettingsItemComponent {
  
  public static selector(): string {
    return `${staticValues.code}-settings-item-page`;
  }

  public setting: SettingConfig<any> & {module?: string};
  public renderType: 'string' | 'picklist' | 'number' | 'boolean';
  public currentValue: any;
  public canEdit = false;

  @Attribute({name: 'data-setting', dataType: 'string'})
  public set settingKey(v: string) {
    this.setting = game.settings.settings.get(v);
    this.renderType = null;
    this.currentValue = null;
    this.canEdit = false;
    if (this.setting) {
      if (this.setting.scope === 'client') {
        this.canEdit = true;
      } else {
        this.canEdit = game.user.isGM;
      }
      const keyParts = v.split('.');
      const namespace = keyParts.splice(0, 1)[0];
      this.currentValue = game.settings.get(namespace, keyParts.join('.'));
      if (this.setting.type === String) {
        if (this.setting.choices == null) {
          this.renderType = 'string';
        } else {
          this.renderType = 'picklist';
        }
      } else if (this.setting.type === Number) {
        this.renderType = 'number';
      } else if (this.setting.type === Boolean) {
        this.renderType = 'boolean';
      }
    }

    this.calcForceClientSettingsInteraction();
  }
  public get settingKey(): string {
    if (this.setting == null) {
      return null;
    }
    if (this.setting.module) {
      return `${this.setting.module}.${this.setting.key}`
    } else {
      return `${this.setting.namespace}.${this.setting.key}`
    }
  }

  @Attribute({name: 'data-auto-save', dataType: 'boolean'})
  public autoSave: boolean;

  @Output('changed')
  public onChange: any;

  public setValue(event: Event) {
    let value = undefined;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
      if (this.renderType === 'boolean') {
        value = (event.target as HTMLInputElement).checked;
      } else {
        value = event.target.value;
        if (value === '') {
          value = null;
        } else if (this.renderType === 'number') {
          value = Number(value);
        }
      }
    }

    if (value !== undefined) {
      this.onChange = value;
      if (this.autoSave) {
        if (this.setting.module) {
          game.settings.set(this.setting.module, this.setting.key, value);
        } else {
          game.settings.set(this.setting.namespace, this.setting.key, value);
        }
      }
    }
  }

  @RunOnce()
  public static registerHooks() {

  }

  public forceClientSettings = {
    render: false,
    mode: 'open' as 'open' | 'soft' | 'hard',
    icon: '',
    hint: '',
  };
  private calcForceClientSettingsInteraction() {
    this.forceClientSettings = {
      render: false,
      mode: 'open',
      icon: '',
      hint: '',
    }

    if (!this.setting || !game.modules.get('force-client-settings')?.active) {
      return;
    }
    
    let isClientSetting = this.setting.scope === 'client';
    // Client settings gets overwittten to 'world' when forced
    if (!isClientSetting) {
      if (this.isForceClientSettingsPreV2(ForceClientSettings)) {
        isClientSetting = !!ForceClientSettings.forcedSettings[this.settingKey];
      } else {
        isClientSetting = ForceClientSettings.forced.has(this.settingKey);
      }
    }
    if (!isClientSetting) {
      return;
    }
    
    if (this.isForceClientSettingsPreV2(ForceClientSettings)) {
      // Only GM can edit
      this.forceClientSettings.render = game.user.isGM;
      this.forceClientSettings.mode = !!ForceClientSettings.forcedSettings[this.settingKey] ? 'hard' : 'open';
      this.forceClientSettings.hint = game.i18n.localize("FORCECLIENTSETTINGS.ui.unforced-settings-hint");
    } else {
      if (ForceClientSettings.forced.has(this.settingKey)) {
        this.forceClientSettings.mode = ForceClientSettings.forced.get(this.settingKey).mode;
      } else {
        this.forceClientSettings.mode = 'open';
      }
      // non GM user can toggle if it has a soft lock
      this.forceClientSettings.render = game.user.isGM || this.forceClientSettings.mode === 'soft';
      this.forceClientSettings.hint = game.i18n.localize(`FORCECLIENTSETTINGS.ui.${this.forceClientSettings.mode}-${game.user.isGM ? 'gm' : 'client'}-hint`);
      if (!game.user.isGM && this.forceClientSettings.mode === 'soft' && ForceClientSettings.unlocked.has(this.settingKey)) {
        // Client can change it to open on their side in soft mode
        this.forceClientSettings.mode = 'open';
        this.forceClientSettings.hint = game.i18n.localize(`FORCECLIENTSETTINGS.ui.unlocked-client-hint`);
      }
    }

    switch (this.forceClientSettings.mode) {
      case 'hard': {
        this.forceClientSettings.icon = 'fa-lock';
        break;
      }
      case 'soft': {
        this.forceClientSettings.icon = 'fa-unlock';
        break;
      }
      case 'open': {
        this.forceClientSettings.icon = 'fa-lock-open';
        break;
      }
    }
  }

  public async toggleForceClientSetting(event: MouseEvent) {
    if (this.isForceClientSettingsPreV2(ForceClientSettings)) {
      await ForceClientSettings.clickToggleForceSettings(event);
    } else {
      if (game.user.isGM) {
        const mode = ForceClientSettings.forced.get(this.settingKey)?.mode;
        switch (mode) {
          case null:
          case undefined: {
            await ForceClientSettings.forceSetting(this.settingKey, "soft");
            break;
          }
          case 'soft': {
            await ForceClientSettings.forceSetting(this.settingKey, "hard");
            break;
          }
          case 'hard': {
            await ForceClientSettings.unforceSetting(this.settingKey);
            break;
          }
        }
      } else {
        if (ForceClientSettings.forced.get(this.settingKey)?.mode === "soft") {
          if (ForceClientSettings.unlocked.has(this.settingKey)) {
            await ForceClientSettings.lockSetting(this.settingKey);
          } else {
            await ForceClientSettings.unlockSetting(this.settingKey);
          }
        }
      }
    }
    this.calcForceClientSettingsInteraction();
  }

  private isForceClientSettingsPreV2(setting: ForceClientSettings): setting is ForceClientSettingsPreV2 {
    return typeof (setting as ForceClientSettingsPreV2).forcedSettings === 'object';
  }

}