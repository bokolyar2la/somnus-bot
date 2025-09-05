// src/util/cityTimezone.ts
import { logger } from './logger.js'

/**
 * Маппинг городов на часовые пояса
 */
export const CITY_TIMEZONE_MAP: Record<string, string> = {
  // Россия
  'москва': 'Europe/Moscow',
  'moscow': 'Europe/Moscow',
  'санкт-петербург': 'Europe/Moscow',
  'спб': 'Europe/Moscow',
  'петербург': 'Europe/Moscow',
  'екатеринбург': 'Asia/Yekaterinburg',
  'новосибирск': 'Asia/Novosibirsk',
  'красноярск': 'Asia/Krasnoyarsk',
  'иркутск': 'Asia/Irkutsk',
  'владивосток': 'Asia/Vladivostok',
  'калининград': 'Europe/Kaliningrad',
  'сочи': 'Europe/Moscow',
  'казань': 'Europe/Moscow',
  'нижний новгород': 'Europe/Moscow',
  'челябинск': 'Asia/Yekaterinburg',
  'омск': 'Asia/Omsk',
  'ростов-на-дону': 'Europe/Moscow',
  'уфа': 'Asia/Yekaterinburg',
  'волгоград': 'Europe/Volgograd',
  'пермь': 'Asia/Yekaterinburg',
  'воронеж': 'Europe/Moscow',
  'краснодар': 'Europe/Moscow',
  'саратов': 'Europe/Saratov',
  'тольятти': 'Europe/Samara',
  'самара': 'Europe/Samara',
  
  // СНГ
  'тбилиси': 'Asia/Tbilisi',
  'батуми': 'Asia/Tbilisi',
  'ереван': 'Asia/Yerevan',
  'баку': 'Asia/Baku',
  'киев': 'Europe/Kiev',
  'харьков': 'Europe/Kiev',
  'одесса': 'Europe/Kiev',
  'днепр': 'Europe/Kiev',
  'львов': 'Europe/Kiev',
  'минск': 'Europe/Minsk',
  'алматы': 'Asia/Almaty',
  'астана': 'Asia/Almaty',
  'нур-султан': 'Asia/Almaty',
  'ташкент': 'Asia/Tashkent',
  'бишкек': 'Asia/Bishkek',
  'душанбе': 'Asia/Dushanbe',
  'ашхабад': 'Asia/Ashgabat',
  'кишинев': 'Europe/Chisinau',
  
  // Европа
  'берлин': 'Europe/Berlin',
  'мюнхен': 'Europe/Berlin',
  'гамбург': 'Europe/Berlin',
  'лондон': 'Europe/London',
  'манчестер': 'Europe/London',
  'париж': 'Europe/Paris',
  'марсель': 'Europe/Paris',
  'рим': 'Europe/Rome',
  'милан': 'Europe/Rome',
  'мадрид': 'Europe/Madrid',
  'барселона': 'Europe/Madrid',
  'амстердам': 'Europe/Amsterdam',
  'прага': 'Europe/Prague',
  'варшава': 'Europe/Warsaw',
  'будапешт': 'Europe/Budapest',
  'вена': 'Europe/Vienna',
  'стокгольм': 'Europe/Stockholm',
  'хельсинки': 'Europe/Helsinki',
  'осло': 'Europe/Oslo',
  'копенгаген': 'Europe/Copenhagen',
  'афины': 'Europe/Athens',
  'стамбул': 'Europe/Istanbul',
  
  // США и Канада
  'нью-йорк': 'America/New_York',
  'вашингтон': 'America/New_York',
  'бостон': 'America/New_York',
  'майами': 'America/New_York',
  'чикаго': 'America/Chicago',
  'даллас': 'America/Chicago',
  'хьюстон': 'America/Chicago',
  'денвер': 'America/Denver',
  'лос-анджелес': 'America/Los_Angeles',
  'сан-франциско': 'America/Los_Angeles',
  'сиэтл': 'America/Los_Angeles',
  'лас-вегас': 'America/Los_Angeles',
  'торонто': 'America/Toronto',
  'ванкувер': 'America/Vancouver',
  'монреаль': 'America/Montreal',
  
  // Азия
  'токио': 'Asia/Tokyo',
  'осака': 'Asia/Tokyo',
  'пекин': 'Asia/Shanghai',
  'шанхай': 'Asia/Shanghai',
  'гонконг': 'Asia/Hong_Kong',
  'сингапур': 'Asia/Singapore',
  'бангкок': 'Asia/Bangkok',
  'джакарта': 'Asia/Jakarta',
  'манила': 'Asia/Manila',
  'сеул': 'Asia/Seoul',
  'мумбаи': 'Asia/Kolkata',
  'дели': 'Asia/Kolkata',
  'бангалор': 'Asia/Kolkata',
  'дубай': 'Asia/Dubai',
  'тель-авив': 'Asia/Jerusalem',
  
  // Австралия и Океания
  'сидней': 'Australia/Sydney',
  'мельбурн': 'Australia/Melbourne',
  'перт': 'Australia/Perth',
  'окленд': 'Pacific/Auckland',
  
  // Южная Америка
  'сан-паулу': 'America/Sao_Paulo',
  'рио-де-жанейро': 'America/Sao_Paulo',
  'буэнос-айрес': 'America/Argentina/Buenos_Aires',
  'лима': 'America/Lima',
  'богота': 'America/Bogota',
  'каракас': 'America/Caracas',
  
  // Африка
  'каир': 'Africa/Cairo',
  'кейптаун': 'Africa/Johannesburg',
  'йоханнесбург': 'Africa/Johannesburg',
  'лагос': 'Africa/Lagos',
  'касабланка': 'Africa/Casablanca'
}

