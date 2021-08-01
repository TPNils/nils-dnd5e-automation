declare let socketlib: Socketlib;

declare interface Socketlib {
  registerModule(moduleName: string): SocketlibSocket;
  registerSystem(systemId: string): SocketlibSocket;
}

declare interface SocketlibSocket {
  register(name: string, handler: (...args: any) => void): void;
  executeAsGM(handler: string, ...args: any): Promise<any>;
  executeAsUser(handler: string, userId: string, ...args: any): Promise<any>;
  executeForAllGMs(handler: string, ...args: any): Promise<any>;
  executeForOtherGMs(handler: string, ...args: any): Promise<any>;
  executeForEveryone(handler: string, ...args: any): Promise<any>;
  executeForOthers(handler: string, ...args: any): Promise<any>;
  executeForUsers(handler: string, ...args: any): Promise<any>;
}
