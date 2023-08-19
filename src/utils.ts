/**
 * JSON.stringify, but good
 */
export function stringify(obj: any): string {
  return JSON.stringify(obj, (_k, v) => v, 2)
}
