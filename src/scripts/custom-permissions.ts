export type CustomPermissionEquivalent = keyof Game.Permissions | 'GM';
export type AllPermissions = keyof Game.Permissions | keyof typeof CustomPermissions;

export const CustomPermissions: {[key: string]: CustomPermissionEquivalent} = {
  ACTOR_DELETE: 'GM',
  TOKEN_DELETE: 'GM',
}

export function hasPermission(permission: keyof Game.Permissions | keyof typeof CustomPermissions): boolean {
  if (CustomPermissions.hasOwnProperty(permission)) {
    permission = CustomPermissions[permission];
  }

  if (permission === 'GM') {
    return game.user.isGM;
  } else {
    return game.user.hasPermission(permission as keyof Game.Permissions);
  }
}