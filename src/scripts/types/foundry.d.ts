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

  readonly _source: DATA;
  readonly parent: PARENT;
  readonly flags: Record<string, Record<string, any>>;

  /** Update with a DML */
  public update(diff: DeepPartial<DATA>, options?: any);
  /** Update the source data locally without a DML */
  public updateSource(diff: DeepPartial<DATA>, options?: any);
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