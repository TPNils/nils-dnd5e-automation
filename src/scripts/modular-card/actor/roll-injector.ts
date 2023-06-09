import { IDmlTrigger, IDmlContext, DmlTrigger } from "../../lib/db/dml-trigger";
import { RunOnce } from "../../lib/decorator/run-once";
import { staticValues } from "../../static-values";
import { UtilsFoundry } from "../../utils/utils-foundry";
import { ActorRollComponent } from "./actor-roll-component";

class ChatMessageTrigger implements IDmlTrigger<ChatMessage> {

  get type(): typeof ChatMessage {
    return ChatMessage;
  }

  public beforeCreate(context: IDmlContext<ChatMessage>): void {
    for (const {newRow} of context.rows) {
      const rollFlag = newRow.getFlag('dnd5e', 'roll') as {type: string};
      if (!rollFlag) {
        continue;
      }

      if (ActorRollComponent.SUPPORTED_DND5E_TYPES.includes(rollFlag.type)) {
        const content = `
        <div data-${staticValues.code}-tag-replacer="${ActorRollComponent.getSelector()}">
          <span data-slot="not-installed-placeholder">The ${staticValues.moduleName} module is required to render this message.</span>
        </div>`;
        if (UtilsFoundry.usesDataModel(newRow)) {
          newRow.updateSource({content: content})
        } else if (UtilsFoundry.usesDocumentData(newRow)) {
          newRow.data.update({content: content})
        }
      }
    }
  }

  @RunOnce()
  public static registerHooks(): void {
    DmlTrigger.registerTrigger(new ChatMessageTrigger());
  }

}

export class RollInjector {
  
  @RunOnce()
  public static registerHooks(): void {
    DmlTrigger.registerTrigger(new ChatMessageTrigger());
  }

}