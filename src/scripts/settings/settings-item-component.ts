import { RunOnce } from "../lib/decorator/run-once";
import { Attribute, Component, Output } from "../lib/render-engine/component";
import { staticValues } from "../static-values";

@Component({
  tag: SettingsItemComponent.selector(),
  html: /*html*/`
    <label *if="this.renderType">
      <div class="label-text">{{this.setting.name}}</div>
      <input *if="this.renderType === 'string'" type="string" [value]="this.currentValue" [disabled]="!this.canEdit" (blur)="this.setValue($event)"/>

      <select *if="this.renderType === 'picklist'" [disabled]="!this.canEdit" (change)="this.setValue($event)">
        <option *for="let key in this.setting.choices" [value]="key" [selected]="this.currentValue === key">{{this.setting.choices[key]}}</option>
      </select>

      <input *if="this.renderType === 'number'" type="number" [value]="this.currentValue" [disabled]="!this.canEdit" (blur)="this.setValue($event)"/>

      <input *if="this.renderType === 'boolean'" type="checkbox" [checked]="!!this.currentValue" [disabled]="!this.canEdit" (change)="this.setValue($event)">
    </label>
    <p class="notes" *if="this.renderType && this.setting?.hint" [innerHtml]="this.setting.hint"></p>
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

}