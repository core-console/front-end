import { isCommonAssetRequest } from "msw";
import { setupWorker } from "msw/browser";

import { env } from "@/config/env";
import { handlers } from "@/mocks/handlers";
import { seedMockData } from "@/mocks/seed";

const worker = setupWorker(...handlers);

const isApiRequest = (request: Request) => {
  const requestUrl = new URL(request.url);
  const apiUrl = new URL(env.VITE_API_BASE_URL, window.location.origin);
  const apiPath = apiUrl.pathname.replace(/\/$/, "");

  return (
    requestUrl.origin === apiUrl.origin &&
    (requestUrl.pathname === apiPath ||
      requestUrl.pathname.startsWith(`${apiPath}/`))
  );
};

export const startBrowserMocking = async () => {
  seedMockData();

  await worker.start({
    onUnhandledRequest(request, print) {
      if (isCommonAssetRequest(request)) {
        return;
      }

      if (isApiRequest(request)) {
        print.warning();
      }

      // Non-API traffic, including future OIDC requests, bypasses the worker.
    },
  });
};
