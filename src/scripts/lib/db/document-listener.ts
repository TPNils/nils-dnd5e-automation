import { ValueProvider, ValueReader } from "../../provider/value-provider";
import { UtilsHooks } from "../../utils/utils-hooks";
import { UtilsLog } from "../../utils/utils-log";
import { RunOnce } from "../decorator/run-once";
import { Stoppable } from "../utils/stoppable";
import { DmlTrigger, IAfterDmlContext, IDmlTrigger } from "./dml-trigger";
import { FoundryDocument, UtilsDocument } from "./utils-document";

const triggersByDocumentType = new Map<string, {trigger: CallbackDocumentTrigger<any>, stoppable: Stoppable}>();
type FoundryDocumentClass<T extends FoundryDocument> = {new(...args: any[]): T; documentName: string;};

const afterSettingHook = new ValueProvider<true>();
if (game.settings) {
  afterSettingHook.set(true);
} else {
  UtilsHooks.setup().then(() => {
    afterSettingHook.set(true);
  })
}

afterSettingHook.firstPromise().then(() => SettingListener.initClientSideSettingsHook());

class CallbackDocumentTrigger<T extends FoundryDocument> implements IDmlTrigger<T> {
  private callbacksByUuid = new Map<string, Map<number, (value?: T) => void>>();
  
  constructor(
    public readonly type: FoundryDocumentClass<T>
  ) {
  }

  private nextId = 0;
  public addListener(uuid: string, callback: (value?: T) => void): Stoppable {
    if (!this.callbacksByUuid.has(uuid)) {
      this.callbacksByUuid.set(uuid, new Map());
    }
    const id = this.nextId++;
    this.callbacksByUuid.get(uuid).set(id, callback);
    return {
      stop: () => {
        const callbacks = this.callbacksByUuid.get(uuid);
        if (callbacks) {
          callbacks.delete(id);
          if (callbacks.size === 0) {
            this.callbacksByUuid.delete(uuid);
          }
          // Don't unregister self to prevent foundry console spam
          // Every register & unregister create a console log
        }
      }
    }
  }

  public afterUpsert(context: IAfterDmlContext<T>): void | Promise<void> {
    for (const row of context.rows) {
      if (this.callbacksByUuid.has(row.newRow.uuid)) {
        for (const callback of this.callbacksByUuid.get(row.newRow.uuid).values()) {
          callback(row.newRow);
        }
      }
    }
  }

  public afterDelete(context: IAfterDmlContext<T>): void | Promise<void> {
    for (const row of context.rows) {
      if (this.callbacksByUuid.has(row.oldRow.uuid)) {
        for (const callback of this.callbacksByUuid.get(row.oldRow.uuid).values()) {
          callback(null);
        }
      }
    }
  }
}

class CallbackSettingKeyTrigger implements IDmlTrigger<Setting> {
  private callbacksByKey = new Map<string, Map<number, (value?: any) => void>>();
  
  public get type() {
    return Setting;
  } 

  private nextId = 0;
  public addListener<T>(key: string, callback: (value?: T) => void): Stoppable {
    if (!this.callbacksByKey.has(key)) {
      this.callbacksByKey.set(key, new Map());
    }
    const id = this.nextId++;
    this.callbacksByKey.get(key).set(id, callback);
    return {
      stop: () => {
        const callbacks = this.callbacksByKey.get(key);
        if (callbacks) {
          callbacks.delete(id);
          if (callbacks.size === 0) {
            this.callbacksByKey.delete(key);
          }
          // Don't unregister self to prevent foundry console spam
          // Every register & unregister create a console log
        }
      }
    }
  }

  public afterUpsert(context: IAfterDmlContext<Setting>): void | Promise<void> {
    for (const row of context.rows) {
      this.callbackChange(row.newRow.key, row.newRow.value);
    }
  }

  public afterDelete(context: IAfterDmlContext<Setting>): void | Promise<void> {
    for (const row of context.rows) {
      this.callbackChange(row.oldRow.key, null);
    }
  }

