export function categoryIdentityLabel(category: { id: string; name: string }) {
  return `${category.name}, Category ID ${category.id}`;
}

export function categoryWorkflowLabel(
  category: { id: string; name: string },
  categories: ReadonlyArray<{ id: string; name: string }>,
) {
  const hasDuplicateName = categories.some(
    (candidate) =>
      candidate.id !== category.id && candidate.name === category.name,
  );
  return hasDuplicateName ? categoryIdentityLabel(category) : category.name;
}
