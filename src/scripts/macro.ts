import { AllPermissions } from "./custom-permissions";
import { MacroContext } from "./macro-context";

export interface IMacroConstructor<T = any> {
  new (): IMacro<T>;
}

export interface IMacro<T = any> {

  /**
   * Client side
   * @returns An array of required permissions. If the client does not have the required permissions, the #run() method will be executed by a DM
   */
  requirePermissions?(context: MacroContext): Promise<AllPermissions[]>;
  /**
   * Client side
   * @returns The data that needs to be passed to the #run() method.
   */
  macroData?(context: MacroContext): Promise<T>;
  /**
   * Server side
   */
  run(context: MacroContext, macroData: T): Promise<void>;

}