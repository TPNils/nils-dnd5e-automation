import { MyActor } from "./fixed-types"


interface Document {
  getFlag: MyActor['getFlag'];
  setFlag: (scope: string,key: string,v: any) => Promise<this>;
}

declare global {
  namespace foundry {
    namespace abstract {
      interface Document extends Document {

      }
    }
  }
  interface Combat extends Document {
  }
  interface User {
    targets: Set<Token>;
  }
}


class DataModelCls<DATA, PARENT extends foundry.abstract.Document<any, any> = foundry.abstract.Document<any, any>> {
  constructor(data?: DATA, options?: {parent?: any, strict?: boolean, [key: string]: any});

  readonly _source: Readonly<DATA>;
  readonly parent: PARENT;
  readonly flags: Record<string, Record<string, any>>;
  readonly schema: SchemaField;
  readonly invalid: boolean;

  /** Update with a DML */
  public update(diff: DeepPartial<DATA>, options?: any);
  /** Update the source data locally without a DML */
  public updateSource(diff: DeepPartial<DATA>, options?: any);
  /**
   * Copy and transform the DataModel into a plain object.
   * Draw the values of the extracted object from the data source (by default) otherwise from its transformed values.
   * @param {boolean} [source=true]     Draw values from the underlying data source rather than transformed values
   * @returns {object}                  The extracted primitive object
   */
  public toObject(source: boolean=true): object;
}

/** Since foundry V10 */
declare global {
  namespace foundry {
    namespace abstract {
      type DataModel<SYSTEM extends object, DATA extends object = object> = DataModelCls<SYSTEM> & DATA & {
        system: SYSTEM;
      };
    }
  }
}