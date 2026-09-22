export const currencyChoices=['original','USD','CAD','BTC','SAT'];
export function preferences(value={}){return {dateFormat:['auto','mdy','dmy','iso'].includes(value?.dateFormat)?value.dateFormat:'auto',currency:currencyChoices.includes(value?.currency)?value.currency:'original'}}
export function displayDate(value,style='auto'){
 if(!value)return 'To be confirmed';
 const dateOnly=/^\d{4}-\d{2}-\d{2}$/.test(value),d=new Date(dateOnly?value+'T12:00:00Z':value);
 if(!Number.isFinite(d.getTime()))return 'To be confirmed';
 const zone=dateOnly?{timeZone:'UTC'}:{};
 let result;
 if(style==='iso'){const parts=new Intl.DateTimeFormat('en-US',{year:'numeric',month:'2-digit',day:'2-digit',...zone}).formatToParts(d);const part=t=>parts.find(p=>p.type===t).value;result=`${part('year')}-${part('month')}-${part('day')}`}
 else result=new Intl.DateTimeFormat(style==='mdy'?'en-US':style==='dmy'?'en-GB':undefined,{year:'numeric',month:style==='auto'?'short':'2-digit',day:style==='auto'?'numeric':'2-digit',...zone}).format(d);
 return dateOnly?result:result+' · '+new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(d);
}
export function originalMoney(amount,currency){try{return new Intl.NumberFormat(undefined,{style:'currency',currency,currencyDisplay:'code'}).format(amount)}catch{return `${amount} ${currency}`}}
export function convertMoney(amount,source,target,rates){
 if(target==='original'||target===source)return null;
 const bitcoin=rates?.bitcoin,base=bitcoin?.[source];
 if(!Number.isFinite(amount)||!Number.isFinite(base)||base<=0)return null;
 const btc=amount/base;
 if(target==='BTC')return new Intl.NumberFormat(undefined,{maximumFractionDigits:8}).format(btc)+' BTC';
 if(target==='SAT')return new Intl.NumberFormat(undefined,{maximumFractionDigits:0}).format(btc*100000000)+' sats';
 const quote=bitcoin?.[target];if(!Number.isFinite(quote)||quote<=0)return null;
 return originalMoney(btc*quote,target);
}
