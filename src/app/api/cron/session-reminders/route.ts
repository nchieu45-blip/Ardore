import { runCoachingEmails } from '@/lib/coaching-emails'
import { isCronAuthorized, cronJson } from '@/lib/cron'
import { runSessionNotifications } from '@/lib/session-cron'
import { isReminderSchedulerAuthorized } from '@/lib/reminder-scheduler-auth'
import { runGroupSessionReminders } from '@/lib/group-session-reminders'

export async function GET(request: Request) {
  const fullAccess = isCronAuthorized(request)
  if (!fullAccess && !isReminderSchedulerAuthorized(request)) return cronJson({ error: 'Unauthorized' }, 401)
  try {
    // One reminder type failing must not suppress the other one.
    const tasks = [runSessionNotifications('session_reminder'), runGroupSessionReminders()]
    if (fullAccess) tasks.push(runCoachingEmails())
    const outcomes = await Promise.allSettled(tasks)
    const result = { sent: 0, skipped: 0, failed: 0, legacySkipped: 0, busy: 0, held: 0 }
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') { result.failed++; continue }
      for (const key of Object.keys(result) as (keyof typeof result)[]) result[key] += outcome.value[key]
    }
    return cronJson(result, result.failed > 0 ? 503 : 200)
  } catch {
    return cronJson({ error: 'Session reminders could not be processed' }, 503)
  }
}
