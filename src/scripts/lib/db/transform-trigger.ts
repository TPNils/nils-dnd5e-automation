import { IDmlContext, ITrigger, IAfterDmlContext, IDmlContextRow, IUnregisterTrigger } from "./dml-trigger";

interface TransformResult<T extends IDmlContext<D>, D> {
  create: T;
  update: T;
  delete: T;
};
export class TransformTrigger<FROM, TO> implements ITrigger<FROM> {

  constructor(
    private readonly transformer: (from: FROM) => {uniqueKey: string, data: TO} | Array<{uniqueKey: string, data: TO}>,
  ){}

  private nextTriggerId = 0;
  private triggers = new Map<number, ITrigger<TO>>();

  public register(trigger: ITrigger<TO>): IUnregisterTrigger {
    const id = this.nextTriggerId++;
    this.triggers.set(id, trigger);

    return {
      unregister: () => {
        this.triggers.delete(id);
      }
    }
  }

  public beforeCreate(context: IDmlContext<FROM>): boolean | void { return this.before(this.transform(context)); }
  public beforeUpdate?(context: IDmlContext<FROM>): boolean | void { return this.before(this.transform(context)); }
  public beforeDelete?(context: IDmlContext<FROM>): boolean | void { return this.before(this.transform(context)); }
  private before<C extends IDmlContext<any>>(context: TransformResult<C, TO>): boolean | void {
    if (context.create.rows.length > 0) {
      for (const trigger of this.triggers.values()) {
        if (trigger.beforeCreate && trigger.beforeCreate(context.create) === false) {
          return false;
        }
        if (trigger.beforeUpsert && trigger.beforeUpsert(context.create) === false) {
          return false;
        }
      }
    }
    if (context.update.rows.length > 0) {
      for (const trigger of this.triggers.values()) {
        if (trigger.beforeUpdate && trigger.beforeUpdate(context.update) === false) {
          return false;
        }
        if (trigger.beforeUpsert && trigger.beforeUpsert(context.update) === false) {
          return false;
        }
      }
    }
    if (context.delete.rows.length > 0) {
      for (const trigger of this.triggers.values()) {
        if (trigger.beforeDelete && trigger.beforeDelete(context.delete) === false) {
          return false;
        }
      }
    }
  }
 
  public create?(context: IAfterDmlContext<FROM>): void | Promise<void> { return this.localAfter(this.transform(context)); }
  public update?(context: IAfterDmlContext<FROM>): void | Promise<void> { return this.localAfter(this.transform(context)); }
  private async localAfter<C extends IAfterDmlContext<any>>(context: TransformResult<C, TO>): Promise<void> {
    if (context.create.rows.length > 0) {
      for (const trigger of this.triggers.values()) {
        if (trigger.create) {
          await trigger.create(context.create);
        }
        if (trigger.upsert) {
          await trigger.upsert(context.create);
        }
      }
    }
    if (context.update.rows.length > 0) {
      for (const trigger of this.triggers.values()) {
        if (trigger.update) {
          await trigger.update(context.update);
        }
        if (trigger.upsert) {
          await trigger.upsert(context.update);
        }
      }
    }
  }
 
  public afterCreate?(context: IAfterDmlContext<FROM>): void | Promise<void> { return this.after(this.transform(context)); }
  public afterUpdate?(context: IAfterDmlContext<FROM>): void | Promise<void> { return this.after(this.transform(context)); }
  public afterDelete?(context: IAfterDmlContext<FROM>): void | Promise<void> { return this.after(this.transform(context)); }
  private async after<C extends IAfterDmlContext<any>>(context: TransformResult<C, TO>): Promise<void> {
    if (context.create.rows.length > 0) {
      for (const trigger of this.triggers.values()) {
        if (trigger.afterCreate) {
          await trigger.afterCreate(context.create);
        }
        if (trigger.afterUpsert) {
          await trigger.afterUpsert(context.create);
        }
      }
    }
    if (context.update.rows.length > 0) {
      for (const trigger of this.triggers.values()) {
        if (trigger.afterUpdate) {
          await trigger.afterUpdate(context.update);
        }
        if (trigger.afterUpsert) {
          await trigger.afterUpsert(context.update);
        }
      }
    }
    if (context.delete.rows.length > 0) {
      for (const trigger of this.triggers.values()) {
        if (trigger.afterDelete) {
          await trigger.afterDelete(context.delete);
        }
      }
    }
  }

  private transform<C extends IDmlContext<any>>(context: C): TransformResult<C, TO> {
    let createRows: IDmlContextRow<TO>[] = [];
    let updateRows: IDmlContextRow<TO>[] = [];
    let deleteRows: IDmlContextRow<TO>[] = [];
    for (const {newRow, oldRow, changedByUserId, options} of context.rows) {
      const newPartsMap = new Map<string, TO>()
      const oldPartsMap = new Map<string, TO>()
      {
        let newParts = this.transformer(newRow);
        if (newParts == null) {
          newParts = [];
        }
        if (!Array.isArray(newParts)) {
          newParts = [newParts];
        }
        let oldParts = this.transformer(oldRow);
        if (oldParts == null) {
          oldParts = [];
        }
        if (!Array.isArray(oldParts)) {
          oldParts = [oldParts];
        }

        for (const part of newParts) {
          newPartsMap.set(part.uniqueKey, part.data);
        }
        for (const part of oldParts) {
          oldPartsMap.set(part.uniqueKey, part.data);
        }
      }

      for (const [key, part] of newPartsMap.entries()) {
        const row: IDmlContextRow<TO> = {
          newRow: part,
          changedByUserId: changedByUserId,
          options: options,
        };
        if (oldPartsMap.has(key)) {
          row.oldRow = oldPartsMap.get(key);
        }

        if (row.oldRow) {
          updateRows.push(row);
        } else {
          createRows.push(row);
        }
      }
      
      for (const [key, part] of oldPartsMap.entries()) {
        if (!newPartsMap.has(key)) {
          deleteRows.push({
            oldRow: part,
            changedByUserId: changedByUserId,
            options: options,
          })
        }
      }
    }
    const baseContextClone = {...context, rows: null};
    return {
      create: {...deepClone(baseContextClone), rows: createRows},
      update: {...deepClone(baseContextClone), rows: updateRows},
      delete: {...deepClone(baseContextClone), rows: deleteRows},
    }
  }
  
}