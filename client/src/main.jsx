import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUpRight, ArrowRight, ArrowLeft, MapPin, Compass, Camera, Users, Globe2, Check, Copy, Plus, X, Upload, Link, LockKeyhole, Trophy, Flag, Trash2, ImagePlus, LoaderCircle, ChevronRight, ChevronDown, Sparkles, MoveUpRight, LogIn, LogOut, Maximize2, Minimize2 } from 'lucide-react';
import { readPhotoLocation } from './photo-location';
import Map from './Map';
import LocationSearch from './LocationSearch';
import PhotoViewer from './PhotoViewer';
import { api, json, preparePhoto, formatDistance } from './api';
import './styles.css';
import './game.css';

function App() {
  const [route,setRoute] = useState(location.pathname);
  const [user,setUser] = useState(null), [authConfig,setAuthConfig] = useState(null), [ready,setReady] = useState(false);
  const host=!!user;
  const [login,setLogin] = useState(null), [toast,setToast] = useState('');
  const notify = message => setToast(message);
  const navigate = path => { history.pushState({},'',path); setRoute(path); window.scrollTo(0,0); };
  useEffect(() => {
    const listener = () => setRoute(location.pathname);
    addEventListener('popstate', listener);
    if(new URLSearchParams(location.hash.slice(1)).has('host'))history.replaceState({},'',location.pathname);
    api('/session').then(data=>{setUser(data.user);setAuthConfig(data.auth);}).catch(e=>notify(e.message)).finally(()=>setReady(true));
    return () => removeEventListener('popstate', listener);
  }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(()=>setToast(''),6000); return ()=>clearTimeout(timer); },[toast]);
  const create = () => host ? navigate('/create') : setLogin('/create');
  const signOut = async () => {
    try { await api('/auth/session',{method:'DELETE'});setUser(null);navigate('/'); }
    catch(e) { notify(e.message); }
  };
  return <>
    <header className="site-header"><div className="header-inner">
      <a className="brand" href="/" onClick={e=>{e.preventDefault();navigate('/');}}><span className="brand-icon"><MapPin size={22} strokeWidth={2}/></span>travelguesser<span className="brand-dot">.</span></a>
      <nav aria-label="Main navigation"><a className="how-link" href="/#how-it-works" onClick={e=>{if(route!=='/'){e.preventDefault();navigate('/');setTimeout(()=>document.getElementById('how-it-works')?.scrollIntoView({behavior:'smooth'}),100);}}}>How it works</a>{host && <button className="text-button trips-nav" onClick={()=>{navigate('/');setTimeout(()=>document.getElementById('my-trips')?.scrollIntoView({behavior:'smooth'}),100);}}>My trips</button>}<button className="button small" onClick={create}><Plus size={16}/> Create a trip</button></nav>
      <HeaderAccount key={user?.uid||'guest'} user={user} ready={ready} signIn={()=>setLogin(route)} signOut={signOut}/>
    </div></header>
    {!ready ? <div className="loading-page"><LoaderCircle className="spin"/> Unpacking…</div> : route === '/create' ? (host ? <CreateTrip user={user} navigate={navigate} notify={notify} signIn={()=>setLogin('/create')}/> : <div className="narrow-page"><LockKeyhole size={38}/><h1>Your next trip starts here.</h1><p>Sign in with Google to create a trip and keep your photos together. Friends can play without signing in.</p><button className="button" onClick={()=>setLogin('/create')}>Continue with Google <ArrowRight size={18}/></button></div>) : /^\/g\/[^/]+\/?$/.test(route) ? <Game key={route} id={route.split('/')[2]} navigate={navigate} notify={notify}/> : route === '/' ? <Home key={user?.uid||'guest'} host={host} create={create} navigate={navigate} notify={notify}/> : <div className="narrow-page"><h1>A little off the map.</h1><p>We couldn’t find that page.</p><button className="button" onClick={()=>navigate('/')}>Back home</button></div>}
    <footer className="site-footer"><a href="/" onClick={e=>{e.preventDefault();navigate('/');}}><Compass size={16}/> A little closer, wherever you are.</a><span>Made for the group chat <span className="footer-star">✳</span></span></footer>
    {login&&<CreatorLogin config={authConfig} close={()=>setLogin(null)} success={data=>{setUser(data.user);setLogin(null);if(login!==route)navigate(login);}}/>}
    {toast&&<div className="toast" role="status">{toast}<button aria-label="Dismiss notification" onClick={()=>setToast('')}><X size={16}/></button></div>}
  </>;
}

