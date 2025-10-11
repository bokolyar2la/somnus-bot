// src/bot/flows/subscriptionFlow.ts
import type { Bot } from 'grammy'
import { InlineKeyboard } from 'grammy'
import crypto from 'node:crypto'
import { config } from '../../util/config.js'
import type { MyContext } from '../helpers/state.js'
import { mainKb } from '../keyboards.js'

/** Продающий текст (HTML) */
function subscribeText(): string {
	return [
		'🔑 <b>Что даёт подписка AI-Сонник?</b>',
		'',
		'🔮 <b>Безлимитные разборы снов</b> — глубже и точнее, чем обычные сонники.',
		'💬 <b>Уточняющие вопросы</b> после каждого сна — коротко и по делу.',
		'🧘 <b>Духовные практики</b> — дыхание, медитации и вечерние ритуалы.',
		'📊 <b>Недельный обзор</b> — повторяющиеся символы и скрытые тенденции.',
		'📂 <b>Экспорт дневника</b> — PDF, TXT или Markdown.',
		'',
		'💫 <b>Тарифы:</b>',
		'▫ 1 неделя — 99 ₽',
		'🌟 1 месяц — 299 ₽ <i>(рекомендуем)</i>',
		'▫ 1 год — 2490 ₽ <i>(выгода ~30%)</i>',
	].join('\n')
}

/** Клавиатура с уникальными callback’ами */
function subscribeKb(): InlineKeyboard {
	return new InlineKeyboard()
		.text('1 неделя — 99 ₽', 'pay:week')
		.row()
		.text('🌟 1 месяц — 299 ₽', 'pay:month')
		.row()
		.text('1 год — 2490 ₽', 'pay:year')
		.row()
		.text('⬅️ Назад', 'pay:back')
}

/** Показ экрана подписки */
export async function sendSubscribeMessage(ctx: MyContext): Promise<void> {
	await ctx.reply(subscribeText(), {
		parse_mode: 'HTML',
		reply_markup: subscribeKb(),
	})
}

/** Тех. email для чека (если нет реального) */
function makeCustomerEmail(ctx: MyContext): string {
	if (ctx.from?.username) return `${ctx.from.username}@t.me`
	return `tg${ctx.from?.id ?? 'user'}@sonmus.ru`
}

/** Создание платежа в YooKassa */
async function createYooPayment(params: {
	amountRub: string // "99.00"
	tgId: string
	plan: 'week' | 'month' | 'year'
	returnUrl: string // куда вернуть пользователя после оплаты
	customerEmail: string
}) {
	const { amountRub, tgId, plan, returnUrl, customerEmail } = params
	const idempotenceKey = crypto.randomUUID()

	const auth = Buffer.from(
		`${config.YOOKASSA_SHOP_ID}:${config.YOOKASSA_SECRET_KEY}`
	).toString('base64')

	// минимально валидный payload с чеком
	const description = `AI-Сонник: подписка (${plan})`
	const payload = {
		amount: { value: amountRub, currency: 'RUB' },
		capture: true,
		description,
		confirmation: {
			type: 'redirect' as const,
			return_url: returnUrl,
		},
		metadata: {
			uid: tgId,
			plan,
		},
		receipt: {
			customer: { email: customerEmail }, // email или phone обязателен при фискализации
			items: [
				{
					description,
					quantity: '1.00',
					amount: { value: amountRub, currency: 'RUB' },
					vat_code: 1, // 1 — без НДС
					payment_subject: 'service', // предмет расчёта — услуга
					payment_mode: 'full_prepayment', // способ расчёта — полная предоплата
				},
			],
			// Если ЛК требует, раскомментируй и поставь свой код системы налогообложения:
			// tax_system_code: 1,
		},
	}

	const res = await fetch('https://api.yookassa.ru/v3/payments', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Idempotence-Key': idempotenceKey,
			Authorization: `Basic ${auth}`,
		},
		body: JSON.stringify(payload),
	})

	const data = await res.json()
	if (!res.ok) {
		throw new Error(
			`YooKassa error ${res.status}: ${JSON.stringify(data, null, 2)}`
		)
	}
	return data as { confirmation?: { confirmation_url?: string } }
}

/** Регистрация обработчиков */
export function registerSubscriptionFlow(bot: Bot<MyContext>): void {
	// открыть экран подписки
	bot.callbackQuery('pay:open', async ctx => {
		await ctx.answerCallbackQuery().catch(() => {})
		await sendSubscribeMessage(ctx)
	})

	// назад
	bot.callbackQuery('pay:back', async ctx => {
		await ctx.answerCallbackQuery().catch(() => {})
		await ctx.reply('Главное меню:', { reply_markup: mainKb })
	})

	// три тарифа → создаём платёж и отдаём ссылку
	bot.callbackQuery(['pay:week', 'pay:month', 'pay:year'], async ctx => {
		await ctx.answerCallbackQuery().catch(() => {})

		const cb = ctx.callbackQuery!.data as 'pay:week' | 'pay:month' | 'pay:year'
		const plan = cb.split(':')[1] as 'week' | 'month' | 'year'
		const tgId = String(ctx.from!.id)

		const AMOUNTS: Record<typeof plan, string> = {
			week: '99.00',
			month: '299.00',
			year: '2490.00',
		}

		await ctx.reply('⏳ Создаю счёт…')

		try {
			const me = ctx.me?.username || 'your_bot'
			const customerEmail = makeCustomerEmail(ctx)

			const data = await createYooPayment({
				amountRub: AMOUNTS[plan],
				tgId,
				plan,
				returnUrl: `https://t.me/${me}`,
				customerEmail,
			})

			const url = data.confirmation?.confirmation_url
			if (!url) throw new Error('Не пришла ссылка на оплату')

			const kb = new InlineKeyboard()
				.url('💳 Оплатить', url)
				.row()
				.text('⬅️ Назад', 'pay:back')

			const label =
				plan === 'week'
					? '1 неделя — 99 ₽'
					: plan === 'month'
					? '1 месяц — 299 ₽'
					: '1 год — 2490 ₽'

			await ctx.reply(
				`Счёт создан: <b>${label}</b>\nОплата пройдёт на защищённой странице YooKassa.`,
				{ parse_mode: 'HTML', reply_markup: kb }
			)
		} catch (e: any) {
			await ctx.reply(`❌ Не удалось создать счёт: ${e?.message ?? String(e)}`)
		}
	})

	// /pay как дубликат
	bot.command('pay', sendSubscribeMessage)
}
