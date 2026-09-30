// Event-first reconciliation. Healthy connections need only a slow safety net.
export function createRefreshScheduler({refresh,ready,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}:{refresh:()=>void;ready:()=>boolean;now?:()=>number;setTimer?:typeof setTimeout;clearTimer?:typeof clearTimeout}){
 let timer:ReturnType<typeof setTimeout>|undefined,disposed=false,last=now(),healthy=false
 const schedule=()=>{if(disposed||timer||!ready())return;timer=setTimer(()=>{timer=undefined;if(!disposed&&ready()){last=now();refresh()}},Math.max(500,2000-(now()-last)))}
 return {
  schedule,
  connection(status:string){healthy=status==='SUBSCRIBED';if(healthy)schedule()},
  recover(){if(now()-last>=(healthy?120000:30000))schedule()},
  dispose(){disposed=true;if(timer)clearTimer(timer)},
 }
}
