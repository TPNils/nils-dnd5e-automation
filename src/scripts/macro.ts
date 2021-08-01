import { AllPermissions } from "./custom-permissions";
import { MacroContext } from "./macro-context";

export interface IMacroConstructor {
  new (): IMacro;
}

export interface IMacro<T = any> {

  requirePermissions?(context: MacroContext): Promise<AllPermissions[]>;
  macroData?(context: MacroContext): Promise<T>;
  run(context: MacroContext, macroData: T): Promise<void>;

}