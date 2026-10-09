const { test } = require('node:test')
const assert = require('node:assert/strict')
const ts = require('typescript')
const fs = require('node:fs')
const vm = require('node:vm')
const exportsObject = {}
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/requestBatcher.ts','utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, { exports: exportsObject })
function setup(run) {
  let id = 0
  const timers = new Map(), errors = []
  const batcher = exportsObject.createRequestBatcher({
    run, setTimer: fn => { timers.set(++id, fn); return id },
    clearTimer: id => timers.delete(id), onError: error => errors.push(error),
  })
  return { ...batcher, timers, errors, flush() {
    const [id, fn] = timers.entries().next().value
    timers.delete(id)
    return fn()
  }}
}
test('50 row updates produce one read; an event during that read gets one trailing read', async () => {
  let calls = 0, resolve
  const b = setup(() => { calls++; return new Promise(r => { resolve = r }) })
  for (let i=0;i<50;i++) b.schedule()
  assert.equal(b.timers.size,1)
  const first = b.flush()
  assert.equal(calls,1)
  for (let i=0;i<50;i++) b.schedule()
  assert.equal(b.timers.size,0)
  resolve(); await first
  assert.equal(b.timers.size,1)
  const second = b.flush()
  resolve(); await second
  assert.equal(calls,2)
  assert.equal(b.timers.size,0)
})
test('failure releases the read lock and later events recover', async () => {
  let calls=0
  const b=setup(async()=>{if(++calls===1)throw Error('offline')})
  b.schedule();await b.flush()
  assert.equal(b.errors.length,1)
  b.schedule();await b.flush()
  assert.equal(calls,2)
})
test('unmount cancels queued reads and in-flight trailing reads',async()=>{
  let calls=0,resolve
  const b=setup(()=>{calls++;return new Promise(r=>{resolve=r})})
  b.schedule();b.dispose();b.schedule()
  assert.equal(b.timers.size,0);assert.equal(calls,0)
  const c=setup(()=>new Promise(r=>{resolve=r}))
  c.schedule();const pending=c.flush();c.schedule();c.dispose()
  resolve();await pending
  assert.equal(c.timers.size,0)
})
