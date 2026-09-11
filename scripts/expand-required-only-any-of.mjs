const objectStructureKeys = [
  "type",
  "properties",
  "patternProperties",
  "additionalProperties",
  "propertyNames",
  "minProperties",
  "maxProperties",
  "dependentRequired",
  "dependentSchemas",
];

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isRequiredOnlyBranch = (value) =>
  isRecord(value) &&
  Object.keys(value).length === 1 &&
  Array.isArray(value.required) &&
  value.required.length > 0 &&
  value.required.every((property) => typeof property === "string");

const getParentRequired = (schema) =>
  Array.isArray(schema.required) &&
  schema.required.every((property) => typeof property === "string")
    ? schema.required
    : [];

const expandNode = (value) => {
  if (Array.isArray(value)) {
    return value.map(expandNode);
  }

  if (!isRecord(value)) {
    return value;
  }

  const schema = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, expandNode(child)]),
  );

  if (
    schema.type !== "object" ||
    !Array.isArray(schema.anyOf) ||
    schema.anyOf.length === 0 ||
    !schema.anyOf.every(isRequiredOnlyBranch)
  ) {
    return schema;
  }

  const objectStructure = Object.fromEntries(
    objectStructureKeys.flatMap((key) =>
      Object.hasOwn(schema, key) ? [[key, schema[key]]] : [],
    ),
  );
  const parentRequired = getParentRequired(schema);

  return {
    ...schema,
    anyOf: schema.anyOf.map((branch) => ({
      ...objectStructure,
      required: [...new Set([...parentRequired, ...branch.required])],
    })),
  };
};

export const expandRequiredOnlyAnyOfBranches = (document) =>
  expandNode(document);

export default expandRequiredOnlyAnyOfBranches;
