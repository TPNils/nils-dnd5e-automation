import { ChatMessageData, ChatMessageDataConstructorData } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/data/data.mjs/chatMessageData";
import { DmlTrigger, IDmlContext, IDmlTrigger, ITrigger } from "../lib/db/dml-trigger";
import { TransformTrigger } from "../lib/db/transform-trigger";
import { DmlUpdateRequest, UtilsDocument } from "../lib/db/utils-document";
import { RunOnce } from "../lib/decorator/run-once";
import { rerenderQueue } from "../lib/render-engine/virtual-dom/render-queue";
import { Stoppable } from "../lib/utils/stoppable";
import { UtilsCompare } from "../lib/utils/utils-compare";
import { UtilsObject } from "../lib/utils/utils-object";
import { staticValues } from "../static-values";
import { BaseDocumentV10, MyActor, MyItem, SpellData } from "../types/fixed-types";
import { UtilsLog } from "../utils/utils-log";
import { ActiveEffectCardPart, AttackCardData, AttackCardPart, CheckCardData, CheckCardPart, DamageCardData, DamageCardPart, DescriptionCardPart, OtherCardPart, PropertyCardPart, ResourceCardData, ResourceCardPart, SpellLevelCardData, SpellLevelCardPart, TargetCardData, TargetCardPart, TemplateCardData, TemplateCardPart } from "./base/index";
import { ItemUtils } from "./item-utils";
import { ModularCardComponent } from "./modular-card-component";
import { ModularCardCreateArgs, ModularCardPart } from "./modular-card-part";
import { UtilsFoundry } from "../utils/utils-foundry";

interface ModularCardPartDataLegacy<T = any> {
  readonly id: string;
  readonly type: string;
  data: T;
}

export type ModularCardDataLegacy = ModularCardPartDataLegacy[];
type ModularCardData = {[partType: string]: any};
interface ModularCardMeta {
  created?: {
    actorUuid?: string;
    tokenUuid?: string;
    itemUuid?: string;
  }
}

function getExtendedTypes(inputHandler: ModularCardPart | string): string[] {
  inputHandler = typeof inputHandler === 'string' ? ModularCard.getTypeHandler(inputHandler) : inputHandler;
  let prototypeIter = Object.getPrototypeOf(inputHandler);
  const types: string[] = [];
  while (prototypeIter != null) {
    if (typeof prototypeIter.getType === 'function') {
      types.push(prototypeIter.getType.call(inputHandler))
    }
    // get parent prototype
    prototypeIter = Object.getPrototypeOf(prototypeIter);
  }

  return types;
}

class ChatMessageAccessPropertyV10 implements ProxyHandler<any> {
  private static getTargetSymbol = Symbol('getWrappedTarget');
  private static revokeSymbol = Symbol('revoke');

  private readonly pathPrefix: string;

  private constructor(
    private readonly message: ChatMessage & BaseDocumentV10<any>,
    readonly path: string,
  ) {
    if (path.length > 0) {
      this.pathPrefix = path + '.';
    } else {
      this.pathPrefix = path;
    }
  }

  public get(target: any, prop: string | symbol, receiver: any) {
    let value = target[prop];
    if (value == null || typeof prop === 'symbol') {
      return value
    }
    if (typeof value !== 'object') {
      return value;
    }
    if (!value[ChatMessageAccessPropertyV10.getTargetSymbol]) {
      value = ChatMessageAccessPropertyV10.wrap(value, this.message, `${this.pathPrefix}${prop}`);
      target[prop] = value;
    }
    return value;
  }
  
