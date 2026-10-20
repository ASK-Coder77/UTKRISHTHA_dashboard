/**
 * Tiny className concatenation helper — avoids a clsx/cn dependency.
 * Filters out falsy values (false, null, undefined, empty string).
 */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
