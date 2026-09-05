// Slack Web API utilities — server-side only

export async function postToSlack(token: string, channel: string, blocks: object[]) {
  // Derive a plain-text fallback from the first header or section block
  // (used by Slack for mobile push previews and accessibility)
  type AnyBlock = { type: string; text?: { text: string } }
  const fallback = (blocks as AnyBlock[]).find(b => b.type === 'header' || b.type === 'section')?.text?.text ?? 'Nilli Studio update'

  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel, blocks, text: fallback }),
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
  approverName,
}: {
  clientLabel: string
  guestName: string
  completedTaskLabel: string
  nextTasks: Array<{ label: string; assigneeName: string }>
  approverName?: string
}) {
  const blocks: object[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${clientLabel} — ${guestName}`, emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `✅ Approved: ~${completedTaskLabel}~${approverName ? `\nApproved by ${approverName}` : ''}` },
    },
  ]

  if (nextTasks.length > 0) {
    const lines = nextTasks.map(t => `*${t.assigneeName}* — ${t.label}`).join('\n')
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*NEXT:*\n${lines}` },
    })
  }

  return blocks
}

export function buildDoneBlocks({
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
      text: { type: 'mrkdwn', text: `✔️ Completed: ~${taskLabel}~\n${assigneeName}` },
    },
  ]
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
  version,
}: {
  clientLabel: string
  guestName: string
  taskLabel: string
  assigneeName: string
  version?: number
}) {
  const versionTag = version && version > 0 ? ` (v${version})` : ''
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${clientLabel} — ${guestName}`, emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*${assigneeName}* submitted *${taskLabel}*${versionTag} for review` },
    },
  ]
}


export function buildNewProjectBlocks({
  clientLabel,
  guestName,
  releaseDate,
  releaseTime,
}: {
  clientLabel: string
  guestName: string
  releaseDate: string
  releaseTime: string | null
}) {
  const releaseParts = [releaseDate, releaseTime].filter(Boolean).join(' · ')
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${clientLabel} — ${guestName}`, emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `🎙️ New project created · releases *${releaseParts}*` },
    },
  ]
}

export function buildReleaseDateChangedBlocks({
  clientLabel,
  guestName,
  newDate,
  newTime,
}: {
  clientLabel: string
  guestName: string
  newDate: string
  newTime: string | null
}) {
  const dateDisplay = newTime ? `${newDate} · ${newTime}` : newDate
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${clientLabel} — ${guestName}`, emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `📅 Release date updated to *${dateDisplay}*` },
    },
  ]
}

export function buildEpisodeDeliveredBlocks({
  clientLabel,
  guestName,
  deliveredByName,
  autoCompleted,
}: {
  clientLabel: string
  guestName: string
  deliveredByName?: string | null
  autoCompleted?: boolean
}) {
  const message = autoCompleted
    ? 'Episode auto-completed — all tasks done'
    : `Episode marked as delivered by *${deliveredByName ?? 'unknown'}*`
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${clientLabel} — ${guestName}`, emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: message },
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

// ─── Custom message templates ──────────────────────────────────────────────────
// Workspace-editable plain-text templates with {placeholder} tokens, stored in
// workspace_settings.slack_templates. An event with no saved template keeps
// using its built-in builder above — defaults only apply once edited & saved.

export interface TemplateVars {
  client: string
  project: string
  task: string
  assignee: string
  approver: string
  author: string
  comment: string
  from: string
  to: string
  date: string
  time: string
  version: string
  by: string
  next_tasks: string
}

/** Which placeholders are meaningful for each Slack event type */
export const SLACK_TEMPLATE_VARS: Record<string, (keyof TemplateVars)[]> = {
  done: ['task', 'assignee'],
  approval: ['task', 'approver', 'next_tasks'],
  review_submitted: ['task', 'assignee', 'version'],
  revision: ['task', 'assignee', 'date'],
  comment: ['task', 'author', 'comment'],
  reassign: ['task', 'from', 'to'],
  release_date_changed: ['date', 'time'],
  new_project: ['date', 'time'],
  episode_delivered: ['by'],
}

/** Starting text shown in the editor — mirrors the built-in messages */
export const SLACK_TEMPLATE_DEFAULTS: Record<string, string> = {
  done: '✔️ Completed: ~{task}~\n{assignee}',
  approval: '✅ Approved: ~{task}~\nApproved by {approver}\n\n*NEXT:*\n{next_tasks}',
  review_submitted: '*{assignee}* submitted *{task}*{version} for review',
  revision: '🔴 ~{task}~\n*{assignee}* — revision requested · due {date}',
  comment: '*{author}* commented on *{task}*:\n{comment}',
  reassign: '*{from}* reassigned *{task}* to *{to}*',
  release_date_changed: '📅 Release date updated to *{date} {time}*',
  new_project: '🎙️ New project created · releases *{date} · {time}*',
  episode_delivered: 'Episode marked as delivered by *{by}*',
}

/**
 * Replace {key} tokens with values. Known keys render their value (empty
 * string if unset); unrecognized tokens are left as-is so typos stay visible.
 */
export function renderSlackTemplate(template: string, vars: Partial<TemplateVars>): string {
  return template.replace(/\{([a-z_]+)\}/g, (raw, key: string) => {
    if (key in vars) return vars[key as keyof TemplateVars] ?? ''
    return raw
  })
}

/** Wrap a rendered custom template in the standard header + section blocks */
export function buildTemplateBlocks(clientLabel: string, guestName: string, rendered: string) {
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${clientLabel} — ${guestName}`, emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: rendered },
    },
  ]
}
