import { ValueProvider } from "../../provider/value-provider";
import { Stoppable } from "../utils/stoppable";
import { DmlTrigger, IAfterDmlContext, IDmlTrigger } from "./dml-trigger";
import { FoundryDocument, UtilsDocument } from "./utils-document";

const triggersByDocumentType = new Map<string, {trigger: CallbackTrigger<any>, stoppable: Stoppable}>();
type FoundryDocumentClass<T extends FoundryDocument> = {new(...args: any[]): T; documentName: string;};

class CallbackTrigger<T extends FoundryDocument> implements IDmlTrigger<T> {
  public callbacksByUuid = new Map<string, DocumentListener<T>>();
  
  constructor(
    public readonly type: FoundryDocumentClass<T>
  ) {
  }

  public afterUpsert(context: IAfterDmlContext<T>): void | Promise<void> {
    for (const row of context.rows) {
      if (this.callbacksByUuid.has(row.newRow.uuid)) {
        this.callbacksByUuid.get(row.newRow.uuid).provider.set(row.newRow);
      }
    }
  }

  public afterDelete(context: IAfterDmlContext<T>): void | Promise<void> {
    for (const row of context.rows) {
      if (this.callbacksByUuid.has(row.oldRow.uuid)) {
        this.callbacksByUuid.get(row.oldRow.uuid).provider.set(null);
      }
    }
  }
}

export class DocumentListener<T extends FoundryDocument> implements Stoppable {
  public provider = new ValueProvider<T>();

  private constructor(
    private readonly uuid: string,
  ) {
    // Load initial value
    UtilsDocument.fromUuid(uuid).then(doc => this.provider.set(doc as T));
  }

  public listenFirst(): Promise<T> {
    return this.provider.listenFirst();
  }

  public get(): T {
    return this.provider.get();
  }

  public listen(callback: (value?: T) => void): Stoppable {
    return this.provider.listen(callback);
  }

  public stop(): void {
    const uuidParts = this.uuid.split('.');
    const documentType: string = uuidParts[uuidParts.length - 2];
    const trigger = triggersByDocumentType.get(documentType);
    trigger.trigger.callbacksByUuid.delete(this.uuid);
    if (trigger.trigger.callbacksByUuid.size === 0) {
      trigger.stoppable.stop();
      triggersByDocumentType.delete(documentType);
    }
  }

  public static listenUuid<T extends FoundryDocument>(uuid: string): DocumentListener<T> {
    // TODO add listener as 2nd callback & return stoppable
    // TODO make sure CONFIG[documentType].documentClass happens when they are init
    const uuidParts = uuid.split('.');
    const documentType: string = uuidParts[uuidParts.length - 2];

    let trigger = triggersByDocumentType.get(documentType)?.trigger;
    if (trigger == null) {
      trigger = new CallbackTrigger(CONFIG[documentType].documentClass);
      const stoppable = DmlTrigger.registerTrigger(trigger);
      triggersByDocumentType.set(documentType, {trigger, stoppable});
    }
    if (!trigger.callbacksByUuid.has(uuid)) {
      trigger.callbacksByUuid.set(uuid, new DocumentListener<T>(uuid));
    }
    return trigger.callbacksByUuid.get(uuid);
  }
}