/**
 * Определяет часовой пояс по названию города
 */
export function getTimezoneByCity(cityName: string): string | null {
  const normalizedCity = cityName.toLowerCase().trim()
  
  // Прямое совпадение
  if (CITY_TIMEZONE_MAP[normalizedCity]) {
    return CITY_TIMEZONE_MAP[normalizedCity]
  }
  
  // Поиск частичного совпадения
  for (const [city, timezone] of Object.entries(CITY_TIMEZONE_MAP)) {
    if (city.includes(normalizedCity) || normalizedCity.includes(city)) {
      return timezone
    }
  }
  
  return null
}

/**
 * Получает список популярных городов для автодополнения
 */
export function getPopularCities(): Array<{ name: string; timezone: string }> {
  return [
    { name: '🇷🇺 Москва', timezone: 'Europe/Moscow' },
    { name: '🇷🇺 Санкт-Петербург', timezone: 'Europe/Moscow' },
    { name: '🇬🇪 Тбилиси', timezone: 'Asia/Tbilisi' },
    { name: '🇷🇺 Екатеринбург', timezone: 'Asia/Yekaterinburg' },
    { name: '🇷🇺 Новосибирск', timezone: 'Asia/Novosibirsk' },
    { name: '🇰🇿 Алматы', timezone: 'Asia/Almaty' },
    { name: '🇺🇦 Киев', timezone: 'Europe/Kiev' },
    { name: '🇧🇾 Минск', timezone: 'Europe/Minsk' },
    { name: '🇩🇪 Берлин', timezone: 'Europe/Berlin' },
    { name: '🇬🇧 Лондон', timezone: 'Europe/London' },
    { name: '🇺🇸 Нью-Йорк', timezone: 'America/New_York' },
    { name: '🇺🇸 Лос-Анджелес', timezone: 'America/Los_Angeles' },
    { name: '🇯🇵 Токио', timezone: 'Asia/Tokyo' },
    { name: '🇨🇳 Пекин', timezone: 'Asia/Shanghai' },
    { name: '🇦🇪 Дубай', timezone: 'Asia/Dubai' },
    { name: '🇦🇺 Сидней', timezone: 'Australia/Sydney' }
  ]
}

/**
 * Валидирует часовой пояс
 */
export function validateTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

/**
 * Форматирует время для отображения пользователю
 */
export function formatTimeInTimezone(timezone: string): string {
  try {
    const now = new Date()
    const formatter = new Intl.DateTimeFormat('ru-RU', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    })
    return formatter.format(now)
  } catch (error) {
    logger.error({ error, timezone }, 'Failed to format time in timezone')
    return 'Неизвестно'
  }
}
