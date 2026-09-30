const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm');const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/refreshScheduler.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:m.exports});let time=0,ready=true,calls=0,id=0,timers=new Map();const advance=ms=>{const end=time+ms;while(true){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;time=next[1].at;timers.delete(next[0]);next[1].fn()}time=end};const s=m.exports.createRefreshScheduler({refresh:()=>calls++,ready:()=>ready,now:()=>time,setTimer:(fn,ms)=>{timers.set(++id,{fn,at:time+ms});return id},clearTimer:i=>timers.delete(i)});
s.connection('SUBSCRIBED');for(let i=0;i<100;i++)s.schedule();advance(2000);assert.equal(calls,1);
advance(15000);s.recover();advance(1000);assert.equal(calls,1);
s.schedule();s.schedule();advance(500);assert.equal(calls,2); // event-driven, no need to wait for the interval
advance(120000);s.recover();advance(500);assert.equal(calls,3);
ready=false;s.schedule();advance(120000);s.recover();advance(1000);assert.equal(calls,3);
ready=true;s.schedule();advance(500);assert.equal(calls,4); // resume
s.connection('CHANNEL_ERROR');advance(30000);s.recover();advance(500);assert.equal(calls,5);
s.schedule();s.dispose();advance(5000);assert.equal(calls,5);
console.log('PASS: burst coalescing, event latency, healthy/degraded recovery, hidden/offline/paused guard, resume and disposal.');
