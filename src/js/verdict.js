export const YES = "YES";
export const NO = "NO";
export const RECONSIDER = "再考";

/** @param {number | null} status HTTP status, or null when no response arrived. */
export function verdict(status) {
  if (status === null) return NO;
  if (status >= 400 && status <= 499) return RECONSIDER;
  if (status >= 200 && status <= 299) return YES;
  return NO;
}
