import { randomUUID,createHash } from 'node:crypto'
import { db,check } from './store'
import { PortalError,qboScope } from './core'
export const archiveBucket='portal-invoice-archive'
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function manualFields(b:Record<string,unknown>){
 const doc_number=String(b.doc_number||'').trim(),currency=String(b.currency||'').toUpperCase().trim()
 const date=(value:unknown,optional=false)=>{if(optional&&!value)return null;const s=String(value||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s)throw new PortalError(400,'Enter a valid invoice date.');return s}
 const money=(v:unknown)=>{const s=String(v??'');if(!/^\d{1,12}(\.\d{1,2})?$/.test(s))throw new PortalError(400,'Enter amounts with at most two decimal places.');return Number(s)}
 const total=money(b.total),balance=money(b.balance),invoice_date=date(b.invoice_date)!,due_date=date(b.due_date,true)
 if(!doc_number||doc_number.length>80)throw new PortalError(400,'Enter an invoice number (up to 80 characters).')
 if(!/^[A-Z]{3}$/.test(currency)||!Intl.supportedValuesOf('currency').includes(currency))throw new PortalError(400,'Choose a valid currency.')
 if(total<=0||balance>total)throw new PortalError(400,'Balance must be between zero and the invoice total.')
 return {doc_number,currency,total,balance,invoice_date,due_date}
}
export async function manualAccount(id:unknown){if(typeof id!=='string'||!uuid.test(id))throw new PortalError(400,'Invalid client account.');const {data,error}=await db().from('portal_accounts').select('id').eq('id',id).eq('scope',qboScope()).maybeSingle();check(error);if(!data)throw new PortalError(404,'Client account not found.');return data.id as string}
export async function manualList(accountId:string){const {data,error}=await db().from('portal_manual_invoices').select('id,doc_number,invoice_date,due_date,currency,total,balance,mime_type,updated_at').eq('account_id',accountId).is('deleted_at',null).order('invoice_date',{ascending:false});check(error);return data||[]}
export async function uploadManual(form:FormData,staffId:string){
 const accountId=await manualAccount(form.get('account_id'))
 const fields=manualFields(Object.fromEntries(form.entries()))
 const file=form.get('file');if(!(file instanceof File))throw new PortalError(400,'Choose a PDF, JPG or PNG file.')
 const bytes=Buffer.from(await file.arrayBuffer()),attachment=attachmentType(bytes)
 const file_hash=createHash('sha256').update(bytes).digest('hex'),id=randomUUID(),storage_path=`${accountId}/${id}.${attachment.extension}`
 const {error:uploadError}=await db().storage.from(archiveBucket).upload(storage_path,bytes,{contentType:attachment.mime,upsert:false});check(uploadError)
 const {error}=await db().from('portal_manual_invoices').insert({...fields,id,account_id:accountId,file_hash,storage_path,mime_type:attachment.mime,created_by:staffId})
 if(error){await db().storage.from(archiveBucket).remove([storage_path]);if(error.code==='23505')throw new PortalError(409,'This file or billing label is already in this client’s history.');check(error)}
 return {ok:true}
}
export async function manualDownload(accountId:string,id:string){if(!uuid.test(id))throw new PortalError(404,'Invoice not found.');const {data,error}=await db().from('portal_manual_invoices').select('storage_path,mime_type').eq('id',id).eq('account_id',accountId).is('deleted_at',null).maybeSingle();check(error);if(!data)throw new PortalError(404,'Invoice not found.');const result=await db().storage.from(archiveBucket).createSignedUrl(data.storage_path,60,{download:'invoice.'+(data.mime_type==='image/png'?'png':data.mime_type==='image/jpeg'?'jpg':'pdf')});check(result.error);return result.data!.signedUrl}
export async function updateManual(accountId:string,b:Record<string,unknown>){if(typeof b.id!=='string'||!uuid.test(b.id))throw new PortalError(400,'Invalid invoice.');const fields=b.remove===true?{deleted_at:new Date().toISOString()}:manualFields(b);const {data,error}=await db().from('portal_manual_invoices').update({...fields,updated_at:new Date().toISOString()}).eq('id',b.id).eq('account_id',accountId).is('deleted_at',null).select('id').maybeSingle();if(error?.code==='23505')throw new PortalError(409,'That invoice number already exists.');check(error);if(!data)throw new PortalError(404,'Invoice not found.');return {ok:true}}
export function attachmentType(bytes:Buffer){
 if(!bytes.length||bytes.length>3145728)throw new PortalError(400,'Choose a file smaller than 3 MB.')
 if(bytes.subarray(0,5).toString()==='%PDF-'&&bytes.subarray(-2048).includes(Buffer.from('%%EOF')))return {mime:'application/pdf',extension:'pdf'}
 if(bytes.length>=20&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.subarray(-12,-4).equals(Buffer.from([0,0,0,0,73,69,78,68])))return {mime:'image/png',extension:'png'}
 if(bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.subarray(-2).equals(Buffer.from([255,217])))return {mime:'image/jpeg',extension:'jpg'}
 throw new PortalError(400,'Choose a complete PDF, JPG or PNG file.')
}
export async function replaceManual(form:FormData){
 const accountId=await manualAccount(form.get('account_id')),id=String(form.get('id')||'')
 if(!uuid.test(id))throw new PortalError(400,'Invalid invoice.')
 const {data:previous,error:readError}=await db().from('portal_manual_invoices').select('storage_path').eq('id',id).eq('account_id',accountId).is('deleted_at',null).maybeSingle();check(readError);if(!previous)throw new PortalError(404,'Invoice not found.')
 const fields=manualFields(Object.fromEntries(form.entries())),file=form.get('file')
 if(!(file instanceof File)||!file.size)return updateManual(accountId,{...fields,id})
 const bytes=Buffer.from(await file.arrayBuffer()),attachment=attachmentType(bytes),storage_path=`${accountId}/${randomUUID()}.${attachment.extension}`,file_hash=createHash('sha256').update(bytes).digest('hex')
 const {error:uploadError}=await db().storage.from(archiveBucket).upload(storage_path,bytes,{contentType:attachment.mime,upsert:false});check(uploadError)
 const {data,error}=await db().from('portal_manual_invoices').update({...fields,storage_path,file_hash,mime_type:attachment.mime,updated_at:new Date().toISOString()}).eq('id',id).eq('account_id',accountId).eq('storage_path',previous.storage_path).is('deleted_at',null).select('id').maybeSingle()
 if(error||!data){await db().storage.from(archiveBucket).remove([storage_path]);if(error?.code==='23505')throw new PortalError(409,'This file or billing label already exists.');check(error);throw new PortalError(409,'The invoice changed. Refresh and try again.')}
 return {ok:true}
}
