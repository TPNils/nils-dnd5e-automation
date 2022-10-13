
export class UtilsFoundry {

  public static getDocumentTypes(): string[] {
    if (Array.isArray(CONST.DOCUMENT_TYPES)) {
      return CONST.DOCUMENT_TYPES as any;
    } else if (Array.isArray(CONST.ENTITY_TYPES)) {
      /* @deprecated — since v9 */
      return CONST.ENTITY_TYPES as any;
    }
  }

}