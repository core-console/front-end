import { glossary, locale, messages } from "@/lib/i18n";

export function HomePage() {
  return (
    <section
      className="flex flex-col gap-2"
      aria-labelledby="home-title"
      lang={locale}
    >
      <h1
        id="home-title"
        lang="en"
        className="text-2xl leading-8 font-semibold text-foreground"
      >
        {glossary.home}
      </h1>
      <p className="text-sm leading-5 text-muted-foreground">
        {messages.home.welcome}
      </p>
    </section>
  );
}

export function Component() {
  return <HomePage />;
}
