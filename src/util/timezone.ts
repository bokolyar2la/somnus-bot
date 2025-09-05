// src/util/timezone.ts
import { logger } from './logger.js'

/**
 * Определяет таймзону пользователя по IP через бесплатный API
 */
export async function detectTimezoneByIP(): Promise<string | null> {
  try {
    // Используем более точный сервис ipapi.co
    const response = await fetch('https://ipapi.co/json/', {
      headers: {
        'User-Agent': 'DreamJournalBot/1.0'
      }
    })
    
    if (!response.ok) {
      logger.warn(`Timezone API returned ${response.status}`)
      return null
    }
    
    const data = await response.json()
    
    if (data.timezone) {
      logger.info(`Detected timezone: ${data.timezone} for ${data.city}, ${data.country_name}`)
      return data.timezone
    }
    
    return null
  } catch (error) {
    logger.error({ error }, 'Failed to detect timezone by IP')
    return null
  }
}

/**
 * Определяет таймзону по координатам (fallback)
 */
export async function detectTimezoneByCoords(lat: number, lon: number): Promise<string | null> {
  try {
    // Используем бесплатный сервис
    const response = await fetch(
      `http://worldtimeapi.org/api/timezone/Etc/GMT`, // Fallback к GMT, можно улучшить
      {
        headers: {
          'User-Agent': 'DreamJournalBot/1.0'
        }
      }
    )
    
    if (!response.ok) {
      return null
    }
    
    // Простая логика определения по координатам
    // Можно улучшить, используя более точный API
    const hourOffset = Math.round(lon / 15)
    const gmtOffset = hourOffset >= 0 ? `+${hourOffset}` : `${hourOffset}`
    
    // Возвращаем примерную таймзону
    if (hourOffset === 3) return 'Europe/Moscow'
    if (hourOffset === 2) return 'Europe/Berlin'
    if (hourOffset === 0) return 'Europe/London'
    if (hourOffset === -5) return 'America/New_York'
    if (hourOffset === -8) return 'America/Los_Angeles'
    
    return `Etc/GMT${gmtOffset}`
  } catch (error) {
    logger.error({ error }, 'Failed to detect timezone by coordinates')
    return null
  }
}

/**
 * Список популярных таймзон для ручного выбора
 */
export const POPULAR_TIMEZONES = [
  { name: '🇷🇺 Москва', value: 'Europe/Moscow' },
  { name: '🇷🇺 Санкт-Петербург', value: 'Europe/Moscow' },
  { name: '🇬🇪 Тбилиси', value: 'Asia/Tbilisi' },
  { name: '🇷🇺 Екатеринбург', value: 'Asia/Yekaterinburg' },
  { name: '🇷🇺 Новосибирск', value: 'Asia/Novosibirsk' },
  { name: '🇰🇿 Алматы', value: 'Asia/Almaty' },
  { name: '🇺🇦 Киев', value: 'Europe/Kiev' },
  { name: '🇧🇾 Минск', value: 'Europe/Minsk' },
  { name: '🇩🇪 Берлин', value: 'Europe/Berlin' },
  { name: '🇬🇧 Лондон', value: 'Europe/London' },
  { name: '🇺🇸 Нью-Йорк', value: 'America/New_York' },
  { name: '🇺🇸 Лос-Анджелес', value: 'America/Los_Angeles' },
]
