import { unlink } from "node:fs/promises";
import { resolve } from "node:path";

const workerPath = resolve(process.cwd(), "dist/mockServiceWorker.js");

try {
  await unlink(workerPath);
  console.log("Removed development-only dist/mockServiceWorker.js.");
} catch (error) {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    console.log(
      "Development-only dist/mockServiceWorker.js was already absent.",
    );
  } else {
    throw error;
  }
}
