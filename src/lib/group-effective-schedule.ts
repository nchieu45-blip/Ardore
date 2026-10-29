import type { SupabaseClient } from '@supabase/supabase-js'

/** A booking's occurrence identity and its payment agreement never change. */
export async function effectiveGroupStart(client: SupabaseClient, classId: string, occurrence: string) {
  const { data, error } = await client.from('group_occurrence_schedules').select('scheduled_at')
    .eq('video_class_id', classId).eq('occurrence_start', occurrence).maybeSingle()
  if (error) throw new Error('group_schedule_unavailable')
  return data?.scheduled_at as string | undefined ?? occurrence
}
