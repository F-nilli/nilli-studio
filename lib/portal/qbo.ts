import { check, db, locked } from './store'
import { decrypt, encrypt, normalizeInvoice, PortalError, required, qboEnvironment, qboScope } from './core'

type Tokens={access_token:string;refresh_token:string;expires_in:number}
type Payload={realm:string;tokens:Tokens}
type Discovery={authorization_endpoint:string;token_endpoint:string;revocation_endpoint:string}
let discoveryCache: {value:Discovery;expires:number}|undefined
export async function endpoints():Promise<Discovery>{
 if(discoveryCache&&discoveryCache.expires>Date.now())return discoveryCache.value
 const r=await fetch('https://developer.intuit.com/.well-known/openid_configuration/',{signal:AbortSignal.timeout(15000),next:{revalidate:3600}})
 if(!r.ok)throw new PortalError(503,'QuickBooks discovery is unavailable. Try again later.')
 const d=await r.json()
 const allowed={authorization_endpoint:'https://appcenter.intuit.com',token_endpoint:'https://oauth.platform.intuit.com',revocation_endpoint:'https://developer.api.intuit.com'}
 for(const [field,origin] of Object.entries(allowed)){const url=new URL(d[field]);if(url.origin!==origin||url.username||url.password)throw new PortalError(503,'Unexpected QuickBooks endpoint.')}
 discoveryCache={value:d,expires:Date.now()+3600000};return d
}
function authHeader(){return 'Basic '+Buffer.from(required('QBO_CLIENT_ID')+':'+required('QBO_CLIENT_SECRET')).toString('base64')}
function apiBase(){return qboEnvironment()==='sandbox'?'https://sandbox-quickbooks.api.intuit.com':'https://quickbooks.api.intuit.com'}
async function diagnose(operation:string,r:Response|undefined,code:string){
 // Never save response bodies, URLs, credentials, company IDs, invoice data or user input.
 const tid=r?.headers.get('intuit_tid')||r?.headers.get('intuit-tid')||''
 await db().from('portal_diagnostics').insert({scope:qboScope(),operation,http_status:r?.status||null,intuit_tid:/^[\w-]{1,128}$/.test(tid)?tid:null,code})
}
async function reconnectRequired(){const {error}=await db().from('portal_connections').update({state:'reconnect_required',last_error:'QuickBooks authorization expired or was revoked. Reconnect QuickBooks.'}).eq('scope',qboScope());check(error)}
export async function grant(params:URLSearchParams):Promise<Tokens>{
 let r:Response
 try{r=await fetch((await endpoints()).token_endpoint,{method:'POST',headers:{Authorization:authHeader(),'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:params,signal:AbortSignal.timeout(15000),cache:'no-store'})}
 catch{await diagnose('oauth',undefined,'network');throw new PortalError(502,'QuickBooks authorization could not complete. Try reconnecting.')}
 if(!r.ok){const body=await r.json().catch(()=>({}));const invalid=body.error==='invalid_grant';await diagnose('oauth',r,invalid?'invalid_grant':'oauth_failed');if(invalid&&params.get('grant_type')==='refresh_token')await reconnectRequired();throw new PortalError(502,invalid?'QuickBooks authorization expired or was revoked. Reconnect QuickBooks.':'QuickBooks authorization failed. Check configuration and reconnect.')}
 const t=await r.json();if(!t.access_token||!t.refresh_token||!Number.isFinite(t.expires_in))throw new PortalError(502,'Invalid QuickBooks token response.');return t
}
async function saveTokens(tokens:Tokens,realm:string){const {error}=await db().from('portal_connections').update({encrypted_payload:encrypt({realm,tokens}),access_expires_at:new Date(Date.now()+tokens.expires_in*1000).toISOString(),updated_at:new Date().toISOString()}).eq('scope',qboScope());check(error)}
// Every caller holds the shared DB lock, including configuration transitions.
async function connection(){
 const {data,error}=await db().from('portal_connections').select('*').eq('scope',qboScope()).maybeSingle();check(error)
 if(!data||data.state!=='connected'||!data.encrypted_payload)throw new PortalError(503,'Connect or reconnect QuickBooks for this environment first.')
 const payload=decrypt<Payload>(data.encrypted_payload)
 if(data.environment!==qboEnvironment()||payload.realm!==required('QBO_EXPECTED_REALM_ID'))throw new PortalError(503,'QuickBooks company does not match configuration.')
 if(Date.parse(data.access_expires_at)<Date.now()+60000){payload.tokens=await grant(new URLSearchParams({grant_type:'refresh_token',refresh_token:payload.tokens.refresh_token}));await saveTokens(payload.tokens,payload.realm)}
 return {...data,...payload}
}
type Connection=Awaited<ReturnType<typeof connection>>
async function qbo(c:Connection,path:string,pdf=false,retry=true):Promise<Response>{
 let r:Response
 try{r=await fetch(`${apiBase()}/v3/company/${encodeURIComponent(c.realm)}/${path}`,{headers:{Authorization:'Bearer '+c.tokens.access_token,Accept:pdf?'application/pdf':'application/json'},signal:AbortSignal.timeout(15000),cache:'no-store'})}
 catch{await diagnose('accounting',undefined,'network');throw new PortalError(502,'QuickBooks is temporarily unavailable. A later sync will retry.')}
 if(r.status===401&&retry){await diagnose('accounting',r,'access_token_rejected');c.tokens=await grant(new URLSearchParams({grant_type:'refresh_token',refresh_token:c.tokens.refresh_token}));await saveTokens(c.tokens,c.realm);return qbo(c,path,pdf,false)}
 if(!r.ok){await diagnose('accounting',r,r.status===429?'rate_limited':r.status===401?'unauthorized':'api_error');if(r.status===401)await reconnectRequired();throw new PortalError(502,r.status===401?'Reconnect QuickBooks to restore access.':r.status===429?'QuickBooks rate limit reached. A later sync will retry.':'QuickBooks request failed. Check the connection or try again later.')}
 return r
}
export async function connectQbo(code:string,realm:string){
 if(realm!==required('QBO_EXPECTED_REALM_ID'))throw new PortalError(400,'The selected QuickBooks company does not match the configured Nilli Studio company.')
 return locked(async()=>{
 const {data:existing,error:e}=await db().from('portal_connections').select('state').eq('scope',qboScope()).maybeSingle();check(e)
 if(existing?.state==='disconnect_pending')throw new PortalError(409,'Finish disconnecting before reconnecting QuickBooks.')
 const tokens=await grant(new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:required('QBO_REDIRECT_URI')}))
 const {error}=await db().from('portal_connections').upsert({scope:qboScope(),environment:qboEnvironment(),state:'connected',encrypted_payload:encrypt({realm,tokens}),access_expires_at:new Date(Date.now()+tokens.expires_in*1000).toISOString(),last_error:null,dirty_version:1,synced_version:0,updated_at:new Date().toISOString()});check(error)
 })
}
export async function disconnectQbo(){return locked(async()=>{
 const {data,error}=await db().from('portal_connections').select('*').eq('scope',qboScope()).maybeSingle();check(error)
 if(!data||data.state==='disconnected')return {ok:true}
 // Persist the stopped state BEFORE calling Intuit. A timeout can never resume sync.
 const {error:e}=await db().from('portal_connections').update({state:'disconnect_pending',last_error:'Disconnect pending. Synchronization is stopped; retry disconnect.'}).eq('scope',qboScope());check(e)
 if(data.encrypted_payload){
 const p=decrypt<Payload>(data.encrypted_payload)
 if(p.realm!==required('QBO_EXPECTED_REALM_ID')||data.environment!==qboEnvironment())throw new PortalError(409,'Connection configuration does not match.')
 let r:Response
 try{r=await fetch((await endpoints()).revocation_endpoint,{method:'POST',headers:{Authorization:authHeader(),'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({token:p.tokens.refresh_token}),signal:AbortSignal.timeout(15000),cache:'no-store'})}
 catch{await diagnose('revoke',undefined,'network');throw new PortalError(502,'Sync is stopped, but QuickBooks revocation is unconfirmed. Retry disconnect.')}
 if(!r.ok){await diagnose('revoke',r,'revocation_failed');throw new PortalError(502,'Sync is stopped, but QuickBooks did not confirm revocation. Retry disconnect.')}
 }
 const {error:clear}=await db().from('portal_connections').update({state:'disconnected',encrypted_payload:null,access_expires_at:null,last_error:null,updated_at:new Date().toISOString()}).eq('scope',qboScope());check(clear)
 return {ok:true}
})}
export async function verifyCustomer(id:string){if(!/^\d+$/.test(id))throw new PortalError(400,'Invalid QuickBooks customer ID.');const c=await connection();const body=await(await qbo(c,'customer/'+encodeURIComponent(id))).json();if(body.Customer?.Id!==id||body.Customer.Active===false)throw new PortalError(400,'Choose an active customer in the connected company.');return String(body.Customer.DisplayName||'Customer '+id)}
export async function cleanupPortal(){const cutoff=new Date(Date.now()-30*86400000).toISOString();const results=await Promise.all([db().from('portal_tokens').delete().lt('expires_at',new Date().toISOString()),db().from('portal_diagnostics').delete().lt('created_at',cutoff)]);for(const r of results)check(r.error)}
export async function syncInvoices(){return locked(async()=>{
 try {const c=await connection();const start=Date.now();const {data:accounts,error}=await db().from('portal_accounts').select('id,qbo_customer_id,portal_clients!inner(active)').eq('portal_clients.active',true).eq('scope',qboScope()).eq('enabled',true).not('qbo_customer_id','is',null);check(error);let count=0
 for(const a of accounts||[]){if(!/^\d+$/.test(a.qbo_customer_id))throw new PortalError(400,'QuickBooks customer mapping is invalid.');const rows=[];for(let position=1;;position+=100){if(Date.now()-start>180000)throw new PortalError(503,'Sync needs a smaller batch. Completed accounts were saved; remaining accounts will retry.');const query=`select * from Invoice where CustomerRef = '${a.qbo_customer_id}' startposition ${position} maxresults 100`;const body=await(await qbo(c,'query?query='+encodeURIComponent(query))).json();if(!body.QueryResponse)throw new PortalError(502,'QuickBooks invoice response is incomplete.');const page=body.QueryResponse.Invoice||[];for(const i of page){if(i.CustomerRef?.value!==a.qbo_customer_id)throw new PortalError(502,'QuickBooks customer mismatch.');rows.push(normalizeInvoice(i))}if(page.length<100)break}
 const {error:e}=await db().rpc('portal_replace_invoices',{target_account:a.id,rows_json:rows});check(e);count+=rows.length
 }
 const {error:e}=await db().from('portal_connections').update({last_success_at:new Date().toISOString(),last_error:null,synced_version:c.dirty_version}).eq('scope',qboScope());check(e)
 return {accounts:accounts?.length||0,invoices:count}
 }catch(e){await db().from('portal_connections').update({last_error:e instanceof PortalError?e.message:'Synchronization interrupted. Retry pending.'}).eq('scope',qboScope());throw e}
})}
export async function invoicePdf(accountId:string,invoiceId:string){return locked(async()=>{
 const {data:a,error:ae}=await db().from('portal_accounts').select('qbo_customer_id').eq('id',accountId).eq('scope',qboScope()).eq('enabled',true).maybeSingle();check(ae);if(!a)throw new PortalError(404,'Invoice not found.')
 const {data,error}=await db().from('portal_invoices').select('qbo_id').eq('account_id',accountId).eq('qbo_id',invoiceId).maybeSingle();check(error);if(!data)throw new PortalError(404,'Invoice not found.')
 const c=await connection();const current=await(await qbo(c,'invoice/'+encodeURIComponent(invoiceId))).json();if(current.Invoice?.CustomerRef?.value!==a.qbo_customer_id)throw new PortalError(404,'Invoice no longer belongs to this account.');const r=await qbo(c,'invoice/'+encodeURIComponent(invoiceId)+'/pdf',true);return new Uint8Array(await r.arrayBuffer())
})}
