import { replaceManual, manualList, manualAccount, uploadManual, manualDownload, updateManual } from '@/lib/portal/manual'
import { after, NextResponse } from 'next/server'
import { check, consumeToken, creator, db, issueToken, staff, locked } from '@/lib/portal/store'
import { paymentUrl, creatorAuthUrl, constantEqual, hash, invoiceStatus, PortalError, required, validWebhook, qboEnvironment, qboScope, privateHeaders } from '@/lib/portal/core'
import { connectQbo, invoicePdf, syncInvoices, disconnectQbo, endpoints, verifyCustomer, cleanupPortal } from '@/lib/portal/qbo'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=240
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:privateHeaders})
function sameOrigin(r:Request){if(r.headers.get('origin')!==new URL(r.url).origin)throw new PortalError(403,'Origin not permitted.')}
async function route(r:Request){
 const u=new URL(r.url),path=u.pathname.replace('/api/portal/',''),method=r.method;
 if(path==='config'&&method==='GET')return json({authUrl:creatorAuthUrl(),authAnonKey:required('PORTAL_AUTH_ANON_KEY')});
 if(path==='qbo/webhook'&&method==='POST'){
  const raw=await r.text();if(Buffer.byteLength(raw)>1_000_000)throw new PortalError(413,'Payload too large.');if(!validWebhook(raw,r.headers.get('intuit-signature')||'',required('QBO_WEBHOOK_VERIFIER')))throw new PortalError(401,'Invalid signature.');
  // Legacy Invoice/Payment notifications trigger reconciliation for this company only.
  // Keep CloudEvents disabled until its payload contract has been tested.
  const payload=JSON.parse(raw);const events=Array.isArray(payload.eventNotifications)?payload.eventNotifications:[];if(!events.some((e:{realmId?:string})=>e.realmId===required('QBO_EXPECTED_REALM_ID')))return json({accepted:true});const {data:connection,error:ce}=await db().from('portal_connections').select('state').eq('scope',qboScope()).maybeSingle();check(ce);if(connection?.state!=='connected')return json({accepted:true});const {error}=await db().rpc('portal_mark_scope_dirty',{target_scope:qboScope()});check(error);after(async()=>{try{await syncInvoices()}catch{/* Durable dirty state and last_error survive; scheduled reconciliation retries. */}});return json({accepted:true});
 }
 if(path==='qbo/sync'&&method==='GET'){
  if(!constantEqual(r.headers.get('authorization')||'','Bearer '+required('CRON_SECRET')))throw new PortalError(401,'Unauthorized.');
  await cleanupPortal();const {data:c,error}=await db().from('portal_connections').select('state').eq('scope',qboScope()).maybeSingle();check(error);if(c?.state!=='connected')return json({skipped:true});return json(await syncInvoices());
 }
 if(path==='qbo/callback'&&method==='GET'){
  const user=await staff();const state=u.searchParams.get('state')||'';const token=await consumeToken(state,'oauth');if(token.staff_id!==user.id)throw new PortalError(403,'Authorization session does not match.');
  if(u.searchParams.has('error'))throw new PortalError(400,'QuickBooks authorization was cancelled.');
  await connectQbo(u.searchParams.get('code')||'',u.searchParams.get('realmId')||'');return NextResponse.redirect(new URL('/portal-admin?connected=1',r.url),302);
 }
 if(path==='preview/exchange'&&method==='POST'){
  if(r.headers.get('origin')!==required('PORTAL_ORIGIN'))throw new PortalError(403,'Origin not permitted.');
  const {ticket}=await r.json();if(typeof ticket!=='string')throw new PortalError(400,'Invalid preview link.');const row=await consumeToken(ticket,'preview_ticket');const token=await issueToken('preview_session',row.staff_id,row.account_id,900);return json({access_token:'preview_'+token});
 }
 if(path==='logout'&&method==='POST'){
  const token=r.headers.get('authorization')?.replace(/^Bearer /,'')||'';if(token.startsWith('preview_')){const {error}=await db().from('portal_tokens').delete().eq('token_hash',hash(token.slice(8))).eq('kind','preview_session').eq('scope',qboScope());check(error)}return json({ok:true});
 }
 if(path==='me'&&method==='GET'){
  const {account,preview}=await creator(r);const {data,error}=await db().from('portal_invoices').select('qbo_id,doc_number,invoice_date,due_date,currency,total,balance,synced_at').eq('account_id',account.id).order('invoice_date',{ascending:false});check(error);
  const {data:sync,error:e}=await db().from('portal_connections').select('last_success_at,last_error,state').eq('scope',qboScope()).maybeSingle();check(e);
  const history=await manualList(account.id);
  const invoices=[...(data||[]).map(i=>({...i,source:'qbo'})),...history.map(i=>({...i,qbo_id:'manual_'+i.id,source:'manual'}))].sort((a,b)=>(b.invoice_date||'').localeCompare(a.invoice_date||'')||String(a.qbo_id).localeCompare(String(b.qbo_id)));
  return json({account:{id:account.id,client:account.clients,paymentUrl:account.payment_url||null,billingMode:account.qbo_customer_id?'qbo':'manual'},preview,invoices:invoices.map(i=>({...i,status:invoiceStatus(i,new Date().toISOString().slice(0,10))})),sync:{lastSuccessAt:sync?.last_success_at||null,needsAttention:!!sync?.last_error,connected:sync?.state==='connected'}});
 }
 if(path.startsWith('invoice/')&&method==='GET'){
  const {account}=await creator(r);const id=path.slice(8);if(id.startsWith('manual_'))return NextResponse.redirect(await manualDownload(account.id,id.slice(7)),302);if(!/^\d+$/.test(id))throw new PortalError(400,'Invalid invoice ID.');const bytes=await invoicePdf(account.id,id);return new Response(bytes as BodyInit,{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="invoice-${id}.pdf"`,...privateHeaders}});
 }
 if(path.startsWith('admin/')){
  const user=await staff();if(method==='POST')sameOrigin(r);
  if(path==='admin/history'&&method==='GET'){const id=await manualAccount(u.searchParams.get('account_id'));return json({invoices:await manualList(id)});}
  if(path==='admin/history-upload'&&method==='POST'){if(Number(r.headers.get('content-length'))>3500000)throw new PortalError(413,'Choose a file smaller than 3 MB.');return json(await uploadManual(await r.formData(),user.id));}
  if(path==='admin/history-replace'&&method==='POST'){if(Number(r.headers.get('content-length'))>3500000)throw new PortalError(413,'Choose a file smaller than 3 MB.');return json(await replaceManual(await r.formData()));}
  if(path==='admin/history-update'&&method==='POST'){const b=await r.json();const id=await manualAccount(b.account_id);return json(await updateManual(id,b));}
  if(path==='admin/history-download'&&method==='POST'){const b=await r.json();const id=await manualAccount(b.account_id);return json({url:await manualDownload(id,b.id)});}
  if(path==='admin/status'&&method==='GET'){
   const results=await Promise.all([db().from('portal_clients').select('id,label,active').order('label'),db().from('portal_accounts').select('*').eq('scope',qboScope()),db().from('portal_connections').select('state,last_success_at,last_error,dirty_version,synced_version').eq('scope',qboScope()).maybeSingle(),db().from('portal_accounts').select('id',{count:'exact',head:true}).is('scope',null),db().from('task_templates').select('client_id,template_name,clients(label)'),db().from('portal_client_templates').select('*')]);for(const x of results)check(x.error);
   const keys=['PORTAL_AUTH_URL','PORTAL_AUTH_ANON_KEY','PORTAL_ORIGIN','PORTAL_TOKEN_KEY','QBO_CLIENT_ID','QBO_CLIENT_SECRET','QBO_REDIRECT_URI','QBO_EXPECTED_REALM_ID','QBO_ENVIRONMENT','QBO_WEBHOOK_VERIFIER','CRON_SECRET'];return json({environment:qboEnvironment(),legacyAccounts:results[3].count||0,clients:results[0].data,templates:results[4].data,associations:results[5].data,accounts:results[1].data,sync:results[2].data,missing:keys.filter(k=>!process.env[k])});
  }
  if(path==='admin/client'&&method==='POST'){
   const b=await r.json();const label=typeof b.label==='string'?b.label.trim():'';if(!label||label.length>120)throw new PortalError(400,'Enter a client name (up to 120 characters).');
   const query=b.id?db().from('portal_clients').update({label}).eq('id',b.id):db().from('portal_clients').insert({label});const {data,error}=await query.select('id').single();check(error);if(!data)throw new PortalError(404,'Client not found.');return json({id:data.id});
  }
  if(path==='admin/client-active'&&method==='POST'){const b=await r.json();if(typeof b.id!=='string'||typeof b.active!=='boolean')throw new PortalError(400,'Invalid client.');const {error}=await db().rpc('portal_set_client_active',{target_id:b.id,is_active:b.active});check(error);return json({ok:true});}
  if(path==='admin/client-templates'&&method==='POST'){const b=await r.json();if(typeof b.id!=='string'||!Array.isArray(b.templates)||b.templates.length>200)throw new PortalError(400,'Invalid template selection.');const {error}=await db().rpc('portal_assign_templates',{target_id:b.id,selections:b.templates});if(error)throw new PortalError(409,'A selected template is missing or already assigned. Refresh and try again.');return json({ok:true});}
  if(path==='admin/account'&&method==='POST'){
   const b=await r.json();if(typeof b.client_id!=='string'||typeof b.enabled!=='boolean'||(b.creator_user_id&&!/^[0-9a-f-]{36}$/i.test(b.creator_user_id))||(b.qbo_customer_id&&!/^\d+$/.test(b.qbo_customer_id)))throw new PortalError(400,'Invalid account mapping.');
   return locked(async()=>{
   const {data:client,error:clientError}=await db().from('portal_clients').select('id').eq('id',b.client_id).eq('active',true).maybeSingle();check(clientError);if(!client)throw new PortalError(404,'Active client not found.');
   const {data:existing,error:ee}=await db().from('portal_accounts').select('*').eq('scope',qboScope()).eq('client_id',b.client_id).maybeSingle();check(ee);
   if(existing?.qbo_customer_id&&existing.qbo_customer_id!==b.qbo_customer_id)throw new PortalError(409,'Customer remapping within the same company requires a reviewed migration.');
   const {error:connectionError}=await db().from('portal_connections').upsert({scope:qboScope(),environment:qboEnvironment(),state:'disconnected'},{onConflict:'scope',ignoreDuplicates:true});check(connectionError);
   let name=existing?.customer_name||null;
   if(b.qbo_customer_id&&(!existing?.qbo_customer_id||!name)){
    name=await verifyCustomer(b.qbo_customer_id);
    if(b.customer_confirmation!==name)throw new PortalError(400,'Verify the customer and confirm the displayed name before saving.');
   }
   const {error}=await db().from('portal_accounts').upsert({scope:qboScope(),client_id:b.client_id,creator_user_id:b.creator_user_id||null,qbo_customer_id:b.qbo_customer_id||null,customer_name:name,enabled:b.enabled,payment_url:paymentUrl(b.payment_url??null)},{onConflict:'scope,client_id'});check(error);return json({ok:true});
   });
  }
  if(path==='admin/customer-check'&&method==='POST'){const {customer_id}=await r.json();if(typeof customer_id!=='string')throw new PortalError(400,'Enter a customer ID.');return json({name:await locked(()=>verifyCustomer(customer_id))});}
  if(path==='admin/qbo-disconnect'&&method==='POST'){const {confirmation}=await r.json();if(confirmation!=='DISCONNECT')throw new PortalError(400,'Type DISCONNECT to confirm.');return json(await disconnectQbo());}

  if(path==='admin/preview'&&method==='POST'){
   const {account_id}=await r.json();const {data,error}=await db().from('portal_accounts').select('id').eq('scope',qboScope()).eq('id',account_id).eq('enabled',true).maybeSingle();check(error);if(!data)throw new PortalError(404,'Enable this portal account first.');const ticket=await issueToken('preview_ticket',user.id,data.id,60);return json({url:required('PORTAL_ORIGIN')+'/live.html#ticket='+encodeURIComponent(ticket)});
  }
  if(path==='admin/qbo-connect'&&method==='POST'){
   const {data:connection,error}=await db().from('portal_connections').select('state').eq('scope',qboScope()).maybeSingle();check(error);if(connection?.state==='disconnect_pending')throw new PortalError(409,'Finish disconnecting before reconnecting.');const discovery=await endpoints();const state=await issueToken('oauth',user.id,null,600);const params=new URLSearchParams({client_id:required('QBO_CLIENT_ID'),response_type:'code',scope:'com.intuit.quickbooks.accounting',redirect_uri:required('QBO_REDIRECT_URI'),state});return json({url:discovery.authorization_endpoint+'?'+params});
  }
  if(path==='admin/sync'&&method==='POST')return json(await syncInvoices());
 }
 throw new PortalError(404,'Not found.');
}
async function handle(r:Request){let response:Response;try{response=await route(r)}catch(e){if(new URL(r.url).pathname==='/api/portal/qbo/callback'){response=NextResponse.redirect(new URL('/portal-admin?connectionError=1',r.url),302)}else response=json({error:e instanceof PortalError?e.message:'The request could not be completed. Check configuration and try again.'},e instanceof PortalError?e.status:500)}const origin=r.headers.get('origin');if(origin&&origin===process.env.PORTAL_ORIGIN)response.headers.set('Access-Control-Allow-Origin',origin);response.headers.set('Vary','Origin');for(const [key,value] of Object.entries(privateHeaders))response.headers.set(key,value);return response}
export const GET=handle
export const POST=handle
export function OPTIONS(r:Request){if(r.headers.get('origin')!==process.env.PORTAL_ORIGIN)return new Response(null,{status:403});return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':process.env.PORTAL_ORIGIN!,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600','Vary':'Origin'}})}
