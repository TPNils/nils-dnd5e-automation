import { UtilsDocument } from "../lib/db/utils-document";
import { RunOnce } from "../lib/decorator/run-once";
import { UtilsDiceSoNice } from "../lib/roll/utils-dice-so-nice";
import { UtilsRoll } from "../lib/roll/utils-roll";
import { staticValues } from "../static-values";
import { MyActor, MyItem } from "../types/fixed-types";
import { ModularCard } from "./modular-card";
import { ClickEvent, createPermissionCheck, CreatePermissionCheckArgs, HtmlContext, ICallbackAction, KeyEvent, ModularCardPart } from "./modular-card-part";

type RollPhase = 'mode-select' | 'bonus-input' | 'result';

interface AttackCardData {
  phase: RollPhase;
  mode: 'normal' | 'advantage' | 'disadvantage';
  userBonus: string;
  calc$: {
    actorUuid?: string;
    label?: string;
    rollBonus?: string;
    evaluatedRoll?: ReturnType<Roll['toJSON']>;
    critTreshold: number;
    isCrit?: boolean;
  }
}

export class AttackCardPart implements ModularCardPart<AttackCardData> {

  public static create({item, actor}: {item: MyItem, actor?: MyActor}): AttackCardData[] {
    if (!['mwak', 'rwak', 'msak', 'rsak'].includes(item?.data?.data?.actionType)) {
      return [];
    }
    const bonus = ['@mod'];

    // Add proficiency bonus if an explicit proficiency flag is present or for non-item features
    if ( !["weapon", "consumable"].includes(item.data.data.type) || item.data.proficient ) {
      bonus.push("@prof");
    }

    const rollData: {[key: string]: any} = actor == null ? {} : item.getRollData();
    if (item.data.data.prof?.hasProficiency) {
      rollData.prof = item.data.data.prof.term;
    }

    // Item bonus
    if (item.data.data.attackBonus) {
      bonus.push(String(item.data.data.attackBonus));
    }

    // Actor bonus
    const actorBonus = actor?.data?.data?.bonuses?.[item.data.data.actionType]?.attack;
    if (actorBonus) {
      bonus.push(actorBonus);
    }

    // One-time bonus provided by consumed ammunition
    if ( (item.data.data.consume?.type === 'ammo') && !!actor?.items ) {
      const ammoItemData = actor.items.get(item.data.data.consume.target)?.data;

      if (ammoItemData) {
        const ammoItemQuantity = ammoItemData.data.quantity;
        const ammoCanBeConsumed = ammoItemQuantity && (ammoItemQuantity - (item.data.data.consume.amount ?? 0) >= 0);
        const ammoItemAttackBonus = ammoItemData.data.attackBonus;
        const ammoIsTypeConsumable = ammoItemData.type === "consumable" && ammoItemData.data.consumableType === "ammo";
        if ( ammoCanBeConsumed && ammoItemAttackBonus && ammoIsTypeConsumable ) {
          bonus.push(`${ammoItemAttackBonus}[ammo]`);
        }
      }
    }
    const attack: AttackCardData = {
      mode: 'normal',
      phase: 'mode-select',
      userBonus: "",
      calc$: {
        actorUuid: actor?.uuid,
        rollBonus: new Roll(bonus.filter(b => b !== '0' && b.length > 0).join(' + '), rollData).toJSON().formula,
        critTreshold: 20
      }
    };

    let critTreshold = item.data.data.critical?.threshold ?? attack.calc$.critTreshold;
    const actorDnd5eFlags = actor?.data?.flags?.dnd5e;
    if (item.type === 'weapon' && actorDnd5eFlags?.weaponCriticalThreshold != null) {
      critTreshold = Math.min(critTreshold, actor.data.flags.dnd5e.weaponCriticalThreshold);
    }
    if (item.type === 'spell' && actorDnd5eFlags?.spellCriticalThreshold != null) {
      critTreshold = Math.min(critTreshold, actor.data.flags.dnd5e.spellCriticalThreshold);
    }
    attack.calc$.critTreshold = critTreshold;

    return [attack];
  }

  @RunOnce()
  public static registerHooks(): void {
    ModularCard.registerModularCardPart(staticValues.moduleName, new AttackCardPart());
  }

  public getType(): string {
    return `AttackCardPart`
  }

  public getHtml({data}: HtmlContext<AttackCardData>): string | Promise<string> {
    return renderTemplate(
      `modules/${staticValues.moduleName}/templates/modular-card/attack-part.hbs`, {
        data: data,
        moduleName: staticValues.moduleName
      }
    );
  }

  public getCallbackActions(): ICallbackAction<AttackCardData>[] {
    const permissionCheck = createPermissionCheck<AttackCardData>(({data}) => {
      const documents: CreatePermissionCheckArgs['documents'] = [];
      if (data.calc$.actorUuid) {
        documents.push({uuid: data.calc$.actorUuid, permission: 'OWNER'});
      }
      return {documents: documents};
    })

    return [
      {
        regex: /^item-attack$/,
        permissionCheck: permissionCheck,
        execute: ({data, clickEvent}) => AttackCardPart.processItemAttack(data, clickEvent),
      },
      {
        regex: /^item-attack-bonus$/,
        permissionCheck: permissionCheck,
        execute: ({data, keyEvent, inputValue}) => AttackCardPart.processItemAttackBonus(data, keyEvent, inputValue as string),
      },
      {
        regex: /^item-attack-mode-(minus|plus)$/,
        permissionCheck: permissionCheck,
        execute: ({data, clickEvent, regexResult}) => AttackCardPart.processItemAttackMode(data, clickEvent, regexResult[1] as ('plus' | 'minus')),
      },
    ]
  }

