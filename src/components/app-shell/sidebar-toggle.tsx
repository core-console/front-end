import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
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
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-controls="app-sidebar"
            aria-expanded={!collapsed}
            aria-label={label}
            className="rounded-sm text-muted-foreground"
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
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
