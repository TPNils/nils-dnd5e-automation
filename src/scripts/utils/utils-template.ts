import { staticValues } from "../static-values";
import { MyItem, RangeUnits } from "../types/fixed-types";
import { UtilsFoundry } from "./utils-foundry";

export interface TemplateDetails {
  x: number;
  y: number;
  shape: MeasuredTemplate['shape'];
}

interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface AbilityTemplate extends MeasuredTemplate {
  drawPreview?: () => void
}

let Nd5aAbilityTemplate: typeof MeasuredTemplate & {fromItem: (item: MyItem) => AbilityTemplate};
function getTemplateClass() {
  if (Nd5aAbilityTemplate == null) {
    let baseClass: typeof Nd5aAbilityTemplate;
    if ('dnd5e' in globalThis) {
      baseClass = (globalThis.dnd5e as any).canvas.AbilityTemplate;
    } else {
      baseClass = (game as any).dnd5e.canvas.AbilityTemplate;
    }

    Nd5aAbilityTemplate = class Nd5aAbilityTemplate extends baseClass {

      private simulateId = false;
      /**
       * Required to make highlightGrid work
       */
      public get id(): string {
        if (!super.id && this.simulateId) {
          return 'null';
        }
        return super.id;
      }
      
      public refresh(): this {
        const value = super.refresh()
        if (this.template) {
          this.highlightGrid();
        }
        return value;
      }
      
      public highlightGrid(): void {
        this.simulateId = true;
        super.highlightGrid()
        this.simulateId = false;
      }
    }
  }

  return Nd5aAbilityTemplate;
}

export class UtilsTemplate {

  public static fromItem(item: MyItem, dmlCallbackMessageId: string): AbilityTemplate {
    const template = getTemplateClass().fromItem(item);
    const dataUpdate = {
      flags: {
        [staticValues.moduleName]: {
          dmlCallbackMessageId: dmlCallbackMessageId,
        }
      }
    };
    if (UtilsFoundry.usesDataModel<MeasuredTemplateDocument>(template.document)) {
      template.document.updateSource(dataUpdate)
    } else if (UtilsFoundry.usesDocumentData<MeasuredTemplateDocument>(template.document)) {
      template.document.data.update(dataUpdate);
    }
    return template;
  }

  public static isTokenInside(templateDetails: TemplateDetails, token: TokenDocument | Rectangle, wallsBlockTargeting: boolean): boolean {
    let rectangle: Rectangle;
    if (token instanceof TokenDocument) {
      let gridSize = UtilsFoundry.getModelData(canvas.scene).grid;
      // Foundry V9 has grid as a number, V10 as an object
      if (typeof gridSize === 'object') {
        gridSize = gridSize.size;
      }
      const tokenData = UtilsFoundry.getModelData(token);
      rectangle = {
        x: tokenData.x,
        y: tokenData.y,
        width: tokenData.width * gridSize,
        height: tokenData.height * gridSize,
      };
    } else {
      rectangle = token;
    }

    if (game.settings.get(staticValues.moduleName, 'aoeTargetRule') === 'xge') {
      return UtilsTemplate.isTokenInsideXge(templateDetails, rectangle, wallsBlockTargeting);
    }
    return UtilsTemplate.isTokenInsideDmg(templateDetails, rectangle, wallsBlockTargeting);
  }

  /**
   * DMG p.251 Areas Of Effect
   * If a *tile* is at least 50% in the area (Foundry default)
   */
  private static isTokenInsideDmg(templateDetails: TemplateDetails, rectangle: Rectangle, wallsBlockTargeting: boolean): boolean {
    let grid = UtilsFoundry.getModelData(canvas.scene).grid;
    // Foundry V9 has grid as a number, V10 as an object
    if (typeof grid === 'object') {
      grid = grid.size;
    }
    const steps = grid;
  
    // Check for center of each square the token uses.
    // e.g. for large tokens all 4 squares
    const startX = rectangle.width >= grid ? grid / 2 : rectangle.width / 2;
    const startY = rectangle.height >= grid ? grid / 2 : rectangle.height / 2;
    for (let x = startX; x < rectangle.width; x += steps) {
      for (let y = startY; y < rectangle.height; y += steps) {
        if (UtilsTemplate.containsPoint(templateDetails, {x: rectangle.x + x, y: rectangle.y + x}, wallsBlockTargeting)) {
          return true;
        }
      }
    }
    return false;
  }
  
