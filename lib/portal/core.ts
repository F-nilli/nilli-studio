import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
export class PortalError extends Error { constructor(public status:number,message:string){super(message)} }
export function required(name:string){const value=process.env[name];if(!value)throw new PortalError(503,'Portal setup is incomplete.');return value}
export function hash(value:string){return createHash('sha256').update(value).digest('hex')}
export function newToken(){return randomBytes(32).toString('base64url')}
export function constantEqual(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)}
export function validWebhook(body:string,signature:string,secret:string){return constantEqual(createHmac('sha256',secret).update(body).digest('base64'),signature)}
function key(){const k=Buffer.from(required('PORTAL_TOKEN_KEY'),'base64');if(k.length!==32)throw new PortalError(503,'Portal encryption is not configured.');return k}
export function encrypt(value:unknown){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key(),iv);return Buffer.concat([iv,c.update(JSON.stringify(value)),c.final(),c.getAuthTag()]).toString('base64')}
export function decrypt<T>(value:string):T{const b=Buffer.from(value,'base64'),d=createDecipheriv('aes-256-gcm',key(),b.subarray(0,12));d.setAuthTag(b.subarray(-16));return JSON.parse(Buffer.concat([d.update(b.subarray(12,-16)),d.final()]).toString())}
export function qboEnvironment(){const value=required('QBO_ENVIRONMENT');if(value!=='sandbox'&&value!=='production')throw new PortalError(503,'Invalid QuickBooks environment.');return value}
// Keyed identifier: neither company ID nor credentials are exposed in storage keys.
export function qboScope(){const realm=required('QBO_EXPECTED_REALM_ID');if(!/^\d+$/.test(realm))throw new PortalError(503,'Invalid QuickBooks company configuration.');return createHmac('sha256',key()).update(qboEnvironment()+':'+realm).digest('hex')}
export const privateHeaders={'Cache-Control':'no-cache, no-store, max-age=0','Pragma':'no-cache','Referrer-Policy':'no-referrer'}
export function staffAllowed(profile:{role?:string;active?:boolean}|null){return !!profile&&profile.active===true&&['admin','ops_manager'].includes(profile.role||'')}
export function normalizeInvoice(i:Record<string,unknown>){
 const currency=(i.CurrencyRef as {value?:string})?.value;
 const updated=(i.MetaData as {LastUpdatedTime?:string})?.LastUpdatedTime;
 if(typeof i.Id!=='string'||typeof i.TotalAmt!=='number'||typeof i.Balance!=='number'||!currency||!updated||!Number.isFinite(i.TotalAmt)||!Number.isFinite(i.Balance))throw new PortalError(502,'QuickBooks returned an incomplete invoice.');
 return {qbo_id:i.Id,doc_number:typeof i.DocNumber==='string'?i.DocNumber:null,invoice_date:i.TxnDate||null,due_date:i.DueDate||null,currency,total:i.TotalAmt,balance:i.Balance,source_updated_at:updated};
}
export function invoiceStatus(i:{total:number;balance:number;due_date:string|null},today:string){if(i.total===0&&i.balance===0)return 'Zero balance';if(i.balance===0)return 'Paid';if(i.due_date&&i.due_date<today)return i.balance<i.total?'Partially paid · overdue':'Overdue';return i.balance<i.total?'Partially paid':'Open'}

export function creatorAuthUrl(){const url=new URL(required("PORTAL_AUTH_URL"));const staff=process.env.NEXT_PUBLIC_SUPABASE_URL;if(url.protocol!=="https:"||staff&&url.origin===new URL(staff).origin)throw new PortalError(503,"Creator authentication must use a separate HTTPS project.");return url.origin}

export function paymentUrl(value:unknown):string|null {
 if(value===null||value==='')return null;
 if(typeof value!=='string'||value.length>2048)throw new PortalError(400,'Enter a valid HTTPS payment link.');
 try {const url=new URL(value.trim());if(url.protocol!=='https:'||url.username||url.password)throw new Error();return url.href}
 catch{throw new PortalError(400,'Enter a valid HTTPS payment link.');}
}
