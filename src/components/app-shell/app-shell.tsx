import { useState, type ReactNode } from "react";

import { AppHeader } from "@/components/app-shell/app-header";
import { AppSidebar } from "@/components/app-shell/app-sidebar";
import { cn } from "@/lib/utils";
import { locale } from "@/lib/i18n";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      lang={locale}
      className={cn(
        "grid min-h-svh min-w-[1024px] grid-rows-[3.5rem_minmax(0,1fr)] bg-background transition-[grid-template-columns] duration-200 ease-out motion-reduce:transition-none",
        collapsed
          ? "grid-cols-[56px_minmax(0,1fr)]"
          : "grid-cols-[240px_minmax(0,1fr)]",
      )}
    >
      <AppSidebar collapsed={collapsed} />
      <AppHeader
        collapsed={collapsed}
        onToggleSidebar={() => setCollapsed((current) => !current)}
      />
      {/* Deferred feature copy stays English; localized routes declare their language. */}
      <main className="min-w-0 bg-background px-8 pt-8" lang="en">
        {children}
      </main>
    </div>
  );
}
