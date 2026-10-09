const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

function setup({ role = 'admin', signedIn = true, empty = false } = {}) {
  const queries = [], exports = {}
  const history = [
    { task_id: 'a', to_status: 'done', changed_by: 'target' },
    { task_id: 'a', to_status: 'approved', changed_by: 'reviewer' },
    { task_id: 'b', to_status: 'revision', changed_by: 'target' },
    { task_id: 'b', to_status: 'approved', changed_by: 'target' },
  ]
  const tasks = [{ id: 'a', assignee_id: 'target', track: 'Video' }, { id: 'b', assignee_id: 'other', track: 'Audio' }]
  const admin = { from(table) {
    const query = { table }; queries.push(query)
    const builder = {
      select() { return this },
      gte(_, value) { query.start = value; return this },
      lte() { return this },
      async in() { return { data: empty ? [] : table === 'tasks' ? tasks : history } },
    }
    return builder
  } }
  const session = {
    auth: { async getUser() { return { data: { user: signedIn ? { id: 'viewer' } : null } } } },
    from() { return { select() { return this }, eq() { return this }, async single() { return { data: { role } } } } },
  }
  const mocks = {
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    '@/lib/supabase/server': { createClient: async () => session },
    '@/lib/supabase/admin': { createAdminClient: () => admin },
    'date-fns': require('date-fns'),
  }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/workload/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, URL, require: name => { if (!(name in mocks)) throw Error(name); return mocks[name] } })
  return { queries, get: () => exports.GET({ url: 'https://example.test/api/workload?userId=target&month=2026-02' }) }
}

test('six months are read once each, including year rollover; counts stay deduplicated', async () => {
  const s = setup(), result = await s.get()
  assert.equal(result.status, 200)
  assert.equal(result.body.completed, 1)
  assert.equal(result.body.reviewed, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(result.body.byTrack)), { Video: { completed: 1, reviewed: 0 }, Audio: { completed: 0, reviewed: 1 } })
  assert.deepEqual(Array.from(result.body.trend, x => x.month), ['2025-09','2025-10','2025-11','2025-12','2026-01','2026-02'])
  assert.ok(result.body.trend.every(x => x.completed === 1 && x.reviewed === 1))
  const months = s.queries.filter(x => x.table === 'task_history').map(x => x.start)
  assert.equal(months.length, 6)
  assert.equal(new Set(months).size, 6)
  assert.equal(s.queries.filter(x => x.table === 'tasks').length, 6)
})

test('empty history avoids task reads and retains all six zero trend entries', async () => {
  const s = setup({ empty: true }), result = await s.get()
  assert.equal(s.queries.length, 6)
  assert.equal(result.body.completed, 0)
  assert.equal(result.body.reviewed, 0)
  assert.equal(result.body.trend.length, 6)
  assert.ok(result.body.trend.every(x => x.completed === 0 && x.reviewed === 0))
})

test('unauthenticated and member requests cannot run workload queries', async () => {
  for (const [options, status] of [[{ signedIn: false }, 401], [{ role: 'member' }, 403]]) {
    const s = setup(options)
    assert.equal((await s.get()).status, status)
    assert.equal(s.queries.length, 0)
  }
})
