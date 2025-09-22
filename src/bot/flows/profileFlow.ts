import type { Bot } from 'grammy'
import { InlineKeyboard } from 'grammy'
import type { MyContext } from '../helpers/state.js'

import {
	findLatestPendingDream,
	getOrCreateUser,
	updateUser,
	updateUserProfile,
} from '../../db/repo.js'
import { detectTimezoneByIP } from '../../util/timezone.js'
import {
	isProfileComplete,
	isValidTimeZone,
	sendProfileReadyCta,
} from '../helpers/profile.js'

/* ------------------------- helpers: локализация ------------------------- */
function ruChronotype(v?: string) {
	switch (v) {
		case 'lark':
			return 'жаворонок'
		case 'owl':
			return 'сова'
		case 'mixed':
			return 'смешанный'
		default:
			return '—'
	}
}
function ruGoal(v?: string) {
	switch (v) {
		case 'fall_asleep':
			return 'лучше засыпать'
		case 'remember':
			return 'запоминать сны'
		case 'symbols':
			return 'понимать символы'
		case 'less_anxiety':
			return 'меньше тревоги'
		default:
			return '—'
	}
}

/* ----------------------- карточка и клавиатура ------------------------- */
function profileCard(u: any) {
	return [
		'*Профиль*',
		`⏰ Таймзона: ${u.timezone ? `*${u.timezone}*` : '«не указана»'}`,
		`👶 Возраст: ${u.ageBand ?? '—'}`,
		`🕊 Хронотип: ${ruChronotype(u.chronotype)}`,
		`🌅 Встаю обычно: ${u.wakeTime ?? '—'}`,
		`🌙 Ложусь обычно: ${u.sleepTime ?? '—'}`,
		`🫧 Стресс (0–10): ${u.stressLevel ?? '—'}`,
		'',
		'_Все настройки анонимны и влияют на качество разбора._',
	].join('\n')
}
function profileKb() {
	return new InlineKeyboard()
		.text('👶 Возраст', 'profile:age:menu')
		.text('🌑🌞 Хронотип', 'profile:chronotype:menu')
		.row()
		.text('⏰ Изменить таймзону', 'profile:timezone:menu')
		.row()
		.text('⏰ Режим сна', 'profile:sleep:menu') // Changed to profile:sleep:menu for the new wizard
		.row()
		.text('🫧 Стресс', 'profile:stress:menu')
}

async function maybeFinishOnboarding(ctx: MyContext) {
	const u = await getOrCreateUser(String(ctx.from!.id))
	if (isProfileComplete(u) && ctx.session.onboarding?.active) {
		ctx.session.onboarding!.active = false
		await sendProfileReadyCta(ctx)
	}
}

async function createTimezoneMenu(): Promise<InlineKeyboard> {
	return new InlineKeyboard()
		.text('📍 Определить автоматически', 'profile:timezone:auto')
		.row()
		.text('✍️ Ввести вручную', 'profile:timezone:manual')
		.row()
		.text('⬅️ Назад', 'profile:open')
}

/* --------------------------- публичные API ----------------------------- */
export async function openProfile(ctx: MyContext) {
	const tgId = ctx.from?.id.toString()
	if (!tgId) return
	const u = await getOrCreateUser(tgId)
	await ctx.reply(profileCard(u), {
		reply_markup: profileKb(),
		parse_mode: 'Markdown',
	})

	// Если профиль стал полным, и есть "ждущий" сон
	if (isProfileComplete(u)) {
		const pendingDream = await findLatestPendingDream(u.id) // Assuming u.id is dbUserId
		if (pendingDream) {
			const kb = new InlineKeyboard()
				.text('🔮 Разобрать сейчас', `interpret:run:${pendingDream.id}`)
				.row()
				.text('✍ Записать новый', 'sleep:start')
			await ctx.reply(
				[
					'Профиль заполнен! 🎉',
					'Хотите разобрать ранее сохранённый сон?',
				].join('\n'),
				{ reply_markup: kb }
			)
		}
	}
}

