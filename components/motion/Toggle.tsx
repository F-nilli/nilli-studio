 'use client'
import {useState,type InputHTMLAttributes} from 'react'
/** Native switch input preserves form, label, keyboard and existing change handlers. */
export function Toggle({className='',onChange,...props}:InputHTMLAttributes<HTMLInputElement>){
 const [interacted,setInteracted]=useState(false)
 return <span className={`t-toggle ${interacted?'is-init':''}`}><input {...props} type="checkbox" role="switch" className={className} onChange={e=>{setInteracted(true);onChange?.(e)}}/><span className="t-toggle-thumb" aria-hidden="true"/></span>
}