function HeaderAccount({user,ready,signIn,signOut}) {
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false);
  const ref=useRef(null),trigger=useRef(null);
  useEffect(()=>{
    if(!open)return;
    const outside=e=>{if(!ref.current?.contains(e.target))setOpen(false);};
    const escape=e=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus();}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[open]);
  if(!ready)return <div className="header-account"><button className="account-trigger" disabled aria-label="Checking sign-in status"><LoaderCircle size={18} className="spin"/><span>Loading…</span></button></div>;
  if(!user)return <div className="header-account"><button className="button outline small header-signin" onClick={signIn}><LogIn size={16}/> Sign in</button></div>;
  const name=user.name||user.email||'Explorer';
  const initials=name.trim().split(/\s+/).map(part=>Array.from(part)[0]).slice(0,2).join('').toLocaleUpperCase();
  return <div className="header-account" ref={ref} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false);}}>
    <button ref={trigger} className="account-trigger" aria-label={`Signed in as ${name}. Account options`} aria-expanded={open} aria-controls="account-panel" onClick={()=>setOpen(value=>!value)}>
      <span className="account-avatar" aria-hidden="true">{initials}</span><span className="account-label"><small>Signed in</small><strong>{name}</strong></span><ChevronDown size={14} aria-hidden="true"/>
    </button>
    {open&&<div id="account-panel" className="account-panel" role="group" aria-label="Your account"><span className="eyebrow">YOUR ACCOUNT</span><strong>{name}</strong>{user.email&&<span className="account-email">{user.email}</span>}<button className="text-button account-signout" disabled={busy} onClick={async()=>{setBusy(true);try{await signOut();}finally{setBusy(false);}}}>{busy?<LoaderCircle size={16} className="spin"/>:<LogOut size={16}/>} {busy?'Signing out…':'Sign out'}</button></div>}
  </div>;
}

