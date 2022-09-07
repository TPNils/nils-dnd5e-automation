import { staticValues } from "../static-values";
import { RangeUnits } from "../types/fixed-types";

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

export class UtilsTemplate {

  public static isTokenInside(templateDetails: TemplateDetails, token: TokenDocument | Rectangle, wallsBlockTargeting: boolean): boolean {
    const rectangle = token instanceof TokenDocument ? {
      x: token.data.x,
      y: token.data.y,
      width: token.data.width * canvas.scene.data.grid,
      height: token.data.height * canvas.scene.data.grid,
    } : token;

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
    const grid = canvas.scene.data.grid;
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
    const steps = Math.min(canvas.scene.data.grid / 2, rectangle.width / 2, rectangle.height / 2);

    // This isnt't perfect, but it should work well enough with the limitations of PIXI
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
    let {direction, distance, angle = 90, width} = document.data;
    distance = UtilsTemplate.feetToPx(distance);
    width = UtilsTemplate.feetToPx(width);
    direction = Math.toRadians(direction);

    let shape: MeasuredTemplate['shape'];
    // Get the Template shape
    switch ( document.data.t ) {
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
      x: document.data.x,
      y: document.data.y,
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
    const gridSize = template.parent.data.grid;
    switch ( template.data.t ) {
      case "circle":
        return {
          x: token.data.x + ((token.data.width * gridSize) / 2),
          y: token.data.y + ((token.data.height * gridSize) / 2),
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