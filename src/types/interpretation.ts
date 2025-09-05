import { z } from "zod";

export const InterpretationSchema = z.object({
  short_title: z.string().max(60),
  symbols_detected: z.array(z.string()).max(12),
  barnum_insight: z.string().max(300),
  esoteric_interpretation: z.string().max(700),
  reflective_question: z.string().max(200),
  gentle_advice: z.array(z.string()).max(5).default([]),
  risk_flags: z.array(z.string()).optional(),
  paywall_teaser: z.string().max(140).optional(),
});

export type Interpretation = z.infer<typeof InterpretationSchema>;

