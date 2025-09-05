// src/bot/flows/practiceFlow.ts
import type { Bot } from 'grammy'
import { InlineKeyboard } from 'grammy'
import { generatePractice } from '../../core/llm.js'
import { isPaidPlan } from '../../core/pricing.js'
import {
	getDreamEntryById,
	getOrCreateUser,
	updateDreamEntryKeywords,
} from '../../db/repo.js'
import { logger } from '../../util/logger.js'
import type { MyContext } from '../helpers/state.js'

/** YYYY-MM-DD в tz (или UTC при её отсутствии) */
function ymdInTz(date: Date, tz?: string | null): string {
	// en-CA даёт формат YYYY-MM-DD
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: tz ?? 'UTC',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(date)
}
/** YYYY-MM в tz (или UTC) */
function ymInTz(date: Date, tz?: string | null): string {
	return ymdInTz(date, tz).slice(0, 7)
}

/** Нормализуем keywords-строку в Set */
function parseKeywordsToSet(keywords: string | null | undefined): Set<string> {
	const set = new Set<string>()
	if (!keywords) return set
	for (const raw of keywords.split(',')) {
		const v = raw.trim()
		if (v) set.add(v)
	}
	return set
}

export function registerPracticeFlow(bot: Bot<MyContext>): void {
	bot.callbackQuery(/^practice:(interpret|followup):(.+)$/, async ctx => {
		await ctx.answerCallbackQuery().catch(() => {})

		const userId = String(ctx.from?.id ?? '')
		if (!userId) return

		const source = ctx.match![1] as 'interpret' | 'followup'
		const entryId = ctx.match![2]

		// Пользователь
		const user = await getOrCreateUser(userId)

		// Запись сна
		const dreamEntry = await getDreamEntryById(entryId)
		if (!dreamEntry || dreamEntry.userId !== user.id) {
			await ctx.reply('Запись сна для практики не найдена или недоступна.')
			return
		}

		// Ключи лимитов (с учётом TZ или UTC по умолчанию)
		const todayYMD = ymdInTz(new Date(), user.timezone)
		const dayKey = `practice_issued:${todayYMD}`
		const monthKey = `practice_issued:${ymInTz(new Date(), user.timezone)}`

		const kwSet = parseKeywordsToSet(dreamEntry.keywords)
		const paid = isPaidPlan(user.plan)

		// Проверка лимитов
		if (paid) {
			// Платные — 1 раз в день
			if (kwSet.has(dayKey)) {
				await ctx.reply(
					'Сегодня практика уже выдавалась. Возвращайтесь завтра ✨'
				)
				return
			}
		} else {
			// Бесплатные — 1 раз в месяц
			if (kwSet.has(monthKey)) {
				const kb = new InlineKeyboard().text('🔓 Оформить подписку', 'pay:open')
				await ctx.reply(
					'В бесплатной версии духовная практика доступна 1 раз в месяц 💫',
					{
						reply_markup: kb,
					}
				)
				return
			}
		}

		// Генерация практики (безопасные значения)
		const interpretation = dreamEntry.llmJsonText ?? ''
		const entryText = dreamEntry.text ?? ''
		let practiceContent = ''
		try {
			practiceContent = await generatePractice({
				entry_text: entryText,
				interpretation,
			})
		} catch (e) {
			logger.error({ err: e, entryId }, 'generatePractice failed')
			await ctx.reply(
				'Не удалось подготовить практику. Попробуйте снова чуть позже.'
			)
			return
		}

		// Ответ пользователю
		await ctx.reply(`✨ Духовная практика\n\n${practiceContent}`)

		// Проставляем маркер в keywords и сохраняем
		kwSet.add(paid ? dayKey : monthKey)
		const newKeywords = Array.from(kwSet).join(', ')
		await updateDreamEntryKeywords(entryId, newKeywords)

		logger.info(
			`Practice issued: userId=${userId}, entryId=${entryId}, key=${
				paid ? dayKey : monthKey
			}, source=${source}`
		)
	})
}
