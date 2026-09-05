import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { postToSlack, buildApprovalBlocks, buildRevisionBlocks, buildReviewSubmittedBlocks, buildCommentBlocks, buildReassignBlocks, buildReleaseDateChangedBlocks, buildNewProjectBlocks, buildEpisodeDeliveredBlocks, buildDoneBlocks } from '@/lib/slack'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { type, episodeId, completedTaskLabel, nextTasks, taskLabel, assigneeName, dueDate, authorName, commentBody, fromName, toName, newDate, newTime, deliveredByName, approverName, version } = body

  const admin = createAdminClient()

  const { data: settingsRows, error: settingsError } = await admin
    .from('workspace_settings')
    .select('slack_bot_token, slack_notifications')
    .limit(1)
  if (settingsError) {
    console.error('[Slack notify] settings read error:', JSON.stringify(settingsError))
    return NextResponse.json({ skipped: 'settings_error' })
  }
  const settings = settingsRows?.[0] ?? null
  if (!settings?.slack_bot_token) return NextResponse.json({ skipped: 'no_token' })

  // Check if this notification type is enabled (default: true if not configured)
  const notifPrefs = (settings as any).slack_notifications ?? {}
  if (notifPrefs[type] === false) return NextResponse.json({ skipped: 'disabled' })

  const { data: episode } = await admin
    .from('episodes')
    .select('client_key, client_label, guest_name')
    .eq('id', episodeId)
    .single()
  if (!episode) return NextResponse.json({ skipped: 'no_episode' })

  // Use limit(1) instead of .single() to avoid silent failures when there are
  // duplicate rows for the same key (e.g. an inactive legacy record alongside
  // the active one — .single() returns null for 2+ rows with no error logged).
  const { data: clientRows, error: clientError } = await admin
    .from('clients')
    .select('slack_channel_id')
    .eq('key', episode.client_key)
    .eq('active', true)
    .limit(1)
  if (clientError) {
    console.error('[Slack notify] client lookup error:', JSON.stringify(clientError), { client_key: episode.client_key })
    return NextResponse.json({ skipped: 'client_error' })
  }
  const client = clientRows?.[0] ?? null
  if (!client?.slack_channel_id) {
    console.warn('[Slack notify] no channel for client_key:', episode.client_key, '— rows found:', clientRows?.length ?? 0)
    return NextResponse.json({ skipped: 'no_channel' })
  }

  const clientLabel = episode.client_label
  const guestName = episode.guest_name

  let blocks: object[]
  if (type === 'approval') {
    blocks = buildApprovalBlocks({ clientLabel, guestName, completedTaskLabel, nextTasks: nextTasks || [], approverName })
  } else if (type === 'done') {
    blocks = buildDoneBlocks({ clientLabel, guestName, taskLabel, assigneeName })
  } else if (type === 'revision') {
    blocks = buildRevisionBlocks({ clientLabel, guestName, taskLabel, assigneeName, dueDate })
  } else if (type === 'review_submitted') {
    blocks = buildReviewSubmittedBlocks({ clientLabel, guestName, taskLabel, assigneeName, version })
  } else if (type === 'comment') {
    blocks = buildCommentBlocks({ clientLabel, guestName, taskLabel, authorName, body: commentBody })
  } else if (type === 'reassign') {
    blocks = buildReassignBlocks({ clientLabel, guestName, taskLabel, fromName, toName })
  } else if (type === 'release_date_changed') {
    blocks = buildReleaseDateChangedBlocks({ clientLabel, guestName, newDate, newTime: newTime ?? null })
  } else if (type === 'new_project') {
    blocks = buildNewProjectBlocks({ clientLabel, guestName, releaseDate: newDate, releaseTime: newTime ?? null })
  } else if (type === 'episode_delivered') {
    blocks = buildEpisodeDeliveredBlocks({ clientLabel, guestName, deliveredByName: deliveredByName ?? 'Someone' })
  } else {
    return NextResponse.json({ error: 'Unknown type' }, { status: 400 })
  }

  const result = await postToSlack(settings.slack_bot_token, client.slack_channel_id, blocks)
  if (!result.ok) {
    console.error('[Slack] postMessage failed:', result.error, { type, episodeId })
    return NextResponse.json({ error: result.error }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
