export function HomePage() {
  return (
    <section className="flex flex-col gap-2" aria-labelledby="home-title">
      <h1
        id="home-title"
        className="text-2xl leading-8 font-semibold text-foreground"
      >
        Home
      </h1>
      <p className="text-sm leading-5 text-muted-foreground">
        Welcome to Core Console.
      </p>
    </section>
  );
}

export function Component() {
  return <HomePage />;
}
