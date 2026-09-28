import {check,db} from './store'
import {PortalError,required} from './core'
const keys=['watermark_full','adread_30_first15','watermark_shorts_2']
export const placementCatalog=[
 {key:keys[0],label:'Full-episode watermark',description:'One watermark placement throughout the full episode.'},
 {key:keys[1],label:'30-second ad-read in the first 15 minutes',description:'One 30-second read within the first 15 minutes, using an agreed script.'},
 {key:keys[2],label:'Watermark on two short-form videos',description:'One bundle covering two separate short-form videos.'},
]
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
function fail(message='Check the form fields.'):never{throw new PortalError(400,message)}
function text(v:unknown,max:number,optional=false){if(typeof v!=='string'||v.trim().length>max||(!optional&&!v.trim()))fail();return v.trim()}
export function placements(value:unknown){
 if(!Array.isArray(value)||value.length>keys.length)fail('Choose supported placements.');const seen=new Set();
 return value.map(p=>{if(!p||!keys.includes(p.key)||seen.has(p.key))fail('Each placement can appear once.');seen.add(p.key);
 if(typeof p.price!=='number'||!Number.isFinite(p.price)||p.price<=0||p.price>1000000||Math.abs(p.price*100-Math.round(p.price*100))>0.00001)fail('Enter a positive price with at most two decimals.');
 if(!['USD','CAD','EUR','GBP'].includes(p.currency)||!Number.isInteger(p.capacity)||p.capacity<1||p.capacity>20)fail('Choose a currency and 1–20 available units.');
 return {key:p.key,price:p.price,currency:p.currency,capacity:p.capacity,requirements:text(p.requirements,2000,true)};
 });
}
function date(v:unknown){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)fail('Enter a valid date.');return v}
export function sponsorshipPayload(b:Record<string,unknown>,isStaff:boolean){
 const action=b.action;
 if(!['menu','defaults','create','save','submit','approve','return','withdraw','close','request','confirm','decline','cancel'].includes(String(action)))fail('Unknown action.');
 if(!isStaff&&['defaults','approve','return','request','cancel'].includes(String(action)))throw new PortalError(403,'Nilli access required.');
 if(isStaff&&action==='confirm')throw new PortalError(403,'The creator must accept this request.');
 const p:Record<string,unknown>={action};
 if(action!=='menu'&&action!=='defaults'){if(!uuid(b.id))fail('Invalid opportunity.');p.id=b.id}
 if(['menu','save','submit','approve','return','withdraw','close'].includes(String(action))){if(!Number.isInteger(b.version)||Number(b.version)<0)fail('Refresh before saving.');p.version=b.version}
 if(['menu','defaults','create','save'].includes(String(action)))p.placements=placements(b.placements);
 if(action==='create'||action==='save'){
  const d=b.details as Record<string,unknown>;if(!d||typeof d!=='object')fail();
  const release_date=date(d.release_date),deadline=date(d.deadline);if(deadline>release_date)fail('The request deadline must be on or before release.');
  if(!Number.isInteger(d.duration)||Number(d.duration)<1||Number(d.duration)>1440)fail('Enter an estimated duration in minutes.');
  p.details={title:text(d.title,160),topic:text(d.topic,200),guest:text(d.guest,160,true),description:text(d.description,4000),release_date,deadline,duration:d.duration};
 }
 if(action==='return')p.note=text(b.note,2000);
 if(action==='request'){p.placement_key=text(b.placement_key,80);p.brand=text(b.brand,160);p.email=text(b.email,254);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(p.email)))fail('Enter the brand contact email.');if(!uuid(b.intake_key))fail();p.intake_key=b.intake_key}
 if(['confirm','decline','cancel'].includes(String(action))){if(!uuid(b.request_id))fail();p.request_id=b.request_id}
 return p;
}
export async function sponsorshipData(clientId:string){
 const results=await Promise.all([
  db().from('portal_sponsor_menus').select('placements,version').eq('client_id',clientId).maybeSingle(),
  db().from('portal_sponsor_defaults').select('placements').eq('singleton',true).single(),
  db().from('portal_sponsor_opportunities').select('*').eq('client_id',clientId).order('created_at',{ascending:false}).limit(100),
 ]);results.forEach(r=>check(r.error));
 const opportunities=results[2].data||[];const ids=opportunities.map(o=>o.id);
 const requestResult=ids.length?await db().from('portal_sponsor_requests').select('id,opportunity_id,placement_key,brand,quote,status,created_at').in('opportunity_id',ids).order('created_at',{ascending:false}):{data:[],error:null};check(requestResult.error);
 return {catalog:placementCatalog,menu:results[0].data||{placements:[],version:0},defaults:results[1].data?.placements||[],opportunities:opportunities.map(o=>({...o,share_url:o.share_token?required('PORTAL_ORIGIN')+'/opportunity.html#'+o.share_token:null,share_token:undefined})),requests:requestResult.data};
}
export async function mutateSponsorship(clientId:string,actor:string,isStaff:boolean,b:Record<string,unknown>){
 const payload=sponsorshipPayload(b,isStaff);
 const {data,error}=await db().rpc('portal_sponsor_mutate',{target_client:clientId,actor,is_staff:isStaff,payload});
 if(error){if(error.code==='P0001')throw new PortalError(409,error.message);check(error)}return data;
}
export async function publicOpportunity(token:string){
 if(!/^[a-f0-9]{64}$/.test(token))throw new PortalError(404,'Opportunity not found.');
 const {data:o,error}=await db().from('portal_sponsor_opportunities').select('id,details,placements,status,client:portal_clients!inner(label,active)').eq('share_token',token).in('status',['approved','closed']).eq('client.active',true).maybeSingle();check(error);if(!o)throw new PortalError(404,'Opportunity is unavailable.');
 const {data:requests,error:e}=await db().from('portal_sponsor_requests').select('placement_key,status').eq('opportunity_id',o.id);check(e);
 const client=o.client as unknown as {label:string};
 return {creator:client.label,details:o.details,status:o.status,placements:o.placements.map((p:{key:string;capacity:number})=>({...p,available:Math.max(0,p.capacity-(requests||[]).filter(r=>r.placement_key===p.key&&r.status==='confirmed').length)})),catalog:placementCatalog};
}
