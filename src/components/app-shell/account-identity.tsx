import { cn } from "@/lib/utils";

import { sidebarLabelClassName } from "@/components/app-shell/sidebar-label";

interface AccountIdentityProps {
  collapsed: boolean;
}

function AccountAvatar() {
  return (
    <span
      aria-label="Developer"
      className="flex size-8 items-center justify-center rounded-[12px] bg-avatar text-sm leading-5 font-medium text-muted-foreground"
      role="img"
    >
      D
    </span>
  );
}

export function AccountIdentity({ collapsed }: AccountIdentityProps) {
  return (
    <div
      aria-label="Current account"
      className="shrink-0 bg-card px-2 pt-2 pb-4"
      role="group"
    >
      {collapsed ? (
        <div className="flex justify-center pb-2">
          <AccountAvatar />
        </div>
      ) : (
        <div className="flex h-[52px] items-center gap-2 rounded-md bg-account px-4">
          <AccountAvatar />
          <div className={cn("min-w-0 flex-1", sidebarLabelClassName)}>
            <p className="truncate text-[13px] leading-[16.25px] font-medium text-foreground">
              Developer
            </p>
            <p className="truncate text-xs leading-[15px] text-muted-foreground">
              developer
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
