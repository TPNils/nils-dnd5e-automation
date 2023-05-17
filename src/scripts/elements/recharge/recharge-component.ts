import { DocumentListener } from "../../lib/db/document-listener";
import { RunOnce } from "../../lib/decorator/run-once";
import { Component, OnInit, OnInitParam } from "../../lib/render-engine/component";
import { RollData } from "../../lib/roll/utils-roll";
import { ValueReader } from "../../provider/value-provider";
import { staticValues } from "../../static-values";
import { MyItem } from "../../types/fixed-types";
import { RechargeFlagData } from "./recharge-chat-trigger";

interface RechargeInterfaceItem {
  uuid: string;
  name: string;
  img: string;
  success: boolean;
  roll?: RollData;
}

@Component({
  tag: RechargeCardComponent.getSelector(),
  html: /*html*/`
    <!-- TODO Maybe this should be formatted like the target component -->
    <div class="item-recharges">
      <div *for="let item of this.items" class="item-recharge">
        <img [src]="item.name"/>
        <div>{{item.name}}</div>
        <!-- TODO other fields -->
      </div>
      <div *if="this.items.length > 0" class="roll-all">
        <!-- TODO roll all -->
      </div>
    </div>
    <div class="placeholder">
      <slot name="not-installed-placeholder"></slot>
    </div>
  `,
  style: /*css*/`
    :host {
      display: block;
    }
    
    .placeholder {
      display: none;
    }

    .item-recharges {
      display: grid;
      grid-template-columns: 
        [img] min-content
        [name] auto
        [success] min-content
        [roll] min-content;
    }

    .item-recharge {
      display: contents;
    }
  `,
})
export class RechargeCardComponent implements OnInit {

  public static getSelector(): string {
    return `${staticValues.code}-recharge`;
  }
  
  private chatMessage: ChatMessage
  public items: RechargeInterfaceItem[] = [];
  public onInit(args: OnInitParam) {
    const messageId = args.html.closest('[data-message-id]')?.getAttribute('data-message-id');
    if (!messageId) {
      return;
    }

    const messageUuid = game.messages.get(messageId)?.uuid;
    if (messageUuid == null) {
      return;
    }

    args.addStoppable(
      DocumentListener.listenUuid<ChatMessage>(messageUuid)
        .filter(message => !!RechargeCardComponent.getData(message))
        .switchMap(message => {
          const flagData = RechargeCardComponent.getData(message);
          return ValueReader.mergeObject({
            message: message,
            flagData: flagData,
            items: DocumentListener.listenUuid<MyItem>(flagData.itemUuids)
          })
        })
        .listen(async ({message, flagData, items}) => {
          const rechargeItems: RechargeInterfaceItem[] = [];

          for (const item of items) {
            if (item.data.data.recharge?.value) {
              const rechargeItem: RechargeInterfaceItem = {
                uuid: item.uuid,
                name: item.name,
                img: item.img,
                success: !!flagData.forcedSuccessByItemUuid[item.uuid],
                roll: flagData.rollsByItemUuid[item.uuid],
              }
              if (!rechargeItem.success && rechargeItem.roll?.evaluated) {
                rechargeItem.success = rechargeItem.roll.total >= item.data.data.recharge.value;
              }
              rechargeItems.push(rechargeItem);
            }
          }
          
          this.chatMessage = message;
          this.items = rechargeItems.sort((a, b) => a.name.localeCompare(b.name))
        })
    );
  }

  private static getData(message: ChatMessage): RechargeFlagData {
    return message.getFlag(staticValues.moduleName, 'recharge') as RechargeFlagData;
  }
  
  @RunOnce()
  public static registerHooks(): void {
  }

}