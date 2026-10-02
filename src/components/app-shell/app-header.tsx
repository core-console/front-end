import { matchPath, useLocation } from "react-router";

import { SidebarToggle } from "@/components/app-shell/sidebar-toggle";
import { glossary } from "@/lib/i18n";

interface AppHeaderProps {
  collapsed: boolean;
  onToggleSidebar: () => void;
}

export function AppHeader({ collapsed, onToggleSidebar }: AppHeaderProps) {
  const location = useLocation();
  const pageLabel = matchPath("/finance/*", location.pathname)
    ? glossary.finance
    : matchPath({ end: true, path: "/users" }, location.pathname)
      ? glossary.users
      : glossary.home;

  return (
    <header className="flex h-14 min-w-0 items-center border-b border-border bg-card pr-8 pl-[14px]">
      <div className="flex items-center gap-2">
        <SidebarToggle collapsed={collapsed} onToggle={onToggleSidebar} />
        <span
          className="text-sm leading-5 font-medium text-foreground"
          lang="en"
        >
          {pageLabel}
        </span>
      </div>
    </header>
  );
}
