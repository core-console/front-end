import { z } from "zod";

export function resolveApiBaseUrl(
  value: string,
  origin = window.location.origin,
) {
  const url = new URL(value, `${origin}/`);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("The API address is invalid.");
  }
  return url.href.replace(/\/+$/, "");
}

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const envSchema = z
  .object({
    // The default supports a future same-origin gateway route.
    VITE_API_BASE_URL: z
      .string()
      .trim()
      .min(1)
      .default("/api")
      .transform((value, context) => {
        try {
          return resolveApiBaseUrl(value);
        } catch {
          context.addIssue({
            code: "custom",
            message:
              "Use an HTTP API base address without credentials, query, or fragment.",
          });
          return z.NEVER;
        }
      }),
    VITE_ENABLE_API_MOCKING: booleanString,
  })
  .readonly();

const result = envSchema.safeParse(import.meta.env);

if (!result.success) {
  const details = result.error.issues
    .map(
      (issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`,
    )
    .join("; ");

  throw new Error(`Invalid environment configuration: ${details}`);
}

export const env = result.data;
