import { RunOnce } from "../lib/decorator/run-once";
import { Component, OnInit, OnInitParam } from "../lib/render-engine/component";
import { staticValues } from "../static-values";

// new (game.settings.menus.get('nils-dnd5e-automation.menu').type)().render(true)
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
      <div class="tab Visibility">
        <nd5a-settings-item-page class="left" data-setting="${staticValues.moduleName}.attackVisibility" data-auto-save="true"></nd5a-settings-item-page>
        <nd5a-settings-item-page class="right" data-setting="${staticValues.moduleName}.attackHiddenRoll" data-auto-save="true"></nd5a-settings-item-page>
        <div class="seperator"></div>
        <nd5a-settings-item-page class="left" data-setting="${staticValues.moduleName}.damageVisibility" data-auto-save="true"></nd5a-settings-item-page>
        <nd5a-settings-item-page class="right" data-setting="${staticValues.moduleName}.damageHiddenRoll" data-auto-save="true"></nd5a-settings-item-page>
        <nd5a-settings-item-page class="left" data-setting="${staticValues.moduleName}.immunityVisibility" data-auto-save="true"></nd5a-settings-item-page>
        <div class="seperator"></div>
        <nd5a-settings-item-page class="left" data-setting="${staticValues.moduleName}.checkVisibility" data-auto-save="true"></nd5a-settings-item-page>
        <nd5a-settings-item-page class="right" data-setting="${staticValues.moduleName}.checkHiddenRoll" data-auto-save="true"></nd5a-settings-item-page>
        <nd5a-settings-item-page class="left" data-setting="${staticValues.moduleName}.checkDcVisibility" data-auto-save="true"></nd5a-settings-item-page>
        <div class="seperator"></div>
      </div>
      <div class="tab AutoRolling">
        <nd5a-settings-item-page class="left" data-setting="${staticValues.moduleName}.gmAutorollAttack" data-auto-save="true"></nd5a-settings-item-page>
        <nd5a-settings-item-page class="right" data-setting="${staticValues.moduleName}.playerAutorollAttack" data-auto-save="true"></nd5a-settings-item-page>
        <nd5a-settings-item-page class="left" data-setting="${staticValues.moduleName}.gmAutorollDamage" data-auto-save="true"></nd5a-settings-item-page>
        <nd5a-settings-item-page class="right" data-setting="${staticValues.moduleName}.playerAutorollDamage" data-auto-save="true"></nd5a-settings-item-page>
        <nd5a-settings-item-page class="left" data-setting="${staticValues.moduleName}.gmAutorollCheck" data-auto-save="true"></nd5a-settings-item-page>
        <nd5a-settings-item-page class="right" data-setting="${staticValues.moduleName}.playerAutorollCheck" data-auto-save="true"></nd5a-settings-item-page>
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
    .wrapper:not([selected-tab="AutoRolling"]) .AutoRolling {
      display: none;
    }
  `
})
export class SettingsComponent implements OnInit {
  
  public static selector(): string {
    return `${staticValues.code}-settings-page`;
  }

  public selectedTab = 'Visibility';
  // TODO support variables in CSS during compile time so the CSS can be generated from this array
  public allTabs = ['Visibility', 'AutoRolling'].map(tabKey => ({key: tabKey, label: game.i18n.localize(`${staticValues.moduleName}.${tabKey}`)}));
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