import { cn } from "@/lib/utils";

import { AccountIdentity } from "@/components/app-shell/account-identity";
import { SidebarNavigation } from "@/components/app-shell/sidebar-navigation";
import { sidebarLabelClassName } from "@/components/app-shell/sidebar-label";

interface AppSidebarProps {
  collapsed: boolean;
}

export function AppSidebar({ collapsed }: AppSidebarProps) {
  return (
    <aside
      aria-label="Core Console sidebar"
      className="row-span-2 flex min-h-svh min-w-0 flex-col border-r border-border bg-sidebar"
      id="app-sidebar"
    >
      <div
        className={cn(
          "flex h-14 shrink-0 items-center overflow-hidden",
          collapsed ? "justify-center" : "gap-2 px-4",
        )}
      >
        <img alt="" className="size-5 shrink-0" src="/core-console-mark.svg" />
        {!collapsed && (
          <span
            className={cn(
              sidebarLabelClassName,
              "text-lg leading-7 font-semibold tracking-[-0.025em] text-foreground",
            )}
          >
            Core Console
          </span>
        )}
      </div>
      <SidebarNavigation collapsed={collapsed} />
      <AccountIdentity collapsed={collapsed} />
    </aside>
  );
}
