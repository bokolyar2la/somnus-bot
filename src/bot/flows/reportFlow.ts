// src/bot/flows/reportFlow.ts
import type { Bot } from 'grammy'
import { InlineKeyboard } from 'grammy'
import { generateReportSummary } from '../../core/llm.js'
import { isPaidPlan } from '../../core/pricing.js'
import {
	addKeywordToLatestEntry,
	getDreamsForExport,
	getLastDream,
	getOrCreateUser,
	getFirstDreamDate,
	updateUser,
} from '../../db/repo.js'
import type { MyContext } from '../helpers/state.js'
import { calculateDreamStreak } from '../helpers/profile.js'

const PAGE_SIZE = 5 as const

/** Экранируем HTML */
function esc(s: string): string {
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
}

/** Читаем LLM JSON из разных возможных полей */
function readLlm(d: any): any {
	if (d?.llmJson && typeof d.llmJson === 'object') return d.llmJson
	if (typeof d?.llmJsonText === 'string') {
		try {
			return JSON.parse(d.llmJsonText)
		} catch {}
	}
	return {}
}

/** Разбор строки keywords в множество */
function parseKeywordsToSet(keywords: string | null | undefined): Set<string> {
	const set = new Set<string>()
	if (!keywords) return set
	for (const raw of keywords.split(',')) {
		const v = raw.trim()
		if (v) set.add(v)
	}
	return set
}

/** YYYY-MM-DD в tz */
function ymdInTz(date: Date, tz: string): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: tz,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(date)
}

/** YYYY-MM в tz */
function ymInTz(date: Date, tz: string): string {
	return ymdInTz(date, tz).slice(0, 7)
}

/** Проверка, является ли пользователь админом */
function isAdmin(userId: string): boolean {
	// Add admin user IDs here
	const adminIds = ['123456789'] // Replace with actual admin IDs
	return adminIds.includes(userId)
}

/** Форматирование даты для отображения (DD.MM) */
function formatDateRange(startDate: Date, endDate: Date, tz: string): string {
	const formatter = new Intl.DateTimeFormat('ru-RU', {
		timeZone: tz,
		day: '2-digit',
		month: '2-digit'
	})
	const start = formatter.format(startDate)
	const end = formatter.format(endDate)
	return `${start}–${end}`
}

/** Вычисление дней до следующего доступного отчёта */
function getDaysUntilNextReport(lastReportAt: Date, tz: string): number {
	const now = new Date()
	const nowLocal = new Date(now.toLocaleString('en-US', { timeZone: tz || 'UTC' }))
	const lastReportLocal = new Date(lastReportAt.toLocaleString('en-US', { timeZone: tz || 'UTC' }))
	
	const daysSinceLastReport = Math.floor((nowLocal.getTime() - lastReportLocal.getTime()) / (1000 * 60 * 60 * 24))
	return Math.max(0, 7 - daysSinceLastReport)
}

/** Границы 7-дневного периода в локальном TZ + человекочитаемый диапазон */
function getLocal7dBounds(tz: string) {
	const now = new Date()
	const nowLocal = new Date(
		now.toLocaleString('en-US', { timeZone: tz || 'UTC' })
	)

	const startLocal = new Date(nowLocal)
	startLocal.setHours(0, 0, 0, 0)
	startLocal.setDate(startLocal.getDate() - 6) // сегодня и 6 дней назад

	const endLocal = new Date(nowLocal)
	endLocal.setHours(23, 59, 59, 999)

	// Обратно в UTC — удобно для сравнения с полями, если они в UTC
	const startUtc = new Date(
		startLocal.toLocaleString('en-US', { timeZone: 'UTC' })
	)
	const endUtc = new Date(endLocal.toLocaleString('en-US', { timeZone: 'UTC' }))

	const humanRange = {
		from: startLocal.toLocaleDateString('ru-RU'),
		to: endLocal.toLocaleDateString('ru-RU'),
	}

	return { startUtc, endUtc, humanRange, startLocal, endLocal }
}

/** Состояния доступности отчёта */
type ReportAvailabilityState = {
	state: 'S0' | 'S1' | 'S2' | 'S3' | 'S4'
	message: string
	canGenerate: boolean
	daysProgress?: number
	totalDays?: number
	nextAvailableDate?: string
}

