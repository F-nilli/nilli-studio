import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPushToUser } from '@/lib/push'

// Comment notification fan-out.
//
// Trust model: the client sends only a commentId. Everything else — who the
// author is, the comment body, the task, the assignee, the parent comment —
// is read from the database. The previous version trusted authorId/body/
// assigneeId/parentAuthorId from the request, so any logged-in user could
// forge notifications as someone else ("Francis mentioned you").

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest) {
  // Verify session
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let payload: { commentId?: unknown }
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const commentId = payload.commentId
  if (typeof commentId !== 'string' || !UUID_RE.test(commentId)) {
    return NextResponse.json({ error: 'Invalid commentId' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Load the comment itself — the source of truth for author, body, task,
  // episode, and parent. You may only fan out notifications for a comment
  // YOU authored in this session.
  const { data: comment } = await admin
    .from('comments')
    .select('id, author_id, body, task_id, episode_id, parent_comment_id')
    .eq('id', commentId)
    .maybeSingle()

  if (!comment) return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
  if (comment.author_id !== user.id) {
    return NextResponse.json({ error: 'You can only notify for your own comments' }, { status: 403 })
  }

  const authorId = user.id
  const body: string = comment.body ?? ''
  const taskId: string | null = comment.task_id ?? null
  const episodeId: string = comment.episode_id

  // Resolve the real recipients from the DB, not the request:
  // the task's current assignee and the parent comment's author.
  let assigneeId: string | null = null
  if (taskId) {
    const { data: task } = await admin.from('tasks').select('assignee_id').eq('id', taskId).maybeSingle()
    assigneeId = task?.assignee_id ?? null
  }

  let parentAuthorId: string | null = null
  if (comment.parent_comment_id) {
    const { data: parent } = await admin
      .from('comments')
      .select('author_id')
      .eq('id', comment.parent_comment_id)
      .maybeSingle()
    parentAuthorId = parent?.author_id ?? null
  }

  // Fetch all users to resolve @mentions by name
  const { data: allUsers } = await admin.from('users').select('id, name')
  if (!allUsers || allUsers.length === 0) return NextResponse.json({ ok: true })

  // Parse @mentions — match @FirstName or @First Last patterns
  const mentionMatches = body.match(/@([A-Za-z0-9]+(?:\s[A-Za-z0-9]+)?)/g) ?? []
  const mentionedUsernames: string[] = mentionMatches.map((m: string) => m.slice(1))

  const notifiedIds = new Set<string>()
  const inserts: object[] = []

  for (const username of mentionedUsernames) {
    const lower = username.toLowerCase()
    const mentionedUser = allUsers.find(u => {
      const uLower = u.name.toLowerCase()
      return uLower.startsWith(lower) || lower.startsWith(uLower.split(' ')[0])
    })
    if (mentionedUser && mentionedUser.id !== authorId && !notifiedIds.has(mentionedUser.id)) {
      notifiedIds.add(mentionedUser.id)
      inserts.push({
        user_id: mentionedUser.id,
        author_id: authorId,
        comment_id: commentId,
        task_id: taskId ?? null,
        episode_id: episodeId,
        type: 'mention',
        read: false,
      })
    }
  }

  // Parent comment author — notify on reply
  if (parentAuthorId && parentAuthorId !== authorId && !notifiedIds.has(parentAuthorId)) {
    notifiedIds.add(parentAuthorId)
    inserts.push({
      user_id: parentAuthorId,
      author_id: authorId,
      comment_id: commentId,
      task_id: taskId ?? null,
      episode_id: episodeId,
      type: 'mention',
      read: false,
    })
  }

  // Task assignee — if not already mentioned and not the author
  if (taskId && assigneeId && assigneeId !== authorId && !notifiedIds.has(assigneeId)) {
    inserts.push({
      user_id: assigneeId,
      author_id: authorId,
      comment_id: commentId,
      task_id: taskId,
      episode_id: episodeId,
      type: 'task_comment',
      read: false,
    })
  }

  if (inserts.length > 0) {
    await admin.from('message_notifications').insert(inserts)

    // Send push notifications
    const authorName = allUsers.find(u => u.id === authorId)?.name ?? 'Someone'
    await Promise.allSettled(
      inserts.map(ins => {
        const i = ins as { user_id: string; type: string }
        const title = i.type === 'mention' ? `${authorName} mentioned you` : `${authorName} commented on your task`
        return sendPushToUser(i.user_id, {
          title,
          body: body.slice(0, 100),
          url: `/episodes/${episodeId}`,
          tag: 'comment',
        })
      })
    )
  }

  return NextResponse.json({ ok: true })
}
