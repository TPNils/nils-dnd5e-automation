import { ValueReader } from "../../provider/value-provider";
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
}