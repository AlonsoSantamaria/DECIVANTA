import { z } from "zod";

export const sessionTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const idempotencyKeySchema = z.string().uuid();
export const executiveActionSchema = z.enum([
  "REQUEST_REVISED_SCENARIO",
  "CONTINUE_WITH_CONDITIONS",
  "DISMISS_ALERT",
]);

export const apiErrorSchema = z.object({
  requestId: z.string().uuid(),
  status: z.string().min(1),
});

export type ExecutiveAction = z.infer<typeof executiveActionSchema>;
