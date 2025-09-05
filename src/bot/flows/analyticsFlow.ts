import type { Bot } from 'grammy'
import { InlineKeyboard } from 'grammy'
import { getDreamsForExport, getOrCreateUser } from '../../db/repo.js'
import { calculateDreamStreak } from '../helpers/profile.js'
import type { MyContext } from '../helpers/state.js'

const PAGE_SIZE = 5

/** Верхнее меню вкладок */
function tabsKb() {
	return new InlineKeyboard()
		.text('📔 Дневник', 'analytics:tab:journal')
		.text('📈 Символы', 'analytics:tab:symbols')
		.text('🏆 Достижения', 'analytics:tab:achievements')
}

function isPaidPlan(plan: string | null | undefined): boolean {
	return plan === 'lite' || plan === 'pro' || plan === 'premium'
}

/** Безопасный HTML-эскейп */
function esc(s: string) {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Вытащить объект LLM (учитываем возможные варианты хранения) */
function readLlm(d: any): any {
	// в проекте встречались поля llmJson и llmJsonText
	if (d.llmJson && typeof d.llmJson === 'object') return d.llmJson
	if (typeof d.llmJsonText === 'string') {
		try {
			return JSON.parse(d.llmJsonText)
		} catch {
			/* ignore */
		}
	}
	return d.llmJsonText && typeof d.llmJsonText === 'object' ? d.llmJsonText : {}
}

/** --------- Вкладка: Дневник --------- */
async function renderJournalTab(ctx: MyContext, page = 0) {
	const userId = ctx.from!.id.toString()
	const user = await getOrCreateUser(userId)

	// предположим, getDreamsForExport вернёт от новых к старым; нам удобно именно так
	const dreams = await getDreamsForExport(user.id)
	const totalPages = Math.max(1, Math.ceil(dreams.length / PAGE_SIZE))
	const start = page * PAGE_SIZE
	const slice = dreams.slice(start, start + PAGE_SIZE)

	let html = '<b>📔 Дневник снов</b>\n\n'
	if (!slice.length) {
		html += 'У вас пока нет записей.'
	} else {
		html += 'Выберите запись:\n\n'
	}

	const kb = new InlineKeyboard()

	for (const d of slice) {
		const llm = readLlm(d)
		const title = llm.short_title ? String(llm.short_title) : `Запись ${d.id}`
		const date = new Date(d.createdAt).toLocaleDateString('ru-RU', {
			timeZone: user.timezone ?? 'UTC',
		})
		// одна кнопка в строке на каждую запись
		kb.row().text(`${date} — ${title}`.slice(0, 64), `analytics:entry:${d.id}`)
	}

	// пагинация
	kb.row()
	if (page > 0) kb.text('◀️ Назад', `analytics:journal:${page - 1}`)
	kb.text(
		`Стр ${Math.min(page + 1, totalPages)} из ${totalPages}`,
		'analytics:tab:journal'
	)
	if (page < totalPages - 1)
		kb.text('Вперёд ▶️', `analytics:journal:${page + 1}`)

	// вкладки сверху как отдельным сообщением не шлём — компактнее добавить ещё строку
	kb.row()
		.text('📔 Дневник', 'analytics:tab:journal')
		.text('📈 Символы', 'analytics:tab:symbols')
		.text('🏆 Достижения', 'analytics:tab:achievements')

	await ctx.reply(html, { parse_mode: 'HTML', reply_markup: kb })
}

async function onJournalOpen(ctx: MyContext) {
	ctx.session.analyticsJournalPage = 0
	await renderJournalTab(ctx, 0)
}

async function onJournalPage(ctx: MyContext) {
	const page = parseInt(ctx.match![1], 10)
	ctx.session.analyticsJournalPage = page
	await renderJournalTab(ctx, page)
}

async function onJournalEntry(ctx: MyContext) {
	const entryId = ctx.match![1]
	const userId = ctx.from!.id.toString()
	const user = await getOrCreateUser(userId)
	const all = await getDreamsForExport(user.id)
	const d = all.find(x => x.id === entryId)

	if (!d) {
		await ctx.reply('Сон не найден.')
		return
	}

	const llm = readLlm(d)
	const title = llm.short_title ? String(llm.short_title) : `Запись ${d.id}`

	const html =
		`<b>${esc(title)}</b>\n\n` +
		`<b>Текст сна:</b> ${esc(String(d.text ?? ''))}\n\n` +
		(Array.isArray(llm.symbols_detected) && llm.symbols_detected.length
			? `<b>Символы:</b> ${esc(llm.symbols_detected.join(', '))}\n\n`
			: '') +
		(llm.barnum_insight
			? `<b>Инсайт:</b> ${esc(String(llm.barnum_insight))}\n\n`
			: '') +
		(llm.esoteric_interpretation
			? `<b>Трактовка:</b> ${esc(String(llm.esoteric_interpretation))}\n\n`
			: '') +
		(llm.reflective_question
			? `<b>Вопрос для размышления:</b> ${esc(
					String(llm.reflective_question)
			  )}\n\n`
			: '') +
		(Array.isArray(llm.gentle_advice) && llm.gentle_advice.length
			? `<b>Мягкие шаги:</b>\n` +
			  llm.gentle_advice
					.map((s: string, i: number) => `${i + 1}. ${esc(s)}`)
					.join('\n')
			: '')

	await ctx.reply(html, { parse_mode: 'HTML', reply_markup: tabsKb() })
}

/** --------- Вкладка: Символы и эмоции --------- */
async function renderSymbolsTab(ctx: MyContext) {
	const userId = ctx.from!.id.toString()
	const user = await getOrCreateUser(userId)
	const dreams = await getDreamsForExport(user.id)

	const now = new Date()
	const days = isPaidPlan(user.plan) ? 30 : 7
	const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

	const recent = dreams.filter(d => new Date(d.createdAt) >= from)

	const symbolCounts: Record<string, number> = {}
	for (const d of recent) {
		const llm = readLlm(d)
		const symbols: string[] = Array.isArray(llm.symbols_detected)
			? llm.symbols_detected
			: d.symbolsRaw
			? String(d.symbolsRaw)
					.split(',')
					.map((s: string) => s.trim())
					.filter(Boolean)
			: []
		for (const s of symbols) {
			symbolCounts[s] = (symbolCounts[s] || 0) + 1
		}
	}

	const topN = isPaidPlan(user.plan) ? 10 : 3
	const top = Object.entries(symbolCounts)
		.sort((a, b) => b[1] - a[1])
		.slice(0, topN)

	const interpreted = recent.filter(d => {
		const llm = readLlm(d)
		return (
			llm &&
			(llm.short_title || llm.esoteric_interpretation || llm.barnum_insight)
		)
	})

	const streak = calculateDreamStreak(recent)

	let html =
		`<b>📈 Обзор за ${days} дней${
			isPaidPlan(user.plan) ? '' : ' (бесплатный)'
		}</b>\n\n` +
		`• Снов записано: ${recent.length}\n` +
		`• Разборов сделано: ${interpreted.length}\n` +
		`• Стрик (макс): ${streak} дней подряд\n\n`

	if (top.length) {
		html +=
			`ТОП-${top.length} символов:\n` +
			top.map(([s, n], i) => `${i + 1}) ${esc(s)} — ${n}`).join('\n')
	} else {
		html += `Символы пока не обнаружены.`
	}

	const kb = new InlineKeyboard()
		.text('📔 Дневник', 'analytics:tab:journal')
		.text('📈 Символы', 'analytics:tab:symbols')
		.text('🏆 Достижения', 'analytics:tab:achievements')

	if (!isPaidPlan(user.plan)) {
		kb.row().text('🔓 Оформить подписку', 'pay:open')
		html += `\n\nХотите полный обзор, больше символов и динамику? Оформите подписку.`
	}

	await ctx.reply(html, { parse_mode: 'HTML', reply_markup: kb })
}

async function onSymbolsOpen(ctx: MyContext) {
	await renderSymbolsTab(ctx)
}

/** --------- Вкладка: Достижения --------- */
async function renderAchievementsTab(ctx: MyContext) {
	const userId = ctx.from!.id.toString()
	const user = await getOrCreateUser(userId)
	const dreams = await getDreamsForExport(user.id)

	const firstDreamAchieved = dreams.length >= 1
	const streak = calculateDreamStreak(dreams)
	const sevenDayStreakAchieved = streak >= 7
	const tenInterpretationsAchieved = (user.monthlyCount ?? 0) >= 10 // приближение
	const threeFollowupsAchieved = (ctx.session.followupsUsed ?? 0) >= 3 // приближение
	const premiumResearcherAchieved = isPaidPlan(user.plan)

	const html =
		`<b>🏆 Достижения</b>\n\n` +
		`📝 <b>Первый сон:</b> ${
			firstDreamAchieved ? 'Получено' : 'Не получено'
		} (записан ≥1 сон)\n` +
		`📅 <b>7 подряд:</b> ${
			sevenDayStreakAchieved ? 'Получено' : 'Не получено'
		} (стрик ≥7 дней)\n` +
		`🌙 <b>10 разборов:</b> ${
			tenInterpretationsAchieved ? 'Получено' : 'Не получено'
		} (≥10 разборов за месяц)\n` +
		`💭 <b>Мыслитель:</b> ${
			threeFollowupsAchieved ? 'Получено' : 'Не получено'
		} (≥3 уточнения)\n` +
		`🔒 <b>Премиум‑исследователь:</b> ${
			premiumResearcherAchieved ? 'Получено' : 'Не получено'
		} (оформите подписку)\n`

	await ctx.reply(html, { parse_mode: 'HTML', reply_markup: tabsKb() })
}

async function onAchievementsOpen(ctx: MyContext) {
	await renderAchievementsTab(ctx)
}

export async function handleAnalyticsCommand(ctx: MyContext) {
	await onJournalOpen(ctx) // по умолчанию открываем дневник
}

export function registerAnalyticsFlow(bot: Bot<MyContext>): void {
	bot.callbackQuery('analytics:tab:journal', async ctx => {
		await ctx.answerCallbackQuery().catch(() => {})
		await onJournalOpen(ctx)
	})

	bot.callbackQuery(/^analytics:journal:(\d+)$/, async ctx => {
		await ctx.answerCallbackQuery().catch(() => {})
		await onJournalPage(ctx)
	})

	bot.callbackQuery(/^analytics:entry:(.+)$/, async ctx => {
		await ctx.answerCallbackQuery().catch(() => {})
		await onJournalEntry(ctx)
	})

	bot.callbackQuery('analytics:tab:symbols', async ctx => {
		await ctx.answerCallbackQuery().catch(() => {})
		await onSymbolsOpen(ctx)
	})

	bot.callbackQuery('analytics:tab:achievements', async ctx => {
		await ctx.answerCallbackQuery().catch(() => {})
		await onAchievementsOpen(ctx)
	})
}