  /**
   * XGE. p.86 If a *token* is within the area, it is affected
   */
   private static isTokenInsideXge(templateDetails: TemplateDetails, rectangle: Rectangle, wallsBlockTargeting: boolean): boolean {
    let grid = UtilsFoundry.getModelData(canvas.scene).grid;
    // Foundry V9 has grid as a number, V10 as an object
    if (typeof grid === 'object') {
      grid = grid.size;
    }
    const steps = Math.min(grid / 2, rectangle.width / 2, rectangle.height / 2);

    // This isn't perfect, but it should work well enough with the limitations of PIXI
    for (let x = 0; x <= rectangle.width; x += steps) {
      for (let y = 0; y <= rectangle.height; y += steps) {
        if (UtilsTemplate.containsPoint(templateDetails, {x: rectangle.x + x, y: rectangle.y + y}, wallsBlockTargeting)) {
          return true;
        }
      }
    }

    return false;
  }

  private static containsPoint(templateDetails: TemplateDetails, point: {x: number; y: number;}, wallsBlockTargeting: boolean) {
    let contains = templateDetails.shape?.contains(point.x - templateDetails.x, point.y - templateDetails.y);
    if (contains && wallsBlockTargeting) {
      const r = new Ray({x: point.x, y: point.y}, templateDetails);
      if (game.version?.startsWith('0')) {
        // @ts-ignore pre 9.x
        contains = !canvas.walls?.checkCollision(r, {type: 'movement', mode: 'any'});
      } else {
        contains = !canvas.walls?.checkCollision(r, {type: 'move', mode: 'any'});
      }
    }
    if (contains) {
      return true;
    }
    return false;
    
  }

  public static getTemplateDetails(document: MeasuredTemplateDocument): TemplateDetails {
    let {direction, distance, angle = 90, width, t, x, y} = UtilsFoundry.getModelData(document);
    distance = UtilsTemplate.feetToPx(distance);
    width = UtilsTemplate.feetToPx(width);
    direction = Math.toRadians(direction);

    let shape: MeasuredTemplate['shape'];
    // Get the Template shape
    switch ( t ) {
      case "circle":
        shape = new PIXI.Circle(0, 0, distance);
        break;
      case "cone":
        // @ts-expect-error
        shape = MeasuredTemplate.prototype._getConeShape(direction, angle, distance);
        break;
      case "rect":
        // @ts-expect-error
        shape = MeasuredTemplate.prototype._getRectShape(direction, distance);
        break;
      case "ray":
        // @ts-expect-error
        shape = MeasuredTemplate.prototype._getRayShape(direction, distance, width);
        break;
    }
    return {
      x: x,
      y: y,
      shape: shape
    }
  }

  public static getFeet({value, unit}: {value?: number, unit?: RangeUnits}): number {
    if (value == null) {
      return Infinity;
    }
    switch (unit) {
      case '':
      case 'any':
      case 'spec': {
        return Infinity;
      }
      case 'none':
      case 'self': {
        return 0;
      }
      case 'touch': {
        return 5;
      }
      case 'mi': {
        return value * 5280;
      }
      case 'm': {
        return value * 3.281;
      }
      case 'km': {
        return value * 3281;
      }
      case 'ft':
      default: {
        return value;
      }
    }
  }

  public static feetToPx(value: number): number {
    const dimensions = game.canvas.dimensions || {size: 1, distance: 1};
    return value * dimensions.size  / dimensions.distance;
  }

  public static getCenter(template: MeasuredTemplateDocument, token: TokenDocument): {x: number; y: number;} {
    switch ( UtilsFoundry.getModelData(template.parent).t ) {
      case "circle":
        let grid = UtilsFoundry.getModelData(canvas.scene).grid;
        // Foundry V9 has grid as a number, V10 as an object
        if (typeof grid === 'object') {
          grid = grid.size;
        }
        const tokenData = UtilsFoundry.getModelData(token);
        return {
          x: tokenData.x + ((tokenData.width * grid) / 2),
          y: tokenData.y + ((tokenData.height * grid) / 2),
        }
      case "cone":
        // @ts-expect-error
        shape = document.object._getConeShape(direction, angle, distance);
        break;
      case "rect":
        // @ts-expect-error
        shape = document.object._getRectShape(direction, distance);
        break;
      case "ray":
        // @ts-expect-error
        shape = document.object._getRayShape(direction, distance, width);
        break;
    }
  }

}