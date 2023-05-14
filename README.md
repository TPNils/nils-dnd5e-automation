# Index
TODO maybe automate as a deploy action?

# Nils' dnd5e automation - FoundryVTT Module
TODO introduction

## Installation

### Method 1 (latest version)
1. TODO register as a module on foundry onceI deem it ready for release

### Method 2 (latest or older versions)
1. Start up Foundry and click "Install Module" in the "Add-on Modules" tab.
2. Paste one of the following into the "Manifest URL" field:
  - _Latest Release:_ `https://github.com/TPNils/nils-dnd5e-automation/releases/download/latest/module.json`
  - _Previous Releases:_ A link to the `module.json` file from any of the [previous releases](https://github.com/TPNils/nils-dnd5e-automation/releases).
3. Click "Install" and the module should download and appear in your modules list.

URLs with the latest version for previous Foundry VTT editions
- TODO _Latest 9.x Release_:
- TODO _Latest 0.8.9 Release_:

## Compatibility

### Required Modules
When you install _Nils' dnd5e automation_ for the first time, you will be prompted to install these along side. _Nils' dnd5e automation_ will not work without them.
- [FVTT libWrapper](https://github.com/ruipin/fvtt-lib-wrapper#1-fvtt-libwrapper)
- [socketlib](https://github.com/manuelVo/foundryvtt-socketlib#socketlib)


### Incompatible Modules
Any other module that managed roll automation will not be compatible. Ideally _Nils' dnd5e automation_ should have all of the features you need regarding automation and no other should be required. If there are missing features, you can create a new feature request. If this module is not what you are looking for, may this list also help you find an alternative.
- [Midi-QOL](https://gitlab.com/tposney/midi-qol)
- [Minimal Rolling Enhancements](https://github.com/ElfFriend-DnD/FVTT-Minimal-Rolling-Enhancements-DND5E#minimal-rolling-enhancements-mre-for-dd5e)
- [Ready Set Roll for 5e](https://github.com/MangoFVTT/fvtt-ready-set-roll-5e#ready-set-roll-for-5e---foundryvtt-module)


### Verified Modules
The following modules have been verified as compatible with the latest version of _Nils' dnd5e automation_ and the specified module version.
- [Combat Utility Belt](https://github.com/death-save/combat-utility-belt#combat-utility-belt) <sup>(1.6.0+)</sup>
- [Dice So Nice](https://gitlab.com/riccisi/foundryvtt-dice-so-nice#installation) <sup>(2.0.0+)</sup>
- [Dynamic Active Effects](https://gitlab.com/tposney/dae) <sup>( TODO )</sup>
- [Force Client Settings](https://gitlab.com/kimitsu_desu/force-client-settings#force-client-settings) <sup>( 1.0.4 )</sup>
- [Token Action HUD](https://github.com/Larkinabout/fvtt-token-action-hud-dnd5e#token-action-hud-dd-5eken-action-hud-dnd5e) <sup>Foundry v8, v9 (2.2.3+)</sup>
- [Token Action HUD Core](https://github.com/Larkinabout/fvtt-token-action-hud-core#token-action-hud-core) <sup>Foundry v10+ (1.2.3+)</sup> + [Token Action HUD D&D 5e](https://github.com/Larkinabout/fvtt-token-action-hud-dnd5e#token-action-hud-dd-5eken-action-hud-dnd5e) <sup>Foundry v10+ (1.2.2+)</sup>
- TODO verify more interactions, especially other big modules, even if it seems silly that they might cause compatibility issues


## Implemented Features
TODO market the module with detailed info, screenshots & gifs. You should be convinced just by looking at screenshots & gifs and info should inform them on how it works.

Crude list
- Minimal clicks
  - Auto consume spell slots + revert
  - Config to auto roll
  - (Auto) apply damage & effects

- Retroactive roll editing
  - Adv => normal => Dis without new rolls
  - normal => crit
  - Including manual bonus

- Client side rendering
  - Should have a user friendlier name: Partial hidden info
  - Hide roll details (or not)
  - Add screenshot with player view + gm view and what permissions you need for the player to see

- Custom SRD features and spell support
  - Should I list all features and spells? I want to support all SRD.
  - Probably list some of the most used like sneak, hunters mark, etc...
  - Separate page with all of them? Might convince some one to start using it.

## Contributing
TODO coding
TODO translations (if this is even different than merge requests?)