import { useQuery } from "@tanstack/react-query";

import { api } from "./apiClient";

/**
 * Lookups shared by several screens.
 *
 * Accounts and categories change rarely and are needed by every form, so they
 * are cached longer than transactional data — otherwise opening the "add
 * transaction" dialog refetches both lists every time.
 */
const LOOKUP_STALE_MS = 5 * 60 * 1000;

export function useAccounts({ includeArchived = false } = {}) {
  return useQuery({
    queryKey: ["accounts", { includeArchived }],
    queryFn: () => api.get(`/api/accounts${includeArchived ? "?includeArchived=true" : ""}`),
    select: (data) => data.accounts,
    staleTime: LOOKUP_STALE_MS,
  });
}

export function useCategories({ kind } = {}) {
  return useQuery({
    queryKey: ["categories", { kind: kind ?? "all" }],
    queryFn: () => api.get(`/api/categories${kind ? `?kind=${kind}` : ""}`),
    select: (data) => data.categories,
    staleTime: LOOKUP_STALE_MS,
  });
}

/**
 * Everything a write can touch.
 *
 * One new transaction moves an account balance, the budget for its category,
 * the dashboard and the portfolio's cash side. Listing the keys in one place
 * means a new screen cannot invalidate half of them and leave the rest of the
 * UI showing figures that are quietly wrong.
 */
export const LEDGER_KEYS = [
  ["transactions"],
  ["accounts"],
  ["budgets"],
  ["dashboard"],
  ["portfolio"],
];

export const invalidateLedger = (queryClient) => {
  for (const key of LEDGER_KEYS) queryClient.invalidateQueries({ queryKey: key });
};