export async function handleProfileMessage(ctx: MyContext): Promise<boolean> {
	const conv = ctx.session.conversation
	const userId = ctx.from?.id.toString()
	if (!userId || !conv) return false

	if (conv.type === 'profile_tz_manual' && conv.stage === 'awaiting_tz') {
		const tz = ctx.message?.text?.trim()
		if (!tz || !isValidTimeZone(tz)) {
			await ctx.reply(
				'Не похоже на IANA-таймзону. Пример: Europe/Moscow. Попробуйте ещё раз.'
			)
			return true
		}
		await updateUser(String(ctx.from!.id), { timezone: tz })
		await ctx.reply(
			`✅ Таймзона сохранена: ${tz}\nПри необходимости вы всегда можете изменить её в профиле.`
		)
		const fresh = await getOrCreateUser(String(ctx.from!.id))
		if (isProfileComplete(fresh)) {
			await sendProfileReadyCta(ctx)
		}
		ctx.session.conversation = undefined
		return true
	}

	if (conv.type !== 'profile') return false // Existing profile messages

	const text = ctx.message?.text?.trim()
	if (!text) {
		await ctx.reply('Пожалуйста, введите значение.')
		return true
	}

	// Handle sleep wizard input
	if (ctx.session.sleepWizard) {
		const isValid = /^([01]\d|2[0-3]):[0-5]\d$/.test(text)
		if (!isValid) {
			await ctx.reply(
				'Неверный формат времени. Введите HH:MM (24ч), например 07:30.'
			)
			return true
		}

		const updateData: any = {}
		if (ctx.session.sleepWizard.step === 'wake') {
			updateData.wakeTime = text
		} else {
			updateData.sleepTime = text
		}

		try {
			await updateUserProfile(userId, updateData)
		} catch (e) {
			console.error('Failed to update profile for sleep time:', e)
			await ctx.reply(
				'Произошла ошибка при сохранении времени. Попробуйте ещё раз.'
			)
			return true
		}

		if (ctx.session.sleepWizard.step === 'wake') {
			ctx.session.sleepWizard.step = 'bed'
			const kb = new InlineKeyboard()
			for (let i = 22; i <= 24; i++) {
				// 22:00, 22:30, ..., 00:00
				const hour = i % 24
				kb.text(
					`${String(hour).padStart(2, '0')}:00`,
					`profile:sleeptime:set:${String(hour).padStart(2, '0')}:00`
				)
				kb.text(
					`${String(hour).padStart(2, '0')}:30`,
					`profile:sleeptime:set:${String(hour).padStart(2, '0')}:30`
				)
				if ((i - 22 + 2) % 4 === 0) kb.row() // Every 2 hours (4 half-hour options)
			}
			kb.text('📝 Ввести вручную', 'profile:sleep:manual_bed').row()
			await ctx.reply('Отлично! Теперь укажите время отхода ко сну.', {
				reply_markup: kb,
			})
		} else {
			// 'bed'
			delete ctx.session.sleepWizard
			delete ctx.session.conversation // Clear general conversation state too
			const u = await getOrCreateUser(userId)
			await ctx.reply(profileCard(u), {
				reply_markup: profileKb(),
				parse_mode: 'Markdown',
			})
			await maybeFinishOnboarding(ctx)
		}
		return true
	}

	// Old handling for awaitingWakeTime and awaitingSleepTime (remove as wizard handles it)
	if (conv.stage === 'awaitingWakeTime' || conv.stage === 'awaitingSleepTime') {
		// This block is now handled by the sleepWizard logic above
		return false
	}

	if (conv.stage === 'awaitingTimezone') {
		if (!isValidTimeZone(text)) {
			await ctx.reply(
				'⚠️ Похоже, это не IANA‑таймзона. Примеры: Europe/Moscow, Asia/Yekaterinburg. Попробуйте ещё раз или нажмите „Популярные“',
				{
					reply_markup: new InlineKeyboard()
						.text('Популярные', 'profile:timezone:menu')
						.text('Отмена', 'profile:timezone:cancel'),
				}
			)
			return true
		}
		try {
			await updateUserProfile(userId, { timezone: text })
			delete ctx.session.conversation
			const u = await getOrCreateUser(userId)
			await ctx.reply(
				`✅ Таймзона сохранена: *${text}*\nПри необходимости вы всегда можете изменить её в профиле.`,
				{
					parse_mode: 'Markdown',
					reply_markup: profileKb(),
				}
			)
			await maybeFinishOnboarding(ctx) // Check for pending dreams
			return true
		} catch (e) {
			console.error('Failed to update profile for timezone:', e)
			await ctx.reply(
				'Произошла ошибка при сохранении таймзоны. Попробуйте ещё раз.'
			)
			return true
		}
	}

	return false
}

