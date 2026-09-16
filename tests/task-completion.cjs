const {test}=require('node:test')
const assert=require('node:assert/strict')
const vm=require('node:vm')
const ts=require('typescript')
const fs=require('node:fs')
const exportsObject={}
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/taskCompletion.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:exportsObject})
const complete=exportsObject.completionStatus
const task={status:'revision',approver_id:'reviewer',client_revision_parent_id:null}
test('client corrections skip review even with a named approver',()=>assert.equal(complete({...task,client_revision_parent_id:'client-task'}),'done'))
test('internal revisions still return to their approver',()=>assert.equal(complete(task),'in_review'))
test('unreviewed revisions can finish instead of becoming stranded',()=>assert.equal(complete({...task,approver_id:null}),'done'))
test('ordinary submissions do not inherit a stale correction bypass',()=>assert.equal(complete({...task,status:'in_progress',client_revision_parent_id:'old-round'}),'in_review'))
test('locked and completed tasks cannot be submitted',()=>{for(const status of ['locked','done','approved','in_review'])assert.equal(complete({...task,status}),null)})
