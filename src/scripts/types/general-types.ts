export function isConstructor(value: any): value is ConstructorOf<any> {
  return typeof value === 'function';
}