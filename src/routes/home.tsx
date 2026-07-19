export function Component() {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="home-title">
      <h1 id="home-title" className="text-3xl font-semibold tracking-tight">
        Application foundation
      </h1>
      <p className="max-w-2xl text-muted-foreground">
        Routing, server-state management, and runtime configuration validation
        are ready.
      </p>
    </section>
  );
}