function Home({host,create,navigate,notify}) {
  const [join,setJoin] = useState(''), [games,setGames] = useState([]), [loadError,setLoadError] = useState('');
  const [deleting,setDeleting] = useState(null);
  const load = () => api('/host/games').then(setGames).catch(e=>setLoadError(e.message));
  useEffect(()=>{if(host)load();},[host]);
  function joinGame(e) { e.preventDefault(); const raw=join.trim(); const id=raw.includes('/g/') ? raw.split('/g/')[1].split(/[?#/]/)[0] : raw; if(!/^[a-zA-Z0-9_-]{8,40}$/.test(id))return notify('Paste the trip link or code your friend sent you.');navigate(`/g/${id}`); }
  return <main className="home">
    <section className="hero">
      <div className="hero-copy"><div className="eyebrow"><span className="live-dot"/> A WORLD OF MEMORIES. A GAME WITH FRIENDS.</div><h1>You were there.<br/>Can they <em>guess where?</em></h1><p className="hero-description">Turn your travel photos into a little friendly competition. Drop your memories, share a link, and see who knows your world best.</p><div className="hero-buttons"><button className="button primary-large" onClick={create}>Create a trip <ArrowUpRight size={21}/></button><button className="button outline primary-large" onClick={()=>navigate('/g/demo-trip')}><Compass size={19}/> Try a demo</button></div><div className="hero-note"><span className="tiny-avatars"><span>W</span><span>A</span><span>J</span></span><span>No accounts for friends. Just a link and a hunch.</span></div></div>
      <div className="hero-art" aria-label="A travel photo ready for your friends to guess"><svg className="flight-path" viewBox="0 0 650 500" aria-hidden="true"><path d="M45 355C-25 211 151 91 188 162S44 318 153 360s239-27 371-155"/><path d="m513 207 20-11-5 23"/></svg><div className="back-postcard"/><div className="postcard"><div className="postcard-image"><img src="/images/mountains.jpg" alt="Dramatic mountain peaks catching the evening light"/><span className="photo-label"><Camera size={13}/> FROM YOUR CAMERA ROLL</span><span className="photo-pin"><MapPin size={25}/></span></div><div className="postcard-caption"><span>Somewhere worth remembering.</span><span>01 / ∞</span></div></div><div className="stamp"><Globe2 size={34} strokeWidth={1}/><span>THE WORLD<br/>IS YOURS TO GUESS</span></div><div className="guess-note"><span className="guess-note-icon"><MapPin size={17}/></span><div><b>Okay, I know this one…</b><span>Famous last words.</span></div><span className="guess-emoji">↗</span></div><div className="handwritten">Big memories. Wild guesses.<svg viewBox="0 0 200 15"><path d="M1 8Q100 0 194 9M28 13Q118 5 169 12"/></svg></div></div>
    </section>
    <section id="how-it-works" className="how-section"><div className="section-intro"><span className="eyebrow">LESS SETUP. MORE “WAIT, IS THAT…?”</span><h2>From camera roll to friendly rivalry.</h2></div><div className="steps">
      <Step number="01" icon={Camera} title="Pack your photos" text="Pick a few trip highlights. We’ll read their GPS data, or you can pin the spot yourself."/>
      <Step number="02" icon={Link} title="Send the invitation" text="One trip, one link. Drop it in the group chat and let your friends jump right in."/>
      <Step number="03" icon={MapPin} title="Let the guessing begin" text="They explore the photo and drop a pin. The closer the guess, the bigger the bragging rights."/>
    </div></section>
    {host&&<section className="my-trips" id="my-trips"><div className="section-heading"><div><span className="eyebrow">YOUR TRAVEL JOURNAL</span><h2>Ready for a few guesses.</h2></div><button className="text-button" onClick={create}>New trip <Plus size={16}/></button></div>{loadError&&<p className="error" role="alert">{loadError}</p>}{games.length ? <div className="trip-grid">{games.map(game=><article className="trip-card" key={game.id}><div className="trip-card-icon"><MapPin size={26}/></div><div><span className="eyebrow">{game.rounds} PHOTO{game.rounds===1?'':'S'} · {new Date(game.createdAt).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</span><h3>{game.title}</h3><p>Hosted by {game.hostName}</p></div><div className="trip-card-actions"><button className="button outline small" onClick={()=>copyLink(game.id,notify)}><Copy size={15}/> Invite</button><button className="icon-button" aria-label={`Open ${game.title}`} onClick={()=>navigate(`/g/${game.id}`)}><ArrowUpRight size={20}/></button><button className="icon-button" aria-label={`Delete ${game.title}`} onClick={()=>setDeleting(game)}><Trash2 size={16}/></button></div></article>)}</div> : <div className="empty-trips"><Camera size={25}/><p>Your next adventure belongs here.</p><button className="text-button" onClick={create}>Create your first trip <ArrowRight size={16}/></button></div>}</section>}
    <section className="invite-strip"><div className="invite-icon"><Users size={24}/></div><div><h3>Got an invitation?</h3><p>Your friend’s adventure is one link away.</p></div><form onSubmit={joinGame}><label className="sr-only" htmlFor="trip-link">Trip link or code</label><input id="trip-link" value={join} onChange={e=>setJoin(e.target.value)} placeholder="Paste a trip link or code" required/><button className="button" type="submit">Join trip <ArrowRight size={17}/></button></form></section>
    {deleting&&<Modal close={()=>setDeleting(null)} title="Delete this trip?"><p>“{deleting.title}” and its photos and scores will be deleted. Its invite link will stop working.</p><div className="modal-actions"><button className="button outline" onClick={()=>setDeleting(null)}>Keep trip</button><button className="button danger" onClick={async()=>{try{await api(`/games/${deleting.id}`,{method:'DELETE'});setDeleting(null);load();notify('Trip deleted.');}catch(e){notify(e.message);}}}>Delete trip</button></div></Modal>}
  </main>;
}

function Step({number,icon:Icon,title,text}) { return <article className="step"><div className="step-top"><span className="step-icon"><Icon size={23} strokeWidth={1.6}/></span><span className="step-number">{number}</span></div><h3>{title}</h3><p>{text}</p></article>; }

function Modal({close,title,children}) {
  const ref=useRef(null);
  useEffect(()=>{const old=document.activeElement;const el=ref.current;el?.focus();const fn=e=>{if(e.key==='Escape')close();if(e.key==='Tab'){const all=[...el.querySelectorAll('button, input, a, select, textarea, [tabindex="0"]')].filter(x=>!x.disabled);if(!all.length)return;const first=all[0],last=all.at(-1);if(e.shiftKey&&(document.activeElement===first||document.activeElement===el)){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};document.addEventListener('keydown',fn);return()=>{document.removeEventListener('keydown',fn);old?.focus();};},[]);
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabIndex={-1} ref={ref}><button className="modal-close icon-button" onClick={close} aria-label="Close dialog"><X size={20}/></button><span className="modal-symbol"><Compass size={27}/></span><h2 id="modal-title">{title}</h2>{children}</section></div>;
}

function CreatorLogin({config,close,success}) {
  const [signIn,setSignIn]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    if(config?.provider==='local')setSignIn(()=>()=>api('/auth/session',json('POST',{idToken:'local-development'})));
    else if(config?.firebase)import('./google-auth').then(m=>m.prepareGoogleSignIn(config.firebase)).then(fn=>{if(active)setSignIn(()=>fn);}).catch(()=>{if(active)setError('Couldn’t prepare Google sign-in. Please refresh and try again.');});
    else setError('Sign-in is unavailable. Please refresh and try again.');
    return()=>{active=false;};
  },[config]);
  return <Modal close={close} title="Your next trip starts here"><p>Sign in to create trips and find them on any device. Your friends only need the trip link to play.</p><button type="button" className="button full google-signin" disabled={!signIn||busy} onClick={async()=>{setBusy(true);setError('');try{success(await signIn());}catch(e){setError(e.message);}finally{setBusy(false);}}}>{busy?<LoaderCircle size={19} className="spin"/>:<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M43.6 24.5c0-1.5-.1-3-.4-4.5H24v8.5h11a9.4 9.4 0 0 1-4.1 6.2v5.2h6.7c3.9-3.6 6-8.8 6-15.4z"/><path fill="#34A853" d="M24 44c5.4 0 10-1.8 13.3-4.9l-6.7-5.2c-1.8 1.2-4 2-6.6 2-5.2 0-9.6-3.5-11.2-8.2H5.9v5.3A20 20 0 0 0 24 44z"/><path fill="#FBBC05" d="M12.8 27.7a12 12 0 0 1 0-7.4V15H5.9a20 20 0 0 0 0 18z"/><path fill="#EA4335" d="M24 12.1c2.9 0 5.5 1 7.5 2.9l5.6-5.6A19 19 0 0 0 24 4 20 20 0 0 0 5.9 15l6.9 5.3C14.4 15.6 18.8 12.1 24 12.1z"/></svg>}{busy?'Signing in…':config?.provider==='local'?'Continue locally':'Continue with Google'}</button>{error&&<p className="error" role="alert">{error}</p>}<p className="small-note">Up to 5 trips · 12 photos per trip<br/>We only use your basic Google profile. Your public host name is up to you.</p></Modal>;
}

async function copyLink(id,notify) { try{await navigator.clipboard.writeText(`${location.origin}/g/${id}`);notify('Invite link copied. Time to wake up the group chat.');}catch{notify('Copy the trip link from your address bar or the share box.');} }

function CreateTrip({user,navigate,notify,signIn}) {
  const [photos,setPhotos]=useState([]),[selected,setSelected]=useState(0),[title,setTitle]=useState(''),[hostName,setHostName]=useState(localStorage.getItem('tg_host_name')||user?.name||'');
  const [busy,setBusy]=useState(false),[preparing,setPreparing]=useState(false),[error,setError]=useState(''),[created,setCreated]=useState(null),[drag,setDrag]=useState(false);
  const [usage,setUsage]=useState(null);
  useEffect(()=>{api('/host/usage').then(setUsage).catch(e=>setError(e.message));},[]);
  const input=useRef(null), photoRef=useRef(photos); photoRef.current=photos;
  useEffect(()=>()=>photoRef.current.forEach(p=>URL.revokeObjectURL(p.url)),[]);
  const current=photos[selected];
  const update = changes => setPhotos(list=>list.map((p,i)=>i===selected?{...p,...changes}:p));
  async function addFiles(files) {
    if(preparing)return;
    setPreparing(true);setError('');
    const allowed=[...files].slice(0,12-photos.length);
    if(files.length>allowed.length)notify('A trip can have up to 12 photos.');
    const added=[];
    for(const file of allowed){try{const metadata=await readPhotoLocation(file);const prepared=await preparePhoto(file);added.push({...prepared,...metadata,id:crypto.randomUUID(),name:file.name,caption:''});}catch(e){setError(e.message);}}
    setPhotos(list=>[...list,...added]);if(added.length)setSelected(photos.length);setPreparing(false);
  }
  async function publish(e){
    e.preventDefault();setBusy(true);setError('');
    const form=new FormData();form.append('metadata',JSON.stringify({title,hostName,photos:photos.map(p=>({...p.location,caption:p.caption}))}));photos.forEach(p=>form.append('photos',p.file,'photo.jpg'));
    try{const game=await api('/games',{method:'POST',body:form});localStorage.setItem('tg_host_name',hostName);setCreated(game);}catch(e){setError(e.message);if(e.status===401)signIn();}finally{setBusy(false);}
  }
  const missing=photos.filter(p=>!p.location).length;
  if(created)return <main className="narrow-page created-page"><span className="success-icon"><Check size={35}/></span><span className="eyebrow">LET THE FRIENDLY RIVALRY BEGIN</span><h1>Your trip is<br/><em>ready to go.</em></h1><p>“{created.title}” has {created.rounds} {created.rounds===1?'memory':'memories'} waiting to be placed on the map. Send the link to your friends.</p><div className="share-box"><input aria-label="Trip invite link" readOnly value={`${location.origin}/g/${created.id}`} onFocus={e=>e.target.select()}/><button className="button" onClick={()=>copyLink(created.id,notify)}><Copy size={17}/> Copy link</button></div><div className="center-buttons"><button className="button outline" onClick={()=>navigate(`/g/${created.id}`)}>Open trip <ArrowUpRight size={17}/></button><button className="text-button" onClick={()=>navigate('/')}>Back to my trips</button></div><p className="small-note"><LockKeyhole size={14}/> Anyone with this trip link can play and see its photos.</p></main>;
  return <main className="create-page"><button className="back-link" onClick={()=>navigate('/')}><ArrowLeft size={16}/> Back to your travels</button><div className="page-heading"><div><span className="eyebrow">THE BEST SOUVENIRS ARE STORIES</span><h1>Make it <em>a trip.</em></h1><p>A few photos. A few pins. A whole lot of “I’ve been there!”</p></div><span className="page-badge"><Camera size={17}/> 1–12 photos per trip</span></div>
    {usage&&<p className={`creator-quota ${usage.trips>=usage.limits.activeTrips?'error':''}`} role="status">{usage.trips} / {usage.limits.activeTrips} trips in your collection.{usage.trips>=usage.limits.activeTrips?' Delete a trip from My trips to make room.':' Friends can play without an account.'}</p>}<form onSubmit={publish}><div className="trip-details panel"><div className="section-number">01</div><div className="field"><label htmlFor="title">Give your trip a name</label><input id="title" placeholder="e.g. A summer worth getting lost in" value={title} onChange={e=>setTitle(e.target.value)} required maxLength={80}/></div><div className="field host-name"><label htmlFor="name">Your name</label><input id="name" placeholder="Who’s behind the camera?" value={hostName} onChange={e=>setHostName(e.target.value)} required maxLength={30}/></div></div>
    <div className="upload-heading"><div><span className="section-number">02</span><h2>Unpack your camera roll</h2></div><span>{photos.length} / 12 photos</span></div>
    <input type="file" accept="image/jpeg,image/png,image/webp" multiple ref={input} className="sr-only" aria-label="Upload travel photos" onChange={e=>{addFiles(e.target.files);e.target.value='';}}/>
    {!photos.length ? <button type="button" className={`dropzone ${drag?'dragging':''}`} onClick={()=>input.current.click()} onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);addFiles(e.dataTransfer.files);}} disabled={preparing}><span className="drop-icon">{preparing?<LoaderCircle className="spin" size={30}/>:<ImagePlus size={30} strokeWidth={1.5}/>}</span><h3>{preparing?'Getting your photos ready…':'Drop a little adventure here'}</h3><p>Drag photos here, or <span>browse your files</span></p><small>JPG, PNG or WebP · Up to 25 MB each · GPS detected automatically</small></button> : <div className="photo-workspace panel"><div className="photo-rail">{photos.map((p,i)=><button type="button" key={p.id} className={`photo-thumb ${selected===i?'selected':''}`} onClick={()=>setSelected(i)} aria-label={`Edit photo ${i+1}${p.location?', location set':', needs a location'}`}><img src={p.url} alt={`Trip photo ${i+1}`}/><span className="thumb-number">{i+1}</span><span className={`thumb-status ${p.location?'set':''}`}>{p.location?<Check size={11}/>:<MapPin size={11}/>}</span></button>)}{photos.length<12&&<button type="button" className="add-photo" onClick={()=>input.current.click()} disabled={preparing} aria-label="Add more photos">{preparing?<LoaderCircle className="spin" size={23}/>:<Plus size={23}/>}<span>Add photos</span></button>}</div>
    {current&&<div className="photo-editor"><div className="photo-preview"><img src={current.url} alt={`Selected trip photo ${selected+1}`}/><button type="button" className="remove-photo" onClick={()=>{URL.revokeObjectURL(current.url);setPhotos(p=>p.filter((_,i)=>i!==selected));setSelected(s=>Math.max(0,s-1));}}><Trash2 size={15}/> Remove</button><span className="preview-number">PHOTO {String(selected+1).padStart(2,'0')}</span></div><div className="location-editor"><div className="location-title"><div><h3>{current.location ? (current.gps?'Location found automatically':'Location set') : current.gpsStatus==='unreadable'?'Couldn’t read the photo’s GPS':'No GPS location in this photo'}</h3><p>{current.location ? (current.gps?'The photo’s GPS placed this pin. You can publish without changing it.':'Pin placed. You can move it with another click.') : current.gpsStatus==='unreadable'?'Try the original camera file, search for the place, or set a pin on the map.':'This file has no saved GPS coordinates. Search for the place below, choose a geotagged original, or place a pin.'}</p></div><span className={`location-status ${current.location?'set':''}`}>{current.location?<Check size={17}/>:<MapPin size={17}/>}</span></div><LocationSearch key={`search-${current.id}`} onSelect={place=>update({location:{lat:place.lat,lng:place.lng},gps:false,locationFocus:place})}/><Map key={current.id} value={current.location} focus={current.locationFocus} onChange={location=>update({location,gps:false})} className="editor-map"/><CoordinateFields value={current.location} onChange={location=>update({location,gps:false})}/><label htmlFor="caption">A little story for the reveal <span>(optional)</span></label><input id="caption" placeholder="That café we nearly walked past…" maxLength={200} value={current.caption} onChange={e=>update({caption:e.target.value})}/><small>Friends see this after they guess.</small></div></div>}</div>}
    {error&&<p className="error" role="alert">{error}</p>}<div className="publish-bar"><div><LockKeyhole size={18}/><span>Locations stay secret until each guess.<br/><small>We remove location metadata from shared photos.</small></span></div><button className="button" disabled={busy||preparing||!photos.length||!!missing||!title.trim()||!hostName.trim()||!usage||usage.trips>=usage.limits.activeTrips}>{busy?<><LoaderCircle className="spin" size={18}/> Publishing your trip…</>:<>Create & share trip <ArrowRight size={18}/></>}</button></div>{missing>0&&<p className="missing-note">{missing} {missing===1?'photo has':'photos have'} no detected GPS location. Set {missing===1?'its location':'their locations'} or choose geotagged photos to publish.</p>}</form>
  </main>;
}

function CoordinateFields({value,onChange}) {
  const [lat,setLat]=useState(value?value.lat.toFixed(5):''),[lng,setLng]=useState(value?value.lng.toFixed(5):'');
  useEffect(()=>{setLat(value?value.lat.toFixed(5):'');setLng(value?value.lng.toFixed(5):'');},[value?.lat,value?.lng]);
  function apply(a,b){if(a.trim()&&b.trim()&&Number.isFinite(Number(a))&&Number.isFinite(Number(b))&&Math.abs(Number(a))<=90&&Math.abs(Number(b))<=180)onChange({lat:Number(a),lng:Number(b)});}
  return <details className="coordinates"><summary>{value?`${value.lat.toFixed(4)}°, ${value.lng.toFixed(4)}°`:'Or enter coordinates'} <ChevronRight size={13}/></summary><div><label>Latitude<input type="number" step="any" min="-90" max="90" placeholder="−90 to 90" value={lat} onChange={e=>setLat(e.target.value)} onBlur={()=>apply(lat,lng)}/></label><label>Longitude<input type="number" step="any" min="-180" max="180" placeholder="−180 to 180" value={lng} onChange={e=>setLng(e.target.value)} onBlur={()=>apply(lat,lng)}/></label><button type="button" className="button small outline" onClick={()=>apply(lat,lng)}>Set pin</button></div></details>;
}

function Game({id,navigate,notify}) {
  const [game,setGame]=useState(null),[run,setRun]=useState(null),[name,setName]=useState(localStorage.getItem('tg_player_name')||'');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[pin,setPin]=useState(null),[result,setResult]=useState(null),[board,setBoard]=useState([]),[loading,setLoading]=useState(true);
  const [mapExpanded,setMapExpanded]=useState(false);
  const submitting=useRef(false);
  useEffect(()=>{api(`/games/${id}`).then(data=>{setGame(data.game);setRun(data.run);}).catch(e=>setError(e.message)).finally(()=>setLoading(false));},[id]);
  useEffect(()=>{if(run?.completed){api(`/games/${id}/leaderboard`).then(setBoard).catch(e=>notify(e.message));}},[run?.completed,id]);
  async function join(e){e.preventDefault();setBusy(true);setError('');try{const data=await api(`/games/${id}/join`,json('POST',{name}));localStorage.setItem('tg_player_name',name);setRun(data);}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function guess(){if(!pin||submitting.current||result||!run||run.completed)return;submitting.current=true;setBusy(true);setError('');try{const data=await api(`/games/${id}/guess`,json('POST',{...pin,round:run.round}));setResult(data.result);setRun(data.run);setMapExpanded(true);}catch(e){setError(e.message);}finally{submitting.current=false;setBusy(false);}}
  useEffect(()=>{
    if(!run||run.completed||result)return;
    const onKey=event=>{
      if((event.code!=='Space'&&event.key!==' ')||event.repeat||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||event.defaultPrevented)return;
      if(event.target instanceof Element && event.target.closest('input, textarea, select, button, a, summary, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="dialog"]'))return;
      event.preventDefault();
      if(pin&&!busy)guess();
    };
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
  },[run,result,pin,busy]);
  if(loading)return <div className="loading-page"><LoaderCircle className="spin"/> Finding your adventure…</div>;
  if(!game)return <main className="narrow-page"><Compass size={38}/><h1>A little off the map.</h1><p role="alert">{error}</p><button className="button" onClick={()=>navigate('/')}>Back home</button></main>;
  if(!run)return <main className="join-page"><div className="join-art"><img src="/images/mountains.jpg" alt="Sunlit mountain peaks"/><div><span className="eyebrow">YOU’RE INVITED TO GET A LITTLE LOST</span><h2>Every photo<br/>has a place.<br/><em>Find it.</em></h2></div><span className="join-art-footer"><Globe2 size={18}/> Your next adventure starts with a guess.</span></div><div className="join-form"><span className="pill"><Users size={15}/> {game.demo?'A taste of the adventure':`An adventure by ${game.hostName}`}</span><h1>{game.title}</h1><p>{game.demo?'Three iconic places. One world map. Give it your best shot.':`${game.hostName} has ${game.rounds} ${game.rounds===1?'photo':'photos'} for you. Look for clues, drop a pin, and see how close you can get.`}</p><div className="game-facts"><span><Camera size={18}/><b>{game.rounds}</b> rounds</span><span><Trophy size={18}/><b>{(game.rounds*5000).toLocaleString()}</b> possible points</span></div><form onSubmit={join}><label htmlFor="player-name">What should we call you?</label><input id="player-name" placeholder="Your name or legendary nickname" value={name} onChange={e=>setName(e.target.value)} maxLength={24} required autoComplete="nickname"/>{error&&<p className="error" role="alert">{error}</p>}<button className="button full" disabled={busy}>{busy?<LoaderCircle className="spin" size={18}/>:<Compass size={18}/>} Let’s explore <ArrowRight size={18}/></button></form><p className="small-note"><LockKeyhole size={13}/> No sign-up. Your progress is saved in this browser.</p></div></main>;
  if(run.completed&&!result)return <main className="results-page"><div className="results-hero"><span className="success-icon"><Trophy size={35}/></span><span className="eyebrow">SOME GOOD GUESSES. SOME GREAT MEMORIES.</span><h1>Well travelled,<br/><em>{run.name}.</em></h1><p>You’ve explored “{game.title}”. Here’s how you did.</p><div className="total-score">{run.score.toLocaleString()}<span>/ {(game.rounds*5000).toLocaleString()} points</span></div><div className="center-buttons"><button className="button" onClick={()=>copyLink(id,notify)}>Challenge a friend <ArrowUpRight size={18}/></button><button className="button outline" onClick={()=>navigate('/')}>Back home</button></div></div><div className="results-columns"><section className="panel round-summary"><h2>Your journey, in pins.</h2>{run.results.map((r,i)=><div className="summary-row" key={i}><img src={`/api/games/${id}/photos/${i}`} alt={`Photo from round ${i+1}`}/><div><span className="eyebrow">ROUND {i+1}</span><p>{formatDistance(r.distance)} away</p></div><strong>{r.score.toLocaleString()}<small> pts</small></strong></div>)}</section><section className="panel leaderboard"><div className="leaderboard-title"><h2>The bragging board</h2><Trophy size={23}/></div><p>A little competition brings everyone closer.</p>{board.length ? board.map((entry,i)=><div key={`${entry.name}-${i}`} className="leaderboard-row"><span className={`rank ${i===0?'first':''}`}>{i===0?<Trophy size={16}/>:String(i+1).padStart(2,'0')}</span><b>{entry.name}</b><span>{entry.score.toLocaleString()} <small>pts</small></span></div>) : <p className="small-note">Scores appear here when players finish.</p>}<button className="text-button" onClick={()=>api(`/games/${id}/leaderboard`).then(setBoard).catch(e=>notify(e.message))}>Refresh scores <ArrowRight size={15}/></button></section></div></main>;
  const round=result?result.round:run.round;
  return <main className="play-page">
    <PhotoViewer key={round} src={`/api/games/${id}/photos/${round}`} alt={`Mystery location for round ${round+1}`}/>
    <header className="play-heading">
      <button className="play-home" aria-label="Back home" onClick={()=>navigate('/')}><ArrowLeft size={19}/></button>
      <div className="play-trip"><span className="eyebrow">{game.title}</span><h1>{result?'The moment of truth.':'Somewhere in the world…'}</h1></div>
      <div className="play-stats"><span><Camera size={16}/><b>{round+1}</b> / {game.rounds}</span><span><Trophy size={16}/><b>{run.score.toLocaleString()}</b> <span>pts</span></span></div>
      <div className="round-progress" aria-label={`Round ${round+1} of ${game.rounds}`}>{Array.from({length:game.rounds},(_,i)=><span key={i} className={i<run.round?'done':i===round?'current':''}/>)}</div>
    </header>
    <section className={`guess-panel panel ${mapExpanded?'is-expanded':''} ${result?'showing-result':''}`} aria-label="Guess map"
      onPointerEnter={event=>{if(event.pointerType==='mouse')setMapExpanded(true);}}
      onPointerLeave={event=>{if(!event.currentTarget.contains(document.activeElement))setMapExpanded(false);}}
      onFocusCapture={event=>{if(!event.target.closest('[data-map-toggle]'))setMapExpanded(true);}}
      onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget))setMapExpanded(false);}}>
      <div className="guess-panel-header"><MapPin size={19}/><div><h2>{result?(result.distance<10?'You know your way around!':result.distance<500?'A pretty good hunch.':'A world of possibility.'):'Where’s your hunch?'}</h2><p>{result?'Your guess, meet the real location.':'Scroll to zoom · Click to drop a pin'}</p></div><button type="button" data-map-toggle aria-label={mapExpanded?'Make map smaller':'Enlarge map'} aria-expanded={mapExpanded} className="icon-button map-size-toggle" onClick={()=>setMapExpanded(value=>!value)}>{mapExpanded?<Minimize2 size={17}/>:<Maximize2 size={17}/>}</button></div>
      <Map key={`${round}-${!!result}`} value={result?result.guess:pin} actual={result?.actual} onChange={result?undefined:setPin} className="guess-map"/>
      {result?<div className="round-result"><div className="map-legend"><span><i className="guess-dot"/> Your guess</span><span><i className="actual-dot"/> Actual location</span></div><div className="result-numbers"><div><span>DISTANCE</span><b>{formatDistance(result.distance)}</b></div><div><span>ROUND SCORE</span><b>+{result.score.toLocaleString()} <small>pts</small></b></div></div>{result.caption&&<p className="reveal-caption">{result.caption}</p>}<button className="button full" onClick={()=>{setResult(null);setPin(null);setError('');setMapExpanded(false);document.activeElement?.blur();}}>{run.completed?'See the final scores':'Next photo'} <ArrowRight size={18}/></button></div>:<div className="guess-controls"><CoordinateFields value={pin} onChange={setPin}/><button className="button full" disabled={!pin||busy} onClick={guess} aria-keyshortcuts="Space">{busy?<LoaderCircle className="spin" size={18}/>:<MapPin size={17}/>} {pin?'Lock in your guess':'Drop a pin to guess'} {pin&&<kbd>SPACE</kbd>}</button><small>{pin?'Press Space to confirm your guess.':'Hover, focus, or tap expand for a bigger map.'}</small></div>}
      {error&&<p className="error" role="alert">{error}</p>}
    </section>
  </main>;
}

createRoot(document.getElementById('root')).render(<App/>);
