import { useGetCurrentUser } from "@/api/generated/core-console";
import { MeResponse } from "@/api/generated/schemas";
import { cn } from "@/lib/utils";

import { sidebarLabelClassName } from "@/components/app-shell/sidebar-label";

interface AccountIdentityProps {
  collapsed: boolean;
}

interface IdentityPresentation {
  initial: string;
  primary: string;
  secondary: string;
}

const loadingIdentity: IdentityPresentation = {
  initial: "…",
  primary: "Loading account",
  secondary: "Please wait",
};

const unavailableIdentity: IdentityPresentation = {
  initial: "?",
  primary: "Account unavailable",
  secondary: "Unable to load",
};

const firstAvailable = (...values: Array<string | null>) =>
  values.find((value) => value?.trim())?.trim();

const toIdentityPresentation = (
  currentUser: MeResponse,
): IdentityPresentation => {
  const primary =
    firstAvailable(
      currentUser.displayName,
      currentUser.username,
      currentUser.email,
    ) ?? currentUser.id;
  const secondary =
    firstAvailable(currentUser.username, currentUser.email) ?? currentUser.id;

  return {
    initial: primary.charAt(0).toLocaleUpperCase(),
    primary,
    secondary,
  };
};

function AccountAvatar({ identity }: { identity: IdentityPresentation }) {
  return (
    <span
      aria-label={identity.primary}
      className="flex size-8 items-center justify-center rounded-[12px] bg-avatar text-sm leading-5 font-medium text-muted-foreground"
      role="img"
    >
      {identity.initial}
    </span>
  );
}

export function AccountIdentity({ collapsed }: AccountIdentityProps) {
  const currentUserQuery = useGetCurrentUser({
    query: {
      select: (response) => MeResponse.parse(response.data),
    },
  });
  const identity = currentUserQuery.data
    ? toIdentityPresentation(currentUserQuery.data)
    : currentUserQuery.isError
      ? unavailableIdentity
      : loadingIdentity;

  return (
    <div
      aria-label="Current account"
      className="shrink-0 bg-card px-2 pt-2 pb-4"
      role="group"
    >
      {collapsed ? (
        <div className="flex justify-center pb-2">
          <AccountAvatar identity={identity} />
        </div>
      ) : (
        <div className="flex h-[52px] items-center gap-2 rounded-md bg-account px-4">
          <AccountAvatar identity={identity} />
          <div className={cn("min-w-0 flex-1", sidebarLabelClassName)}>
            <p className="truncate text-[13px] leading-[16.25px] font-medium text-foreground">
              {identity.primary}
            </p>
            <p className="truncate text-xs leading-[15px] text-muted-foreground">
              {identity.secondary}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
