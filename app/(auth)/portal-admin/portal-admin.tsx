'use client'
import { useEffect,useState } from 'react'
import InvoiceHistory from './invoice-history'
type Client={id:string;label:string}
type Account={id:string;client_id:string;creator_user_id:string|null;qbo_customer_id:string|null;customer_name:string|null;enabled:boolean;payment_url?:string|null}
type Data={environment:string;legacyAccounts:number;clients:Client[];accounts:Account[];missing:string[];sync:null|{state:string;last_success_at:string|null;last_error:string|null;dirty_version:number;synced_version:number}}
const input={background:'#1e1e1e',border:'1px solid #444',borderRadius:6,padding:10,color:'white',width:'100%'}
const button={...input,width:'auto',marginRight:12}
async function api(path:string,body?:unknown){const r=await fetch('/api/portal/admin/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok)throw new Error(d.error);return d}
export default function PortalAdmin(){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[justConnected,setJustConnected]=useState(false)
 async function load(){setData(await api('status'))}
 useEffect(()=>{const u=new URL(window.location.href);if(u.searchParams.has('connected'))setJustConnected(true);if(u.searchParams.has('connectionError'))setError('QuickBooks authorization did not complete. Check the configured company and try connecting again.');u.searchParams.delete('connected');u.searchParams.delete('connectionError');window.history.replaceState(window.history.state,'',u.pathname+u.search+u.hash);load().catch(e=>setError(e.message))},[])
 async function run(fn:()=>Promise<void>){setBusy(true);setError('');try{await fn()}catch(e){setError(e instanceof Error?e.message:'Request failed.')}finally{setBusy(false)}}
 return <div style={{padding:32,maxWidth:1100}}>
 <h1 style={{fontSize:28,fontWeight:700}}>Creator portals</h1>
 <p style={{color:'#aaa',margin:'12px 0 24px'}}>Connect each client to a verified QuickBooks customer. Invoices update automatically after setup.</p>
 {error&&<p role="alert" style={{color:'#ff9a7b',margin:16}}>{error}</p>}
 {!data?<p>Apply migration_portal_scoped_connections.sql in the production Supabase project if setup is incomplete.</p>:<>
 <section style={{padding:24,background:'#1e1e1e',borderRadius:12,marginBottom:24}}>
 <h2>QuickBooks · {data.environment==='production'?'Production':'Sandbox'}</h2>
 <p style={{marginTop:12,fontWeight:600}}>{data.sync?.state==='connected'?'Connected':data.sync?.state==='disconnect_pending'?'Disconnect pending · synchronization stopped':data.sync?.state==='reconnect_required'?'Reconnection required':'Not connected'}</p>
 {justConnected&&data.sync?.state==='connected'&&<p role="status" style={{color:'#bce8cb'}}>QuickBooks connected successfully. Verify each customer below, then sync invoices.</p>}
 {data.legacyAccounts>0&&<p style={{marginTop:12,color:'#ffb18f'}}>Previous setup records are preserved separately and are not used here. Enter the real customer IDs for this company; do not reuse sandbox IDs.</p>}
 <p style={{margin:'12px 0'}}>Last successful sync: {data.sync?.last_success_at?new Date(data.sync.last_success_at).toLocaleString():'Not synchronized'}</p>
 {data.sync?.last_error&&<p role="alert">{data.sync.last_error}</p>}
 {data.missing.length>0&&<p style={{color:'#ff9a7b'}}>Configuration needed: {data.missing.join(', ')}</p>}
 <button disabled={busy||data.sync?.state==='disconnect_pending'} style={button} onClick={()=>run(async()=>{const d=await api('qbo-connect',{});window.location.assign(d.url)})}>{data.sync?'Reconnect QuickBooks':'Connect QuickBooks'}</button>
 <button disabled={busy||data.sync?.state!=='connected'} style={button} onClick={()=>run(async()=>{await api('sync',{});await load()})}>Sync now</button>
 {data.sync&&data.sync.state!=='disconnected'&&<a href="/portal-admin/disconnect" style={{textDecoration:'underline'}}>Disconnect QuickBooks</a>}
 </section>
 {data.clients.map(c=><AccountForm key={c.id+(data.accounts.find(a=>a.client_id===c.id)?.id||'new')} client={c} account={data.accounts.find(a=>a.client_id===c.id)} busy={busy} connected={data.sync?.state==='connected'} save={b=>run(async()=>{await api('account',b);await load()})} preview={id=>run(async()=>{const d=await api('preview',{account_id:id});window.location.assign(d.url)})}/>)}
 </>}
 <p style={{marginTop:24}}><a href="mailto:info@nillistudio.com">Contact support</a> · <a href="https://www.nillistudio.com/creator-portal/terms">Terms</a> · <a href="https://www.nillistudio.com/creator-portal/privacy">Privacy</a></p>
 </div>
}
function AccountForm({client,account,busy,connected,save,preview}:{client:Client;account?:Account;busy:boolean;connected:boolean;save:(b:unknown)=>void;preview:(id:string)=>void}){
 const [user,setUser]=useState(account?.creator_user_id||''),[customer,setCustomer]=useState(account?.qbo_customer_id||''),[enabled,setEnabled]=useState(account?.enabled||false),[payment,setPayment]=useState(account?.payment_url||''),[name,setName]=useState(account?.customer_name||''),[confirmed,setConfirmed]=useState(!!account?.customer_name),[checking,setChecking]=useState(false),[error,setError]=useState('')
 async function verify(){setChecking(true);setError('');setName('');setConfirmed(false);try{const d=await api('customer-check',{customer_id:customer});setName(d.name)}catch(e){setError(e instanceof Error?e.message:'Unable to verify customer.')}finally{setChecking(false)}}
 return <section style={{background:'#1e1e1e',border:'1px solid #333',padding:24,borderRadius:12,marginBottom:20}}>
 <h2 style={{fontSize:20,marginBottom:16}}>{client.label}</h2>
 <form onSubmit={e=>{e.preventDefault();save({client_id:client.id,creator_user_id:user,qbo_customer_id:customer,customer_confirmation:confirmed?name:null,enabled,payment_url:payment})}}>
 <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:16}}>
 <label>Creator auth user ID<input style={input} value={user} onChange={e=>setUser(e.target.value)} placeholder="Separate creator-auth project UUID"/></label>
 <label>QuickBooks customer ID<input style={input} value={customer} disabled={!!account?.qbo_customer_id||checking} onChange={e=>{setCustomer(e.target.value);setName('');setConfirmed(false)}} pattern="[0-9]*" placeholder="Customer ID from this QuickBooks company"/></label>
 </div>
 {!account?.customer_name&&<button type="button" style={{...button,marginTop:12}} disabled={!connected||busy||checking||!customer} onClick={verify}>{checking?'Checking…':'Verify customer'}</button>}
 {name&&<label style={{display:'block',margin:'16px 0'}}><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> I confirm “{name}” is the QuickBooks customer for {client.label}.</label>}
 {error&&<p role="alert">{error}</p>}
 <label style={{display:'block',marginTop:16}}>Payment link (optional)<input type="url" style={input} value={payment} onChange={e=>setPayment(e.target.value)} placeholder="https://…" maxLength={2048}/></label>
 <label style={{display:'block',margin:'16px 0'}}><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/> Enable creator portal</label>
 <button disabled={busy||checking||!!customer&&!confirmed} style={{...button,background:'#e03200'}}>Save account</button>
 {account?.enabled&&<button type="button" disabled={busy} style={button} onClick={()=>preview(account.id)}>View as creator ↗</button>}
 </form>{account&&<InvoiceHistory accountId={account.id} clientName={client.label}/>}</section>
}
