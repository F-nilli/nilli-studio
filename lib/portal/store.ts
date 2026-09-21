import { randomUUID } from 'node:crypto'
import { createClient as createSupabase } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { hash, newToken, PortalError, required, staffAllowed, creatorAuthUrl } from './core'
export const db=()=>createAdminClient()
export function check(error:unknown){if(error)throw new PortalError(503,'Portal storage is unavailable. Check the migration and configuration.')}
export async function staff(){const s=await createClient();const {data:{user}}=await s.auth.getUser();if(!user)throw new PortalError(401,'Sign in to the production app.');const {data,error}=await db().from('users').select('role,active').eq('id',user.id).single();check(error);if(!staffAllowed(data))throw new PortalError(403,'Admin or ops access required.');return user}
export async function validStaff(id:string){const {data,error}=await db().from('users').select('role,active').eq('id',id).single();check(error);if(!staffAllowed(data))throw new PortalError(403,'Staff access revoked.')}
export async function issueToken(kind:string,staffId:string,accountId:string|null,seconds:number){const token=newToken();const {error}=await db().from('portal_tokens').insert({token_hash:hash(token),kind,staff_id:staffId,account_id:accountId,expires_at:new Date(Date.now()+seconds*1000).toISOString()});check(error);return token}
export async function consumeToken(token:string,kind:string){const {data,error}=await db().from('portal_tokens').delete().eq('token_hash',hash(token)).eq('kind',kind).gt('expires_at',new Date().toISOString()).select().maybeSingle();check(error);if(!data)throw new PortalError(401,'Link expired or already used.');await validStaff(data.staff_id);return data}
export async function creator(request:Request){
 const token=request.headers.get('authorization')?.replace(/^Bearer /,'');if(!token)throw new PortalError(401,'Sign in to your creator account.');
 let accountId:string|undefined,preview=false;
 if(token.startsWith('preview_')){const {data,error}=await db().from('portal_tokens').select('staff_id,account_id').eq('token_hash',hash(token.slice(8))).eq('kind','preview_session').gt('expires_at',new Date().toISOString()).maybeSingle();check(error);if(!data)throw new PortalError(401,'Preview expired.');await validStaff(data.staff_id);accountId=data.account_id;preview=true}
 else {const url=creatorAuthUrl();const auth=createSupabase(url,required('PORTAL_AUTH_ANON_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});const {data:{user},error}=await auth.auth.getUser(token);if(error||!user)throw new PortalError(401,'Session expired. Please sign in again.');const {data,error:err}=await db().from('portal_accounts').select('id').eq('creator_user_id',user.id).eq('enabled',true).maybeSingle();check(err);accountId=data?.id}
 if(!accountId)throw new PortalError(403,'Your portal account has not been enabled.');
 const {data,error}=await db().from('portal_accounts').select('*,clients(label)').eq('id',accountId).eq('enabled',true).single();check(error);if(!data)throw new PortalError(403,'Portal access is disabled.');return {account:data,preview};
}
export async function locked<T>(fn:()=>Promise<T>):Promise<T>{const owner=randomUUID();const {data,error}=await db().rpc('portal_take_lock',{lock_name:'qbo',lock_owner:owner});check(error);if(!data)throw new PortalError(409,'QuickBooks synchronization is already running. Try again shortly.');try{return await fn()}finally{await db().from('portal_locks').delete().eq('name','qbo').eq('owner',owner)}}
