import { Link } from "react-router";
import { locale, messages } from "@/lib/i18n";

export function Component() {
  return (
    <section
      className="flex flex-col gap-4"
      aria-labelledby="not-found-title"
      lang={locale}
    >
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">404</p>
        <h1
          id="not-found-title"
          className="text-3xl font-semibold tracking-tight"
        >
          {messages.notFound.title}
        </h1>
        <p className="text-muted-foreground">{messages.notFound.description}</p>
      </div>
      <Link className="w-fit font-medium underline underline-offset-4" to="/">
        {messages.common.returnHome}
      </Link>
    </section>
  );
}
