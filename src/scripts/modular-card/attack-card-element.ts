import { staticValues } from "../static-values";
import { createElement } from "./card-part-element";

export const AttackCardElement = createElement({
  selector: `${staticValues.code}-attack-card`,
  getHtml: (context) => {
    return renderTemplate(
      `modules/${staticValues.moduleName}/templates/modular-card/attack-part.hbs`, {
        data: context.data,
        moduleName: staticValues.moduleName
      }
    )
  },
  getCallbackActions: () => []
})