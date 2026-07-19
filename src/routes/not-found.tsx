import { Link } from "react-router";

export function Component() {
  return (
    <section className="flex flex-col gap-4" aria-labelledby="not-found-title">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">404</p>
        <h1
          id="not-found-title"
          className="text-3xl font-semibold tracking-tight"
        >
          Page not found
        </h1>
        <p className="text-muted-foreground">
          The requested page does not exist.
        </p>
      </div>
      <Link className="w-fit font-medium underline underline-offset-4" to="/">
        Return home
      </Link>
    </section>
  );
}
