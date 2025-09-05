import { z } from 'zod'
import * as dotenv from 'dotenv'

dotenv.config()

const configSchema = z.object({
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  BOT_TOKEN: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default('gpt-3.5-turbo'),
  ADMIN_IDS: z.string().transform(str => new Set(str.split(',').map(id => id.trim()))),
  
  // Feature flags
  REPORT_V2: z.string().transform(str => str === 'true').default('false'),
  METRICS_ENABLED: z.string().transform(str => str === 'true').default('false'),
  DB_MAINTENANCE: z.string().transform(str => str === 'true').default('true'),
  BACKUP_ENABLED: z.string().transform(str => str === 'true').default('false'),
  
  // Rate limits
  LLM_RATE_LIMIT_PER_MINUTE: z.string().transform(str => parseInt(str)).default('5'),
  REPORT_RATE_LIMIT_PER_HOUR: z.string().transform(str => parseInt(str)).default('2'),
  
  // Budget controls
  DAILY_BUDGET_USD: z.string().transform(str => parseFloat(str)).default('10'),
  BUDGET_WARNING_THRESHOLD: z.string().transform(str => parseFloat(str)).default('80'),
  
  // Backup settings
  BACKUP_PATH: z.string().default('./backups'),
})

export type Config = z.infer<typeof configSchema>

function validateConfig(): Config & { features: any; backup: any; budget: any } {
	try {
		const baseConfig = configSchema.parse({
			BOT_TOKEN: process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '',
			OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
			OPENAI_MODEL: process.env.OPENAI_MODEL,
			ADMIN_IDS: process.env.ADMIN_IDS,
			REPORT_V2: process.env.REPORT_V2,
			METRICS_ENABLED: process.env.METRICS_ENABLED,
			DB_MAINTENANCE: process.env.DB_MAINTENANCE,
			BACKUP_ENABLED: process.env.BACKUP_ENABLED,
			LLM_RATE_LIMIT_PER_MINUTE: process.env.LLM_RATE_LIMIT_PER_MINUTE,
			REPORT_RATE_LIMIT_PER_HOUR: process.env.REPORT_RATE_LIMIT_PER_HOUR,
			LOG_LEVEL: process.env.LOG_LEVEL,
			DAILY_BUDGET_USD: process.env.DAILY_BUDGET_USD,
			BUDGET_WARNING_THRESHOLD: process.env.BUDGET_WARNING_THRESHOLD,
			BACKUP_PATH: process.env.BACKUP_PATH,
		})
		
		// Добавляем структурированные объекты для удобства
		return {
			...baseConfig,
			features: {
				reportV2: baseConfig.REPORT_V2,
				metrics: baseConfig.METRICS_ENABLED,
				dbMaintenance: baseConfig.DB_MAINTENANCE,
			},
			backup: {
				enabled: baseConfig.BACKUP_ENABLED,
				path: baseConfig.BACKUP_PATH,
			},
			budget: {
				dailyLimitUsd: baseConfig.DAILY_BUDGET_USD,
				warningThreshold: baseConfig.BUDGET_WARNING_THRESHOLD,
			},
		}
	} catch (error) {
		console.error('❌ Invalid configuration:')
		if (error instanceof z.ZodError) {
			error.errors.forEach(err => {
				console.error(`  ${err.path.join('.')}: ${err.message}`)
			})
		}
		process.exit(1)
	}
}

export const config = validateConfig()

// Экспорт для обратной совместимости
export const BOT_TOKEN = config.BOT_TOKEN
export const OPENAI_API_KEY = config.OPENAI_API_KEY
export const ADMIN_IDS = Array.from(config.ADMIN_IDS) // Конвертируем Set обратно в массив для совместимости
