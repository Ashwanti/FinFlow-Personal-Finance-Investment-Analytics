import { QueryClient } from "@tanstack/react-query";

import { ApiError } from "./apiClient";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      /**
       * Never retry an error the server has already decided.
       *
       * The client refreshes and retries a 401 itself, so one arriving here
       * means the session really is gone; retrying a 400 or 404 just repeats a
       * request the server has answered definitively; and hammering a 429
       * makes the rate limit worse.
       */
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});
