import { AllPermissions } from "./custom-permissions";
import { MacroContext } from "./macro-context";

export interface IMacroConstructor {
  new (context: MacroContext): IMacro;
}

export interface IMacro {
  requirePermissions?(): Promise<AllPermissions[]>;
  run(): Promise<void>;

}