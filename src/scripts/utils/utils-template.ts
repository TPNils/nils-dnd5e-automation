export interface TemplateDetails {
  x: number;
  y: number;
  shape: MeasuredTemplate['shape'];
}

// Source: https://gitlab.com/tposney/midi-qol/-/blob/ee67ca2468aa2f6912e5c6154cdc44ac85abec82/src/module/itemhandling.ts
export class UtilsTemplate {

  public static isTokenInside(templateDetails: TemplateDetails, token: TokenDocument, wallsBlockTargeting: boolean): boolean {
    const grid = canvas.scene?.data.grid;
    const templatePos = { x: templateDetails.x, y: templateDetails.y };
  
    // Check for center of each square the token uses.
    // e.g. for large tokens all 4 squares
    const startX = token.data.width >= 1 ? 0.5 : token.data.width / 2;
    const startY = token.data.height >= 1 ? 0.5 : token.data.height / 2;
    for (let x = startX; x < token.data.width; x++) {
      for (let y = startY; y < token.data.height; y++) {
        const currGrid = {
          x: token.data.x + x * grid - templatePos.x,
          y: token.data.y + y * grid - templatePos.y,
        };
        let contains = templateDetails.shape?.contains(currGrid.x, currGrid.y);
        if (contains && wallsBlockTargeting) {
          const r = new Ray({x: currGrid.x + templatePos.x, y: currGrid.y + templatePos.y}, templatePos);
          contains = !canvas.walls?.checkCollision(r);
        }
        if (contains) {
          return true;
        }
      }
    }
    return false;
  }

  public static getTemplateDetails(document: MeasuredTemplateDocument): TemplateDetails {
    let {direction, distance, angle, width} = document.data;
    const dimensions = game.canvas.dimensions || {size: 1, distance: 1};
    distance *= dimensions.size  / dimensions.distance;
    width *= dimensions.size  / dimensions.distance;
    direction = Math.toRadians(direction);

    let shape: MeasuredTemplate['shape'];
    // Get the Template shape
    switch ( document.data.t ) {
      case "circle":
        shape = new PIXI.Circle(0, 0, distance);
        break;
      case "cone":
        // @ts-expect-error
        shape = document._object._getConeShape(direction, angle, distance);
        break;
      case "rect":
        // @ts-expect-error
        shape = document._object._getRectShape(direction, distance);
        break;
      case "ray":
        // @ts-expect-error
        shape = document._object._getRayShape(direction, distance, width);
        break;
    }
    return {
      x: document.data.x,
      y: document.data.y,
      shape: shape
    }
  }

}