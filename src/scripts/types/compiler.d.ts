export {};

/** 
 * Add virtual "global keywords" that will be picked up by the compiler and and removed.
 */
declare global {
  /** Convert the string from scss to css during compile time */
  const scss: typeof String.raw;
}

