interface BaseDocument<DATA> {
  id?: string;
  uuid: string;
  data: DATA;
  folder?: string;
  getFlag(moduleName: string, key: string): any;
}

export type MyItemData = {
  [key: string]: any;
  data: {
    [key: string]: any;
    damage: {
      [key: string]: any;
      parts: [string, string][]; // array of ['damage formula', 'damage type']
    },
    range: {
      value?: number;
      long?: number;
      units: string;
    },
    target: {
      value?: number;
      width?: number;
      units: string;
      type: string;
    },
  }
}

export type MyItem = Item & BaseDocument<MyItemData> & {
  pack?: string;
};

export type MyActor = Actor & BaseDocument<any> & {
  items: Map<string, MyItem>;
}

export type MyCompendiumCollection = CompendiumCollection & BaseDocument<CompendiumCollection.Metadata>;