import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { locale, messages } from "@/lib/i18n";

export function RouteErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return (
      <ErrorPage
        description={messages.routeError.requestFailedDescription}
        title={messages.routeError.requestFailedTitle(error.status)}
      />
    );
  }

  if (error instanceof Error) {
    return (
      <ErrorPage
        description={messages.routeError.unexpectedDescription}
        title={messages.routeError.unexpectedTitle}
      />
    );
  }

  return (
    <ErrorPage
      description={messages.routeError.unknownDescription}
      title={messages.routeError.unknownTitle}
    />
  );
}

function ErrorPage({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <main
      className="flex min-h-svh items-center justify-center bg-background p-6 text-foreground"
      lang={locale}
    >
      <section
        className="flex max-w-lg flex-col gap-4 text-center"
        aria-labelledby="route-error-title"
      >
        <div className="flex flex-col gap-2">
          <h1
            id="route-error-title"
            className="text-3xl font-semibold tracking-tight"
          >
            {title}
          </h1>
          <p className="text-muted-foreground">{description}</p>
        </div>
        <Link className="font-medium underline underline-offset-4" to="/">
          {messages.common.returnHome}
        </Link>
      </section>
    </main>
  );
}
