// src/bot/index.ts
import { Bot, GrammyError, HttpError, session } from 'grammy'

import {
	canAskFollowup,
	getMonthlyFollowups,
	getMonthlyQuota,
} from '../core/pricing.js'
import { startScheduler } from '../core/scheduler.js'
import { getOrCreateUser, updateUser } from '../db/repo.js'
import { isAdmin } from '../util/auth.js' // Import isAdmin
import { config } from '../util/config.js'
import { logger } from '../util/logger.js'

import { initSession, MyContext } from './helpers/state.js'
import { mainKb, registerCommands } from './keyboards.js'

import { InlineKeyboard } from 'grammy'
import { startHttpServer } from '../http/server.js'
import {
	handleAnalyticsCommand,
	registerAnalyticsFlow,
} from './flows/analyticsFlow.js'
import { registerExportFlow } from './flows/exportFlow.js'
import { answerFollowup } from './flows/followupFlow.js'
import { registerInterpretFlow } from './flows/interpretFlow.js'
import { registerListDreamsFlow } from './flows/listDreamsFlow.js'
import { registerPracticeFlow } from './flows/practiceFlow.js' // Import practice flow
import {
	handleProfileMessage,
	openProfile,
	registerProfileFlow,
} from './flows/profileFlow.js'
import {
	handleRemindersCommand,
	handleRemindersMessage,
	registerRemindersFlow,
} from './flows/remindersFlow.js'
import { handleReportCommand, registerReportFlow } from './flows/reportFlow.js'
import {
	handleSleepMessage,
	openSleepInput,
	registerSleepFlow,
} from './flows/sleepFlow.js' // Import openSleepInput
import {
	registerSubscriptionFlow,
	sendSubscribeMessage,
} from './flows/subscriptionFlow.js'

if (!config.BOT_TOKEN) {
	throw new Error('Empty BOT_TOKEN. Add it to .env and restart.')
}

const bot = new Bot<MyContext>(config.BOT_TOKEN)

// ---- session first
bot.use(
	session({
		initial: initSession,
	})
)

// ---- basic commands
bot.command('start', async (ctx: MyContext) => {
	if (!ctx.from?.id) {
		return ctx.reply('Произошла ошибка, не могу определить ваш ID.')
	}

	await getOrCreateUser(ctx.from.id.toString())

	const onboarding =
		'Привет 👋 Я — твой проводник снов.\n' +
		'Я помогу тебе вести дневник снов и находить в них подсказки.\n\n' +
		'Тут вы можете:\n' +
		'✍ Записать сон — делись ночными историями.\n' +
		'📊 Аналитика — дневник, символы и достижения.\n' +
		'⏰ Напоминания — настрой удобное время, чтобы я напоминал о снах.\n' +
		'📋 Отчёт по снам: повторяющиеся символы, темы и их значение.\n' +
		'👤 Профиль — настройки для лучшего понимания твоих снов.\n' +
		'📂 Экспорт — выгружай сны в PDF, TXT или Markdown.\n\n' +
		'Попробуй прямо сейчас нажать «✍ Записать сон».'

	await ctx.reply(onboarding, { reply_markup: mainKb })
})

bot.command('help', (ctx: MyContext) =>
	ctx.reply(
		[
			'Справка:',
			'• /sleep — записать ночной сон',
			'• /analytics — аналитика, достижения, дневник',
			'• /profile — настройки (таймзона, хронотип, цель, стресс и т.д.)',
			'• /report — отчёт по снам (повторяющиеся символы, практики)',
			'• /export — экспорт дневника',
			'• /limits — лимиты разборов в этом месяце',
			'• /subscribe — информация о подписке',
			'',
			'Также можно пользоваться кнопками под полем ввода.',
		].join('\n')
	)
)

bot.command('limits', async (ctx: MyContext) => {
	const userId = ctx.from?.id?.toString()
	if (!userId) return ctx.reply('Не удалось определить ваш ID.')

	if (isAdmin(ctx.from?.id)) {
		return ctx.reply(
			`Ваши лимиты:\nПлан: admin\nРазборов за месяц: ∞/∞\nОсталось: ∞`
		)
	}

	const user = await getOrCreateUser(userId)
	const plan = (user.plan as any) ?? 'free'
	const used = user.monthlyCount ?? 0
	const total = getMonthlyQuota(plan)
	const left = Math.max(0, total - used)

	const kb = new InlineKeyboard().text('🔓 Оформить подписку', 'pay:open')

	await ctx.reply(
		`Ваши лимиты:\nПлан: ${plan}\nРазборов за месяц: ${used}/${total}\nОсталось: ${left}`,
		{ reply_markup: kb }
	)
})

bot.command('pay', sendSubscribeMessage) // Register /pay command
bot.command('subscribe', sendSubscribeMessage)
bot.hears('💳 Подписка', sendSubscribeMessage)

bot.callbackQuery('pay:open', async (ctx: MyContext) => {
	await ctx.answerCallbackQuery()
	await sendSubscribeMessage(ctx)
})

// Dev command for admin (optional)
bot.command('dev_unlimit', async (ctx: MyContext) => {
	if (!isAdmin(ctx.from?.id)) return
	const id = ctx.from!.id.toString()
	await updateUser(id, { plan: 'paid' as any })
	await ctx.reply('Dev: выставлен план paid. Лимиты сняты.')
})

// Экспорт-меню (по строке на кнопку — нагляднее)
const exportMenuKb = new InlineKeyboard()
	.text('📄 PDF', 'export:format:pdf')
	.row()
	.text('📝 Markdown', 'export:format:md')
	.row()
	.text('📃 TXT', 'export:format:txt')

