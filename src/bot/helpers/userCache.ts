// src/bot/helpers/userCache.ts
import type { User } from '@prisma/client'
import type { MyContext } from './state.js'
import { getOrCreateUser, updateUserProfile } from '../../db/repo.js'
import { logger } from '../../util/logger.js'

const CACHE_TTL = 30000 // 30 секунд

export async function getCachedUser(ctx: MyContext): Promise<User> {
  const userId = ctx.from!.id.toString()
  const now = Date.now()
  const cached = ctx.session.cachedUser
  
  // Проверяем валидность кэша
  if (cached && 
      cached.tgId === userId && 
      (now - cached.lastFetchedAt) < CACHE_TTL) {
    logger.debug({ userId, cacheAge: now - cached.lastFetchedAt }, 'User cache hit')
    return cached.data
  }
  
  // Кэш устарел или отсутствует - загружаем из БД
  logger.debug({ userId }, 'User cache miss, fetching from DB')
  const user = await getOrCreateUser(userId)
  
  // Сохраняем в кэш
  ctx.session.cachedUser = {
    data: user,
    lastFetchedAt: now,
    tgId: userId
  }
  
  return user
}

export function invalidateUserCache(ctx: MyContext, reason?: string) {
  const userId = ctx.from?.id?.toString()
  if (ctx.session.cachedUser) {
    logger.debug({ userId, reason }, 'User cache invalidated')
    ctx.session.cachedUser = undefined
  }
}

// Обертка для updateUserProfile с автоматической инвалидацией
export async function updateUserProfileWithCache(
  ctx: MyContext,
  tgId: string,
  data: Parameters<typeof updateUserProfile>[1]
) {
  const result = await updateUserProfile(tgId, data)
  invalidateUserCache(ctx, 'profile_updated')
  return result
}

// Хелпер для принудительного обновления кэша
export async function refreshUserCache(ctx: MyContext): Promise<User> {
  invalidateUserCache(ctx, 'manual_refresh')
  return getCachedUser(ctx)
}

// Статистика кэша для мониторинга
export function getCacheStats(ctx: MyContext) {
  const cached = ctx.session.cachedUser
  if (!cached) {
    return { status: 'empty' }
  }
  
  const age = Date.now() - cached.lastFetchedAt
  const isValid = age < CACHE_TTL
  
  return {
    status: isValid ? 'valid' : 'expired',
    ageMs: age,
    tgId: cached.tgId
  }
}
