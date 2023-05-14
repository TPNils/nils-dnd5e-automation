import { UtilsHooks } from "./utils-hooks";

export class Version {
  
  constructor(
    public readonly major: number,
    public readonly minor?: number,
    public readonly patch?: number,
  ) {
  }

  public valueOf() {
    const parts = [this.major, this.minor ?? 0, this.patch ?? 0];
    return parts.map(part => String(part).padStart(20, '0')).join('.');
  }

  public equals(value: any): boolean {
    if (!(value instanceof Version)) {
      return false;
    }

    return this.major === value.major && (this.minor ?? 0) === (value.minor ?? 0) && (this.patch ?? 0) === (value.patch ?? 0);
  }

  public toString(): string {
    const parts = [this.major];
    if (this.minor != null) {
      parts.push(this.minor);
    }
    if (this.patch != null) {
      parts.push(this.patch);
    }
    return parts.join('.');
  }

  public static fromString(versionString: string): Version {
    let version = /^v?([0-9]+)(?:\.([0-9]+))?(?:\.([0-9]+))?$/i.exec(versionString);
    if (!version) {
      throw new Error('Unsupported version format');
    }

    const versionData = {major: 0, minor: undefined, patch: undefined};
    versionData.major = Number.parseInt(version[1]);
    versionData.minor = Number.parseInt(version[2]);
    versionData.patch = Number.parseInt(version[3]);
    return new Version(versionData.major, versionData.minor, versionData.patch);
  }

}

export class UtilsFoundry {

  public static getDocumentTypes(): string[] {
    if (Array.isArray(foundry.CONST.DOCUMENT_TYPES)) {
      return foundry.CONST.DOCUMENT_TYPES as any;
    } else if (Array.isArray(foundry.CONST.ENTITY_TYPES)) {
      /* @deprecated — since v9 */
      return foundry.CONST.ENTITY_TYPES as any;
    }
    throw new Error('Nothing found, have they deprecated the CONST var?');
  }

  public static getDocumentPermissions(): typeof foundry.CONST.DOCUMENT_PERMISSION_LEVELS {
    if (foundry.CONST.DOCUMENT_PERMISSION_LEVELS != null && typeof foundry.CONST.DOCUMENT_PERMISSION_LEVELS === 'object') {
      return foundry.CONST.DOCUMENT_PERMISSION_LEVELS as any;
    } else if (foundry.CONST.ENTITY_PERMISSIONS != null && typeof foundry.CONST.ENTITY_PERMISSIONS === 'object') {
      /* @deprecated — since v9 */
      return foundry.CONST.ENTITY_PERMISSIONS as any;
    }
    throw new Error('Nothing found, have they deprecated the CONST var?');
  }

  public static getUserRoles(): typeof foundry.CONST.USER_ROLES {
    if (foundry.CONST.USER_ROLES != null && typeof foundry.CONST.USER_ROLES === 'object') {
      return foundry.CONST.USER_ROLES as any;
    }
    throw new Error('Nothing found, have they deprecated the CONST var?');
  }

  public static getDiceRoleModes(): typeof foundry.CONST.DICE_ROLL_MODES {
    if (foundry.CONST.DICE_ROLL_MODES != null && typeof foundry.CONST.DICE_ROLL_MODES === 'object') {
      return foundry.CONST.DICE_ROLL_MODES as any;
    }
    throw new Error('Nothing found, have they deprecated the CONST var?');
  }

  public static getGameVersion(): Version {
    let version: string;
    if (typeof game.version === 'string') {
      version = game.version
    } else if (typeof game.data?.version === 'string') {
      version = game.data?.version;
    }
    if (!version) {
      let hasInitTriggered = false;
      // If init is resolved, it will exec sync, if not async
      // This way we can detect if it has triggered or not
      UtilsHooks.init().then(() => hasInitTriggered = true);
      if (!hasInitTriggered) {
        throw new Error('No version found');
      }
      throw new Error('Nothing found, have they deprecated the version var?');
    }


    return Version.fromString(version);
  }

}