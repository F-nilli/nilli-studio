import {check,db} from './store'
import {PortalError} from './core'
export function packageDetails(body:Record<string,unknown>){
 const name=typeof body.name==='string'?body.name.trim():''
 const deliverables=typeof body.deliverables==='string'?body.deliverables.trim():''
 const currency=body.currency,frequency=body.frequency,amount=body.amount
 if(!name||name.length>120||deliverables.length>4000||!['USD','CAD','EUR','GBP','AUD','MXN'].includes(String(currency))||!['monthly','quarterly','annually','per_project','custom'].includes(String(frequency))||typeof amount!=='number'||!Number.isFinite(amount)||amount<0||amount>10000000||typeof body.visible!=='boolean')throw new PortalError(400,'Enter a package name, valid amount, currency and billing frequency.')
 return {name,deliverables,currency:String(currency),frequency:String(frequency),amount,visible:body.visible}
}
export async function clientPackage(clientId:string,admin=false){
 let q=db().from('portal_client_packages').select('name,deliverables,currency,frequency,amount,visible').eq('client_id',clientId)
 if(!admin)q=q.eq('visible',true)
 const {data,error}=await q.maybeSingle();check(error);return data
}
export async function savePackage(clientId:string,body:Record<string,unknown>,actor:string){
 const details=packageDetails(body)
 const {error}=await db().from('portal_client_packages').upsert({client_id:clientId,...details,updated_by:actor,updated_at:new Date().toISOString()});check(error);return {ok:true}
}