  public set(target: any, prop: string | symbol, newValue: any, receiver: any) {
    target[prop] = newValue;
    if (typeof prop === 'symbol') {
      return true;
    }
    
    // Foundry does not like to partially update arrays as they become converted into objects
    const selectedSourcePath = `${this.pathPrefix}${prop}`;
    let traversingSourcePath = selectedSourcePath;
    let highestArrayPath: string;
    while (traversingSourcePath.length) {
      const value = getProperty(this.message, traversingSourcePath);
      if (Array.isArray(value)) {
        highestArrayPath = traversingSourcePath;
      }
      traversingSourcePath = traversingSourcePath.substring(0, traversingSourcePath.lastIndexOf('.'))
    }
    let updatePath: string;
    let updateValue: any;
    if (highestArrayPath && highestArrayPath !== selectedSourcePath) {
      updatePath = highestArrayPath;
      updateValue = deepClone(getProperty(this.message, highestArrayPath));
      const targetSubpath = selectedSourcePath.substring(highestArrayPath.length + 1);
      setProperty(updateValue, targetSubpath, target[prop])
    } else {
      updatePath = selectedSourcePath;
      updateValue = target[prop];
    }
    this.message.updateSource({[updatePath]: updateValue});
    
    // If you pass an object as a new value
    //  wrap all properties so any changes made it the external provided value also get captured
    let pendingDeepProxyWraps: Array<{pathPrefix: string, newValue: object}> = [];
    if (newValue != null && typeof newValue === 'object') {
      pendingDeepProxyWraps.push({pathPrefix: this.pathPrefix, newValue});
    }
    while (pendingDeepProxyWraps.length) {
      const proxyWraps = pendingDeepProxyWraps;
      pendingDeepProxyWraps = [];
      for (const proxyWrap of proxyWraps) {
        for (const key in proxyWrap.newValue) {
          if (proxyWrap.newValue[key] != null && typeof proxyWrap.newValue[key] === 'object') {
            pendingDeepProxyWraps.push({pathPrefix: `${proxyWrap.pathPrefix}${key}.`, newValue: proxyWrap.newValue[key]});
            if (!proxyWrap.newValue[key][ChatMessageAccessPropertyV10.getTargetSymbol]) {
              proxyWrap.newValue[key] = ChatMessageAccessPropertyV10.wrap(proxyWrap.newValue[key], this.message, `${this.pathPrefix}${prop}`);
            }
          }
        }
      }
    }
    return true;
  }

  public deleteProperty(target: any, prop: string | symbol): boolean {
    delete target[prop];
    if (typeof prop !== 'symbol') {
      this.message.updateSource({[`-=${this.pathPrefix}${prop}`]: null});
    }
    return true;
  }

  public static revoke<T>(wrapped: T): T {
    const dummyRoot = {wrapped};
    let pendingUnwrapping = [{proxy: wrapped as any, key: 'wrapped', parent: dummyRoot as object}];
    while (pendingUnwrapping.length) {
      const unwrapping = pendingUnwrapping;
      pendingUnwrapping = [];
      for (const unwrap of unwrapping) {
        if (unwrap.proxy == null) {
          continue;
        } else if (unwrap.proxy[ChatMessageAccessPropertyV10.revokeSymbol]) {
          const target = unwrap.proxy[ChatMessageAccessPropertyV10.getTargetSymbol];
          unwrap.parent[unwrap.key] = target;
          unwrap.proxy[ChatMessageAccessPropertyV10.revokeSymbol]();
          delete target[ChatMessageAccessPropertyV10.getTargetSymbol];
          delete target[ChatMessageAccessPropertyV10.revokeSymbol];
          for (const key in target) {
            pendingUnwrapping.push({proxy: target[key], key: key, parent: target})
          }
          
        }
        
      }
    }
    return dummyRoot.wrapped;
  }

  public static wrap<T>(wrapped: T, message: ChatMessage & BaseDocumentV10<any>, path: string = ''): T {
    const proxy = Proxy.revocable(wrapped, new ChatMessageAccessPropertyV10(message, path));
    wrapped[ChatMessageAccessPropertyV10.getTargetSymbol] = wrapped;
    wrapped[ChatMessageAccessPropertyV10.revokeSymbol] = proxy.revoke;
    return proxy.proxy;
  }

}

export class ModularCardInstance {
  private data: ModularCardData = {};
  private meta: ModularCardMeta = {};

