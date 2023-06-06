import { RunOnce } from "../lib/decorator/run-once";
import { Component, OnInit, OnInitParam } from "../lib/render-engine/component";
import { staticValues } from "../static-values";
import { UtilsLog } from "../utils/utils-log";

interface TabLayoutConfig {
  key: string;
  groups: Array<SettingLayout[]>;
  presets?: Record<string, Preset>;
}
interface Preset {
  description: string;
  values: Array<{key: string; value: any;}>;
}
interface SettingLayout {
  key: string;
  autoSave: boolean;
}

// new (game.settings.menus.get('nils-dnd5e-automation.menu').type)().render(true)
const allTabConfigs: TabLayoutConfig[] = [
  {
    key: 'Visibility',
    presets: {
     noSecrets: 
      {
        description: /*html*/`
          <p>
            This preset is intended for new GMs who are still learning DND together with there players and want to
            play with everything open so they can help each other.
          </p>
          <p>
            Players can see almost everything with the exception of GM secret blocks.
            This include damage types, roll modifiers, when something crits and other details.
            The amount of information available will make it very easy to meta game, even to players who don't intent to.
          </p>
          <p>
            <b>NOTE:</b> Fudging rolls is possible with this preset as the players will see the roll results.
          </p>
        `,
        values: [
          {key: `${staticValues.moduleName}.forceRollModeItem`, value: 'public'},
          {key: `${staticValues.moduleName}.itemNameVisibility`, value: 'allDetails'},
          {key: `${staticValues.moduleName}.itemImageVisibility`, value: 'allDetails'},
          {key: `${staticValues.moduleName}.itemDescriptionVisibility`, value: 'allDetails'},
          {key: `${staticValues.moduleName}.attackVisibility`, value: 'allDetails'},
          {key: `${staticValues.moduleName}.attackHiddenRoll`, value: 'total'},
          {key: `${staticValues.moduleName}.damageVisibility`, value: 'allDetails'},
          {key: `${staticValues.moduleName}.damageHiddenRoll`, value: 'total'},
          {key: `${staticValues.moduleName}.immunityVisibility`, value: 'allDetails'},
          {key: `${staticValues.moduleName}.checkVisibility`, value: 'allDetails'},
          {key: `${staticValues.moduleName}.checkHiddenRoll`, value: 'total'},
          {key: `${staticValues.moduleName}.checkDcVisibility`, value: 'allDetails'},
        ],
      },
      transparency: 
       {
         description: /*html*/`
          <p>
            This preset is intended for GMs who want to be transparent to their players with their rolls but prevent too much meta gaming.
          </p>
           <p>
             Players can see most of the information that matters but the details are hidden.
             Players will see all the details of other player characters and
             NPCs who they have the Observer/Owner permission for (like familiars).
             Any other NPC will have some things hidden like: did the NPC have advantage, was it a crit, what are the modifiers, item descriptions
           </p>
           <p>
             <b>NOTE:</b> Fudging rolls is possible with this preset as the players will see the roll results.
           </p>
         `,
         values: [
           {key: `${staticValues.moduleName}.forceRollModeItem`, value: 'public'},
           {key: `${staticValues.moduleName}.itemNameVisibility`, value: 'allDetails'},
           {key: `${staticValues.moduleName}.itemImageVisibility`, value: 'allDetails'},
           {key: `${staticValues.moduleName}.itemDescriptionVisibility`, value: 'playerOrPermission'},
           {key: `${staticValues.moduleName}.attackVisibility`, value: 'playerOrPermission'},
           {key: `${staticValues.moduleName}.attackHiddenRoll`, value: 'total'},
           {key: `${staticValues.moduleName}.damageVisibility`, value: 'playerOrPermission'},
           {key: `${staticValues.moduleName}.damageHiddenRoll`, value: 'total'},
           {key: `${staticValues.moduleName}.immunityVisibility`, value: 'playerOrPermission'},
           {key: `${staticValues.moduleName}.checkVisibility`, value: 'playerOrPermission'},
           {key: `${staticValues.moduleName}.checkHiddenRoll`, value: 'total'},
           {key: `${staticValues.moduleName}.checkDcVisibility`, value: 'playerOrPermission'},
         ],
       },
       dmScreen: 
        {
          description: /*html*/`
           <p>
             This preset come as close as possible to a traditional IRL dnd game with the information that the players get.
             It is intended for GMs who want to make private rolls but allow players to roll publicly.
           </p>
            <p>
              Players will see all the details of other player characters and
              NPCs who they have the Observer/Owner permission for (like familiars).
              Actions from any other NPC are mostly hidden,
              the only information they get is the associated image of the item/ability and if a roll has been made (as you would be able to hear IRL).
              Nothing else will be visible, not even the name of the item/ability.
            </p>
            <p>
              <b>NOTE:</b> Fudging is possible since players can't see the roll, you can roll one thing but say another.
            </p>
          `,
          values: [
            {key: `${staticValues.moduleName}.forceRollModeItem`, value: 'public'},
            {key: `${staticValues.moduleName}.itemNameVisibility`, value: 'permission'},
            {key: `${staticValues.moduleName}.itemImageVisibility`, value: 'allDetails'},
            {key: `${staticValues.moduleName}.itemDescriptionVisibility`, value: 'playerOrPermission'},
            {key: `${staticValues.moduleName}.attackVisibility`, value: 'playerOrPermission'},
            {key: `${staticValues.moduleName}.attackHiddenRoll`, value: 'rolled'},
            {key: `${staticValues.moduleName}.damageVisibility`, value: 'playerOrPermission'},
            {key: `${staticValues.moduleName}.damageHiddenRoll`, value: 'rolled'},
            {key: `${staticValues.moduleName}.immunityVisibility`, value: 'playerOrPermission'},
            {key: `${staticValues.moduleName}.checkVisibility`, value: 'playerOrPermission'},
            {key: `${staticValues.moduleName}.checkHiddenRoll`, value: 'rolled'},
            {key: `${staticValues.moduleName}.checkDcVisibility`, value: 'playerOrPermission'},
          ],
        },
    },
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
          <i class="fas fa-eye"></i> {{localize("${staticValues.moduleName}." + tab.key)}}
        </span>
      </div>
    </nav>
    <div class="wrapper" selected-tab="{{this.selectedTab}}">
      <div *for="let tab of this.allTabs" class="tab {{tab.key}}">
        <virtual *if="tab.presets != null">
          <div class="preset-selector">
            <p>
              These are presets for this settings tab and don't affect other tabs.
            </p>
            <p>
              The presets are designed to help you find a starting point on how you want to play.
              If none of the presets fit your needs, you can select the best one and tweak the individual settings below.
            </p>
            <p>
              These settings update in real time, no need to refresh before the changes apply.
            </p>
            <label *for="let presetKey in tab.presets">
              <input type="radio" name="{{tab.key}}" value="{{presetKey}}" checked="{{this.selectedPresetPerTab[tab.key] === presetKey}}" (change)="this.setSelectedTab(tab.key, presetKey)"/>
              {{localize('${staticValues.moduleName}.' + tab.key + '-presets-' + presetKey)}}
            </label>
          </div>
          <div class="preset-description">
            {{{tab.presets[this.selectedPresetPerTab[tab.key]].description}}}
            <button type="button" (click)="this.applyPreset()">{{localize('DND5E.Apply')}}</button>
          </div>
          <div class="separator"></div>
        </virtual>
        <virtual *for="let group of tab.groups">
          <nd5e-settings-item-page *for="let setting of group" [data-setting]="setting.key" [data-auto-save]="setting.autoSave"></nd5e-settings-item-page>
          <div class="separator"></div>
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
    .preset-selector label {
      font-weight: bold;
      display: block;
    }

    .separator {
      grid-column: 1 / span 2;
      border-bottom: 1px solid #7a7971;
    }

    .wrapper:not([selected-tab="Visibility"]) .Visibility,
    .wrapper:not([selected-tab="Automation"]) .Automation {
      display: none;
    }
  `
})
export class SettingsComponent {
  
  public static selector(): string {
    return `${staticValues.code}-settings-page`;
  }

  constructor() {
    for (const tab of this.allTabs) {
      if (tab.presets == null) {
        continue;
      }
      const keys = Object.keys(tab.presets);
      if (!keys.length) {
        continue;
      }
      this.selectedPresetPerTab[tab.key] = keys[0];
    }
  }

  public selectedTab = allTabConfigs[0].key;
  public selectedPresetPerTab: Record<string, string> = {};
  // TODO support variables in CSS during compile time so the CSS can be generated from this array
  public allTabs = allTabConfigs;
  private markChanged: () => void;
  public onInit(args: OnInitParam) {
    this.markChanged = args.markChanged;
  }
  
  public setSelectedTab(tabLey: string, presetKey: string): void {
    this.selectedPresetPerTab[tabLey] = presetKey;
    this.markChanged();
  }

  public applyPreset(): void {
    const tab =  this.allTabs.find(tab => tab.key === this.selectedTab);
    const preset = tab?.presets?.[this.selectedPresetPerTab[this.selectedTab]];
    for (const value of preset.values) {
      const firstDot = value.key.indexOf('.');
      game.settings.set(value.key.substring(0, firstDot), value.key.substring(firstDot + 1), value.value);
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