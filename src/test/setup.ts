/// <reference types="node" />
import "@testing-library/jest-dom/vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { locks } from "node:worker_threads";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";

import { seedMockData } from "@/mocks/seed";
import { server } from "@/mocks/server";

beforeAll(() => {
  // jsdom has no LockManager; use Node's native implementation at this boundary.
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: locks,
  });
  server.listen({ onUnhandledRequest: "error" });
});

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  globalThis.IDBKeyRange = IDBKeyRange;
  seedMockData();
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
