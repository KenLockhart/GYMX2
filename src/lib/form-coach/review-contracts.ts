import { z } from "zod";
import { FormCoachWorkflowDetailSchema } from "./workflow-contracts";

const ReviewItemSchema = FormCoachWorkflowDetailSchema.shape.items.element.extend({
  expected_review_sequence: z.number().int().min(0).max(2_147_483_647),
  can_review: z.boolean(),
  can_open_retry: z.boolean(),
  max_extra_attempts: z.number().int().min(0).max(3),
});

export const FormCoachReviewDetailSchema = FormCoachWorkflowDetailSchema.extend({
  items: z.array(ReviewItemSchema).min(1).max(20),
});

export type FormCoachReviewDetail = z.infer<typeof FormCoachReviewDetailSchema>;
export type FormCoachReviewItem = FormCoachReviewDetail["items"][number];

export function parseFormCoachReviewDetail(input: unknown): FormCoachReviewDetail {
  return FormCoachReviewDetailSchema.parse(input);
}
