import { DateTime } from "luxon";

export function nowInZone(zone?: string) {
  return zone ? DateTime.now().setZone(zone) : DateTime.now();
}

export function parseHHMM(hhmm?: string) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return { h, m };
}

export function sameLocalDay(a: DateTime, b: DateTime) {
  return a.hasSame(b, "day");
}

// Вернёт true, если локальное время пользователя == заданным час/минуте в пределах этой минуты
export function isNowAt(zone: string|undefined, hhmm: string|undefined) {
  const z = nowInZone(zone);
  const t = parseHHMM(hhmm);
  if (!t) return false;
  return z.hour === t.h && z.minute === t.m;
}

