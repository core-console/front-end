import { z } from "zod";
import {
  CreateFinanceSettlementBody,
  PreviewFinanceSettlementBody,
} from "@/api/generated/schemas";

// OpenAPI maxLength counts Unicode code points; Zod's generated .max counts
// UTF-16 units. Retain every generated v6 field and correct only that check.
const reason = z.string().refine((value) => {
  const length = [...value].length;
  return length >= 1 && length <= 500;
});
const combinedPreview = PreviewFinanceSettlementBody.options.find(
  (option): option is (typeof PreviewFinanceSettlementBody.options)[4] =>
    "shape" in option &&
    "kind" in option.shape &&
    option.shape.kind.value === "combined",
);
const combinedCommand = CreateFinanceSettlementBody.options.find(
  (option): option is (typeof CreateFinanceSettlementBody.options)[5] =>
    "shape" in option &&
    "kind" in option.shape &&
    option.shape.kind.value === "combined",
);
if (!combinedPreview || !combinedCommand)
  throw new Error("The generated combined Settlement contract is missing.");

export const settlementPreviewBody = z.union([
  combinedPreview.extend({ reason }),
  PreviewFinanceSettlementBody,
]);
export const settlementCommandBody = z.union([
  combinedCommand.extend({ reason }),
  CreateFinanceSettlementBody,
]);
