import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, Scan } from 'lucide-react';

export default function PhotoViewer({ src, alt }) {
  const viewport = useRef(null), scale = useRef(1), anchor = useRef(null), drag = useRef(null);
  const [zoom, setZoom] = useState(1), [dragging, setDragging] = useState(false);
  const zoomTo = useCallback((value, point) => {
    const el = viewport.current;
    if (!el) return;
    const next = Math.max(1, Math.min(4, value));
    const x = point?.x ?? el.clientWidth / 2, y = point?.y ?? el.clientHeight / 2;
    anchor.current = { left:(el.scrollLeft + x) * next / scale.current - x, top:(el.scrollTop + y) * next / scale.current - y };
    scale.current = next;
    setZoom(next);
  }, []);
  useLayoutEffect(() => {
    if (anchor.current && viewport.current) {
      viewport.current.scrollLeft = anchor.current.left;
      viewport.current.scrollTop = anchor.current.top;
    }
  }, [zoom]);
  useEffect(() => {
    const el = viewport.current;
    const wheel = event => {
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      const bounds = el.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientHeight : 1);
      zoomTo(scale.current * Math.exp(-Math.max(-200,Math.min(200,delta)) * .0025), {x:event.clientX-bounds.left,y:event.clientY-bounds.top});
    };
    el.addEventListener('wheel',wheel,{passive:false});
    return () => el.removeEventListener('wheel',wheel);
  }, [zoomTo]);
  function stopDrag(event) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null; setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <section className="photo-viewer" aria-label="Mystery photo">
    <div ref={viewport} className={`photo-viewport ${zoom>1?'is-zoomed':''} ${dragging?'is-dragging':''}`} tabIndex={0} role="region" aria-label="Photo viewer. Scroll to zoom, drag to pan. Use plus and minus to zoom, zero to fit."
      onDoubleClick={event=>{const r=event.currentTarget.getBoundingClientRect();zoomTo(scale.current>1?1:2,{x:event.clientX-r.left,y:event.clientY-r.top});}}
      onKeyDown={event=>{if(['+','=','-','0'].includes(event.key)){event.preventDefault();zoomTo(event.key==='0'?1:scale.current*(event.key==='-'?.8:1.25));}}}
      onPointerDown={event=>{if(event.pointerType!=='mouse'||event.button!==0||scale.current===1)return;event.currentTarget.focus({preventScroll:true});drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,left:event.currentTarget.scrollLeft,top:event.currentTarget.scrollTop};event.currentTarget.setPointerCapture(event.pointerId);setDragging(true);event.preventDefault();}}
      onPointerMove={event=>{const start=drag.current;if(start?.id===event.pointerId){event.currentTarget.scrollLeft=start.left+start.x-event.clientX;event.currentTarget.scrollTop=start.top+start.y-event.clientY;}}}
      onPointerUp={stopDrag} onPointerCancel={stopDrag} onLostPointerCapture={()=>{drag.current=null;setDragging(false);}}>
      <div className="photo-canvas" style={{width:`${zoom*100}%`,height:`${zoom*100}%`}}><img src={src} alt={alt} draggable={false}/></div>
    </div>
    <div className="photo-tools" aria-label="Photo zoom controls">
      <button type="button" className="photo-closer" aria-label="Look a little closer" onClick={()=>zoomTo(scale.current===1?2:scale.current*1.25)} disabled={zoom>=4}><ZoomIn size={17}/><span>Look a little closer</span></button>
      <span className="photo-zoom-value" aria-live="polite">{Math.round(zoom*100)}%</span>
      <button type="button" aria-label="Zoom out of photo" onClick={()=>zoomTo(scale.current*.8)} disabled={zoom<=1}><ZoomOut size={18}/></button>
      <button type="button" aria-label="Fit whole photo" onClick={()=>zoomTo(1)} disabled={zoom<=1}><Scan size={18}/></button>
    </div>
    <p className="photo-help">Scroll to zoom · Drag to explore</p>
  </section>;
}
