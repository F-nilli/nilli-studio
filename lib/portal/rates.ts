import {unstable_cache} from 'next/cache'
// Shared server Data Cache: never put creator tokens or account data in this cache.
export const RATE_TTL_SECONDS=3*60*60
export function validRates(payload:unknown,now=Date.now()){
 const b=(payload as {bitcoin?:Record<string,unknown>})?.bitcoin
 if(!b||typeof b.last_updated_at!=='number'||b.last_updated_at*1000<now-6*60*60*1000||b.last_updated_at*1000>now+60000)throw new Error('Price unavailable')
 const rates:Record<string,number>={}
 for(const c of ['usd','cad','eur','gbp','aud','mxn']){const value=b[c];if(typeof value!=='number'||!Number.isFinite(value)||value<=0)throw new Error('Price unavailable');rates[c.toUpperCase()]=value}
 return {bitcoin:rates,expiresAt:now+RATE_TTL_SECONDS*1000}
}
const cachedRates=unstable_cache(async()=>{
 try{
 const response=await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,cad,eur,gbp,aud,mxn&include_last_updated_at=true',{cache:'no-store',signal:AbortSignal.timeout(6000),headers:process.env.COINGECKO_DEMO_API_KEY?{'x-cg-demo-api-key':process.env.COINGECKO_DEMO_API_KEY}:{}})
 if(!response.ok)throw new Error('Price unavailable')
 return validRates(await response.json())
 }catch{return {bitcoin:null,expiresAt:Date.now()+5*60*1000}}
},['portal-display-rates-v1'],{revalidate:RATE_TTL_SECONDS})
export async function displayRates(){return cachedRates()}
