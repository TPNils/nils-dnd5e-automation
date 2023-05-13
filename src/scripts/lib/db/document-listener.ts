import { ValueProvider, ValueReader } from "../../provider/value-provider";
import { UtilsLog } from "../../utils/utils-log";
import { Stoppable } from "../utils/stoppable";
import { DmlTrigger, IAfterDmlContext, IDmlTrigger } from "./dml-trigger";
import { FoundryDocument, UtilsDocument } from "./utils-document";

const triggersByDocumentType = new Map<string, {trigger: CallbackTrigger<any>, stoppable: Stoppable}>();
type FoundryDocumentClass<T extends FoundryDocument> = {new(...args: any[]): T; documentName: string;};

class CallbackTrigger<T extends FoundryDocument> implements IDmlTrigger<T> {
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
          if (this.callbacksByUuid.size === 0) {
            triggersByDocumentType.get(this.type.documentName).stoppable.stop();
            triggersByDocumentType.delete(this.type.documentName);
          }
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

export class DocumentListener<T> extends ValueReader<T> {

  private readonly documentType: string;
  private constructor(
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
      trigger = new CallbackTrigger(CONFIG[this.documentType].documentClass);
      const stoppable = DmlTrigger.registerTrigger(trigger);
      triggersByDocumentType.set(this.documentType, {trigger, stoppable});
    }
    return trigger.addListener(this.uuid, callback);
  }

  public static listenUuid<T = FoundryDocument>(uuid: string): ValueReader<T> {
    return new DocumentListener<T>(uuid);
  }

  public static listenSettingValue<T = any>(...settingKeyParts: string[]): ValueReader<T> {
    const settingKey = settingKeyParts.join('.');
    const settingConfig = game.settings.settings.get(settingKey);
    if (settingConfig == null) {
      return new ValueProvider(undefined);
    }
    const storage = game.settings.storage.get(settingConfig.scope);
    let uuid: string;
    if (storage instanceof WorldSettings) {
      uuid = storage.getSetting(settingKey).uuid;
    } else {
      // TODO there is no uuid or hooks for client side settings in foundry V8, V9 & V10
      // Find a way around this, probably overwrite the client storage methods
      UtilsLog.warn('Setting', settingKey, 'is a client setting and does not support listening to changes.');
      const keyParts = settingKey.split('.');
      const namespace = keyParts.splice(0, 1)[0];
      const currentValue: any = game.settings.get(namespace, keyParts.join('.'));
      return new ValueProvider(currentValue);
    }
    
    return new DocumentListener<T>(uuid);
  }

}