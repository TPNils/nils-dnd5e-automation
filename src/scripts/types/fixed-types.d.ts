interface BaseDocument<DATA> {
  id?: string;
  data: DATA;
  getFlag(moduleName: string, key: string): any;
}

export type MyItem = Item & BaseDocument<any>;

export type MyActor = Actor & BaseDocument<any> & {
  items: Map<string, MyItem>;
}