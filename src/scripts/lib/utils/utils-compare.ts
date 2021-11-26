export class UtilsCompare {

  public static findDiff(original: any, override: any): {changed: boolean, diff?: any} {
    if (original === override) {
      return {changed: false};
    }
    const originalType = typeof original;
    const overrideType = typeof override;
  
    if (originalType !== overrideType) {
      return {changed: true, diff: override};
    }
  
    if (Array.isArray(original) !== Array.isArray(override)) {
      return {changed: true, diff: override};
    }
  
    if (original === null && override !== null) {
      // null is an object, undefined is it's own type
      return {changed: true, diff: override};
    }
  
    if (originalType === 'object') {
      const keys = new Set([...Object.keys(original), ...Object.keys(override)]);
      const diff: any = Array.isArray(original) ? [] : {};
      for (const key of keys) {
        const itemResult = UtilsCompare.findDiff(original[key], override[key]);
        if (itemResult.changed) {
          diff[key] = itemResult.diff;
        }
      }
      if (Object.keys(diff).length > 0) {
        if (Array.isArray(override)) {
          // Foundry can't handle partial array dml updates
          return {changed: true, diff: override};
        }
        return {changed: true, diff: diff};
      } else {
        return {changed: false};
      }
    } else {
      if (original === override) {
        return {changed: false};
      } else {
        return {changed: true, diff: override};
      }
    }
  }

}