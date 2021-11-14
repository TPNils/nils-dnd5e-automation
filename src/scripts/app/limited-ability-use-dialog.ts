import { staticValues } from "../static-values";
import { MyItem } from "../types/fixed-types";
// @ts-expect-error
import AbilityUseDialog from "/systems/dnd5e/module/apps/ability-use-dialog.js";

// based on https://gitlab.com/foundrynet/dnd5e/-/blob/master/module/apps/ability-use-dialog.js
export class LimitedAbilityUseDialog {
  
  public static async create(item: MyItem): Promise<{
    level: string;
    placeTemplate: string;
  }> {
    if ( !item.isOwned ) {
      throw new Error("You cannot display an ability usage dialog for an unowned item");
    }

    // Prepare data
    const actorData = item.actor.data.data;
    const itemData = item.data.data;
    const uses = itemData.uses || {};
    const quantity = itemData.quantity || 0;
    const recharge = itemData.recharge || {};
    const recharges = !!recharge.value;
    const sufficientUses = (quantity > 0 && !uses.value) || uses.value > 0;

    // Prepare dialog form data
    const data = {
      item: item.data,
      title: game.i18n.format("DND5E.AbilityUseHint", {type: game.i18n.localize(`DND5E.ItemType${item.type.capitalize()}`), name: item.name}),
      note: AbilityUseDialog._getAbilityUseNote(item.data, uses, recharge),
      consumeSpellSlot: false,
      consumeRecharge: recharges,
      consumeResource: !!itemData.consume.target,
      consumeUses: uses.per && (uses.max > 0),
      canUse: recharges ? recharge.charged : sufficientUses,
      createTemplate: game.user.can("TEMPLATE_CREATE") && item.hasAreaTarget,
      errors: [],
      isSpell: false,
    };
    if ( item.data.type === "spell" ) {
      AbilityUseDialog._getSpellData(actorData, itemData, data);
    }

    // Render the ability usage template
    const html = await renderTemplate(`modules/${staticValues.moduleName}/templates/ability-use.hbs`, data);

    // Create the Dialog and return data as a Promise
    const icon = data.isSpell ? "fa-magic" : "fa-fist-raised";
    const label = game.i18n.localize(`DND5E.AbilityUse${data.isSpell ? "Cast" : "Use"}`);
    return new Promise(resolve => {
      const dlg = new AbilityUseDialog(item, {
        title: `${item.name}: ${game.i18n.localize("DND5E.AbilityUseConfig")}`,
        content: html,
        buttons: {
          use: {
            icon: `<i class="fas ${icon}"></i>`,
            label: label,
            callback: (html: JQuery) => {
              const fd = new FormDataExtended(html[0].querySelector("form"), {});
              resolve(fd.toObject() as any);
            }
          }
        },
        default: "use",
        close: () => resolve(null)
      });
      dlg.render(true);
    });
  }

}