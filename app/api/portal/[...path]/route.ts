import { after, NextResponse } from 'next/server'
import { check, consumeToken, creator, db, issueToken, staff } from '@/lib/portal/store'
import { creatorAuthUrl, constantEqual, hash, invoiceStatus, PortalError, required, validWebhook } from '@/lib/portal/core'
import { connectQbo, invoicePdf, syncInvoices } from '@/lib/portal/qbo'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=240
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}})
function sameOrigin(r:Request){if(r.headers.get('origin')!==new URL(r.url).origin)throw new PortalError(403,'Origin not permitted.')}
async function route(r:Request){
 const u=new URL(r.url),path=u.pathname.replace('/api/portal/',''),method=r.method;
 if(path==='config'&&method==='GET')return json({authUrl:creatorAuthUrl(),authAnonKey:required('PORTAL_AUTH_ANON_KEY')});
 if(path==='qbo/webhook'&&method==='POST'){
  const raw=await r.text();if(Buffer.byteLength(raw)>1_000_000)throw new PortalError(413,'Payload too large.');if(!validWebhook(raw,r.headers.get('intuit-signature')||'',required('QBO_WEBHOOK_VERIFIER')))throw new PortalError(401,'Invalid signature.');
  // Both legacy and CloudEvents notifications trigger reconciliation. Never trust
  // event amounts, customers, ordering or delivery uniqueness as invoice data.
  JSON.parse(raw);const {error}=await db().rpc('portal_mark_dirty');check(error);after(async()=>{try{await syncInvoices()}catch{/* Durable dirty state and last_error survive; scheduled reconciliation retries. */}});return json({accepted:true});
 }
 if(path==='qbo/sync'&&method==='GET'){
  if(!constantEqual(r.headers.get('authorization')||'','Bearer '+required('CRON_SECRET')))throw new PortalError(401,'Unauthorized.');
  return json(await syncInvoices());
 }
 if(path==='qbo/callback'&&method==='GET'){
  const user=await staff();const state=u.searchParams.get('state')||'';const token=await consumeToken(state,'oauth');if(token.staff_id!==user.id)throw new PortalError(403,'Authorization session does not match.');
  if(u.searchParams.has('error'))throw new PortalError(400,'QuickBooks authorization was cancelled.');
  await connectQbo(u.searchParams.get('code')||'',u.searchParams.get('realmId')||'');return NextResponse.redirect(new URL('/portal-admin?connected=1',r.url));
 }
 if(path==='preview/exchange'&&method==='POST'){
  if(r.headers.get('origin')!==required('PORTAL_ORIGIN'))throw new PortalError(403,'Origin not permitted.');
  const {ticket}=await r.json();if(typeof ticket!=='string')throw new PortalError(400,'Invalid preview link.');const row=await consumeToken(ticket,'preview_ticket');const token=await issueToken('preview_session',row.staff_id,row.account_id,900);return json({access_token:'preview_'+token});
 }
 if(path==='logout'&&method==='POST'){
  const token=r.headers.get('authorization')?.replace(/^Bearer /,'')||'';if(token.startsWith('preview_')){const {error}=await db().from('portal_tokens').delete().eq('token_hash',hash(token.slice(8))).eq('kind','preview_session');check(error)}return json({ok:true});
 }
 if(path==='me'&&method==='GET'){
  const {account,preview}=await creator(r);const {data,error}=await db().from('portal_invoices').select('qbo_id,doc_number,invoice_date,due_date,currency,total,balance,synced_at').eq('account_id',account.id).order('invoice_date',{ascending:false});check(error);
  const {data:sync,error:e}=await db().from('portal_qbo').select('last_success_at,last_error').eq('id',true).maybeSingle();check(e);
  return json({account:{id:account.id,client:account.clients},preview,invoices:(data||[]).map(i=>({...i,status:invoiceStatus(i,new Date().toISOString().slice(0,10))})),sync:{lastSuccessAt:sync?.last_success_at||null,needsAttention:!!sync?.last_error,connected:!!sync}});
 }
 if(path.startsWith('invoice/')&&method==='GET'){
  const {account}=await creator(r);const id=path.slice(8);if(!/^\d+$/.test(id))throw new PortalError(400,'Invalid invoice ID.');const bytes=await invoicePdf(account.id,id);return new Response(bytes as BodyInit,{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="invoice-${id}.pdf"`,'Cache-Control':'private, no-store'}});
 }
 if(path.startsWith('admin/')){
  const user=await staff();if(method==='POST')sameOrigin(r);
  if(path==='admin/status'&&method==='GET'){
   const results=await Promise.all([db().from('clients').select('id,key,label').eq('active',true),db().from('portal_accounts').select('*'),db().from('portal_qbo').select('realm_id,last_success_at,last_error,dirty_version,synced_version').eq('id',true).maybeSingle()]);for(const x of results)check(x.error);
   const keys=['PORTAL_AUTH_URL','PORTAL_AUTH_ANON_KEY','PORTAL_ORIGIN','PORTAL_TOKEN_KEY','QBO_CLIENT_ID','QBO_CLIENT_SECRET','QBO_REDIRECT_URI','QBO_EXPECTED_REALM_ID','QBO_ENVIRONMENT','QBO_WEBHOOK_VERIFIER','CRON_SECRET'];return json({clients:results[0].data,accounts:results[1].data,sync:results[2].data,missing:keys.filter(k=>!process.env[k])});
  }
  if(path==='admin/account'&&method==='POST'){
   const b=await r.json();if(typeof b.client_id!=='string'||typeof b.enabled!=='boolean'||(b.creator_user_id&&!/^[0-9a-f-]{36}$/i.test(b.creator_user_id))||(b.qbo_customer_id&&!/^\d+$/.test(b.qbo_customer_id)))throw new PortalError(400,'Invalid account mapping.');
   // Customer mapping cannot be silently reassigned after importing financial data.
   const {data:existing,error:ee}=await db().from('portal_accounts').select('qbo_customer_id').eq('client_id',b.client_id).maybeSingle();check(ee);if(existing?.qbo_customer_id&&existing.qbo_customer_id!==b.qbo_customer_id)throw new PortalError(409,'Customer remapping requires a reviewed data migration.');
   const {error}=await db().from('portal_accounts').upsert({client_id:b.client_id,creator_user_id:b.creator_user_id||null,qbo_customer_id:b.qbo_customer_id||null,enabled:b.enabled},{onConflict:'client_id'});check(error);return json({ok:true});
  }
  if(path==='admin/preview'&&method==='POST'){
   const {account_id}=await r.json();const {data,error}=await db().from('portal_accounts').select('id').eq('id',account_id).eq('enabled',true).maybeSingle();check(error);if(!data)throw new PortalError(404,'Enable this portal account first.');const ticket=await issueToken('preview_ticket',user.id,data.id,60);return json({url:required('PORTAL_ORIGIN')+'/live.html#ticket='+encodeURIComponent(ticket)});
  }
  if(path==='admin/qbo-connect'&&method==='POST'){
   required('QBO_EXPECTED_REALM_ID');const state=await issueToken('oauth',user.id,null,600);const params=new URLSearchParams({client_id:required('QBO_CLIENT_ID'),response_type:'code',scope:'com.intuit.quickbooks.accounting',redirect_uri:required('QBO_REDIRECT_URI'),state});return json({url:'https://appcenter.intuit.com/connect/oauth2?'+params});
  }
  if(path==='admin/sync'&&method==='POST')return json(await syncInvoices());
 }
 throw new PortalError(404,'Not found.');
}
async function handle(r:Request){let response:Response;try{response=await route(r)}catch(e){response=json({error:e instanceof PortalError?e.message:'The request could not be completed. Check configuration and try again.'},e instanceof PortalError?e.status:500)}const origin=r.headers.get('origin');if(origin&&origin===process.env.PORTAL_ORIGIN)response.headers.set('Access-Control-Allow-Origin',origin);response.headers.set('Vary','Origin');response.headers.set('Cache-Control','no-store');return response}
export const GET=handle
export const POST=handle
export function OPTIONS(r:Request){if(r.headers.get('origin')!==process.env.PORTAL_ORIGIN)return new Response(null,{status:403});return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':process.env.PORTAL_ORIGIN!,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600','Vary':'Origin'}})}
