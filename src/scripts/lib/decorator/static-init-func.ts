export function StaticInitFunc(init: () => any) {
  return function (target: any, propertyKey: string, descriptor?: PropertyDescriptor) {
    if (descriptor) {
      if (descriptor.configurable === false) {
        throw new Error(`Can't change the property ${propertyKey}. configurable is disabled.`);
      }
      if (descriptor.get && !descriptor.set) {
        throw new Error(`Key ${propertyKey} is a getter and does not have a set.`);
      }
      if (descriptor.writable === false) {
        throw new Error(`Can't change the property ${propertyKey}. property is not writable.`);
      }
    }

    const getFunc = () => {
      const value = init();
      Reflect.deleteProperty(target, propertyKey);
      target[propertyKey] = value;
      return value;
    }
    
    if (descriptor) {
      descriptor.get = getFunc;
      delete descriptor.value;
      delete descriptor.writable;
    } else {
      Reflect.defineProperty(target, propertyKey, {
        configurable: true,
        get: getFunc
      })
    }
  };
}