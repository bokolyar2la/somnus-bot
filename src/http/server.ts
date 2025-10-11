import express, { Request, Response } from 'express'
import { updateUser } from '../db/repo.js'
import { logger } from '../util/logger.js'

function addDays(date: Date, days: number) {
	const d = new Date(date)
	d.setDate(d.getDate() + days)
	return d
}
function addMonths(date: Date, months: number) {
	const d = new Date(date)
	d.setMonth(d.getMonth() + months)
	return d
}

export function startHttpServer() {
	const app = express()
	app.use(express.json())
	app.get('/webhook/yookassa', (_req, res) => res.sendStatus(200))
	app.post('/webhook/yookassa', async (req: Request, res: Response) => {
		try {
			const event = req.body

			if (event?.object?.status === 'succeeded') {
				const desc: string = event.object.description || ''
				const uid = desc.match(/uid:(\d+)/)?.[1]
				const plan = desc.match(/plan:(week|month|year)/)?.[1] as
					| 'week'
					| 'month'
					| 'year'
					| undefined

				if (uid && plan) {
					const now = new Date()
					const until =
						plan === 'week'
							? addDays(now, 7)
							: plan === 'month'
							? addMonths(now, 1)
							: addMonths(now, 12)

					// Обновляем пользователя через репозиторий
					await updateUser(uid, { plan: 'paid' as any, planUntil: until })

					logger.info(
						{ uid, plan, planUntil: until.toISOString() },
						'YooKassa: plan upgraded'
					)
				} else {
					logger.warn(
						{ desc },
						'YooKassa: cannot parse uid/plan from description'
					)
				}
			}
			res.sendStatus(200)
		} catch (e) {
			logger.error(e, 'Webhook error')
			res.sendStatus(200)
		}
	})

	const port = Number(process.env.PORT || 3000)
	app.listen(port, () => logger.info(`Webhook server started on :${port}`))
}
