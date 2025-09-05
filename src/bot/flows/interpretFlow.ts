// src/bot/flows/interpretFlow.ts
import type { Bot } from 'grammy'
import { InlineKeyboard } from 'grammy'
import { interpretDream } from '../../core/llm.js'
import {
	canAskFollowup,
	canInterpret,
	getMonthlyFollowups,
	getMonthlyQuota,
} from '../../core/pricing.js'
import {
	clearKeyword,
	ensureMonthlyReset,
	getDreamEntryById,
	getLastDream,
	getOrCreateUser,
	incMonthlyCount,
	saveEntryCost,
	saveInterpretation,
	updateUser,
} from '../../db/repo.js'
import { isAdmin } from '../../util/auth.js'
import { estimateCostRub } from '../../util/cost.js'
import { logger } from '../../util/logger.js'
import { isProfileComplete } from '../helpers/profile.js'
import type { MyContext } from '../helpers/state.js'

/* ----------------------------- helpers ----------------------------- */

function shouldNudgeProfile(session: MyContext['session']): boolean {
	const iso = session.onboarding?.lastProfileNudgeAt
	if (!iso) return true
	const last = new Date(iso).getTime()
	const now = Date.now()
	// не чаще раза в 24 часа
	return now - last > 24 * 60 * 60 * 1000
}

/** Экранируем HTML */
const esc = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/* ----------------------- основная логика разбора --------------------- */

async function runInterpretation(
	ctx: MyContext,
	entryId: string,
	userId: string
) {
	let user = await getOrCreateUser(userId)
	const dreamEntry = await getDreamEntryById(entryId)

	if (!dreamEntry) {
		await ctx.reply('Запись сна не найдена или устарела. Используйте /sleep.')
		return
	}

	// НИЧЕГО не блокируем по профилю/таймзоне — всегда делаем разбор
	await ctx.reply('🔮 Готовлю разбор... это может занять несколько секунд.')

	try {
		// месячный сброс счётчика
		await ensureMonthlyReset(user.id)
		user = await getOrCreateUser(userId)

		// лимиты интерпретаций (админ — без ограничений)
		if (!isAdmin(ctx.from?.id)) {
			const plan = (user.plan as any) ?? 'free'
			const used = user.monthlyCount ?? 0
			if (!canInterpret(plan, used)) {
				const total = getMonthlyQuota(plan)
				const left = Math.max(0, total - used)
				const kb = new InlineKeyboard().text('🔓 Оформить подписку', 'pay:open')
				await ctx.reply(
					`Ваш месячный лимит разборов исчерпан.\nПлан: ${plan}\nИспользовано: ${used}/${total}\nОсталось: ${left}`,
					{ reply_markup: kb }
				)
				return
			}
		}

		// если была метка ожидания профиля — снять
		if (dreamEntry.keywords?.includes('awaiting_profile')) {
			await clearKeyword(entryId, 'awaiting_profile')
		}

		const payload = {
			profile: {
				timezone: user.timezone ?? 'UTC',
				ageBand: (user.ageBand ?? undefined) as any,
				chronotype: (user.chronotype ?? undefined) as any,
				tone: 'poetic' as const,
				esotericaLevel: user.esotericaLevel ?? 50,
				sleepGoal: (user.sleepGoal ?? undefined) as any,
				wakeTime: user.wakeTime ?? undefined,
				sleepTime: user.sleepTime ?? undefined,
				stressLevel: user.stressLevel ?? undefined,
				dreamFrequency: (user.dreamFrequency ?? undefined) as any,
			},
			dream_text: dreamEntry.text,
			user_symbols: dreamEntry.symbolsRaw
				? dreamEntry.symbolsRaw
						.split(',')
						.map(s => s.trim())
						.filter(Boolean)
				: undefined,
		}

		const out = await interpretDream(payload)

		// токены/стоимость
		const tokensIn = (out as any).usage?.prompt_tokens ?? 500
		const tokensOut = (out as any).usage?.completion_tokens ?? 700
		const costRub = estimateCostRub(tokensIn, tokensOut)

		// сохранить результат
		await saveInterpretation(dreamEntry.id, { llmJson: out })
		await saveEntryCost(dreamEntry.id, tokensIn, tokensOut, costRub)
		await incMonthlyCount(user.id)

		const html =
			`<b>${esc(out.short_title)}</b>\n\n` +
			`<b>Символы:</b> ${esc(out.symbols_detected.join(', '))}\n\n` +
			`<b>Инсайт:</b> ${esc(out.barnum_insight)}\n\n` +
			`<b>Трактовка:</b> ${esc(out.esoteric_interpretation)}\n\n` +
			`<b>Вопрос для размышления:</b> ${esc(out.reflective_question)}\n\n` +
			(out.gentle_advice?.length
				? `<b>Мягкие шаги:</b>\n` +
				  out.gentle_advice
						.map((s: string, i: number) => `${i + 1}. ${esc(s)}`)
						.join('\n')
				: '')

		const kb = new InlineKeyboard()
			.text('💬 Задать вопрос', `followup:${dreamEntry.id}`)
			.row()
			.text('✨ Духовная практика', `practice:interpret:${dreamEntry.id}`)
			.row()
			.text('📔 Открыть дневник', 'analytics:journal')

		await ctx.reply(html, { parse_mode: 'HTML', reply_markup: kb })

		// отметить первый разбор
		if (!ctx.session.onboarding) ctx.session.onboarding = {}
		if (!ctx.session.onboarding.firstInterpretDone) {
			ctx.session.onboarding.firstInterpretDone = true
			await updateUser(userId, { firstInterpretDone: true })
		}

		// мягкий CTA заполнить профиль (после успешного разбора)
		const fresh = await getOrCreateUser(userId)
		if (!isProfileComplete(fresh) && shouldNudgeProfile(ctx.session)) {
			const kb2 = new InlineKeyboard().text(
				'👤 Заполнить профиль',
				'profile:open'
			)
			await ctx.reply(
				'✨ Разбор готов. Чтобы следующие разборы были точнее (символы, контекст и отчёты) — заполните профиль, это ~1 минута.',
				{ reply_markup: kb2 }
			)
			ctx.session.onboarding.lastProfileNudgeAt = new Date().toISOString()
		}
	} catch (e: any) {
		logger.error(e, 'interpret failed')
		await ctx.reply('Не удалось сделать разбор. Попробуйте ещё раз чуть позже.')
	}
}

