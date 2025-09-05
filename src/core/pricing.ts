export type Plan = 'free' | 'paid';

type Limits = {
  monthlyInterps: number;   // лимит интерпретаций в месяц
  weeklyReport: boolean;    // фича weekly в принципе доступна
};

export const LIMITS: Record<Plan, Limits> = {
  free: { monthlyInterps: 5,        weeklyReport: true  }, // урезанный weekly (см. квоту)
  paid: { monthlyInterps: Infinity, weeklyReport: true  },
};

export function safePlan(plan?: string | null): Plan {
  const p = (plan ?? '').trim();
  if (!p) return 'free';
  if (p === 'free' || p === 'paid') return p as Plan;
  if (p === 'plus' || p === 'lite' || p === 'pro' || p === 'premium') return 'paid';
  return 'free';
}
export function isPaidPlan(plan?: string | null): boolean { return safePlan(plan) === 'paid'; }
export function isFreePlan(plan?: string | null): boolean { return safePlan(plan) === 'free'; }

export function getMonthlyQuota(plan: Plan | string): number {
  return LIMITS[safePlan(plan as string)].monthlyInterps;
}
export function getMonthlyFollowups(plan: Plan | string): number {
  return isPaidPlan(plan as string) ? Infinity : 3;
}
export function canAskFollowup(plan: string, used: number): boolean {
  const q = getMonthlyFollowups(plan);
  return q === Infinity ? true : used < q;
}
export function canInterpret(plan: string, used: number): boolean {
  const q = getMonthlyQuota(plan);
  return q === Infinity ? true : used < q;
}
export function canWeeklyFeature(plan: Plan | string): boolean {
  return LIMITS[safePlan(plan as string)].weeklyReport;
}
export function getMonthlyWeeklyQuota(plan: Plan | string): number {
  return isPaidPlan(plan as string) ? Infinity : 1;
}
export function canRunWeekly(plan: Plan | string, usedThisMonth: number): boolean {
  const q = getMonthlyWeeklyQuota(plan);
  return q === Infinity ? true : usedThisMonth < q;
}
