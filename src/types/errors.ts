// src/types/errors.ts
import { logger } from '../util/logger.js'

export abstract class DomainError extends Error {
  abstract readonly code: string
  abstract readonly userMessage: string
  
  constructor(message: string, public readonly context?: Record<string, any>) {
    super(message)
    this.name = this.constructor.name
  }
}

export class LLMValidationError extends DomainError {
  readonly code = 'LLM_VALIDATION_FAILED'
  readonly userMessage = 'Не удалось обработать ответ ИИ. Попробуйте ещё раз.'
}

export class LLMTimeoutError extends DomainError {
  readonly code = 'LLM_TIMEOUT'
  readonly userMessage = 'ИИ слишком долго думает. Попробуйте ещё раз.'
}

export class TimezoneError extends DomainError {
  readonly code = 'INVALID_TIMEZONE'
  readonly userMessage = 'Неверная таймзона. Выберите из списка.'
}

export class TimeFormatError extends DomainError {
  readonly code = 'INVALID_TIME_FORMAT'
  readonly userMessage = 'Неверный формат времени. Используйте формат ЧЧ:ММ (например, 09:30).'
}

export class QuotaExceededError extends DomainError {
  readonly code = 'QUOTA_EXCEEDED'
  readonly userMessage = 'Лимит исчерпан. Оформите подписку для продолжения.'
}

export class RateLimitError extends DomainError {
  readonly code = 'RATE_LIMITED'
  readonly userMessage = 'Слишком много запросов. Подождите немного.'
}

export class DatabaseError extends DomainError {
  readonly code = 'DATABASE_ERROR'
  readonly userMessage = 'Временная проблема с базой данных. Попробуйте позже.'
}

export class ValidationError extends DomainError {
  readonly code = 'VALIDATION_ERROR'
  readonly userMessage = 'Некорректные данные. Проверьте введенную информацию.'
}

export class ReportNotAvailableError extends DomainError {
  readonly code = 'REPORT_NOT_AVAILABLE'
  readonly userMessage = 'Отчёт пока недоступен. Проверьте условия получения.'
}

// Маппер для пользователей
export function mapErrorToUserMessage(error: Error): string {
  if (error instanceof DomainError) {
    return error.userMessage
  }
  
  // Специальные случаи для системных ошибок
  if (error.message?.includes('timeout')) {
    return 'Превышено время ожидания. Попробуйте ещё раз.'
  }
  
  if (error.message?.includes('network') || error.message?.includes('fetch')) {
    return 'Проблемы с сетью. Проверьте подключение и попробуйте позже.'
  }
  
  // Логируем неожиданные ошибки
  logger.error({ err: error }, 'Unmapped error occurred')
  return 'Произошла техническая ошибка. Попробуйте позже.'
}

// Хелпер для безопасного выполнения операций
export async function safeExecute<T>(
  operation: () => Promise<T>,
  fallbackMessage?: string
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof DomainError) {
      throw error
    }
    
    // Оборачиваем системные ошибки в доменные
    const message = fallbackMessage || mapErrorToUserMessage(error as Error)
    throw new ValidationError(message, { originalError: error })
  }
}
