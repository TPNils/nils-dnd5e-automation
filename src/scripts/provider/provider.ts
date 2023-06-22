import { staticValues } from '../static-values.js';
import { ValueProvider } from './value-provider.js';

class Provider {

  public registerHooks(): void {
    Hooks.once('socketlib.ready', () => {
      this.setSocket(socketlib.registerModule(staticValues.moduleName));
    });
  }

  private socket = new ValueProvider<SocketlibSocket>();
  public getSocket(): Promise<SocketlibSocket> {
    return this.socket.firstPromise();
  }

  public setSocket(socket: SocketlibSocket): void {
    this.socket.set(socket);
  }

}

export const provider = new Provider();