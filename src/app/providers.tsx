import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, type PropsWithChildren } from "react";

import { queryClient } from "@/app/query-client";

const ReactQueryDevtools = import.meta.env.DEV
  ? lazy(async () => {
      const devtools = await import("@tanstack/react-query-devtools");
      return { default: devtools.ReactQueryDevtools };
    })
  : null;

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {ReactQueryDevtools ? (
        <Suspense fallback={null}>
          <ReactQueryDevtools initialIsOpen={false} />
        </Suspense>
      ) : null}
    </QueryClientProvider>
  );
}
