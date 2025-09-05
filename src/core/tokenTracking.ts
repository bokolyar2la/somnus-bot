// src/core/tokenTracking.ts
import { logger } from '../util/logger.js'
import { config } from '../util/config.js'

interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  model: string
  operation: string
  userId: string
  correlationId: string
  timestamp: Date
  costUsd?: number
}

interface DailyCosts {
  date: string
  totalTokens: number
  totalCostUsd: number
  operationBreakdown: Record<string, { tokens: number; cost: number; count: number }>
}

// В памяти хранилище для текущего дня
const dailyUsage = new Map<string, TokenUsage[]>()
const dailyCosts = new Map<string, DailyCosts>()

// Цены за 1K токенов (в USD)
const TOKEN_PRICES = {
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-3.5-turbo': { input: 0.0015, output: 0.002 },
  'claude-3-sonnet': { input: 0.003, output: 0.015 },
  'claude-3-haiku': { input: 0.00025, output: 0.00125 },
} as const

export function calculateTokenCost(
  model: string,
  promptTokens: number,
  completionTokens: number
): number {
  const pricing = TOKEN_PRICES[model as keyof typeof TOKEN_PRICES]
  if (!pricing) {
    logger.warn({ model }, 'Unknown model for cost calculation')
    return 0
  }
  
  const inputCost = (promptTokens / 1000) * pricing.input
  const outputCost = (completionTokens / 1000) * pricing.output
  
  return inputCost + outputCost
}

export function trackTokenUsage(
  model: string,
  promptTokens: number,
  completionTokens: number,
  operation: string,
  userId: string,
  correlationId: string
): TokenUsage {
  const totalTokens = promptTokens + completionTokens
  const costUsd = calculateTokenCost(model, promptTokens, completionTokens)
  
  const usage: TokenUsage = {
    promptTokens,
    completionTokens,
    totalTokens,
    model,
    operation,
    userId,
    correlationId,
    timestamp: new Date(),
    costUsd
  }
  
  // Добавляем в дневное хранилище
  const today = new Date().toISOString().split('T')[0]
  const todayUsage = dailyUsage.get(today) || []
  todayUsage.push(usage)
  dailyUsage.set(today, todayUsage)
  
  // Обновляем дневную статистику
  updateDailyCosts(today, usage)
  
  // Логируем использование
  logger.info({
    correlationId,
    userId,
    model,
    operation,
    promptTokens,
    completionTokens,
    totalTokens,
    costUsd: costUsd.toFixed(6)
  }, 'Token usage tracked')
  
  // Проверяем бюджет
  checkBudgetLimits(today)
  
  return usage
}

function updateDailyCosts(date: string, usage: TokenUsage) {
  let costs = dailyCosts.get(date)
  if (!costs) {
    costs = {
      date,
      totalTokens: 0,
      totalCostUsd: 0,
      operationBreakdown: {}
    }
    dailyCosts.set(date, costs)
  }
  
  costs.totalTokens += usage.totalTokens
  costs.totalCostUsd += usage.costUsd || 0
  
  const opKey = `${usage.operation}-${usage.model}`
  if (!costs.operationBreakdown[opKey]) {
    costs.operationBreakdown[opKey] = { tokens: 0, cost: 0, count: 0 }
  }
  
  costs.operationBreakdown[opKey].tokens += usage.totalTokens
  costs.operationBreakdown[opKey].cost += usage.costUsd || 0
  costs.operationBreakdown[opKey].count += 1
}

function checkBudgetLimits(date: string) {
  const costs = dailyCosts.get(date)
  if (!costs || !config.budget?.dailyLimitUsd) return
  
  const { dailyLimitUsd, warningThreshold } = config.budget
  const usagePercent = (costs.totalCostUsd / dailyLimitUsd) * 100
  
  if (usagePercent >= 100) {
    logger.error({
      date,
      totalCost: costs.totalCostUsd,
      dailyLimit: dailyLimitUsd,
      usagePercent
    }, 'Daily budget limit exceeded!')
  } else if (usagePercent >= (warningThreshold || 80)) {
    logger.warn({
      date,
      totalCost: costs.totalCostUsd,
      dailyLimit: dailyLimitUsd,
      usagePercent
    }, 'Daily budget warning threshold reached')
  }
}

export function getDailyUsage(date?: string): DailyCosts | undefined {
  const targetDate = date || new Date().toISOString().split('T')[0]
  return dailyCosts.get(targetDate)
}

export function getUsageByUser(userId: string, date?: string): TokenUsage[] {
  const targetDate = date || new Date().toISOString().split('T')[0]
  const todayUsage = dailyUsage.get(targetDate) || []
  return todayUsage.filter(usage => usage.userId === userId)
}

export function getUsageByOperation(operation: string, date?: string): TokenUsage[] {
  const targetDate = date || new Date().toISOString().split('T')[0]
  const todayUsage = dailyUsage.get(targetDate) || []
  return todayUsage.filter(usage => usage.operation === operation)
}

export function getBudgetStatus(): {
  dailyUsed: number
  dailyLimit: number
  remainingBudget: number
  usagePercent: number
  isOverBudget: boolean
} {
  const today = new Date().toISOString().split('T')[0]
  const costs = dailyCosts.get(today)
  const dailyLimit = config.budget?.dailyLimitUsd || 0
  const dailyUsed = costs?.totalCostUsd || 0
  
  return {
    dailyUsed,
    dailyLimit,
    remainingBudget: Math.max(0, dailyLimit - dailyUsed),
    usagePercent: dailyLimit > 0 ? (dailyUsed / dailyLimit) * 100 : 0,
    isOverBudget: dailyUsed >= dailyLimit
  }
}

export function exportUsageData(startDate: string, endDate: string): {
  summary: Record<string, DailyCosts>
  detailed: Record<string, TokenUsage[]>
} {
  const summary: Record<string, DailyCosts> = {}
  const detailed: Record<string, TokenUsage[]> = {}
  
  for (const [date, costs] of dailyCosts.entries()) {
    if (date >= startDate && date <= endDate) {
      summary[date] = costs
      detailed[date] = dailyUsage.get(date) || []
    }
  }
  
  return { summary, detailed }
}

// Очистка старых данных (вызывать периодически)
export function cleanupOldUsageData(retentionDays = 30) {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays)
  const cutoffString = cutoffDate.toISOString().split('T')[0]
  
  let cleaned = 0
  for (const date of dailyUsage.keys()) {
    if (date < cutoffString) {
      dailyUsage.delete(date)
      dailyCosts.delete(date)
      cleaned++
    }
  }
  
  if (cleaned > 0) {
    logger.info({ cleaned, retentionDays }, 'Cleaned up old usage data')
  }
}

// Запуск периодической очистки
export function startUsageCleanup() {
  // Очищаем старые данные каждый день в полночь
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(0, 0, 0, 0)
  
  const msUntilMidnight = tomorrow.getTime() - now.getTime()
  
  setTimeout(() => {
    cleanupOldUsageData()
    // Затем каждые 24 часа
    setInterval(cleanupOldUsageData, 24 * 60 * 60 * 1000)
  }, msUntilMidnight)
  
  logger.info('Usage data cleanup scheduler started')
}
