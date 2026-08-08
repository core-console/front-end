import { House, Settings, Users, type LucideIcon } from "lucide-react";
import { Link, useLocation } from "react-router";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { sidebarLabelClassName } from "@/components/app-shell/sidebar-label";
import { cn } from "@/lib/utils";

interface SidebarNavigationProps {
  collapsed: boolean;
}

interface NavigationItem {
  icon: LucideIcon;
  label: string;
  to?: string;
}

const navigationItems: NavigationItem[] = [
  { icon: House, label: "Home", to: "/" },
  { icon: Users, label: "Users" },
  { icon: Settings, label: "Settings" },
];

function NavigationItemView({
  collapsed,
  active,
  item,
}: {
  active: boolean;
  collapsed: boolean;
  item: NavigationItem;
}) {
  const className = cn(
    "flex items-center text-sm leading-5",
    collapsed
      ? "size-10 justify-center rounded-md"
      : "min-h-10 w-full gap-2 rounded-sm px-4 py-2",
    active
      ? collapsed
        ? "bg-sidebar-active-collapsed text-sidebar-primary"
        : "bg-sidebar-accent text-sidebar-primary"
      : "text-sidebar-foreground",
  );
  const content = (
    <>
      <item.icon
        aria-hidden="true"
        className="size-[18px] shrink-0"
        strokeWidth={1.5}
      />
      {!collapsed && (
        <span className={sidebarLabelClassName}>{item.label}</span>
      )}
    </>
  );

  if (item.to) {
    const link = (
      <Link
        aria-current={active ? "page" : undefined}
        aria-label={item.label}
        className={cn(
          className,
          "hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        )}
        to={item.to}
      >
        {content}
      </Link>
    );

    if (collapsed) {
      return (
        <Tooltip>
          <TooltipTrigger render={link} />
          <TooltipContent side="right">{item.label}</TooltipContent>
        </Tooltip>
      );
    }

    return link;
  }

  return (
    <span aria-disabled="true" className={className}>
      {content}
    </span>
  );
}

export function SidebarNavigation({ collapsed }: SidebarNavigationProps) {
  const location = useLocation();

  return (
    <nav
      aria-label="Primary navigation"
      className={cn(
        "flex flex-1 flex-col pt-2",
        collapsed ? "items-center gap-1 px-2" : "items-start gap-1 px-2",
      )}
    >
      {navigationItems.map((item) => (
        <NavigationItemView
          active={item.to === "/" && location.pathname === "/"}
          collapsed={collapsed}
          item={item}
          key={item.label}
        />
      ))}
    </nav>
  );
}
