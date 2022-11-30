export class UtilsArray {

  public static includesAny(arr: any[], includes: any[]): boolean {
    for (const incl of includes) {
      if (arr.includes(incl)) {
        return true;
      }
    }
    return false;
  }

}