// ---- reply keyboard buttons -> commands
bot.hears('🛌 Записать сон', openSleepInput) // Use openSleepInput
bot.hears('📊 Аналитика', handleAnalyticsCommand)
bot.command('analytics', handleAnalyticsCommand)
bot.hears('🔔 Напоминания', handleRemindersCommand)
bot.hears('📋 Отчёт по снам', handleReportCommand)
bot.command('report', handleReportCommand)
bot.hears('👤 Профиль', openProfile)
bot.hears('📤 Экспорт', (ctx: MyContext) =>
	ctx.reply('Выберите формат экспорта:', { reply_markup: exportMenuKb })
)

bot.command('menu', (ctx: MyContext) =>
	ctx.reply('Главное меню:', { reply_markup: mainKb })
)

bot.callbackQuery('sleep:start', async (ctx: MyContext) => {
	await ctx.answerCallbackQuery()
	await openSleepInput(ctx as any)
})

// Removed - this callback is now handled in analyticsFlow.ts

bot.callbackQuery('profile:open', async (ctx: MyContext) => {
	await ctx.answerCallbackQuery().catch(() => {})
	await openProfile(ctx)
})

// Локальное меню подписки (если нужно вызвать вручную)
const subscriptionMenuKb = new InlineKeyboard()
	.text('1 неделя — 199 ₽', 'pay:week')
	.row()
	.text('1 месяц — 499 ₽', 'pay:month')
	.row()
	.text('1 год — 2500 ₽', 'pay:year')
	.row()
	.text('⬅️ Назад', 'pay:back')

bot.callbackQuery('pay:back', async (ctx: MyContext) => {
	await ctx.answerCallbackQuery()
	try {
		// снимаем inline-клавиатуру у старого сообщения
		await ctx.editMessageReplyMarkup()
	} catch {}
	// отправляем новое сообщение с reply-клавиатурой
	await ctx.reply('Главное меню:', { reply_markup: mainKb })
})

// ---- register flows & system menu BEFORE start()
async function bootstrap() {
	await registerCommands(bot) // setMyCommands

	registerSleepFlow(bot)
	registerRemindersFlow(bot)
	registerAnalyticsFlow(bot)
	registerReportFlow(bot)
	registerProfileFlow(bot)
	registerExportFlow(bot)
	registerListDreamsFlow(bot)
	registerInterpretFlow(bot)
	registerSubscriptionFlow(bot)
	registerPracticeFlow(bot)

	// universal message router — keep it AFTER flow registration
	bot.on('message', async (ctx: MyContext, next) => {
		const conv = ctx.session.conversation

		// no active conversation -> let other handlers run
		if (!conv) return next()

		if (conv.type === 'sleep' || conv.type === 'nap') {
			const handled = await handleSleepMessage(ctx)
			if (handled) return
			return next()
		}

		if (conv.type === 'reminders') {
			const handled = await handleRemindersMessage(ctx)
			if (handled) return
			return next()
		}

		if (conv.type === 'profile') {
			await handleProfileMessage(ctx)
			return
		}

		if (conv?.type === 'followup') {
			const entryId = conv.entryId
			if (!entryId) {
				await ctx.reply(
					'Не нашёл связанный сон для уточнения. Нажмите «💬 Задать вопрос» ещё раз.'
				)
				ctx.session.conversation = undefined
				return
			}

			const q = ctx.message?.text?.trim()
			if (!q || q.length < 2) {
				await ctx.reply('Пожалуйста, сформулируйте короткий вопрос по разбору.')
				return
			}

			// лимиты
			const userId = ctx.from!.id.toString()
			const user = await getOrCreateUser(userId)
			const plan = (user.plan as any) ?? 'free'
			ctx.session.followupsUsed ??= 0
			const used = ctx.session.followupsUsed

			// Admin bypass for limits
			if (isAdmin(ctx.from?.id)) {
				// админ — игнорируем лимиты
			} else {
				if (!canAskFollowup(plan, used)) {
					const total = getMonthlyFollowups(plan)
					const left = total === Infinity ? '∞' : Math.max(0, total - used)
					const kb = new InlineKeyboard().text(
						'🔓 Оформить подписку',
						'pay:open'
					)
					await ctx.reply(
						`Лимит уточняющих вопросов на вашем плане исчерпан.\nИспользовано: ${used}/${total}\nОсталось: ${left}`,
						{ reply_markup: kb }
					)
					// остаёмся в режиме followup, пусть переформулирует после апгрейда
					return
				}
			}

			// ответ
			await ctx.reply('💭 Думаю над ответом…')
			await answerFollowup(bot, ctx, entryId, q)

			// Сбрасываем режим
			ctx.session.conversation = undefined
			return
		}

		return next()
	})

	bot.catch((err: any) => {
		const ctx = err.ctx

		// контекст апдейта полезно логировать структурно
		logger.error(
			{ err: err.error, update: ctx.update },
			'Error while handling update'
		)

		if (err.error instanceof GrammyError) {
			logger.error(
				{ method: err.error.method, description: err.error.description },
				'Error in Telegram API request'
			)
		} else if (err.error instanceof HttpError) {
			logger.error(
				{ httpError: String(err.error) },
				'Could not contact Telegram'
			)
		} else {
			logger.error({ unknown: err.error }, 'Unknown error')
		}
	})

	// start long polling, then scheduler
	await bot.start({
		onStart: ({ username }: { username?: string }) =>
			logger.info(`${username} started with long polling`),
	})
	startHttpServer()
	startScheduler(bot)
}

bootstrap().catch(e => {
	logger.error(e, 'Bootstrap failed')
	process.exit(1)
})