  public callbackChange(key: string, newValue: any): void {
    if (this.callbacksByKey.has(key)) {
      for (const callback of this.callbacksByKey.get(key).values()) {
        callback(newValue);
      }
    }
  }
}
let callbackSettingKeyTrigger: CallbackSettingKeyTrigger;
function getCallbackSettingKeyTrigger() {
  if (callbackSettingKeyTrigger == null) {
    callbackSettingKeyTrigger = new CallbackSettingKeyTrigger();
    DmlTrigger.registerTrigger(callbackSettingKeyTrigger);
  }
  return callbackSettingKeyTrigger;
}

class UuidListener<T> extends ValueReader<T> {

  private readonly documentType: string;
  constructor(
    private readonly uuid: string,
  ) {
    super();
    const uuidParts = uuid.split('.');
    this.documentType = uuidParts[uuidParts.length - 2];
  }

  public listen(callback: (value?: T) => void): Stoppable {
    UtilsDocument.fromUuid(this.uuid).then(init => callback(init as any as T));
    
    let trigger = triggersByDocumentType.get(this.documentType)?.trigger;
    if (trigger == null) {
      // TODO make sure CONFIG[documentType].documentClass happens when they are init
      trigger = new CallbackDocumentTrigger(CONFIG[this.documentType].documentClass);
      const stoppable = DmlTrigger.registerTrigger(trigger);
      triggersByDocumentType.set(this.documentType, {trigger, stoppable});
    }
    return trigger.addListener(this.uuid, callback);
  }

}

class SettingListener<T> extends ValueReader<T> {

  constructor(
    private readonly settingKey: string,
  ) {
    super();
  }

  public listen(callback: (value?: T) => void): Stoppable {
    const settingConfig = game.settings.settings.get(this.settingKey);
    if (settingConfig == null) {
      callback(undefined);
      UtilsLog.warn('Setting', this.settingKey, 'does not exist and does not support listening to changes.');
      return {stop: () => {}};
    }
    
    const keyParts = this.settingKey.split('.');
    const namespace = keyParts.splice(0, 1)[0];
    const currentValue: any = game.settings.get(namespace, keyParts.join('.'));
    callback(currentValue);

    return getCallbackSettingKeyTrigger().addListener(this.settingKey, callback);
  }

  @RunOnce()
  public static initClientSideSettingsHook(): void {
    const clientStorage = game.settings.storage.get('client') as Storage;

    const originalSetItem = clientStorage.setItem;
    clientStorage.setItem = function(this: Storage, ...args: any[]) {
      getCallbackSettingKeyTrigger().callbackChange(args[0], args[1]);
      return originalSetItem.apply(this, ...args);
    }
    
    const originalRemoveItem = clientStorage.removeItem;
    clientStorage.removeItem = function(this: Storage, ...args: any[]) {
      getCallbackSettingKeyTrigger().callbackChange(args[0], null);
      return originalRemoveItem.apply(this, ...args);
    }
  }

}

export class DocumentListener {

  public static listenUuid<T = FoundryDocument>(uuid: string): ValueReader<T>;
  public static listenUuid<T = FoundryDocument>(uuid: Iterable<string>): ValueReader<T[]>;
  public static listenUuid<T = FoundryDocument>(uuid: string | Iterable<string>): ValueReader<T> | ValueReader<T[]> {
    if (typeof uuid === 'string') {
      return new UuidListener<T>(uuid);
    }
    return ValueProvider.all(Array.from(uuid).map(id => new UuidListener<T>(id)));
  }

  public static listenSettingValue<T = any>(...settingKeyParts: string[]): ValueReader<T> {
    const settingKey = settingKeyParts.join('.');
    return afterSettingHook.switchMap(() => {
      return new SettingListener(settingKey);
    });
  }

}

globalThis.DocumentListener = DocumentListener;