  constructor(private message: ChatMessage) {
    
    this.data = message.getFlag(staticValues.moduleName, 'modularCardData') as any;
    if (this.data == null) {
      this.data = {};
    }
    this.meta = message.getFlag(staticValues.moduleName, 'modularCardDataMeta') as any;
    if (this.meta == null) {
      this.meta = {};
    }

    // It's important that we use the same data & meta instance
    // So changes made within this instance are also reflected on the chat message
    if (UtilsFoundry.usesDataModel(message)) {
      this.data = ChatMessageAccessPropertyV10.wrap(deepClone(this.data), message, `flags.${staticValues.moduleName}.modularCardData`);
      this.meta = ChatMessageAccessPropertyV10.wrap(deepClone(this.meta), message, `flags.${staticValues.moduleName}.modularCardDataMeta`);
    } else if (UtilsFoundry.usesDocumentData(message)) {
      setProperty(message.data, `flags.${staticValues.moduleName}.modularCardData`, this.data);
      setProperty(message.data, `flags.${staticValues.moduleName}.modularCardDataMeta`, this.meta);
    }

    for (const key of Object.keys(this.data)) {
      if (!Number.isNaN(Number.parseInt(key))) {
        // Legacy format => parse to new format
        this.data[this.data[key].type] = this.data[key].data;
        delete this.data[key];
      }
    }
  }

  public hasType<T>(partType: ModularCardPart<T> | string): boolean {
    return this.getTypeData(partType) != null;
  }

  public getTypeData<T>(partType: string): any | null;
  public getTypeData<T>(partType: ModularCardPart<T>): T | null;
  public getTypeData<T>(partType: ModularCardPart<T> | string): any | null
  public getTypeData<T>(partType: ModularCardPart<T> | string): T | null {
    const partTypeName = this.getTypeName(partType);
    if (this.data[partTypeName] != null) {
      return this.data[partTypeName];
    }

    for (const type in this.data) {
      const extendedTypes = getExtendedTypes(type);
      if (extendedTypes.includes(partTypeName)) {
        return this.data[type];
      }
    }
    return null;
  }

  public getTypeDataAndHandler<T>(partType: string): {handler: ModularCardPart<any>; data: any} | null;
  public getTypeDataAndHandler<T>(partType: ModularCardPart<T>): {handler: ModularCardPart<T>; data: T} | null;
  public getTypeDataAndHandler<T>(partType: ModularCardPart<T> | string): {handler: ModularCardPart<any>; data: any} | null
  public getTypeDataAndHandler<T>(partType: ModularCardPart<T> | string): {handler: ModularCardPart<T>; data: T} | null {
    const partTypeName = this.getTypeName(partType);
    if (this.data[partTypeName] != null) {
      return {
        data: this.data[partTypeName],
        handler: ModularCard.getTypeHandler(partTypeName),
      };
    }

    for (const type in this.data) {
      const extendedTypes = getExtendedTypes(type);
      if (extendedTypes.includes(partTypeName)) {
        return {
          data: this.data[type],
          handler: ModularCard.getTypeHandler(type),
        };
      }
    }
    return null;
  }

  public setTypeData<T>(partType: string, data: any | null): void;
  public setTypeData<T>(partType: ModularCardPart<T>, data: T | null): void;
  public setTypeData<T>(partType: ModularCardPart<T> | string, data: any | null): void {
    if (data == null) {
      delete this.data[this.getTypeName(partType)];
      return;
    }
    
    if (this.data[this.getTypeName(partType)] == null) {
      this.data[this.getTypeName(partType)] = {};
    }

    ModularCardInstance.update(this.data[this.getTypeName(partType)], data);
  }
  
  public setMeta(meta: ModularCardMeta): void {
    ModularCardInstance.update(this.meta, meta);
  }

  private static update(original: object, newValue: object) {
    if (newValue == null) {
      newValue = {};
    }
    const originalKeys = new Set(Object.keys(original));
    const newKeys = new Set(Object.keys(newValue));

    for (const newKey of newKeys) {
      original[newKey] = newValue[newKey];
    }

    for (const originalKey of originalKeys) {
      if (!newKeys.has(originalKey)) {
        delete original[originalKey];
      }
    }
  }

  public getItemUuid(): string {
    if (this.meta != null) {
      return this.meta.created?.itemUuid;
    }

    // legacy
    let itemUuid = this.getTypeData<AttackCardData>(AttackCardPart.instance)?.attackSource$?.itemUuid;
    if (itemUuid == null) {
      const calc = this.getTypeData<DamageCardData>(DamageCardPart.instance)?.calc$;
      if (calc && calc.damageSource.type === 'Item') {
        itemUuid = calc.damageSource.itemUuid;
      }
    }
    if (itemUuid == null) {
      itemUuid = this.getTypeData<SpellLevelCardData>(SpellLevelCardPart.instance)?.calc$?.itemUuid;
    }
    
    return itemUuid;
  }

