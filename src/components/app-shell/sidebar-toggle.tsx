import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { locale, messages } from "@/lib/i18n";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface SidebarToggleProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function SidebarToggle({ collapsed, onToggle }: SidebarToggleProps) {
  const label = collapsed
    ? messages.shell.expandSidebar
    : messages.shell.collapseSidebar;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-controls="app-sidebar"
            aria-expanded={!collapsed}
            aria-label={label}
            className="rounded-sm text-muted-foreground aria-expanded:bg-transparent hover:aria-expanded:bg-muted"
            onClick={onToggle}
            size="icon"
            variant="ghost"
          >
            {collapsed ? (
              <PanelLeftOpen
                aria-hidden="true"
                className="size-[18px]"
                strokeWidth={1.5}
              />
            ) : (
              <PanelLeftClose
                aria-hidden="true"
                className="size-[18px]"
                strokeWidth={1.5}
              />
            )}
          </Button>
        }
      />
      <TooltipContent lang={locale} side="bottom">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