/** Проверка доступности отчёта */
async function checkReportAvailability(userId: string, userTgId: string): Promise<ReportAvailabilityState> {
	const user = await getOrCreateUser(userTgId)
	const tz = user.timezone || 'UTC'
	const isPaid = isPaidPlan(user.plan)
	const isUserAdmin = isAdmin(userTgId)
	
	// Админ-байпас
	if (isUserAdmin) {
		const { humanRange } = getLocal7dBounds(tz)
		return {
			state: 'S2',
			message: `Готов собрать отчёт за последние 7 дней (${humanRange.from}–${humanRange.to}).`,
			canGenerate: true
		}
	}
	
	// Проверяем наличие снов
	const firstDreamDate = await getFirstDreamDate(userId)
	if (!firstDreamDate) {
		return {
			state: 'S0',
			message: 'Пока нет записей — начните с первого сна, и я подготовлю первый отчёт 📝',
			canGenerate: false
		}
	}
	
	// Проверяем, прошло ли 7 дней с первого сна
	const now = new Date()
	const nowLocal = new Date(now.toLocaleString('en-US', { timeZone: tz }))
	const firstDreamLocal = new Date(firstDreamDate.toLocaleString('en-US', { timeZone: tz }))
	const daysSinceFirst = Math.floor((nowLocal.getTime() - firstDreamLocal.getTime()) / (1000 * 60 * 60 * 24))
	
	if (daysSinceFirst < 7) {
		return {
			state: 'S1',
			message: `Прошло ${daysSinceFirst}/7 дней с первого сна. ${daysSinceFirst === 6 ? 'Завтра' : `Через ${7 - daysSinceFirst} дней`} будет доступен первый отчёт ✨`,
			canGenerate: false,
			daysProgress: daysSinceFirst,
			totalDays: 7
		}
	}
	
	const currentMonth = ymInTz(now, tz)
	const { humanRange } = getLocal7dBounds(tz)
	
	if (isPaid) {
		// Для платных пользователей: проверяем 7-дневный лимит
		if ((user as any).lastReportAt) {
			const daysUntilNext = getDaysUntilNextReport((user as any).lastReportAt, tz)
			if (daysUntilNext > 0) {
				return {
					state: 'S4',
					message: `Отчёт уже получен недавно. Новый будет доступен через ${daysUntilNext} ${daysUntilNext === 1 ? 'день' : daysUntilNext < 5 ? 'дня' : 'дней'}.`,
					canGenerate: false
				}
			}
		}
		return {
			state: 'S2',
			message: `Готов собрать отчёт за последние 7 дней (${humanRange.from}–${humanRange.to}).`,
			canGenerate: true
		}
	} else {
		// Для бесплатных пользователей: проверяем месячный лимит
		if ((user as any).lastReportMonth === currentMonth) {
			const nextMonth = new Date(now)
			nextMonth.setMonth(nextMonth.getMonth() + 1, 1)
			nextMonth.setHours(0, 0, 0, 0)
			const nextMonthStr = nextMonth.toLocaleDateString('ru-RU', {
				timeZone: tz,
				day: '2-digit',
				month: '2-digit'
			})
			return {
				state: 'S3',
				message: `В бесплатной версии отчёт доступен 1 раз в месяц 🙂\nСледующий отчёт можно получить с ${nextMonthStr}.`,
				canGenerate: false,
				nextAvailableDate: nextMonthStr
			}
		}
		return {
			state: 'S2',
			message: `Готов собрать отчёт за последние 7 дней (${humanRange.from}–${humanRange.to}).`,
			canGenerate: true
		}
	}
}

