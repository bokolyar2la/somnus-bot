import { getOrCreateUser, updateUser } from '../../db/repo.js'
import { isProfileComplete, sendProfileReadyCta } from './profile.js'
import type { MyContext } from './state.js'

export async function withProfileCompletionCheck(
  ctx: MyContext,
  updater: () => Promise<void>
) {
  const userId = String(ctx.from!.id)
  const before = await getOrCreateUser(userId)
  const wasComplete = isProfileComplete(before)

  await updater()

  const after = await getOrCreateUser(userId)
  const nowComplete = isProfileComplete(after)

  if (!wasComplete && nowComplete) {
    await sendProfileReadyCta(ctx)
    if (ctx.session.onboarding) delete ctx.session.onboarding.pendingEntryId
  }
}

