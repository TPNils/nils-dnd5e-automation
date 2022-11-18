
export class UtilsFoundry {

  public static getDocumentTypes(): string[] {
    if (Array.isArray(foundry.CONST.DOCUMENT_TYPES)) {
      return foundry.CONST.DOCUMENT_TYPES as any;
    } else if (Array.isArray(foundry.CONST.ENTITY_TYPES)) {
      /* @deprecated — since v9 */
      return foundry.CONST.ENTITY_TYPES as any;
    }
  }

  public static getDocumentPermissions(): typeof foundry.CONST.DOCUMENT_PERMISSION_LEVELS {
    if (foundry.CONST.DOCUMENT_PERMISSION_LEVELS != null && typeof foundry.CONST.DOCUMENT_PERMISSION_LEVELS === 'object') {
      return foundry.CONST.DOCUMENT_PERMISSION_LEVELS as any;
    } else if (foundry.CONST.ENTITY_PERMISSIONS != null && typeof foundry.CONST.ENTITY_PERMISSIONS === 'object') {
      /* @deprecated — since v9 */
      return foundry.CONST.ENTITY_PERMISSIONS as any;
    }
  }

  public static getUserRolls(): typeof foundry.CONST.USER_ROLES {
    if (foundry.CONST.USER_ROLES != null && typeof foundry.CONST.USER_ROLES === 'object') {
      return foundry.CONST.USER_ROLES as any;
    }
  }

}