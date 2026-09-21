import {check,db} from './store'
import {PortalError} from './core'
const fields='id,title,format,release_date,created_at,review_url,review_ready,publication_url,published_at,status'
export function projectUrl(value:unknown,frameOnly=false){
 if(value===null||value===undefined||value==='')return null
 if(typeof value!=='string'||value.length>2048)throw new PortalError(400,'Enter a valid HTTPS link.')
 try{const u=new URL(value.trim());if(u.protocol!=='https:'||u.username||u.password|| (frameOnly&&!(u.hostname==='f.io'||u.hostname==='frame.io'||u.hostname.endsWith('.frame.io'))))throw new Error();return u.href}catch{throw new PortalError(400,frameOnly?'Use a Frame.io HTTPS review link.':'Use a valid HTTPS published-content link.')}
}
export function projectDetails(body:Record<string,unknown>,now=new Date()){
 const review_url=projectUrl(body.review_url,true),publication_url=projectUrl(body.publication_url)
 if(typeof body.review_ready!=='boolean'||typeof body.published!=='boolean')throw new PortalError(400,'Choose a review and publication status.')
 if(body.review_ready&&!review_url)throw new PortalError(400,'Add a Frame.io link before marking ready for review.')
 let published_at:string|null=null
 if(body.published){if(typeof body.published_at!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(body.published_at))throw new PortalError(400,'Choose the actual publication date.');const date=new Date(body.published_at+'T00:00:00.000Z');if(!Number.isFinite(+date)||date.toISOString().slice(0,10)!==body.published_at||body.published_at>now.toISOString().slice(0,10))throw new PortalError(400,'Publication must be today or earlier.');published_at=date.toISOString()}
 return {review_url,review_ready:body.review_ready,publication_url,published_at}
}
function visibleProject(p:Record<string,unknown>){return {id:p.id,title:p.title,format:p.format,release_date:p.release_date,status:p.status,published_at:p.published_at,review_ready:p.review_ready,review_url:p.review_ready||p.published_at?p.review_url:null,publication_url:p.published_at?p.publication_url:null}}
export async function projectFeed(clientId:string,section:string,offset=0){
 if(!['home','active','library','all'].includes(section)||!Number.isSafeInteger(offset)||offset<0||offset>100000)throw new PortalError(400,'Invalid project page.')
 const query=()=>db().from('portal_project_feed').select(fields,{count:'exact'}).eq('portal_client_id',clientId)
 if(section==='home'){
  const active=()=>query().is('published_at',null).in('status',['in_progress','ready_for_review'])
  const today=new Date().toISOString().slice(0,10)
  const upcoming=await active().gte('release_date',today).order('release_date',{ascending:true}).order('id').limit(1);check(upcoming.error)
  const past=await active().lt('release_date',today).order('release_date',{ascending:false}).order('id').limit(1);check(past.error)
  const current=upcoming.data?.[0]||past.data?.[0]
  if(current)return {project:visibleProject(current),current:true,activeCount:(upcoming.count||0)+(past.count||0)}
  const latest=await query().order('release_date',{ascending:false}).order('created_at',{ascending:false}).order('id').limit(1);check(latest.error)
  return {project:latest.data?.[0]?visibleProject(latest.data[0]):null,current:false,activeCount:0}
 }
 let q=query();if(section==='active')q=q.is('published_at',null);if(section==='library')q=q.not('published_at','is',null)
 const result=await q.order(section==='library'?'published_at':'release_date',{ascending:section==='active'}).order('id').range(offset,offset+23);check(result.error)
 return {projects:section==='all'?(result.data||[]):(result.data||[]).map(visibleProject),total:result.count||0,nextOffset:offset+(result.data?.length||0)<(result.count||0)?offset+24:null}
}
export async function saveProject(clientId:string,body:Record<string,unknown>,staffId:string){
 if(typeof body.id!=='string'||!/^[0-9a-f-]{36}$/i.test(body.id))throw new PortalError(400,'Invalid project.')
 const details=projectDetails(body)
 const {error}=await db().rpc('portal_save_project',{target_client:clientId,target_episode:body.id,details,actor:staffId});check(error);return {ok:true}
}
