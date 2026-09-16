const {test}=require('node:test')
const assert=require('node:assert/strict')
const vm=require('node:vm')
const ts=require('typescript')
const fs=require('node:fs')
function setup(){
 const events=[], exports={}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/saveMotion.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,crypto:{randomUUID:()=> 'save-1'},CustomEvent:class{constructor(type,args){this.type=type;this.detail=args.detail}},window:{dispatchEvent:e=>events.push(e.detail.state)}})
 return {save:exports.withSaveMotion,events}
}
test('successful save returns the exact original result and only confirms after resolution',async()=>{
 const {save,events}=setup();let resolve
 const original={data:{id:'task'},error:null}
 const pending=save(new Promise(r=>resolve=r))
 assert.deepEqual(events,['saving']);resolve(original)
 assert.equal(await pending,original);assert.deepEqual(events,['saving','saved'])
})
test('database error is preserved and never produces a success check',async()=>{
 const {save,events}=setup(),original={data:null,error:{message:'rejected'}}
 assert.equal(await save(Promise.resolve(original)),original)
 assert.deepEqual(events,['saving','failed'])
})
test('rejected request propagates the same error without changing caller control flow',async()=>{
 const {save,events}=setup(),error=new Error('offline')
 await assert.rejects(save(Promise.reject(error)),e=>e===error)
 assert.deepEqual(events,['saving','failed'])
})
