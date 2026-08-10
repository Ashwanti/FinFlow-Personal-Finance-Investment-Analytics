/**
 * Builds a query string, dropping anything empty.
 *
 * Not cosmetic: the API validates query parameters with Zod enums and object
 * ids, and `?type=` or `?accountId=` with an empty value is a 400, not a
 * missing filter. Clearing a dropdown in the UI has to remove the parameter
 * rather than send a blank one.
 */
export function queryString(params) {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    search.set(key, String(value));
  }

  const result = search.toString();
  return result ? `?${result}` : "";
}
