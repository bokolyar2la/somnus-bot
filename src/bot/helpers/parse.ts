export function extractHashtags(text: string): string[] {
  const hashtags = text.match(/#\w+/g);
  return hashtags ? hashtags.map(tag => tag.substring(1)) : [];
}

export function isValidHHMM(s: string): boolean {
  const match = s.match(/^(\d{2}):(\d{2})$/);
  if (!match) return false;
  const [_, hh, mm] = match;
  const h = Number(hh);
  const m = Number(mm);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

export function mapRuWeekdayToIndex(s: string): number | -1 {
  const weekDays = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
  return weekDays.indexOf(s.toLowerCase());
}

