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


class DataModelCls<DATA extends object, PARENT extends foundry.abstract.Document<any, any> = foundry.abstract.Document<any, any>> {
  constructor(data?: DATA, options?: {parent?: any, strict?: boolean, [key: string]: any});

  readonly _source: DATA;
  readonly parent: PARENT;
  readonly flags: Record<string, Record<string, any>>;
}

/** Sinds foundry V10 */
declare global {
  namespace foundry {
    namespace abstract {
      type DataModel<DATA extends object> = DataModelCls<DATA> & DATA;
    }
  }
}