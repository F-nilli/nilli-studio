import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { postToSlack, buildApprovalBlocks, buildRevisionBlocks, buildReviewSubmittedBlocks, buildCommentBlocks, buildReassignBlocks } from '@/lib/slack'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { type, episodeId, completedTaskLabel, nextTasks, taskLabel, assigneeName, dueDate, authorName, commentBody, fromName, toName } = body

  const admin = createAdminClient()

  const { data: settings } = await admin.from('workspace_settings').select('slack_bot_token').single()
  if (!settings?.slack_bot_token) return NextResponse.json({ skipped: 'no_token' })

  const { data: episode } = await admin
    .from('episodes')
    .select('client_key, client_label, guest_name')
    .eq('id', episodeId)
    .single()
  if (!episode) return NextResponse.json({ skipped: 'no_episode' })

  const { data: client } = await admin
    .from('clients')
    .select('slack_channel_id')
    .eq('key', episode.client_key)
    .single()
  if (!client?.slack_channel_id) return NextResponse.json({ skipped: 'no_channel' })

  const clientLabel = episode.client_label
  const guestName = episode.guest_name

  let blocks: object[]
  if (type === 'approval') {
    blocks = buildApprovalBlocks({ clientLabel, guestName, completedTaskLabel, nextTasks: nextTasks || [] })
  } else if (type === 'revision') {
    blocks = buildRevisionBlocks({ clientLabel, guestName, taskLabel, assigneeName, dueDate })
  } else if (type === 'review_submitted') {
    blocks = buildReviewSubmittedBlocks({ clientLabel, guestName, taskLabel, assigneeName })
  } else if (type === 'comment') {
    blocks = buildCommentBlocks({ clientLabel, guestName, taskLabel, authorName, body: commentBody })
  } else if (type === 'reassign') {
    blocks = buildReassignBlocks({ clientLabel, guestName, taskLabel, fromName, toName })
  } else {
    return NextResponse.json({ error: 'Unknown type' }, { status: 400 })
  }

  const result = await postToSlack(settings.slack_bot_token, client.slack_channel_id, blocks)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
  return NextResponse.json({ ok: true })
}
