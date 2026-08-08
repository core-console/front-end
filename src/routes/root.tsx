import { Outlet } from "react-router";

import { AppShell } from "@/components/app-shell/app-shell";

export function Root() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

export function RouteHydrateFallback() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6 text-foreground">
      <p className="text-muted-foreground">Loading application…</p>
    </main>
  );
}