  public getActorUuid(): string {
    if (this.meta != null) {
      return this.meta.created?.actorUuid;
    }

    // legacy
    let actorUuid = this.getTypeData<AttackCardData>(AttackCardPart.instance)?.actorUuid$;
    if (actorUuid == null) {
      actorUuid = this.getTypeData<CheckCardData>(CheckCardPart.instance)?.actorUuid$;
    }
    if (actorUuid == null) {
      actorUuid = this.getTypeData<DamageCardData>(DamageCardPart.instance)?.calc$?.actorUuid;
    }
    if (actorUuid == null) {
      actorUuid = this.getTypeData<ResourceCardData>(ResourceCardPart.instance)?.calc$?.actorUuid;
    }
    if (actorUuid == null) {
      actorUuid = this.getTypeData<SpellLevelCardData>(SpellLevelCardPart.instance)?.calc$?.actorUuid;
    }
    if (actorUuid == null) {
      actorUuid = this.getTypeData<TargetCardData>(TargetCardPart.instance)?.calc$?.actorUuid;
    }
    if (actorUuid == null) {
      actorUuid = this.getTypeData<TemplateCardData>(TemplateCardPart.instance)?.calc$?.actorUuid;
    }

    return actorUuid;
  }

  public getTokenUuid(): string {
    if (this.meta != null) {
      return this.meta.created?.tokenUuid;
    }

    // legacy
    let tokenUuid = this.getTypeData<SpellLevelCardData>(SpellLevelCardPart.instance)?.calc$?.tokenUuid;
    if (tokenUuid == null) {
      tokenUuid = this.getTypeData<TargetCardData>(TargetCardPart.instance)?.calc$?.tokenUuid;
    }
    if (tokenUuid == null) {
      tokenUuid = this.getTypeData<TemplateCardData>(TemplateCardPart.instance)?.calc$?.tokenUuid;
    }

    return tokenUuid;
  }

  private getTypeName(partType: ModularCardPart | string): string {
    return typeof partType === 'string' ? partType : partType?.getType()
  }

  public getAllTypes(): ModularCardPart[] {
    const parts: ModularCardPart[] = [];
    for (const type in this.data) {
      const handler = ModularCard.getTypeHandler(type);
      if (handler != null) {
        parts.push(handler);
      }
    }
    return parts;
  }

  public deepClone(): ModularCardInstance {
    if (UtilsFoundry.usesDataModel(this.message)) {
      this.data = ChatMessageAccessPropertyV10.revoke(this.data);
      this.meta = ChatMessageAccessPropertyV10.revoke(this.meta);

      const clone = new ModularCardInstance(new ChatMessage(this.message.toObject()));

      this.data = ChatMessageAccessPropertyV10.wrap(this.data, this.message, `flags.${staticValues.moduleName}.modularCardData`);
      this.meta = ChatMessageAccessPropertyV10.wrap(this.meta, this.message, `flags.${staticValues.moduleName}.modularCardDataMeta`);

      return clone;
    }
    return new ModularCardInstance(new ChatMessage(this.message.toObject()));
  }
}

export interface ModularCardTriggerData<T = any> {
  readonly messageId: string;
  readonly typeHandler: ModularCardPart<T>;
  readonly part: T;
  readonly allParts: ModularCardInstance;
}

class ChatMessageTransformer<T> extends TransformTrigger<ChatMessage, ModularCardTriggerData<T>> implements IDmlTrigger<ChatMessage> {

  public triggerStoppable: Stoppable;

  constructor(private cardPartType: ModularCardPart<T>) {
    super((from: ChatMessage) => this.transformFunc(from));
  }

  get type(): typeof ChatMessage {
    return ChatMessage;
  }

  private transformFunc(from: ChatMessage): {uniqueKey: string, data: ModularCardTriggerData} | Array<{uniqueKey: string, data: ModularCardTriggerData}> {
    const parts = ModularCard.getCardPartDatas(from);
    if (parts == null) {
      return [];
    }

    const response: Array<{uniqueKey: string, data: ModularCardTriggerData}> = [];
    const dataWrapper = parts.getTypeDataAndHandler(this.cardPartType);
    if (dataWrapper != null) {
      response.push({
        uniqueKey: `${from.uuid}.${this.cardPartType.getType()}`,
        data: {
          part: dataWrapper.data,
          allParts: parts,
          messageId: from.id,
          typeHandler: dataWrapper.handler,
        }
      });
    }

    return response;
  }
  
}