/* ---------------------------- регистрация ---------------------------- */

export function registerInterpretFlow(bot: Bot<MyContext>) {
	// Команда: разобрать последний сон
	bot.command('interpret', async ctx => {
		const userId = ctx.from?.id.toString()
		if (!userId) return ctx.reply('Не удалось определить ваш ID.')

		const user = await getOrCreateUser(userId)
		const last = await getLastDream(user.id)
		if (!last) {
			await ctx.reply('У вас ещё нет записей сна. Используйте /sleep.')
			return
		}

		await runInterpretation(ctx, last.id, userId)
	})

	// Inline-кнопка: «Разобрать сейчас» (после /sleep)
	bot.callbackQuery(/^interpret:(.+)$/, async ctx => {
		await ctx.answerCallbackQuery({ text: 'Делаю разбор...' })
		const userId = ctx.from?.id.toString()
		if (!userId) return
		const entryId = ctx.match![1]
		await runInterpretation(ctx, entryId, userId)
	})

	// Запуск разбора из профиля (например, после заполнения)
	bot.callbackQuery(/^interpret:run:(.+)$/, async ctx => {
		await ctx.answerCallbackQuery({ text: 'Делаю разбор...' })
		const userId = ctx.from?.id.toString()
		if (!userId) return
		const entryId = ctx.match![1]
		await runInterpretation(ctx, entryId, userId)
	})

	// Follow-up по разбору
	bot.callbackQuery(/^followup:(.+)$/, async ctx => {
		await ctx.answerCallbackQuery()
		const entryId = ctx.match![1]
		const userId = ctx.from?.id?.toString()
		if (!userId) return

		const user = await getOrCreateUser(userId)
		const plan = (user.plan as any) ?? 'free'
		ctx.session.followupsUsed ??= 0
		const used = ctx.session.followupsUsed

		if (!isAdmin(ctx.from?.id)) {
			if (!canAskFollowup(plan, used)) {
				const total = getMonthlyFollowups(plan)
				const left = total === Infinity ? '∞' : Math.max(0, total - used)
				const kb = new InlineKeyboard().text('🔓 Оформить подписку', 'pay:open')
				await ctx.reply(
					`Лимит уточняющих вопросов на вашем плане исчерпан.\nИспользовано: ${used}/${total}\nОсталось: ${left}`,
					{ reply_markup: kb }
				)
				return
			}
		}

		ctx.session.conversation = { type: 'followup', entryId }
		await ctx.reply(
			'Напишите уточняющий вопрос по разбору. Отвечу коротко (2–5 предложений).'
		)
	})
}