/* --------------------------- регистрация flow -------------------------- */
export function registerProfileFlow(bot: Bot<MyContext>) {
	bot.command('profile', openProfile)

	// Меню секций
	bot.callbackQuery('profile:age:menu', async ctx => {
		await ctx.answerCallbackQuery()
		await ctx.editMessageText('Выберите возраст:', {
			reply_markup: new InlineKeyboard()
				.text('18-24', 'profile:age:18-24')
				.text('25-34', 'profile:age:25-34')
				.row()
				.text('35-44', 'profile:age:35-44')
				.text('45-54', 'profile:age:45-54')
				.row()
				.text('55+', 'profile:age:55+'),
		})
	})

	bot.callbackQuery('profile:chronotype:menu', async ctx => {
		await ctx.answerCallbackQuery()
		await ctx.editMessageText('Ваш хронотип:', {
			reply_markup: new InlineKeyboard()
				.text('Жаворонок', 'profile:chronotype:lark')
				.text('Сова', 'profile:chronotype:owl')
				.row()
				.text('Смешанный', 'profile:chronotype:mixed'),
		})
	})

	// Меню выбора таймзоны (новая реализация)
	bot.callbackQuery('profile:timezone:menu', async ctx => {
		await ctx.answerCallbackQuery().catch(() => {})
		await ctx.reply('Выберите таймзону ⏱️', {
			reply_markup: await createTimezoneMenu(),
		})
	})

	// Автоматическое определение таймзоны
	bot.callbackQuery('profile:timezone:auto', async ctx => {
		await ctx.answerCallbackQuery('🔍 Определяю ваше время...')
		const userId = String(ctx.from!.id)

		try {
			const tz = await detectTimezoneByIP()

			if (tz) {
				await updateUser(userId, { timezone: tz })
				await ctx.reply(`✅ Время определено автоматически: ${tz}`)
				const fresh = await getOrCreateUser(userId)
				if (isProfileComplete(fresh)) {
					await sendProfileReadyCta(ctx)
				}
			} else {
				const kb = new InlineKeyboard()
					.text('🌍 Выбрать из списка', 'profile:timezone:popular')
					.row()
					.text('✍️ Ввести вручную', 'profile:timezone:manual')

				await ctx.reply(
					'🤔 Не удалось определить время автоматически.\nВыберите другой способ:',
					{ reply_markup: kb }
				)
			}
		} catch (error) {
			const kb = new InlineKeyboard()
				.text('🌍 Выбрать из списка', 'profile:timezone:popular')
				.row()
				.text('✍️ Ввести вручную', 'profile:timezone:manual')

			await ctx.reply(
				'❌ Ошибка определения времени.\nВыберите другой способ:',
				{ reply_markup: kb }
			)
		}
	})

	// Ручной ввод таймзоны (включение режима ожидания)
	bot.callbackQuery('profile:timezone:manual', async ctx => {
		await ctx.answerCallbackQuery().catch(() => {})
		ctx.session.conversation = {
			type: 'profile_tz_manual',
			stage: 'awaiting_tz',
		}
		await ctx.reply(
			'✍️ Введите таймзону в формате IANA (например, Europe/Moscow) или нажмите «⬅️ Назад» в профиле.'
		)
	})
	// Sleep mode mini-wizard entry
	bot.callbackQuery('profile:sleep:menu', async ctx => {
		await ctx.answerCallbackQuery()
		ctx.session.sleepWizard = { step: 'wake' }
		const kb = new InlineKeyboard()
		for (let i = 6; i <= 9; i++) {
			// 06:00, 06:30, ..., 09:00
			kb.text(
				`${String(i).padStart(2, '0')}:00`,
				`profile:waketime:set:${String(i).padStart(2, '0')}:00`
			)
			kb.text(
				`${String(i).padStart(2, '0')}:30`,
				`profile:waketime:set:${String(i).padStart(2, '0')}:30`
			)
			if (i < 9) kb.row()
		}
		kb.text('📝 Ввести вручную', 'profile:sleep:manual_wake').row()
		await ctx.editMessageText('Шаг 1 из 2: Укажите время подъёма.', {
			reply_markup: kb,
		})
	})

	// Handle manual wake time input within the wizard
	bot.callbackQuery('profile:sleep:manual_wake', async ctx => {
		await ctx.answerCallbackQuery()
		ctx.session.conversation = { type: 'profile', stage: 'awaitingWakeTime' }
		await ctx.reply(
			'✍ Введите время подъёма в формате HH:MM (например, 07:30).'
		)
	})

	// Handle manual bed time input within the wizard
	bot.callbackQuery('profile:sleep:manual_bed', async ctx => {
		await ctx.answerCallbackQuery()
		ctx.session.conversation = { type: 'profile', stage: 'awaitingSleepTime' }
		await ctx.reply(
			'✍ Введите время отхода ко сну в формате HH:MM (например, 22:45).'
		)
	})
	// Время подъёма (старые хендлеры, переиспользуем)
	bot.callbackQuery(/^profile:waketime:set:(\d{2}:\d{2})$/, async ctx => {
		await ctx.answerCallbackQuery()
		const time = ctx.match![1]
		try {
			await updateUserProfile(ctx.from!.id.toString(), { wakeTime: time })
		} catch (e) {
			console.error('Failed to update profile for wake time:', e)
			await ctx.reply(
				'Произошла ошибка при сохранении времени. Попробуйте ещё раз.'
			)
			return
		}
		// If we are in the sleep wizard, proceed to the next step
		if (ctx.session.sleepWizard?.step === 'wake') {
			ctx.session.sleepWizard.step = 'bed'
			const kb = new InlineKeyboard()
			for (let i = 22; i <= 24; i++) {
				// 22:00, 22:30, ..., 00:00
				const hour = i % 24
				kb.text(
					`${String(hour).padStart(2, '0')}:00`,
					`profile:sleeptime:set:${String(hour).padStart(2, '0')}:00`
				)
				kb.text(
					`${String(hour).padStart(2, '0')}:30`,
					`profile:sleeptime:set:${String(hour).padStart(2, '0')}:30`
				)
				if ((i - 22 + 2) % 4 === 0) kb.row() // Every 2 hours (4 half-hour options)
			}
			kb.text('📝 Ввести вручную', 'profile:sleep:manual_bed').row()
			await ctx.editMessageText(
				'Отлично! Теперь укажите время отхода ко сну.',
				{ reply_markup: kb }
			)
		} else {
			// Otherwise, return to profile and check for onboarding completion
			const u = await getOrCreateUser(ctx.from!.id.toString())
			await ctx.editMessageText(profileCard(u), {
				reply_markup: profileKb(),
				parse_mode: 'Markdown',
			})
			await maybeFinishOnboarding(ctx)
		}
	})

	// Время сна (старые хендлеры, переиспользуем)
	bot.callbackQuery(/^profile:sleeptime:set:(\d{2}:\d{2})$/, async ctx => {
		await ctx.answerCallbackQuery()
		const time = ctx.match![1]
		try {
			await updateUserProfile(ctx.from!.id.toString(), { sleepTime: time })
		} catch (e) {
			console.error('Failed to update profile for sleep time:', e)
			await ctx.reply(
				'Произошла ошибка при сохранении времени. Попробуйте ещё раз.'
			)
			return
		}
		delete ctx.session.sleepWizard // Clear wizard state
		delete ctx.session.conversation // Clear general conversation state
		// Always return to profile after setting sleep time
		const u = await getOrCreateUser(ctx.from!.id.toString())
		await ctx.editMessageText(profileCard(u), {
			reply_markup: profileKb(),
			parse_mode: 'Markdown',
		})
		await maybeFinishOnboarding(ctx)
	})

	// «Другое» — ввод времени руками (перехватываем тут для мини-визарда)
	bot.callbackQuery('profile:waketime:other', async ctx => {
		// This handler is now replaced by profile:sleep:manual_wake
		return ctx.answerCallbackQuery()
	})
	bot.callbackQuery('profile:sleeptime:other', async ctx => {
		// This handler is now replaced by profile:sleep:manual_bed
		return ctx.answerCallbackQuery()
	})

	// Возраст / хронотип / цель
	bot.callbackQuery(
		/^profile:age:(18-24|25-34|35-44|45-54|55\+)$/,
		async ctx => {
			await ctx.answerCallbackQuery()
			try {
				await updateUserProfile(ctx.from!.id.toString(), {
					ageBand: ctx.match![1] as any,
				})
			} catch (e) {
				console.error('Failed to update profile for age band:', e)
				await ctx.reply(
					'Произошла ошибка при сохранении возраста. Попробуйте ещё раз.'
				)
				return
			}
			const u = await getOrCreateUser(ctx.from!.id.toString())
			await ctx.editMessageText(profileCard(u), {
				reply_markup: profileKb(),
				parse_mode: 'Markdown',
			})
			await maybeFinishOnboarding(ctx) // Check for pending dreams
		}
	)

	bot.callbackQuery(/^profile:chronotype:(lark|owl|mixed)$/, async ctx => {
		await ctx.answerCallbackQuery()
		try {
			await updateUserProfile(ctx.from!.id.toString(), {
				chronotype: ctx.match![1] as any,
			})
		} catch (e) {
			console.error('Failed to update profile for chronotype:', e)
			await ctx.reply(
				'Произошла ошибка при сохранении хронотипа. Попробуйте ещё раз.'
			)
			return
		}
		const u = await getOrCreateUser(ctx.from!.id.toString())
		await ctx.editMessageText(profileCard(u), {
			reply_markup: profileKb(),
			parse_mode: 'Markdown',
		})
		await maybeFinishOnboarding(ctx) // Check for pending dreams
	})

	// Меню и установка уровня стресса
	bot.callbackQuery('profile:stress:menu', async ctx => {
		await ctx.answerCallbackQuery()
		await ctx.editMessageText('Уровень стресса (0–10):', {
			reply_markup: new InlineKeyboard()
				.text('0', 'profile:stress:set:0')
				.text('1', 'profile:stress:set:1')
				.text('2', 'profile:stress:set:2')
				.text('3', 'profile:stress:set:3')
				.text('4', 'profile:stress:set:4')
				.text('5', 'profile:stress:set:5')
				.row()
				.text('6', 'profile:stress:set:6')
				.text('7', 'profile:stress:set:7')
				.text('8', 'profile:stress:set:8')
				.text('9', 'profile:stress:set:9')
				.text('10', 'profile:stress:set:10'),
		})
	})

	bot.callbackQuery(/^profile:stress:set:(\d{1,2})$/, async ctx => {
		await ctx.answerCallbackQuery()
		const n = Math.max(0, Math.min(10, parseInt(ctx.match![1], 10)))
		try {
			await updateUserProfile(ctx.from!.id.toString(), { stressLevel: n })
		} catch (e) {
			console.error('Failed to update profile for stress level:', e)
			await ctx.reply(
				'Произошла ошибка при сохранении уровня стресса. Попробуйте ещё раз.'
			)
			return
		}
		const u = await getOrCreateUser(ctx.from!.id.toString())
		await ctx.editMessageText(profileCard(u), {
			reply_markup: profileKb(),
			parse_mode: 'Markdown',
		})
		await maybeFinishOnboarding(ctx) // Check for pending dreams
	})
}
