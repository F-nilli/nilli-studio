'use client'
import {useEffect,useRef,useState,type ReactNode} from 'react'
import {ResizeMotion,SaveGlyph} from '@/components/motion/WorkflowMotion'
export function Collapse({open,children}:{open:boolean;children:ReactNode}){
 const [visited,setVisited]=useState(open)
 useEffect(()=>{if(open)setVisited(true)},[open])
 return <div className="portal-collapse" data-open={open} inert={!open} aria-hidden={!open}><div>{(visited||open)&&children}</div></div>
}
export function TabSurface({value,children}:{value:string;children:ReactNode}){
 const ref=useRef<HTMLDivElement>(null)
 useEffect(()=>{if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;const a=ref.current?.animate([{opacity:.4,transform:'translateY(3px)'},{opacity:1,transform:'translateY(0)'}],{duration:160,easing:'ease-out'});return()=>a?.cancel()},[value])
 return <ResizeMotion><div ref={ref}>{children}</div></ResizeMotion>
}
export function SkeletonRows({count=3}:{count?:number}){return <div role="status" aria-label="Loading" aria-busy="true" className="portal-skeletons">{Array.from({length:count},(_,i)=><div className="portal-skeleton-row" key={i} aria-hidden="true"><div><span/><span/></div><span/></div>)}</div>}
export function ActionLabel({busy,saved,children}:{busy:boolean;saved:boolean;children:ReactNode}){return <span className="portal-action-label"><SaveGlyph busy={busy} success={saved}/>{busy?'Saving…':saved?'Saved ✓':children}</span>}
export function usePortalAction(){
 const [busy,setBusy]=useState(false),[saved,setSaved]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');const lock=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined)
 useEffect(()=>()=>clearTimeout(timer.current),[])
 async function run(fn:()=>Promise<void>,success='Changes saved.'){
 if(lock.current)return;lock.current=true;clearTimeout(timer.current);setBusy(true);setSaved(false);setError('');setMessage('')
 try{await fn();setSaved(true);setMessage(success);timer.current=setTimeout(()=>setSaved(false),1800)}catch(e){setError(e instanceof Error?e.message:'Request failed.')}finally{lock.current=false;setBusy(false)}
 }
 return {run,busy,saved,error,message}
}
