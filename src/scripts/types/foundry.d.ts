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