// src/util/metrics.ts
import promClient from 'prom-client'
import { config } from './config.js'

// Создаем реестр метрик
export const register = new promClient.Registry()

// Базовые метрики системы
promClient.collectDefaultMetrics({ register })

// Доменные метрики
export const metrics = {
  llmCalls: new promClient.Counter({
    name: 'llm_calls_total',
    help: 'Total number of LLM API calls',
    labelNames: ['operation', 'model', 'status'],
    registers: [register]
  }),
  
  llmLatency: new promClient.Histogram({
    name: 'llm_latency_seconds',
    help: 'LLM API call latency',
    labelNames: ['operation', 'model'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
    registers: [register]
  }),
  
  interpretations: new promClient.Counter({
    name: 'interpretations_total',
    help: 'Total number of dream interpretations',
    labelNames: ['plan', 'status'],
    registers: [register]
  }),
  
  reports: new promClient.Counter({
    name: 'reports_total',
    help: 'Total number of reports generated',
    labelNames: ['plan', 'type'],
    registers: [register]
  }),
  
  reportsBlocked: new promClient.Counter({
    name: 'reports_blocked_quota_total',
    help: 'Reports blocked due to quota limits',
    labelNames: ['plan', 'reason'],
    registers: [register]
  }),
  
  llmCost: new promClient.Counter({
    name: 'llm_cost_usd_total',
    help: 'Total LLM costs in USD',
    labelNames: ['operation', 'model'],
    registers: [register]
  }),
  
  activeUsers: new promClient.Gauge({
    name: 'active_users',
    help: 'Number of active users',
    labelNames: ['period'],
    registers: [register]
  }),
  
  userCacheHits: new promClient.Counter({
    name: 'user_cache_hits_total',
    help: 'User cache hits',
    registers: [register]
  }),
  
  userCacheMisses: new promClient.Counter({
    name: 'user_cache_misses_total',
    help: 'User cache misses',
    registers: [register]
  }),
  
  rateLimitHits: new promClient.Counter({
    name: 'rate_limit_hits_total',
    help: 'Rate limit violations',
    labelNames: ['feature', 'user_plan'],
    registers: [register]
  }),
  
  errors: new promClient.Counter({
    name: 'errors_total',
    help: 'Total errors by type',
    labelNames: ['error_type', 'operation'],
    registers: [register]
  })
}

// Middleware для метрик LLM
export function trackLLMCall<T>(
  operation: string,
  model: string,
  promise: Promise<T>
): Promise<T> {
  const timer = metrics.llmLatency.startTimer({ operation, model })
  
  return promise
    .then(result => {
      metrics.llmCalls.inc({ operation, model, status: 'success' })
      return result
    })
    .catch(error => {
      metrics.llmCalls.inc({ operation, model, status: 'error' })
      throw error
    })
    .finally(() => {
      timer()
    })
}

// Трекинг интерпретаций
export function trackInterpretation(plan: string, status: 'success' | 'error') {
  metrics.interpretations.inc({ plan, status })
}

// Трекинг отчетов
export function trackReport(plan: string, type: string) {
  metrics.reports.inc({ plan, type })
}

// Трекинг заблокированных отчетов
export function trackBlockedReport(plan: string, reason: string) {
  metrics.reportsBlocked.inc({ plan, reason })
}

// Трекинг стоимости LLM
export function trackLLMCost(operation: string, model: string, costUsd: number) {
  metrics.llmCost.inc({ operation, model }, costUsd)
}

// Трекинг кэша пользователей
export function trackUserCacheHit() {
  metrics.userCacheHits.inc()
}

export function trackUserCacheMiss() {
  metrics.userCacheMisses.inc()
}

// Трекинг rate limiting
export function trackRateLimit(feature: string, userPlan: string) {
  metrics.rateLimitHits.inc({ feature, user_plan: userPlan })
}

// Трекинг ошибок
export function trackError(errorType: string, operation: string) {
  metrics.errors.inc({ error_type: errorType, operation })
}

// HTTP endpoint для метрик
export function setupMetricsEndpoint(app: any) {
  if (config.METRICS_ENABLED) {
    app.get('/metrics', async (req: any, res: any) => {
      res.set('Content-Type', register.contentType)
      res.end(await register.metrics())
    })
  }
}

// Периодическое обновление активных пользователей
export function startMetricsCollection() {
  if (!config.METRICS_ENABLED) return
  
  // Обновляем метрики каждые 5 минут
  setInterval(async () => {
    try {
      // Здесь можно добавить сбор метрик из БД
      // Например, количество активных пользователей за разные периоды
    } catch (error) {
      console.error('Failed to collect metrics:', error)
    }
  }, 5 * 60 * 1000)
}