class ChatMessageTrigger implements IDmlTrigger<ChatMessage> {
  get type() {
    return ChatMessage;
  }

  public beforeUpsert(context: IDmlContext<ChatMessage>): void {
    for (const {newRow} of context.rows) {
      if (newRow == null) {
        continue;
      }
      const parts = ModularCard.getCardPartDatas(newRow);
      if (parts != null) {
        const attr: [string, string][] = [];
        if (parts.getItemUuid()) {
          // Used to integrate with CUB concentrator
          // Other modules might also use this?
          attr.push([`data-item-id`, /Item\.([^\.]+)/i.exec(parts.getItemUuid())[1]]);
        }
        UtilsFoundry.getModelData(newRow)._source.content = `<div ${attr.map(att => `${att[0]}=${att[1]}`).join(' ')}>
        <div data-${staticValues.code}-tag-replacer="${ModularCardComponent.getSelector()}">
          <span data-slot="not-installed-placeholder">The ${staticValues.moduleName} module is required to render this message.</span>
        </div></div>`;
      }
    }
  }
}

const chatMessageTransformerMap = new Map<string, ChatMessageTransformer<any>>();

interface ModularCardInitAdd {
  addPart: ModularCardPart;
  position: ModularCardInitPosition<ModularCardPart | string>[];
}
interface ModularCardInitPosition<T> {
  type: 'before' | 'after'
  reference: T;
}
export class BeforeCreateModuleCardEvent {

  constructor({item, actor, token}: ModularCardCreateArgs) {
    Object.defineProperties(this, {
      item: {
        value: item,
        writable: false,
        configurable: false,
      },
      actor: {
        value: actor,
        writable: false,
        configurable: false,
      },
      token: {
        value: token,
        writable: false,
        configurable: false,
      },
    })
  }

  public readonly item: MyItem;
  public readonly actor?: MyActor;
  public readonly token?: TokenDocument;

  private addActions: ModularCardInitAdd[] = [];
  private add(addPart: ModularCardPart | ModularCardPart[], ...inputPositions: Array<ModularCardInitPosition<ModularCardPart | string> | ModularCardInitPosition<ModularCardPart | string>[]>): void {
    addPart = (Array.isArray(addPart) ? addPart : [addPart]);
    const positions: ModularCardInitPosition<ModularCardPart | string>[] = [];
    for (const position of inputPositions.deepFlatten()) {
      const refType = typeof position.reference === 'string' ? position.reference : position.reference.getType();
      if (ModularCard.getTypeHandler(refType) == null) {
        UtilsLog.warn(new Error(`${refType} has not been registered, skipping it as a position option.`));
      } else {
        positions.push(position);
      }
    }
    for (let i = 0; i < addPart.length; i++) {
      if (ModularCard.getTypeHandler(addPart[i].getType()) == null) {
        UtilsLog.error(new Error(`${addPart[i].getType()} has not been registered, it won't be added to the card.`));
        continue;
      }
      if (i === 0) {
        this.addActions.push({
          addPart: addPart[i],
          position: positions,
        });
      } else {
        this.addActions.push({
          addPart: addPart[i],
          position: [{type: 'after', reference: addPart[0]}],
        });
      }
    }
  }

  public addBefore(reference: ModularCardPart | string, addPart: ModularCardPart): void {
    this.add(addPart, {type: 'before', reference: reference});
  }

  public replace(reference: ModularCardPart | string, addPart: ModularCardPart): void {
    this.addBefore(reference, addPart);
    this.remove(reference);
  }

  public addAfter(reference: ModularCardPart | string, addPart: ModularCardPart): void {
    this.add(addPart, {type: 'after', reference: reference});
  }

  private removed = new Set<string>();
  public remove(...removeInputs: Array<ModularCardPart | ModularCardPart[] | string | string[]>) {
    // Don't actually remove any items so they can still be used as a reference
    const removes = removeInputs.deepFlatten();
    for (const remove of removes) {
      this.removed.add(typeof remove === 'string' ? remove : remove.getType());
    }
  }

