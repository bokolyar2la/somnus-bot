import pino from "pino"
import { randomUUID } from 'crypto'
import type { MyContext } from '../bot/helpers/state.js'

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  serializers: { 
    err: pino.stdSerializers.err 
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
})

export function createCorrelationId(): string {
  return randomUUID()
}

export function withCorrelationId(ctx: MyContext) {
  if (!ctx.session.correlationId) {
    ctx.session.correlationId = createCorrelationId()
  }
  
  return logger.child({ 
    correlationId: ctx.session.correlationId,
    userId: ctx.from?.id 
  })
}

// Для использования в LLM/DB вызовах
export function getCorrelationLogger(correlationId: string, additionalContext?: Record<string, any>) {
  return logger.child({ 
    correlationId, 
    ...additionalContext 
  })
}
