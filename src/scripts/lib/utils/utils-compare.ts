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
          if (itemResult.diff === undefined) {
            diff[`-=${key}`] = null;
          } else {
            diff[key] = itemResult.diff;
          }
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

  public static deepEquals(original: any, compareTo: any): boolean {
    if (original === compareTo) {
      return true;
    }
    // NaN !== NaN
    if (Number.isNaN(original) && Number.isNaN(compareTo)) {
      return true;
    }
    const originalType = typeof original;
    const compareToType = typeof compareTo;
  
    if (originalType !== compareToType) {
      return false;
    }
  
    if (Array.isArray(original) !== Array.isArray(compareTo)) {
      return false;
    }
  
    if (original === null || compareTo === null && original !== compareTo) {
      // null is an object, undefined is it's own type
      return false;
    }
  
    if (originalType === 'object') {
      const keys = new Set([...Object.keys(original), ...Object.keys(compareTo)]);
      for (const key of keys) {
        if (!UtilsCompare.deepEquals(original[key], compareTo[key])) {
          return false;
        }
      }
      return true;
    } else {
      return original === compareTo;
    }
  }

}