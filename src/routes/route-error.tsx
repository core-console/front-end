import { isRouteErrorResponse, Link, useRouteError } from "react-router";

export function RouteErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return (
      <ErrorPage
        description="The requested operation could not be completed."
        title={`${error.status} ${error.statusText || "Request failed"}`}
      />
    );
  }

  if (error instanceof Error) {
    return (
      <ErrorPage
        description="An unexpected application error occurred."
        title="Something went wrong"
      />
    );
  }

  return (
    <ErrorPage
      description="An unknown application error occurred."
      title="Unknown error"
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
    <main className="flex min-h-svh items-center justify-center bg-background p-6 text-foreground">
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
          Return home
        </Link>
      </section>
    </main>
  );
}