  private static async processItemAttack(data: AttackCardData, clickEvent: ClickEvent | null): Promise<void> {
    if (data.phase === 'result') {
      return;
    }

    const orderedPhases: RollPhase[] = ['mode-select', 'bonus-input', 'result'];
    if (clickEvent?.shiftKey) {
      data.phase = orderedPhases[orderedPhases.length - 1];
    } else {
      data.phase = orderedPhases[orderedPhases.indexOf(data.phase) + 1];
    }

    if (orderedPhases.indexOf(data.phase) === orderedPhases.length - 1) {
      await AttackCardPart.processItemAttackRoll(data);
    }
  }
  
  private static async processItemAttackBonus(data: AttackCardData, keyEvent: KeyEvent | null, attackBonus: string): Promise<void> {
    if (data.calc$.evaluatedRoll?.evaluated || data.phase === 'result') {
      return;
    }

    if (attackBonus) {
      data.userBonus = attackBonus;
    } else {
      data.userBonus = "";
    }

    if (data.userBonus && !Roll.validate(data.userBonus) && keyEvent) {
      // Only show error on key press
      throw new Error(game.i18n.localize('Error') + ': ' + game.i18n.localize('Roll Formula'));
    }

    if (keyEvent?.key === 'Enter') {
      await AttackCardPart.processItemAttackRoll(data);
    } else if (keyEvent?.key === 'Escape') {
      data.phase = 'mode-select';
    }
  }

  private static async processItemAttackRoll(data: AttackCardData): Promise<void> {
    if (data.calc$.evaluatedRoll) {
      return;
    }
    
    const actor: MyActor = data.calc$?.actorUuid == null ? null : (await UtilsDocument.tokenFromUuid(data.calc$.actorUuid)).getActor();
    let baseRoll = new Die();
    baseRoll.faces = 20;
    baseRoll.number = 1;
    switch (data.mode) {
      case 'advantage': {
        baseRoll.number = 2;
        baseRoll.modifiers.push('kh');
        break;
      }
      case 'disadvantage': {
        baseRoll.number = 2;
        baseRoll.modifiers.push('kl');
        break;
      }
    }
    if (actor && actor.getFlag("dnd5e", "halflingLucky")) {
      // reroll a base roll 1 once
      // first 1 = maximum reroll 1 die not both at (dis)advantage (see PHB p173)
      // second 2 = reroll when the roll result is equal to 1 (=1)
      baseRoll.modifiers.push('r1=1');
    }
    const parts: string[] = [baseRoll.formula];
    if (data.calc$.rollBonus) {
      parts.push(data.calc$.rollBonus);
    }
    
    if (data.userBonus && Roll.validate(data.userBonus)) {
      parts.push(data.userBonus);
    }

    const roll = await UtilsRoll.simplifyRoll(new Roll(parts.join(' + '))).roll({async: true});
    UtilsDiceSoNice.showRoll({roll: roll});
    data.calc$.evaluatedRoll = roll.toJSON();
    data.phase = 'result';

    const baseRollResult = (data.calc$.evaluatedRoll.terms[0] as RollTerm & DiceTerm.TermData).results.filter(result => result.active)[0];
    data.calc$.isCrit = baseRollResult.result >= data.calc$.critTreshold;

    if (data.calc$.isCrit) {
      // TODO modify damage cards to become crits
      // for (const dmg of this.data.items?.[itemIndex].damages ?? []) {
      //   if (dmg.phase === 'mode-select') {
      //     dmg.mode = 'critical';
      //   }
      // }
    }
  }

  private static async processItemAttackMode(data: AttackCardData, event: ClickEvent | null, modName: 'plus' | 'minus'): Promise<void> {
    console.log('processItemAttackMode', {data, event, modName})
    let modifier = modName === 'plus' ? 1 : -1;
    if (event?.shiftKey && modifier > 0) {
      modifier++;
    } else if (event?.shiftKey && modifier < 0) {
      modifier--;
    }
    
    const order: Array<AttackCardData['mode']> = ['disadvantage', 'normal', 'advantage'];
    const newIndex = Math.max(0, Math.min(order.length-1, order.indexOf(data.mode) + modifier));
    if (data.mode === order[newIndex]) {
      return;
    }
    data.mode = order[newIndex];

    if (event?.shiftKey) {
      await AttackCardPart.processItemAttackRoll(data);
    }
    
    if (!data.calc$.evaluatedRoll) {
      return;
    }

    const originalRoll = Roll.fromJSON(JSON.stringify(data.calc$.evaluatedRoll));
    data.calc$.evaluatedRoll = (await UtilsRoll.setRollMode(originalRoll, data.mode)).toJSON();
  }

}