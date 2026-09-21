'use client'
import {useEffect,useState} from 'react'
export default function Disconnect(){
 const [confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(false),[error,setError]=useState(''),[environment,setEnvironment]=useState(''),[ready,setReady]=useState(false)
 useEffect(()=>{fetch('/api/portal/admin/status').then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);setEnvironment(d.environment);setDone(!d.sync||d.sync.state==='disconnected');setReady(true)}).catch(e=>setError(e.message))},[])
 async function disconnect(){setBusy(true);setError('');try{const r=await fetch('/api/portal/admin/qbo-disconnect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmation})});const d=await r.json();if(!r.ok)throw new Error(d.error);setDone(true)}catch(e){setError(e instanceof Error?e.message:'Disconnect failed.')}finally{setBusy(false)}}
 return <main style={{maxWidth:720,margin:'40px auto',padding:28,background:'#1e1e1e',borderRadius:12}}>
 <h1 style={{fontSize:28}}>Disconnect QuickBooks</h1>
 <p style={{margin:'16px 0'}}>Environment: {environment||'Loading…'}</p>
 {done?<div role="status"><h2>QuickBooks is disconnected.</h2><p>Synchronization and invoice PDF retrieval are stopped. Cached invoice history is retained. No invoices were deleted from QuickBooks.</p></div>:<>
 <p>This disconnects Nilli Studio’s {environment} QuickBooks connection for all clients in this environment. It stops invoice updates and PDF downloads. Existing cached invoice history and customer mappings are kept for reconnection. It does not delete or change anything in QuickBooks.</p>
 <form onSubmit={e=>{e.preventDefault();disconnect()}}><label style={{display:'block',margin:'20px 0'}}>Type DISCONNECT to confirm<input style={{display:'block',padding:12,marginTop:8,background:'#111',border:'1px solid #555',color:'white'}} value={confirmation} onChange={e=>setConfirmation(e.target.value)} autoComplete="off"/></label><button disabled={!ready||busy||confirmation!=='DISCONNECT'} style={{padding:12,background:'#e03200',borderRadius:6,opacity:!ready||busy||confirmation!=='DISCONNECT'?.5:1}}>{busy?'Disconnecting…':'Confirm disconnect'}</button></form></>}
 {error&&<p role="alert" style={{color:'#ffb18f',marginTop:16}}>{error}</p>}
 <p style={{marginTop:24}}><a href="/portal-admin">Return to connection settings</a> · <a href="mailto:info@nillistudio.com">Contact support</a></p>
 </main>
}
