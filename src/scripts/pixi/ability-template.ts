import { MeasuredTemplateData } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/data/module.mjs";
import { MyItemData } from "../types/fixed-types.js";

/**
 * Basically a copy from DND5e AbilityTemplate, except that actorSheet can be null
 */
export default class MyAbilityTemplate extends MeasuredTemplate {

  private actorSheet?: ActorSheet;

  public static fromItem({target, flags, actorSheet}: {target: MyItemData['data']['target'], flags?: any, actorSheet?: ActorSheet}): MyAbilityTemplate {
    // @ts-expect-error
    const templateShape = CONFIG.DND5E.areaTargetTypes[target?.type];
    if ( !templateShape ) {
      return null;
    }

    // Prepare template data
    const templateData: Partial<MeasuredTemplateData> = {
      t: templateShape,
      user: game.user.id,
      distance: target.value,
      direction: 0,
      x: 0,
      y: 0,
      flags: flags,
      // @ts-expect-error
      fillColor: game.user.color
    };

    // Additional type-specific data
    switch ( templateShape ) {
      case "cone":
        templateData.angle = CONFIG.MeasuredTemplate.defaults.angle;
        break;
      case "rect": // 5e rectangular AoEs are always cubes
        templateData.distance = Math.hypot(target.value, target.value);
        templateData.width = target.value;
        templateData.direction = 45;
        break;
      case "ray": // 5e rays are most commonly 1 square (5 ft) in width
        templateData.width = target.width ?? canvas.dimensions.distance;
        break;
      default:
        break;
    }

    // Return the template constructed from the item data
    const baseTemplate = new CONFIG.MeasuredTemplate.documentClass(templateData, {parent: canvas.scene});
    const abilityTemplate = new this(baseTemplate);
    abilityTemplate.actorSheet = actorSheet;
    return abilityTemplate;
  }

  /* -------------------------------------------- */

  /**
   * Creates a preview of the spell template
   */
  public drawPreview(): void {
    const initialLayer = canvas.activeLayer;

    // Draw the template and switch to the template layer
    this.draw();
    this.layer.activate();
    this.layer.preview.addChild(this);

    // Hide the sheet that originated the preview
    if (this.actorSheet) {
      this.actorSheet.minimize();
    }

    // Activate interactivity
    this.activatePreviewListeners(initialLayer);
  }

  /* -------------------------------------------- */

  /**
   * Activate listeners for the template preview
   * @param {CanvasLayer} initialLayer  The initially active CanvasLayer to re-activate after the workflow is complete
   */
  private activatePreviewListeners(initialLayer: CanvasLayer): void {
    const handlers: {[key: string]: (event: any) => void} = {};
    let moveTime = 0;

    // Update placement (mouse-move)
    handlers.mm = event => {
      event.stopPropagation();
      let now = Date.now(); // Apply a 20ms throttle
      if ( now - moveTime <= 20 ) return;
      const center = event.data.getLocalPosition(this.layer);
      const snapped = canvas.grid.getSnappedPosition(center.x, center.y, 2);
      this.data.update({x: snapped.x, y: snapped.y});
      this.refresh();
      moveTime = now;
    };

    // Cancel the workflow (right-click)
    handlers.rc = event => {
      // @ts-expect-error
      this.layer._onDragLeftCancel(event);
      canvas.stage.off("mousemove", handlers.mm);
      canvas.stage.off("mousedown", handlers.lc);
      canvas.app.view.oncontextmenu = null;
      canvas.app.view.onwheel = null;
      initialLayer.activate();
      if (this.actorSheet) {
        this.actorSheet.maximize();
      }
    };

    // Confirm the workflow (left-click)
    handlers.lc = event => {
      handlers.rc(event);
      const destination = canvas.grid.getSnappedPosition(this.data.x, this.data.y, 2);
      this.data.update(destination);
      canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [this.data as any]);
    };

    // Rotate the template by 3 degree increments (mouse-wheel)
    handlers.mw = event => {
      if ( event.ctrlKey ) event.preventDefault(); // Avoid zooming the browser window
      event.stopPropagation();
      let delta = canvas.grid.type > CONST.GRID_TYPES.SQUARE ? 30 : 15;
      let snap = event.shiftKey ? delta : 5;
      this.data.update({direction: this.data.direction + (snap * Math.sign(event.deltaY))});
      this.refresh();
    };

    // Activate listeners
    canvas.stage.on("mousemove", handlers.mm);
    canvas.stage.on("mousedown", handlers.lc);
    canvas.app.view.oncontextmenu = handlers.rc;
    canvas.app.view.onwheel = handlers.mw;
  }
}
