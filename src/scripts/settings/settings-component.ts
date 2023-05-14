import { RunOnce } from "../lib/decorator/run-once";
import { Component, OnInit, OnInitParam } from "../lib/render-engine/component";
import { staticValues } from "../static-values";

interface TabLayoutConfig {
  key: string;
  groups: Array<SettingLayout[]>
}
interface TabLayout {
  key: string;
  label?: string;
  groups: Array<SettingLayout[]>
}
interface SettingLayout {
  key: string;
  autoSave: boolean;
}

// new (game.settings.menus.get('nils-dnd5e-automation.menu').type)().render(true)
const allTabConfigs: TabLayoutConfig[] = [
  {
    key: 'Visibility',
    groups: [
      [
        {key: `${staticValues.moduleName}.forceRollModeItem`, autoSave: true},
      ],
      [
        {key: `${staticValues.moduleName}.itemNameVisibility`, autoSave: true},
        {key: `${staticValues.moduleName}.itemImageVisibility`, autoSave: true},
        {key: `${staticValues.moduleName}.itemDescriptionVisibility`, autoSave: true},
      ],
      [
        {key: `${staticValues.moduleName}.attackVisibility`, autoSave: true},
        {key: `${staticValues.moduleName}.attackHiddenRoll`, autoSave: true},
      ],
      [
        {key: `${staticValues.moduleName}.damageVisibility`, autoSave: true},
        {key: `${staticValues.moduleName}.damageHiddenRoll`, autoSave: true},
        {key: `${staticValues.moduleName}.immunityVisibility`, autoSave: true},
      ],
      [
        {key: `${staticValues.moduleName}.checkVisibility`, autoSave: true},
        {key: `${staticValues.moduleName}.checkHiddenRoll`, autoSave: true},
        {key: `${staticValues.moduleName}.checkDcVisibility`, autoSave: true},
      ],
    ],
  },
  {
    key: 'Automation',
    groups: [
      [
        {key: `${staticValues.moduleName}.gmAutorollAttack`, autoSave: true},
        {key: `${staticValues.moduleName}.playerAutorollAttack`, autoSave: true},
        {key: `${staticValues.moduleName}.gmAutorollDamage`, autoSave: true},
        {key: `${staticValues.moduleName}.playerAutorollDamage`, autoSave: true},
        {key: `${staticValues.moduleName}.gmAutorollCheck`, autoSave: true},
        {key: `${staticValues.moduleName}.playerAutorollCheck`, autoSave: true},
      ],
      [
        {key: `${staticValues.moduleName}.captureManualRolls`, autoSave: true},
      ],
      [
        {key: `${staticValues.moduleName}.autoConsumeResources`, autoSave: true},
      ],
    ],
  },
]

@Component({
  tag: SettingsComponent.selector(),
  html: /*html*/`
    <nav class="tabs">
      <div *for="let tab of this.allTabs" class="item {{this.selectedTab === tab.key ? 'active' : ''}}">
        <span class="nav-text" (click)="this.selectedTab = tab.key">
          <i class="fas fa-eye"></i> {{tab.label}}
        </span>
      </div>
    </nav>
    <div class="wrapper" selected-tab="{{this.selectedTab}}">
      <div *for="let tab of this.allTabs" class="tab {{tab.key}}">
        <virtual *for="let group of tab.groups">
          <nd5a-settings-item-page *for="let setting of group" [data-setting]="setting.key" [data-auto-save]="setting.autoSave"></nd5a-settings-item-page>
          <div class="seperator"></div>
        </virtual>
      </div>
    </div>
  `,
  style: /*css*/`
    :host {
      display: block;
    }

    .nav-text{
      cursor: pointer;
    }

    .tabs {
      border-bottom: 1px solid #000;
      margin-bottom: 1em;
    }

    .wrapper .tab {
      display: grid;
      row-gap: .5em;
      column-gap: 1em;
      grid-template-columns: 1fr 1fr;
    }

    .tab-section-header {
      grid-column: 1 / span 2;
      font-size: 1.5em;
      font-weight: bold;
      border-bottom: 1px solid #7a7971;
    }

    .seperator {
      grid-column: 1 / span 2;
      border-bottom: 1px solid #7a7971;
    }

    .wrapper:not([selected-tab="Visibility"]) .Visibility,
    .wrapper:not([selected-tab="Automation"]) .Automation {
      display: none;
    }
  `
})
export class SettingsComponent implements OnInit {
  
  public static selector(): string {
    return `${staticValues.code}-settings-page`;
  }

  public selectedTab = allTabConfigs[0].key;
  // TODO support variables in CSS during compile time so the CSS can be generated from this array
  public allTabs: TabLayout[] = allTabConfigs.map(config => {
    return {
      ...deepClone(config),
      label: game.i18n.localize(`${staticValues.moduleName}.${config.key}`)
    };
  });
  public onInit(args: OnInitParam) {
    const settings: Array<Partial<SettingConfig>> = [];
    const prefix = `${staticValues.moduleName}.`;
    for (const [key, setting] of game.settings.settings.entries()) {
      if (key.startsWith(prefix)) {
        settings.push(setting);
      }
    }
  }

  @RunOnce()
  public static registerHooks() {

  }

}

export class Nd5aSettingsFormApplication extends FormApplication<any, any> {
   
  public getData() {
    return `<form><${SettingsComponent.selector()}></${SettingsComponent.selector()}></form>`;
  }

  public static get defaultOptions(): FormApplicationOptions {
    return mergeObject(super.defaultOptions, {
      classes: ['form'],
      popOut: true,
      width: Math.min(1000, window.innerWidth / 2),
      height: window.innerHeight - 100,
      template: `modules/${staticValues.moduleName}/templates/raw-html.hbs`,
      id: `${staticValues.moduleName}-form`,
      title: `${staticValues.moduleLabel} settings`,
    });
  }

  protected async _updateObject(event: Event, formData?: object): Promise<void> {
    // There is no update on submit, update happens when the setting changes
  }
}