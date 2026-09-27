import { useEffect, useRef, useState } from 'react';
import { Timer } from 'lucide-react';
export default function RoundClock({deadline,serverNow,onExpire}) {
  const [now,setNow]=useState(Date.now()),offset=useRef(0),expired=useRef(0),callback=useRef(onExpire);
  callback.current=onExpire;
  useEffect(()=>{offset.current=(serverNow||Date.now())-Date.now();setNow(Date.now());},[serverNow]);
  useEffect(()=>{expired.current=0;if(!deadline)return;const t=setInterval(()=>{
    const n=Date.now();setNow(n);
    if(n+offset.current>deadline+400 && n-expired.current>2000){expired.current=n;callback.current?.();}
  },250);return()=>clearInterval(t);},[deadline]);
  if(!deadline)return null;
  const seconds=Math.max(0,Math.ceil((deadline-now-offset.current)/1000));
  return <span className={`round-clock ${seconds<=10?'urgent':''}`} role="timer" aria-label={`${seconds} seconds remaining`}><Timer size={16}/>{Math.floor(seconds/60)}:{String(seconds%60).padStart(2,'0')}</span>;
}
