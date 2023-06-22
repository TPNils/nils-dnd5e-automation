# V10 upgrade TODO's
- Checkout the tours API
- See if I can make use of the tooltop API. It would be an improvement over html title as you can pass it html through the API (I think)
- Support actor Group type
- Also check if there are issues with Vehicle actors
- Fire the dnd5e events when a certain roll is made

## Event hooks
I may need to call these hooks manually since I am bypassing them in some way.
Alternative, refactor how I do thinks internally and call the item/actor methods so they internally call the hooks.
I am also not sure what every hook does so some might not be relevant.

Example for spell slots:
```js
Item5e.use(config={
  consumeSpellLevel: 5,
  consumeSpellSlot: true,
  // Ignore all the rest
  createMeasuredTemplate: false,
  consumeQuantity: false,
  consumeRecharge: false,
  consumeResource: false,
  consumeUsage: false,
  needsConfiguration: false,
}, options={})
```

```js
/**
  * A hook event that fires before an item's resource consumption has been calculated.
  * @function dnd5e.preItemUsageConsumption
  * @memberof hookEvents
  * @param {Item5e} item                  Item being used.
  * @param {ItemUseConfiguration} config  Configuration data for the item usage being prepared.
  * @param {ItemUseOptions} options       Additional options used for configuring item usage.
  * @returns {boolean}                    Explicitly return `false` to prevent item from being used.
  */
if ( Hooks.call("dnd5e.preItemUsageConsumption", item, config, options) === false ) return;

/**
  * A hook event that fires after an item's resource consumption has been calculated but before any
  * changes have been made.
  * @function dnd5e.itemUsageConsumption
  * @memberof hookEvents
  * @param {Item5e} item                     Item being used.
  * @param {ItemUseConfiguration} config     Configuration data for the item usage being prepared.
  * @param {ItemUseOptions} options          Additional options used for configuring item usage.
  * @param {object} usage
  * @param {object} usage.actorUpdates       Updates that will be applied to the actor.
  * @param {object} usage.itemUpdates        Updates that will be applied to the item being used.
  * @param {object[]} usage.resourceUpdates  Updates that will be applied to other items on the actor.
  * @returns {boolean}                       Explicitly return `false` to prevent item from being used.
  */
// NOTE: only gets called in dnd5e thinks there are usages, which might conflict with the current internals
if ( Hooks.call("dnd5e.itemUsageConsumption", item, config, options, usage) === false ) return;

/**
  * A hook event that fires before the Item is rolled to recharge.
  * @function dnd5e.preRollRecharge
  * @memberof hookEvents
  * @param {Item5e} item                 Item for which the roll is being performed.
  * @param {object} config               Configuration data for the pending roll.
  * @param {string} config.formula       Formula that will be used to roll the recharge.
  * @param {object} config.data          Data used when evaluating the roll.
  * @param {number} config.target        Total required to be considered recharged.
  * @param {boolean} config.chatMessage  Should a chat message be created for this roll?
  * @returns {boolean}                   Explicitly return false to prevent the roll from being performed.
  */
if ( Hooks.call("dnd5e.preRollRecharge", this, rollConfig) === false ) return;

/**
  * A hook event that fires after the Item has rolled to recharge, but before any changes have been performed.
  * @function dnd5e.rollRecharge
  * @memberof hookEvents
  * @param {Item5e} item  Item for which the roll was performed.
  * @param {Roll} roll    The resulting roll.
  * @returns {boolean}    Explicitly return false to prevent the item from being recharged.
  */
if ( Hooks.call("dnd5e.rollRecharge", this, roll) === false ) return roll;

/**
 * No futher info
 */
Hooks.call("dnd5e.getActiveEffectContextOptions", effect, ui.context.menuItems);

/**
 * No futher info
 */
Hooks.call("dnd5e.getItemContextOptions", item, ui.context.menuItems);

/**
  * A hook event that fires when some useful data is dropped onto an ItemSheet5e.
  * @function dnd5e.dropItemSheetData
  * @memberof hookEvents
  * @param {Item5e} item                  The Item5e
  * @param {ItemSheet5e} sheet            The ItemSheet5e application
  * @param {object} data                  The data that has been dropped onto the sheet
  * @returns {boolean}                    Explicitly return `false` to prevent normal drop handling.
  */
const allowed = Hooks.call("dnd5e.dropItemSheetData", item, this, data);

/**
  * A hook event that fires to generate the table for custom spellcasting types.
  * The actual hook names include the spellcasting type (e.g. `dnd5e.buildPsionicSpellcastingTable`).
  * @param {object} table                          Table definition being built. *Will be mutated.*
  * @param {Item5e} item                           Class for which the spellcasting table is being built.
  * @param {SpellcastingDescription} spellcasting  Spellcasting descriptive object.
  * @function dnd5e.buildSpellcastingTable
  * @memberof hookEvents
  */
Hooks.callAll(
  `dnd5e.build${spellcasting.type.capitalize()}SpellcastingTable`, table, item, spellcasting
);
```

## After V8 & V9 support is dropped
- Check if I can leverage DataModel schema validation for my own card parts
  - auto validate data
  - has build-in migration strats
  - Would I be able to leverage this for triggers? Trigger for this DataModel, regardless of it's position in the data
  - There is a HTMLField validation rule that strips invalid html => do I want this? I think so.
  - Will also be able to correctly parse array updates https://github.com/foundryvtt/foundryvtt/issues/7088
- Migrate to font-awesome 6.1.2
- combatStart, combatTurn and combatRound hooks are added if recharging is implemented