  public getParts(): ModularCardPart[] {
    const resolvedParts: Array<string> = [];
    for (const standardPart of [
      DescriptionCardPart.instance,
      SpellLevelCardPart.instance,
      AttackCardPart.instance,
      DamageCardPart.instance,
      OtherCardPart.instance,
      TemplateCardPart.instance,
      ResourceCardPart.instance,
      CheckCardPart.instance,
      TargetCardPart.instance,
      ActiveEffectCardPart.instance,
      PropertyCardPart.instance,
    ]) {
      resolvedParts.push(standardPart.getType());
    }

    const fallbackPosition: ModularCardInitPosition<string> = {
      type: 'after',
      reference: TemplateCardPart.instance.getType()
    };

    let pendingAddActions = this.addActions;
    while (pendingAddActions.length > 0) {
      const processing = pendingAddActions;
      pendingAddActions = [];
      for (const process of processing) {
        const positions = process.position.length === 0 ? [fallbackPosition] : process.position;
        let added = false;
        for (const position of positions) {
          const type = typeof position.reference === 'string' ? position.reference : position.reference.getType();
          const index = resolvedParts.indexOf(type);
          if (index !== -1) {
            resolvedParts.splice(index + (position.type === 'after' ? 1 : 0), 0, process.addPart.getType());
            added = true;
            break;
          }
          if (!added) {
            pendingAddActions.push(process);
          }
        }

        if (processing.length === pendingAddActions.length) {
          // Nothing got processed => missing a reference, use fallback
          // TODO be smarter, detect wich are also still pending
          for (const pending of pendingAddActions) {
            pending.position = [fallbackPosition];
          }
        }
      }
    }
    
    for (const remove of this.removed) {
      const index = resolvedParts.indexOf(remove);
      if (index !== -1) {
        resolvedParts.splice(index, 1);
      }
    }

    // Try to detect conflics, only 1 ModularCardPart per type is allowed
    // If you extend a ModularCardPart, that part is both itself and the extended part (= 2 different types or more)
    const handlerMetas: Array<{type: ModularCardPart, extendedTypes: string[]}> = []
    for (const resolvedPart of resolvedParts) {
      const type = ModularCard.getTypeHandler(resolvedPart);
      handlerMetas.push({
        type: type,
        extendedTypes: getExtendedTypes(type),
      });
    }
    // Prioritize the handlers with the least extends if there is a conflict
    handlerMetas.sort((a, b) => a.extendedTypes.length - b.extendedTypes.length);
    
    const whitelistTypes = new Set<string>()
    for (const handlerMeta of handlerMetas) {
      const conflicts: string[] = [];
      for (const extendedType of handlerMeta.extendedTypes) {
        if (whitelistTypes.has(extendedType)) {
          conflicts.push(extendedType);
        }
      }

      if (conflicts.length > 0) {
        UtilsLog.buildError(
          'Detected conflicts for',
          {color: 'grey', message: handlerMeta.type.getType()},
          'with the other original type(s)',
          {color: 'grey', message: conflicts.join(', ')},
          `. When you extend other types, you will need to remove the originals from that message during the event create${staticValues.code.capitalize()}ModuleCard`
          )();
      } else {
        for (const extendedType of handlerMeta.extendedTypes) {
          whitelistTypes.add(extendedType);
        }
      }
    }

    return resolvedParts
      .filter(typeName => whitelistTypes.has(typeName))
      .map(typeName => ModularCard.getTypeHandler(typeName));
  }
}

export class ModularCard {

  private static registeredPartsByType = new Map<string, {part: ModularCardPart}>();
  private static typeToModule = new Map<string, string>();
  public static registerModularCardPart(moduleName: string, part: ModularCardPart): void {
    if (ModularCard.registeredPartsByType.has(part.getType())) {
      UtilsLog.info(`ModularCardPart type "${part.getType()}" from module ${ModularCard.typeToModule.get(part.getType())} gets overwritten by module ${moduleName}`);
    }
    ModularCard.registeredPartsByType.set(part.getType(), {part: part});
    ModularCard.typeToModule.set(part.getType(), moduleName);
  }
  
