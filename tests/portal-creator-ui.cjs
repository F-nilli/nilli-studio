const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
// DOM boundary stub exercises actual render/navigation code without auth credentials
// or live API calls. Browser layout QA remains a separate release check.
function fixture(){const nodes=new Map();const element=()=>({innerHTML:'',textContent:'',dataset:{},setAttribute(){},removeAttribute(){},focus(){},animate(){},classList:{toggle(){},remove(){},add(){}},onclick:null});const get=s=>{if(!nodes.has(s))nodes.set(s,element());return nodes.get(s)};const nav=['home','production','library','invoices','package','performance','nascar'].map(page=>({...element(),dataset:{page}}));const calls=[];const project={id:'a',title:'An episode <script>bad()</script>',format:'Podcast',release_date:'2026-10-01',status:'ready_for_review',review_url:'https://f.io/review',review_ready:true};const data={account:{client:{label:'Test creator'},paymentUrl:null},preview:true,invoices:[],sync:{}};const utils={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('public/creator-portal/preferences.js','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:utils.exports,Date,Intl,Number});const context=vm.createContext({...utils.exports,document:{hidden:false,addEventListener(){},querySelector:get,querySelectorAll:s=>s==='nav [data-page]'?nav:[]},window:{addEventListener(){},scrollY:0,scrollTo(){}},history:{pushState(){},replaceState(){}},location:{pathname:'/live.html',search:'',hash:'',assign(){}},matchMedia:()=>({matches:true}),fetch:async url=>{calls.push(url);const value=url.endsWith('/me')?data:url.includes('section=home')?{project,current:true,activeCount:2}:{projects:[{...project,status:'published',published_at:'2026-09-20',publication_url:'https://youtube.com/watch?v=test'}],nextOffset:null};return {ok:true,json:async()=>value}},URL,URLSearchParams,Date,Intl,setTimeout,setInterval(){},API_ORIGIN:'https://backend.example'});let src=fs.readFileSync('public/creator-portal/live.js','utf8').replace("import {API_ORIGIN} from './config.js';",'').replace("import {preferences,displayDate,originalMoney,convertMoney} from './preferences.js';",'');src=src.slice(0,src.lastIndexOf('start().catch'));vm.runInContext(src,context);return {context,nodes,nav,calls,get}}
test('full creator preview opens Home and retains identity across Production, Library and Invoices',async()=>{const f=fixture();await vm.runInContext('dashboard()',f.context);assert.match(f.get('#live').innerHTML,/Viewing the full creator experience/);assert.match(f.get('#page-content').innerHTML,/Next in production/);assert.doesNotMatch(f.get('#page-content').innerHTML,/View all|See more/);assert.match(f.get('#page-content').innerHTML,/Last 28 days/);assert.doesNotMatch(f.get('#page-content').innerHTML,/<script>/);await vm.runInContext("navigate('production')",f.context);assert.ok(f.calls.at(-1).includes('section=active'));await vm.runInContext("navigate('library')",f.context);assert.match(f.get('#page-content').innerHTML,/Watch published content/);await vm.runInContext("navigate('invoices')",f.context);assert.match(f.get('#page-content').innerHTML,/No invoices available yet/);assert.equal(vm.runInContext('preview',f.context),true);});
test('cards do not offer an unreleased review link or unsafe published link',()=>{const f=fixture();const html=vm.runInContext("projectCard({title:'Private draft',format:'Podcast',status:'in_progress',release_date:'2026-09-20',review_url:'https://f.io/private',review_ready:false,publication_url:'javascript:alert(1)'})",f.context);assert.doesNotMatch(html,/href=/);});

test('background refresh preserves unchanged markup and skips hidden pages',async()=>{const f=fixture();await vm.runInContext('dashboard()',f.context);const html=f.get('#page-content').innerHTML;await vm.runInContext("navigate('home',false,true)",f.context);assert.equal(f.get('#page-content').innerHTML,html);assert.equal(vm.runInContext('pageLoading',f.context),false);const n=f.calls.length;vm.runInContext("token='test';document.hidden=true;refreshVisible()",f.context);assert.equal(f.calls.length,n);});

test('creator preview cannot update auth or reauthenticate as a client',async()=>{const f=fixture();await vm.runInContext('dashboard()',f.context);await assert.rejects(vm.runInContext("authUser({email:'other@example.com'})",f.context),/preview/);await assert.rejects(vm.runInContext("reauthenticate('password')",f.context),/creator account/);assert.equal(f.calls.filter(u=>u.includes('/auth/')).length,0)});


test('shared entrance keeps Brand informational and preserves creator fields across keyboard tab changes',async()=>{
 const f=fixture(),attributes=new Map();
 const tabs=['creator','brand'].map(name=>({disabled:false,tabIndex:0,getAttribute:key=>key==='aria-controls'?name+'-login':attributes.get(name+key),setAttribute:(key,value)=>attributes.set(name+key,value),focus(){this.focused=true}}));
 f.get('#live').querySelectorAll=()=>tabs;
 f.context.document.getElementById=id=>f.get('#'+id);
 vm.runInContext('login()',f.context);
 assert.match(f.get('#live').innerHTML,/Brand <span>Coming soon/);
 assert.match(f.get('#live').innerHTML,/id="brand-login"[^>]* hidden/);
 assert.equal(f.calls.length,0);
 const form=f.get('#login');form.email={value:'creator@example.com'};form.password={value:'test-only'};
 tabs[0].onkeydown({key:'ArrowRight',preventDefault(){}});
 assert.equal(f.get('#creator-login').hidden,true);assert.equal(f.get('#brand-login').hidden,false);
 assert.equal(attributes.get('brandaria-selected'),'true');assert.equal(tabs[1].focused,true);
 tabs[1].onclick();assert.equal(f.calls.length,0);
 tabs[1].onkeydown({key:'Home',preventDefault(){}});
 assert.equal(f.get('#creator-login').hidden,false);assert.equal(form.email.value,'creator@example.com');
 const button={disabled:false};form.querySelector=()=>button;
 let release;f.context.fetch=async()=>{f.calls.push('request');await new Promise(r=>release=r);throw new Error('Connection unavailable')};
 const pending=form.onsubmit({preventDefault(){},currentTarget:form});
 await new Promise(r=>setImmediate(r));assert.equal(button.disabled,true);assert.ok(tabs.every(t=>t.disabled));
 await form.onsubmit({preventDefault(){},currentTarget:form});assert.equal(f.calls.length,1);
 release();await pending;
 assert.equal(button.disabled,false);assert.ok(tabs.every(t=>!t.disabled));
 assert.equal(form.email.value,'creator@example.com');assert.equal(form.password.value,'');
 assert.match(f.get('#login-error').textContent,/Connection unavailable/);
});
