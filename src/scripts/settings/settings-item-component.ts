import { DocumentListener } from "../lib/db/document-listener";
import { RunOnce } from "../lib/decorator/run-once";
import { AsyncAttribute, Attribute, Component, OnInit, OnInitParam, Output } from "../lib/render-engine/component";
import { UtilsForceClientSettings } from "../lib/utils/utils-force-client-settings";
import { ValueReader } from "../provider/value-provider";
import { staticValues } from "../static-values";
import { UtilsLog } from "../utils/utils-log";

@Component({
  tag: SettingsItemComponent.selector(),
  html: /*html*/`
    <div class="label-wrapper">
      <span *if="this.forceClientSettings.render" [title]="this.forceClientSettings.hint" class="icon fa {{this.forceClientSettings.icon}}" (click)="this.toggleForceClientSetting()">&nbsp;</span>
      <label *if="this.renderType">
        <div class="label-text">
          {{this.setting.name}}
        </div>
        <input *if="this.renderType === 'string'" type="string" [value]="this.currentValue" [disabled]="!this.canEdit" (blur)="this.setValue($event)"/>

        <select *if="this.renderType === 'picklist'" [disabled]="!this.canEdit" (change)="this.setValue($event)">
          <option *for="let key in this.setting.choices" [value]="key" [selected]="this.currentValue === key">{{this.setting.choices[key]}}</option>
        </select>

        <input *if="this.renderType === 'number'" type="number" [value]="this.currentValue" [disabled]="!this.canEdit" (blur)="this.setValue($event)"/>

        <input *if="this.renderType === 'boolean'" type="checkbox" [checked]="!!this.currentValue" [disabled]="!this.canEdit" (change)="this.setValue($event)">
      </label>
    </div>
    <p class="notes" *if="this.renderType && this.setting?.hint">{{{this.setting.hint}}}</p>
  `,
  style: /*css*/`
    :host {
      display: block;
    }

    .label-wrapper {
      display: flex;
      align-items: baseline;
    }

    .icon {
      min-width: 20px;
      cursor: pointer;
    }

    input,
    select {
      cursor: pointer;
    }

    label {
      display: flex;
      flex-grow: 1;
      align-items: center;
    }

    .label-text {
      display: block;
      font-weight: bold;
      flex-grow: 1;
    }
  `
})
export class SettingsItemComponent implements OnInit {
  
  public static selector(): string {
    return `${staticValues.code}-settings-item-page`;
  }

  public setting: SettingConfig<any> & {module?: string};
  public renderType: 'string' | 'picklist' | 'number' | 'boolean';
  public currentValue: any;
  public canEdit = false;
  
  public onInit(args: OnInitParam) {
    args.addStoppable(
      this.settingKey$
        .switchMap(settingKey => ValueReader.mergeObject({
          settingKey: settingKey,
          settingValue: DocumentListener.listenSettingValue<string>(settingKey),
        }))
        .listen(({settingKey, settingValue}) => {
          this.settingKey = settingKey;
          this.setting = game.settings.settings.get(this.settingKey);
          this.renderType = null;
          this.currentValue = null;
          this.canEdit = false;
          if (this.setting) {
            if (this.setting.scope === 'client') {
              this.canEdit = true;
            } else {
              this.canEdit = game.user.isGM;
            }
            this.currentValue = settingValue;
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
      }),
    );
  }

  @AsyncAttribute({name: 'data-setting', dataType: 'string'})
  public settingKey$: ValueReader<string>;
  private settingKey: string;
  

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

    if (!this.setting || !UtilsForceClientSettings.isActive()) {
      return;
    }
    
    let isClientSetting = this.setting.scope === 'client';
    if (!isClientSetting) {
      // Client settings gets overwritten to 'world' when forced
      isClientSetting = UtilsForceClientSettings.getState(this.settingKey) === 'hard';
    }
    if (!isClientSetting) {
      return;
    }
    
    if (UtilsForceClientSettings.isForceClientSettingsPreV2(ForceClientSettings)) {
      // Only GM can edit
      this.forceClientSettings.render = game.user.isGM;
      this.forceClientSettings.mode = UtilsForceClientSettings.getState(this.settingKey);
      this.forceClientSettings.hint = game.i18n.localize("FORCECLIENTSETTINGS.ui.unforced-settings-hint");
    } else {
      this.forceClientSettings.mode = UtilsForceClientSettings.getState(this.settingKey);
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

  public async toggleForceClientSetting() {
    await UtilsForceClientSettings.toggle(this.settingKey);
    this.calcForceClientSettingsInteraction();
  }

}