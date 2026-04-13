import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPushToUser } from '@/lib/push'

export async function POST(request: NextRequest) {
  // Verify session
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { commentId, authorId, taskId, episodeId, body, assigneeId, parentAuthorId } = await request.json()

  const admin = createAdminClient()

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
          url: episodeId ? `/episodes/${episodeId}` : '/',
          tag: 'comment',
        })
      })
    )
  }

  return NextResponse.json({ ok: true })
}
