import { staticValues } from "../../static-values";
import { MyItem, MyActor } from "../../types/fixed-types";
import { UtilsLog } from "../../utils/utils-log";
import { TemplateCardPart, DescriptionCardPart, SpellLevelCardPart, AttackCardPart, DamageCardPart, OtherCardPart, ResourceCardPart, CheckCardPart, TargetCardPart, ActiveEffectCardPart, DeletedDocumentsCardPart, PropertyCardPart } from "../item/base/index";
import { ModularCard } from "../modular-card";
import { ModularCardCreateArgs, ModularCardPart } from "../modular-card-part";

export interface ModularCardInitAdd {
  addPart: ModularCardPart;
  position: ModularCardInitPosition<ModularCardPart | string>[];
}
export interface ModularCardInitPosition<T> {
  type: 'before' | 'after'
  reference: T;
}

export class BeforeCreateModuleCardEvent {

  constructor({item, actor, token}: ModularCardCreateArgs) {
    Object.defineProperties(this, {
      item: {
        value: item,
        writable: false,
        configurable: false,
      },
      actor: {
        value: actor,
        writable: false,
        configurable: false,
      },
      token: {
        value: token,
        writable: false,
        configurable: false,
      },
    })
  }

  public readonly item: MyItem;
  public readonly actor?: MyActor;
  public readonly token?: TokenDocument;

  private addActionsByType = new Map<string, ModularCardInitAdd>();
  private add(addParts: ModularCardPart | ModularCardPart[], ...inputPositions: Array<ModularCardInitPosition<ModularCardPart | string> | ModularCardInitPosition<ModularCardPart | string>[]>): void {
    addParts = (Array.isArray(addParts) ? addParts : [addParts]);

    const positions: ModularCardInitPosition<ModularCardPart | string>[] = [];
    for (const position of inputPositions.deepFlatten()) {
      const refType = typeof position.reference === 'string' ? position.reference : position.reference.getType();
      if (ModularCard.getTypeHandler(refType) == null) {
        UtilsLog.warn(new Error(`${refType} has not been registered, skipping it as a position option.`));
      } else {
        positions.push(position);
      }
    }

    for (const part of addParts) {
      // Re-add removed parts
      this.removed.delete(part.getType());
    }

    for (const part of addParts) {
      // Remove invalid parts (but add them to addActionsByType so the order can be calculated)
      if (ModularCard.getTypeHandler(part.getType()) == null) {
        this.remove(part);
        UtilsLog.error(new Error(`${part.getType()} has not been registered, it won't be added to the card.`));
      }
    }

    if (addParts.length > 0 && !this.addActionsByType.has(addParts[0].getType())) {
      this.addActionsByType.set(addParts[0].getType(), {
        addPart: addParts[0],
        position: positions,
      });
    }
    for (let i = 1; i < addParts.length; i++) {
      this.addActionsByType.set(addParts[i].getType(), {
        addPart: addParts[i],
        position: [{type: 'after', reference: addParts[0]}],
      });
    }
  }

  public addBefore(reference: ModularCardPart | string, addPart: ModularCardPart): void {
    this.add(addPart, {type: 'before', reference: reference});
  }

  public replace(reference: ModularCardPart | string, addPart: ModularCardPart): void {
    this.addBefore(reference, addPart);
    this.remove(reference);
  }

  public addAfter(reference: ModularCardPart | string, addPart: ModularCardPart): void {
    this.add(addPart, {type: 'after', reference: reference});
  }

  private removed = new Set<string>();
  public remove(...removeInputs: Array<ModularCardPart | ModularCardPart[] | string | string[]>) {
    // Don't actually remove any items so they can still be used as a reference
    const removes = removeInputs.deepFlatten();
    for (const remove of removes) {
      this.removed.add(typeof remove === 'string' ? remove : remove.getType());
    }
  }

  public getParts(): ModularCardPart[] {
    const resolvedParts: Array<string> = [];
    for (const standardPart of BeforeCreateModuleCardEvent.getStandardParts()) {
      resolvedParts.push(standardPart.getType());
    }

    const fallbackPosition: ModularCardInitPosition<string> = {
      type: 'after',
      reference: TemplateCardPart.instance.getType()
    };

    let pendingAddActions = Array.from(this.addActionsByType.values());
    while (pendingAddActions.length > 0) {
      const processing = pendingAddActions;
      pendingAddActions = [];
      for (const process of processing) {
        const positions = process.position.length === 0 ? [fallbackPosition] : process.position;
        let added = false;
        for (const position of positions) {
          const type = typeof position.reference === 'string' ? position.reference : position.reference.getType();
          const index = resolvedParts.indexOf(type);
          if (index !== -1) {
            resolvedParts.splice(index + (position.type === 'after' ? 1 : 0), 0, process.addPart.getType());
            added = true;
            break;
          }
          if (!added) {
            pendingAddActions.push(process);
          }
        }

        if (processing.length === pendingAddActions.length) {
          // Nothing got processed => missing a reference, use fallback
          // TODO be smarter, detect which are also still pending
          for (const pending of pendingAddActions) {
            pending.position = [fallbackPosition];
          }
        }
      }
    }
    
    for (const remove of this.removed) {
      const index = resolvedParts.indexOf(remove);
      if (index !== -1) {
        resolvedParts.splice(index, 1);
      }
    }

    return resolvedParts.map(typeName => ModularCard.getTypeHandler(typeName));
  }

  public static getStandardParts(): ModularCardPart[] {
    return [
      DescriptionCardPart.instance,
      SpellLevelCardPart.instance,
      AttackCardPart.instance,
      DamageCardPart.instance,
      OtherCardPart.instance,
      TemplateCardPart.instance,
      ResourceCardPart.instance,
      CheckCardPart.instance,
      TargetCardPart.instance,
      ActiveEffectCardPart.instance,
      DeletedDocumentsCardPart.instance,
      PropertyCardPart.instance,
    ];
  }

  public static getEventName(): string {
    return `${staticValues.code.capitalize()}.createModuleCard`;
  }
}