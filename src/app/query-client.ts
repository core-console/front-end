import { QueryClient } from "@tanstack/react-query";

// Keep TanStack Query defaults until real API behavior justifies
// local or global overrides.
export const queryClient = new QueryClient();
