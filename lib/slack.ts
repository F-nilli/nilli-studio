// Slack Web API utilities — server-side only

export async function postToSlack(token: string, channel: string, blocks: object[]) {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel, blocks }),
  })
  return res.json() as Promise<{ ok: boolean; error?: string; team?: string }>
}

export async function testSlackToken(token: string) {
  const res = await fetch('https://slack.com/api/auth.test', {
    headers: { Authorization: `Bearer ${token}` },
  })
  return res.json() as Promise<{ ok: boolean; team?: string; error?: string }>
}

// ─── Block Kit builders ────────────────────────────────────────────────────────

export function buildApprovalBlocks({
  clientLabel,
  guestName,
  completedTaskLabel,
  nextTasks,
}: {
  clientLabel: string
  guestName: string
  completedTaskLabel: string
  nextTasks: Array<{ label: string; assigneeName: string }>
}) {
  const blocks: object[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${clientLabel} — ${guestName}`, emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `~${completedTaskLabel}~` },
    },
  ]

  if (nextTasks.length > 0) {
    const lines = nextTasks.map(t => `*${t.assigneeName}* — ${t.label}`).join('\n')
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `NEXT: ${lines}` },
    })
  }

  return blocks
}

export function buildRevisionBlocks({
  clientLabel,
  guestName,
  taskLabel,
  assigneeName,
  dueDate,
}: {
  clientLabel: string
  guestName: string
  taskLabel: string
  assigneeName: string
  dueDate?: string
}) {
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${clientLabel} — ${guestName}`, emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `🔴 ~${taskLabel}~` },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${assigneeName}* — revision requested${dueDate ? ` · due ${dueDate}` : ''}`,
      },
    },
  ]
}

export function buildCommentBlocks({
  clientLabel,
  guestName,
  taskLabel,
  authorName,
  body,
}: {
  clientLabel: string
  guestName: string
  taskLabel: string
  authorName: string
  body: string
}) {
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${clientLabel} — ${guestName}`, emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*${authorName}* commented on *${taskLabel}*:\n${body}` },
    },
  ]
}

export function buildReviewSubmittedBlocks({
  clientLabel,
  guestName,
  taskLabel,
  assigneeName,
}: {
  clientLabel: string
  guestName: string
  taskLabel: string
  assigneeName: string
}) {
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${clientLabel} — ${guestName}`, emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*${assigneeName}* submitted *${taskLabel}* for review` },
    },
  ]
}


export function buildReassignBlocks({
  clientLabel,
  guestName,
  taskLabel,
  fromName,
  toName,
}: {
  clientLabel: string
  guestName: string
  taskLabel: string
  fromName: string
  toName: string
}) {
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${guestName} / ${clientLabel}`, emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*${fromName}* reassigned *${taskLabel}* to *${toName}*` },
    },
  ]
}
