import { AllPermissions } from "./custom-permissions";

export interface IMacro {

  requirePermissions?(): Array<AllPermissions>;
  run(): Promise<void>;

}