  public static registerModularCardTrigger<T>(type: ModularCardPart<T>, trigger: ITrigger<ModularCardTriggerData>): Stoppable {
    let chatMessageTransformer: ChatMessageTransformer<T> = chatMessageTransformerMap.get(type.getType());
    if (!chatMessageTransformer) {
      chatMessageTransformer = new ChatMessageTransformer(type);
      chatMessageTransformerMap.set(type.getType(), chatMessageTransformer);
      chatMessageTransformer.triggerStoppable = DmlTrigger.registerTrigger(chatMessageTransformer);
    }
    const transformerStoppable = chatMessageTransformer.register(trigger);
    return {stop: () => {
      transformerStoppable.stop();
      if (!chatMessageTransformer.hasTriggers()) {
        chatMessageTransformer.triggerStoppable.stop();
      }
    }};
  }

  public static getTypeHandler<T extends ModularCardPart = ModularCardPart>(type: string): T | null {
    if (ModularCard.registeredPartsByType.get(type) == null) {
      UtilsLog.buildWarn('Could not find type handler for', {color: 'grey', message: type})();
    }
    return ModularCard.registeredPartsByType.get(type).part as T;
  }

  public static async getDefaultItemParts(data: {actor?: MyActor, token?: TokenDocument, item: MyItem}): Promise<ModularCardInstance> {
    const parts: Promise<{data: any, cardPart: ModularCardPart}>[] = [];
    const itemData = UtilsFoundry.getSystemData(data.item);
    const actorData = UtilsFoundry.getSystemData(data.actor);
    
    // Find the first available spellslot, auto upcast if missing spell slots
    if (actorData && itemData.level > 0) {
      const itemLevel = itemData.level;
      const spellIsPact = itemData?.preparation?.mode === 'pact';
      let selectedLevel: number | 'pact' = spellIsPact ? actorData.spells.pact.level : itemData.level;
      let selectedSpell: SpellData = spellIsPact ? actorData.spells.pact : actorData.spells[`spell${selectedLevel}`];
      
      if (selectedLevel < itemLevel || selectedSpell.value < 1) {
        let newItemLevel = itemLevel;
        if (actorData.spells.pact.level >= itemLevel && actorData.spells.pact.value > 0) {
          newItemLevel = actorData.spells.pact.level;
        } else {
          const spellLevels = Object.keys(actorData.spells)
            .map(prop => /^spell([0-9]+)$/i.exec(prop))
            .filter(rgx => !!rgx)
            .map(rgx => Number(rgx[1]))
            .sort();
          for (const spellLevel of spellLevels) {
            if (spellLevel <= itemLevel) {
              continue;
            }
            let actorSpellData: SpellData = actorData.spells[`spell${spellLevel}`];
            if (actorSpellData.value > 0) {
              newItemLevel = spellLevel;
              break;
            }
          }
        }
        if (itemLevel != newItemLevel) {
          data.item = ItemUtils.createUpcastItem(data.item, newItemLevel);
        }
      }
    }

    const createEvent = new BeforeCreateModuleCardEvent(data);
    // Ignore returned boolean
    Hooks.call(`create${staticValues.code.capitalize()}ModuleCard`, createEvent);
    
    for (const cardPart of createEvent.getParts()) {
      const response = cardPart.create(data);
      if (response instanceof Promise) {
        parts.push(response.then(resp => ({data: resp, cardPart: cardPart})))
      } else {
        parts.push(Promise.resolve({data: response, cardPart: cardPart}));
      }
    }

    const response = new ModularCardInstance(new ChatMessage());
    response.setMeta({
      created: {
        actorUuid: data.actor?.uuid,
        tokenUuid: data.token?.uuid,
        itemUuid: data.item?.uuid,
      }
    });
    for (const part of await Promise.all(parts)) {
      if (part.data != null) {
        response.setTypeData(part.cardPart, part.data);
      }
    }
    return response;
  }
  
