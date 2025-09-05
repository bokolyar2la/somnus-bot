// src/core/rateLimiter.ts
import { RateLimitError } from '../types/errors.js'
import { trackRateLimit } from '../util/metrics.js'
import { logger } from '../util/logger.js'

interface RateLimit {
  requests: number[]
  windowMs: number
  maxRequests: number
}

const rateLimits = new Map<string, RateLimit>()

const LIMITS = {
  'interpret': { maxRequests: 5, windowMs: 60000 },    // 5/минуту
  'followup': { maxRequests: 3, windowMs: 60000 },     // 3/минуту  
  'report': { maxRequests: 2, windowMs: 3600000 },     // 2/час
  'practice': { maxRequests: 10, windowMs: 3600000 },  // 10/час
  'export': { maxRequests: 5, windowMs: 3600000 },     // 5/час
} as const

export type RateLimitFeature = keyof typeof LIMITS

export function checkRateLimit(
  userId: string, 
  feature: RateLimitFeature,
  userPlan: string = 'free',
  isAdmin = false
): void {
  if (isAdmin) {
    logger.debug({ userId, feature }, 'Rate limit bypassed for admin')
    return // Админы без лимитов
  }
  
  const key = `${userId}:${feature}`
  const limit = LIMITS[feature]
  const now = Date.now()
  
  let userLimit = rateLimits.get(key)
  if (!userLimit) {
    userLimit = { requests: [], ...limit }
    rateLimits.set(key, userLimit)
  }
  
  // Очищаем старые запросы
  userLimit.requests = userLimit.requests.filter(
    timestamp => now - timestamp < userLimit.windowMs
  )
  
  if (userLimit.requests.length >= userLimit.maxRequests) {
    // Трекаем нарушение лимита
    trackRateLimit(feature, userPlan)
    
    logger.warn({
      userId,
      feature,
      userPlan,
      currentRequests: userLimit.requests.length,
      maxRequests: userLimit.maxRequests,
      windowMs: userLimit.windowMs
    }, 'Rate limit exceeded')
    
    throw new RateLimitError(
      `Rate limit exceeded for ${feature}`,
      { 
        userId, 
        feature, 
        limit: userLimit.maxRequests,
        windowMs: userLimit.windowMs,
        userPlan
      }
    )
  }
  
  userLimit.requests.push(now)
  
  logger.debug({
    userId,
    feature,
    requestsInWindow: userLimit.requests.length,
    maxRequests: userLimit.maxRequests
  }, 'Rate limit check passed')
}

// Получение статистики лимитов для пользователя
export function getRateLimitStats(userId: string): Record<string, any> {
  const stats: Record<string, any> = {}
  const now = Date.now()
  
  for (const feature of Object.keys(LIMITS) as RateLimitFeature[]) {
    const key = `${userId}:${feature}`
    const userLimit = rateLimits.get(key)
    const limit = LIMITS[feature]
    
    if (userLimit) {
      // Очищаем старые запросы для точной статистики
      const validRequests = userLimit.requests.filter(
        timestamp => now - timestamp < userLimit.windowMs
      )
      
      stats[feature] = {
        used: validRequests.length,
        max: limit.maxRequests,
        remaining: Math.max(0, limit.maxRequests - validRequests.length),
        windowMs: limit.windowMs,
        resetsAt: validRequests.length > 0 
          ? new Date(Math.min(...validRequests) + limit.windowMs)
          : null
      }
    } else {
      stats[feature] = {
        used: 0,
        max: limit.maxRequests,
        remaining: limit.maxRequests,
        windowMs: limit.windowMs,
        resetsAt: null
      }
    }
  }
  
  return stats
}

// Очистка старых записей (вызывать периодически)
export function cleanupRateLimits() {
  const now = Date.now()
  let cleaned = 0
  
  for (const [key, userLimit] of rateLimits.entries()) {
    const validRequests = userLimit.requests.filter(
      timestamp => now - timestamp < userLimit.windowMs
    )
    
    if (validRequests.length === 0) {
      rateLimits.delete(key)
      cleaned++
    } else {
      userLimit.requests = validRequests
    }
  }
  
  if (cleaned > 0) {
    logger.debug({ cleaned }, 'Cleaned up rate limit entries')
  }
}

// Запуск периодической очистки
export function startRateLimitCleanup() {
  // Очищаем каждые 10 минут
  setInterval(cleanupRateLimits, 10 * 60 * 1000)
  logger.info('Rate limit cleanup scheduler started')
}