/** Экран-заглушка с проверкой доступности отчёта */
async function renderReportPlaceholder(ctx: MyContext) {
	const userId = ctx.from!.id.toString()
	const userTgId = ctx.from!.id.toString()
	const user = await getOrCreateUser(userTgId)
	const tz = user.timezone || 'UTC'
	const isTimezoneEmpty = !user.timezone
	
	const availability = await checkReportAvailability(user.id, userTgId)
	const { humanRange } = getLocal7dBounds(tz)
	
	let html = `<b>📋 Отчёт за 7 дней</b>\n\n`
	html += `Дата диапазона: ${humanRange.from}–${humanRange.to}\n\n`
	
	// Добавляем предупреждение о таймзоне если она не указана
	if (isTimezoneEmpty) {
		html += `⏰ Укажите свою таймзону в профиле для корректных дат\n\n`
	}
	
	html += availability.message
	
	const kb = new InlineKeyboard()
	
	// Основная кнопка генерации отчёта
	if (availability.canGenerate) {
		kb.text('🧾 Получить отчёт за 7 дней', 'report:generate:7')
	}
	
	// Вторичные кнопки в зависимости от состояния
	switch (availability.state) {
		case 'S0':
			kb.row().text('✍ Записать сон', 'sleep:start')
			kb.row().text('📔 Дневник', 'analytics:tab:journal')
			break
			
		case 'S1':
			kb.row().text('✍ Записать сон', 'sleep:start')
			kb.row().text('📔 Дневник', 'analytics:tab:journal')
			kb.row().text('🔔 Напоминания', 'profile:reminders')
			break
			
		case 'S2':
			kb.row().text('✍ Записать сон', 'sleep:start')
			kb.row().text('📔 Дневник', 'analytics:tab:journal')
			break
			
		case 'S3':
			kb.row().text('🔓 Оформить подписку', 'pay:open')
			kb.row().text('📔 Дневник', 'analytics:tab:journal')
			kb.row().text('✍ Записать сон', 'sleep:start')
			break
			
		case 'S4':
			kb.row().text('📔 Дневник', 'analytics:tab:journal')
			kb.row().text('✍ Записать сон', 'sleep:start')
			break
	}
	
	// Кнопка изменения таймзоны если она не указана
	if (isTimezoneEmpty) {
		kb.row().text('⏰ Изменить таймзону', 'profile:timezone:menu')
	}
	
	await ctx.reply(html, { parse_mode: 'HTML', reply_markup: kb })
}