  public static createCardData(parts: ModularCardInstance): ChatMessageDataConstructorData {
    const modularCardDataMeta: ModularCardMeta = {
      created: {
        actorUuid: parts.getActorUuid(),
        itemUuid: parts.getItemUuid(),
        tokenUuid: parts.getTokenUuid(),
      }
    }
    const chatMessageData: ChatMessageDataConstructorData = {
      flags: {
        [staticValues.moduleName]: {
          modularCardData: ModularCard.createFlagObject(parts),
          modularCardDataMeta: modularCardDataMeta,
        }
      }
    };

    let rollMode: string = game.settings.get('core', 'rollMode');
    const rollModeOverride = game.settings.get(staticValues.moduleName, 'forceRollModeItem') as string;
    if (rollModeOverride !== 'default') {
      rollMode = rollModeOverride;
    }

    if (rollMode === 'gmroll' || rollMode === 'private') {
      chatMessageData.whisper = [game.userId];
      for (const user of game.users.values()) {
        if (user.isGM) {
          chatMessageData.whisper.push(user.id);
        }
      }
    }
    if (rollMode === 'blindroll' || rollMode === 'blind') {
      chatMessageData.whisper = [];
      chatMessageData.blind = true;
      for (const user of game.users.values()) {
        if (user.isGM) {
          chatMessageData.whisper.push(user.id);
        }
      }
    }
    if (rollMode === 'selfroll' || rollMode === 'self') {
      chatMessageData.whisper = [game.userId];
    }

    chatMessageData.speaker = ChatMessage.getSpeaker();

    return chatMessageData;
  }
  
  @RunOnce()
  public static registerHooks(): void {
    // Override render behaviour
    DmlTrigger.registerTrigger(new ChatMessageTrigger());
    
    // - Keep scrollbar at the bottom
    Hooks.on('renderChatLog', () => {
      const log = document.querySelector("#chat-log");
      let isAtBottom = Math.abs(log.scrollHeight - (log.scrollTop + log.getBoundingClientRect().height)) < 2;
      const scrollToBottom = () => (ui.chat as any).scrollBottom();
      
      const observer = new MutationObserver((mutationsList, observer) => {
        if (isAtBottom) {
          rerenderQueue.add(scrollToBottom);
        }
      });

      log.addEventListener('scroll', () => {
        isAtBottom = Math.abs(log.scrollHeight - (log.scrollTop + log.getBoundingClientRect().height)) < 2;
      });

      // Start observing the target node for configured mutations
      observer.observe(document, { childList: true, subtree: true });
    })
  }

  public static getCardPartDatas(message: ChatMessage): ModularCardInstance | null {
    if (message == null) {
      return null;
    }

    const flagData: any = message.getFlag(staticValues.moduleName, 'modularCardData') as any;
    if (typeof message.getFlag(staticValues.moduleName, 'modularCardData') === 'object' && !Array.isArray(flagData)) {
      return new ModularCardInstance(message);
    } else if (flagData != null) {
      UtilsLog.warn('Unexpected modularCardData found for message', message.uuid, 'flagData:', flagData);
      return null;
    }
  }
  
  public static async setBulkCardPartDatas(updates: Array<{message: ChatMessage, data: ModularCardInstance | ModularCardDataLegacy}>): Promise<void> {
    const bulkUpdateRequest: DmlUpdateRequest<any>[] = [];
    for (const update of updates) {
      if (update.message == null) {
        continue;
      }
  
      const cardsObj = ModularCard.createFlagObject(update.data);
      const originalCards = update.message.getFlag(staticValues.moduleName, 'modularCardData');
      if (UtilsCompare.deepEquals(originalCards, cardsObj)) {
        continue;
      }
      UtilsObject.injectDeleteForDml(originalCards, cardsObj);
      bulkUpdateRequest.push({document: update.message, rootData: {flags: {[staticValues.moduleName]: {modularCardData: cardsObj}}}});
    }
    return UtilsDocument.bulkUpdate(bulkUpdateRequest);
  }

  public static setCardPartDatas(message: ChatMessage, data: ModularCardInstance | ModularCardDataLegacy): Promise<void> {
    return ModularCard.setBulkCardPartDatas([{message, data}])
  }

  private static createFlagObject(data: ModularCardInstance | ModularCardDataLegacy): ModularCardData {
    const cardsObj: ModularCardData = {};
    if (Array.isArray(data)) {
      for (const part of data) {
        if (part.data != null) {
          cardsObj[part.id] = part;
        }
      }
    } else if (data instanceof ModularCardInstance) {
      for (const type of data.getAllTypes()) {
        const typeData = data.getTypeData(type);
        if (typeData != null) {
          cardsObj[type.getType()] = typeData;
        }
      }
    }
    return cardsObj;
  }

}