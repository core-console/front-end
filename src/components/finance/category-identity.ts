export function categoryIdentityLabel(category: { id: string; name: string }) {
  return `${category.name}, Category ID ${category.id}`;
}

export function categoryWorkflowLabel(
  category: { id: string; name: string },
  categories: ReadonlyArray<{ id: string; name: string }>,
  language?: typeof locale,
) {
  const hasDuplicateName = categories.some(
    (candidate) =>
      candidate.id !== category.id && candidate.name === category.name,
  );
  return hasDuplicateName
    ? language === locale
      ? messages.finance.quickEntry.categoryIdentity(category.name, category.id)
      : categoryIdentityLabel(category)
    : category.name;
}
import { locale, messages } from "@/lib/i18n";
