// Enhance controls without changing form submission or save behavior.
export function showSuccess(node,message){node.replaceChildren();const icon=document.createElement('span');icon.className='t-success-check';icon.dataset.state='in';icon.setAttribute('aria-hidden','true');icon.innerHTML='<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path pathLength="20" d="m5.5 10 3 3 6-6"/></svg>';node.append(icon,document.createTextNode(' '+message))}
const tabs=new Map();
function enhance(){
 document.querySelectorAll('input[type=checkbox]:not([data-keep-checkbox])').forEach(input=>{if(input.closest('.t-toggle'))return;const wrap=document.createElement('span');wrap.className='t-toggle';input.before(wrap);wrap.append(input);input.setAttribute('role','switch');const thumb=document.createElement('span');thumb.className='t-toggle-thumb';thumb.setAttribute('aria-hidden','true');wrap.append(thumb);input.addEventListener('change',()=>wrap.classList.add('is-init'))});
 for(const [host,entry] of tabs)if(!host.isConnected){entry.observer.disconnect();tabs.delete(host)}
 document.querySelectorAll('[role=tablist]').forEach(host=>{
  if(tabs.has(host)){tabs.get(host).measure(false);return}
  host.classList.add('t-tabs');const pill=document.createElement('span');pill.className='t-tabs-pill';pill.setAttribute('aria-hidden','true');host.prepend(pill);
  const measure=snap=>{const active=host.querySelector('[aria-selected=true]');if(!active)return;const x=active.offsetLeft,y=active.offsetTop,w=active.offsetWidth,h=active.offsetHeight,key=[x,y,w,h].join();if(pill.dataset.position===key)return;if(snap)pill.style.transition='none';pill.style.transform=`translate(${x}px,${y}px)`;pill.style.width=w+'px';pill.style.height=h+'px';pill.dataset.position=key;if(snap){void pill.offsetWidth;pill.style.transition=''}};
  const observer=new ResizeObserver(()=>measure(true));observer.observe(host);host.querySelectorAll('[role=tab]').forEach(b=>observer.observe(b));tabs.set(host,{observer,measure});measure(true)
 })
}
let scheduled=false;new MutationObserver(()=>{if(!scheduled){scheduled=true;queueMicrotask(()=>{scheduled=false;enhance()})}}).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-selected']});enhance();
