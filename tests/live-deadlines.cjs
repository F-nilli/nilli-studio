const { test } = require('node:test')
const assert = require('node:assert/strict')
const ts = require('typescript')
const fs = require('node:fs')
const vm = require('node:vm')
function load(file, mocks = {}, globals = {}) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
    { exports, require: name => mocks[name] || require(name), ...globals })
  return exports
}
test('deadline precision, terminal states, review age and timezone offsets', () => {
  const now = Date.parse('2026-09-14T14:30:00Z')
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])) } static now() { return now } }
  const { isOverdue, parseDate } = load('lib/utils.ts', {}, { Date: Clock })
  assert.equal(isOverdue('2026-09-14T14:00:00Z', 'in_progress'), true)
  assert.equal(isOverdue('2026-09-14T15:00:00Z', 'in_progress'), false)
  assert.equal(isOverdue('2026-09-14T14:30:00Z', 'in_progress'), false)
  for (const status of ['done', 'approved', 'locked', 'in_review']) assert.equal(isOverdue('2026-09-13T00:00:00Z', status), false)
  assert.equal(isOverdue('2026-09-15T00:00:00Z', 'in_review', true, '2026-09-12T00:00:00Z'), false)
  assert.equal(parseDate('2026-09-14T10:00:00-04:00').toISOString(), '2026-09-14T14:00:00.000Z')
  assert.equal(isOverdue('2026-09-14T10:00:00-04:00', 'revision'), true)
  assert.equal(isOverdue(null, 'in_progress'), false)
  // Submission suspends even an already-late deadline; revisions use the replacement.
  assert.equal(isOverdue('2026-09-14T10:00:00Z', 'in_review', true), false)
  assert.equal(isOverdue('2026-09-14T16:00:00Z', 'revision', true), false)
  assert.equal(isOverdue('2026-09-14T14:00:00Z', 'revision', true), true)
})
test('recovery refresh works without count changes; events coalesce and cleanup stops work', () => {
  let cleanup, refreshes = 0, ticks = 0, removed = false, subscribed
  const intervals = new Map(), timeouts = new Map(), handlers = {}, listeners = {}
  let id = 0
  const router = { refresh: () => refreshes++ }
  const channel = { on(_event, filter, callback) { handlers[filter.table] = callback; return this }, subscribe(callback) { subscribed = callback; return this } }
  const document = { visibilityState: 'visible', addEventListener: (n,f) => listeners[n]=f, removeEventListener: n => delete listeners[n] }
  const window = { addEventListener: (n,f) => listeners[n]=f, removeEventListener: n => delete listeners[n] }
  const { useLiveRefresh } = load('lib/useLiveRefresh.ts', {
    react: { useEffect: f => cleanup=f(), useState: () => [0, () => ticks++], useRef: value => ({current:value}) },
    'next/navigation': { useRouter: () => router },
    '@/lib/supabase/client': { createClient: () => ({channel: () => channel, removeChannel: () => {removed=true}}) }
  }, {document, window, navigator:{onLine:true}, crypto:{randomUUID:()=> 'test'}, setInterval:(f,ms)=> {intervals.set(ms,f);return ms}, clearInterval:id=>intervals.delete(id), setTimeout:f=>{timeouts.set(++id,f);return id}, clearTimeout:id=>timeouts.delete(id)})
  useLiveRefresh()
  intervals.get(15000)(); assert.equal(refreshes,1)
  handlers.tasks(); handlers.episodes(); assert.equal(timeouts.size,1)
  const flush = () => {const pending=[...timeouts.values()];timeouts.clear();pending.forEach(f=>f())}
  flush(); assert.equal(refreshes,2)
  subscribed('SUBSCRIBED'); flush(); assert.equal(refreshes,3)
  document.visibilityState='hidden';intervals.get(15000)();assert.equal(refreshes,3)
  document.visibilityState='visible';listeners.visibilitychange();flush();assert.equal(refreshes,4)
  intervals.get(10000)();assert.ok(ticks>0)
  cleanup();assert.equal(removed,true);assert.equal(intervals.size,0);assert.equal(Object.keys(listeners).length,0)
})