/** --------- 7-дневный отчёт --------- */
async function renderSevenDayReport(ctx: MyContext) {
	const userId = ctx.from!.id.toString()
	const userTgId = ctx.from!.id.toString()
	const user = await getOrCreateUser(userTgId)
	
	// Повторная проверка доступности (дедупликация)
	const availability = await checkReportAvailability(user.id, userTgId)
	if (!availability.canGenerate) {
		await renderReportPlaceholder(ctx)
		return
	}
	
	// Use UTC as default if timezone is not set
	const tz = user.timezone || 'UTC'
	const isTimezoneEmpty = !user.timezone
	const { startUtc, endUtc, humanRange } = getLocal7dBounds(tz)

	// Берём все сны пользователя и фильтруем в коде (если repo не умеет диапазоны)
	const allDreams = await getDreamsForExport(user.id)
	const dreamsInPeriod = allDreams.filter(d => {
		const base = d.sleptAt ? new Date(d.sleptAt) : new Date(d.createdAt)
		return base >= startUtc && base <= endUtc
	})
	const hasAnyDreams = allDreams.length > 0

	// Гейтинг (free: 1/месяц)
	if (!isPaidPlan(user.plan)) {
		const monthKey = `weekly_issued:${ymInTz(new Date(), tz)}`
		const latest = await getLastDream(user.id)
		if (latest) {
			const kwSet = parseKeywordsToSet(latest.keywords)
			if (kwSet.has(monthKey)) {
				const kb = new InlineKeyboard().text('🔓 Оформить подписку', 'pay:open')
				await ctx.reply(
					'В бесплатной версии отчёт за 7 дней доступен 1 раз в месяц 🙂\nОформите подписку, чтобы смотреть аналитику в любой момент.',
					{ reply_markup: kb }
				)
				return
			}
		}
	}

	// Нет записей в окне 7 дней
	if (dreamsInPeriod.length === 0) {
		const kb = new InlineKeyboard().text('✍ Записать сон', 'sleep:start')
		if (hasAnyDreams) {
			kb.row().text('📔 Дневник', 'analytics:tab:journal')
			await ctx.reply(
				`За последние 7 дней (${humanRange.from}–${humanRange.to}) записи не найдены в вашей таймзоне ${tz}.\nРанние записи — в «📔 Дневник».`,
				{ reply_markup: kb }
			)
		} else {
			await ctx.reply(
				`За последние 7 дней (${humanRange.from}–${humanRange.to}) записей пока нет.\nЗапишите хотя бы один сон — и вернитесь за отчётом ✨`,
				{ reply_markup: kb }
			)
		}
		return
	}

	// Счётчики
	const interped = dreamsInPeriod.filter(d => {
		const llm = readLlm(d)
		return !!(
			llm.short_title ||
			llm.esoteric_interpretation ||
			llm.barnum_insight
		)
	})

	const streak = calculateDreamStreak(dreamsInPeriod)

	// TOP-3 символов
	const symbolCounts: Record<string, number> = {}
	for (const d of dreamsInPeriod) {
		const llm = readLlm(d)
		const fromLlm = Array.isArray(llm.symbols_detected)
			? (llm.symbols_detected as string[])
			: []
		const fromRaw = d.symbolsRaw
			? String(d.symbolsRaw)
					.split(/[,;]/)
					.map(s => s.trim())
					.filter(Boolean)
			: []
		for (const s of [...fromLlm, ...fromRaw]) {
			const key = String(s).toLowerCase()
			if (!key) continue
			symbolCounts[key] = (symbolCounts[key] || 0) + 1
		}
	}
	const topSymbols = Object.entries(symbolCounts)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 3)
		.map(([symbol, count]) => ({ symbol, count }))

	// LLM summary (ожидается string)
	const periodDays = 7 as 7
	let llmSummary = 'Период спокойный, без ярко повторяющихся образов 🙂'
	try {
		const profileUser = await getOrCreateUser(userId)
		llmSummary = await generateReportSummary({
			periodDays,
			countDreams: dreamsInPeriod.length,
			countInterps: interped.length,
			streakMax: streak,
			topSymbols,
			plan: isPaidPlan(user.plan) ? 'paid' : 'free',
			profile: {
				stressLevel: profileUser.stressLevel ?? null,
				sleepGoal: profileUser.sleepGoal ?? null,
				chronotype: profileUser.chronotype ?? null,
			},
		})
	} catch {
		if (topSymbols.length >= 2) {
			llmSummary = `Период под знаком ${topSymbols[0].symbol} и ${topSymbols[1].symbol} — про внутреннее движение и мягкое переосмысление ✨`
		} else if (topSymbols.length === 1) {
			llmSummary = `Период под знаком ${topSymbols[0].symbol} — образ просит внимания ✨`
		}
	}

	// Сообщение
	let html = `<b>📈 Отчёт за 7 дней</b>\n\n`
	
	// Add timezone warning if timezone is empty
	if (isTimezoneEmpty) {
		html += `⚠️ Таймзона не указана, отчёт построен по UTC. Укажите таймзону в профиле для точности.\n\n`
	}
	
	html += `• Снов: ${dreamsInPeriod.length} • Разборов: ${interped.length} • Стрик: ${streak} дней\n\n`
	if (topSymbols.length) {
		html +=
			`ТОП-3 символов:\n` +
			topSymbols
				.map((s, i) => `${i + 1}) ${esc(s.symbol)} — ${s.count}`)
				.join('\n') +
			'\n\n'
	} else {
		html += `Символы пока не обнаружены.\n\n`
	}
	html += `Нить недели:\n${esc(llmSummary)}`

	const kb = new InlineKeyboard()
		.text('✍ Записать сон', 'sleep:start')
		.row()
		.text('📔 Дневник', 'analytics:tab:journal')
	
	// Add timezone change button if timezone is empty
	if (isTimezoneEmpty) {
		kb.row().text('⏰ Изменить таймзону', 'profile:timezone:menu')
	}
	
	if (!isPaidPlan(user.plan)) {
		kb.row().text('🔓 Оформить подписку', 'pay:open')
	}

	await ctx.reply(html, { parse_mode: 'HTML', reply_markup: kb })

	// Помечаем выдачу отчёта
	const now = new Date()
	if (isPaidPlan(user.plan)) {
		// Для платных пользователей: обновляем lastReportAt
		await updateUser(userTgId, { lastReportAt: now })
	} else {
		// Для бесплатных пользователей: обновляем lastReportMonth
		const currentMonth = ymInTz(now, tz)
		await updateUser(userTgId, { lastReportMonth: currentMonth })
	}
}

/** Публичные API */
export async function handleReportEntry(ctx: MyContext): Promise<void> {
	// Показываем экран-заглушку вместо прямой генерации отчёта
	await renderReportPlaceholder(ctx)
}

export function registerReportFlow(bot: Bot<MyContext>): void {
	bot.command('report', handleReportEntry)
	bot.callbackQuery('report:get:7', async ctx => {
		await ctx.answerCallbackQuery().catch(() => {})
		await handleReportEntry(ctx)
	})
	
	// Новый обработчик для генерации отчёта
	bot.callbackQuery('report:generate:7', async ctx => {
		await ctx.answerCallbackQuery().catch(() => {})
		await renderSevenDayReport(ctx)
	})
}

// Совместимость со старым именем
export const handleReportCommand = handleReportEntry
