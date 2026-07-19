import { Link, Outlet } from "react-router";

export function Root() {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="border-b">
        <nav
          className="mx-auto flex w-full max-w-5xl items-center px-6 py-4"
          aria-label="Main navigation"
        >
          <Link className="font-semibold" to="/">
            Front End
          </Link>
        </nav>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 px-6 py-12">
        <Outlet />
      </main>
    </div>
  );
}

export function RouteHydrateFallback() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6 text-foreground">
      <p className="text-muted-foreground">Loading application…</p>
    </main>
  );
}
