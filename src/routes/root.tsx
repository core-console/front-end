import { Outlet } from "react-router";

import { AppShell } from "@/components/app-shell/app-shell";
import { locale, messages } from "@/lib/i18n";

export function Root() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

export function RouteHydrateFallback() {
  return (
    <main
      className="flex min-h-svh items-center justify-center bg-background p-6 text-foreground"
      lang={locale}
    >
      <p className="text-muted-foreground">{messages.app.loading}</p>
    </main>
  );
}
