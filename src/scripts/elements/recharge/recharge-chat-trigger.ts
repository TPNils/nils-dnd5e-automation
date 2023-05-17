import { RollData } from "../../lib/roll/utils-roll";

export interface RechargeFlagData {
  itemUuids: string[];
  rollsByItemUuid: {
    [uuid: string]: RollData;
  }
  forcedSuccessByItemUuid: {
    [uuid: string]: boolean;
  }
}

// TODO Do I want to do this