import { MeasuredTemplateData } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/data/module.mjs";
import { MyItemData } from "../types/fixed-types.js";
import { TemplateDetails, UtilsTemplate } from "../utils/utils-template.js";

let nextVirtualId = 0;

/**
 * Basically a copy from DND5e AbilityTemplate, except that actorSheet can be null
 */
export default class MyAbilityTemplate extends MeasuredTemplate {

  private actorSheet?: ActorSheet;

  public static fromItem({target, flags, actorSheet}: {target: MyItemData['data']['target'], flags?: any, actorSheet?: ActorSheet}): MyAbilityTemplate {
    // @ts-expect-error
    let templateShape = CONFIG.DND5E.areaTargetTypes[target?.type];
    let distance = target?.value;
    if (!templateShape && ['ft', 'mi', 'm', 'km'].includes(target?.units)) {
      templateShape = 'circle';
      distance = UtilsTemplate.getFeet({value: target?.value, unit: target.units});
    }
    if (!templateShape && ['touch'].includes(target?.units)) {
      templateShape = 'rect';
      distance = 15;
    }
    if (!templateShape || !distance || distance < 0 || distance === Infinity) {
      return null;
    }

    // Prepare template data
    const templateData: Partial<MeasuredTemplateData> = {
      t: templateShape,
      user: game.user.id,
      distance: distance,
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

  private _virtualId: string;
  /**
   * Required to make highlightGrid work
   */
  public get virtualId(): string {
    if (this._virtualId === undefined) {
      this._virtualId = String(nextVirtualId++);
    }
    return this._virtualId;
  }

  /* -------------------------------------------- */

  /**
   * Creates a preview of the spell template
   */
  public drawPreview(): void {
    const initialLayer = canvas.activeLayer;

    // Draw the template and switch to the template layer
    this.draw();
    this.highlightGrid();
    this.layer.activate();
    this.layer.preview.addChild(this);

    // Hide the sheet that originated the preview
    if (this.actorSheet) {
      this.actorSheet.minimize();
    }

    // Activate interactivity
    this.activatePreviewListeners(initialLayer);
  }
  
  public refresh(): this {
    const value = super.refresh()
    this.highlightGrid();
    return value;
  }

  /**
   * Highlight the grid squares which should be shown under the area of effect
   */
  public highlightGrid(): void {
    const grid = canvas.grid;
    const d = canvas.dimensions as any;
    const border = this.borderColor as any;
    const color = this.fillColor as any;

    // Only highlight for objects which have a defined shape
    if ( !this.shape ) return;

    // Clear existing highlight
    let hl = grid.getHighlightLayer(`Template.${this.virtualId}`);
    if (!hl) {
      hl = grid.addHighlightLayer(`Template.${this.virtualId}`);
    }
    hl.clear();

    // If we are in gridless mode, highlight the shape directly
    if ( grid.type === CONST.GRID_TYPES.GRIDLESS ) {
      const shape = this.shape.clone();
      if ( "points" in shape ) {
        shape.points = shape.points.map((p, i) => {
          if ( i % 2 ) return this.y + p;
          else return this.x + p;
        });
      } else {
        shape.x += this.x;
        shape.y += this.y;
      }
      return grid.grid.highlightGridPosition(hl, {border, color, shape: shape as any});
    }

    // Get number of rows and columns
    const nr = Math.ceil(((this.data.distance * 1.5) / d.distance) / (d.size / grid.h));
    const nc = Math.ceil(((this.data.distance * 1.5) / d.distance) / (d.size / grid.w));

    // Get the offset of the template origin relative to the top-left grid space
    const [tx, ty] = canvas.grid.getTopLeft(this.data.x, this.data.y);
    const [row0, col0] = grid.grid.getGridPositionFromPixels(tx, ty);
    const hx = canvas.grid.w / 2;
    const hy = canvas.grid.h / 2;
    const isCenter = (this.data.x - tx === hx) && (this.data.y - ty === hy);

    // Identify grid coordinates covered by the template Graphics
    const details: TemplateDetails = {
      x: this.x,
      y: this.y,
      shape: this.shape,
    }
    for (let r = -nr; r < nr; r++) {
      for (let c = -nc; c < nc; c++) {
        let [gx, gy] = canvas.grid.grid.getPixelsFromGridPosition(row0 + r, col0 + c);
        let contains = ((r === 0) && (c === 0) && isCenter ) || UtilsTemplate.isTokenInside(details, {x: gx, y: gy, width: canvas.grid.w, height: canvas.grid.h}, true);
        if ( !contains ) continue;
        grid.grid.highlightGridPosition(hl, {x: gx, y: gy, border, color});
      }
    }
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
      this.disableHighlight();
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
      this.disableHighlight();
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

  private disableHighlight() {
    canvas.grid.destroyHighlightLayer(`Template.${this.virtualId}`);
    this._virtualId = null;
  }
}
