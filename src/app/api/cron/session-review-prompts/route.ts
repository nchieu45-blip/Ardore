import { isCronAuthorized, cronJson } from '@/lib/cron'
import { runSessionNotifications } from '@/lib/session-cron'

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return cronJson({ error: 'Unauthorized' }, 401)
  try {
    const result = await runSessionNotifications('session_review_prompt')
    return cronJson(result, result.failed > 0 ? 503 : 200)
  } catch {
    return cronJson({ error: 'Session review prompts could not be processed' }, 503)
  }
}
