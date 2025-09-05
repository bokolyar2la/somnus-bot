import { ADMIN_IDS } from './config.js';
export function isAdmin(telegramId: string | number | undefined): boolean {
  if (!telegramId) return false;
  return ADMIN_IDS.includes(String(telegramId));
}

