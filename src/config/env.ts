import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const envSchema = z
  .object({
    // The default supports a future same-origin gateway route.
    VITE_API_BASE_URL: z.string().trim().min(1).default("/api"),
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
