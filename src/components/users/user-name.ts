import type { UserResponse } from "@/api/generated/schemas";

export const getUserHumanName = (user: UserResponse) =>
  [user.displayName, user.username, user.email]
    .find((value) => value?.trim())
    ?.trim() ?? user.id;
