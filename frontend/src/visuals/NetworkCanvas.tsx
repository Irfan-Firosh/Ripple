import {useEffect,useRef} from 'react';
import {communities,connections,position,profiles,type Concept} from './network';
export function NetworkCanvas({concept,playing,theme,selected,onSelect,replay}:{concept:Concept;playing:boolean;theme:'dark'|'light';selected:number;onSelect:(id:number)=>void;replay:number}){
  const canvas=useRef<HTMLCanvasElement>(null);
  const images=useRef(new Map<number,HTMLImageElement>());
  const hitPoints=useRef<{id:number;x:number;y:number;r:number}[]>([]);
  const yaw=useRef(0),pitch=useRef(-.1),zoom=useRef(1),elapsed=useRef(0);
  const drag=useRef<{x:number;y:number;moving:boolean}|null>(null);
  const frame=useRef(0);
  useEffect(()=>{profiles.forEach(p=>{const img=new Image();img.src=p.avatar;img.onload=()=>images.current.set(p.id,img);});},[]);
  useEffect(()=>{elapsed.current=0;},[replay,concept]);
  useEffect(()=>{
    const el=canvas.current;if(!el)return;const ctx=el.getContext('2d');if(!ctx)return;
    const media=matchMedia('(prefers-reduced-motion: reduce)');let reduced=media.matches;const handleMotion=()=>{reduced=media.matches;};media.addEventListener('change',handleMotion);
    let width=1,height=1,last=0,visible=true;
    const resize=new ResizeObserver(([e])=>{width=e.contentRect.width;height=e.contentRect.height;const dpr=Math.min(devicePixelRatio,2);el.width=width*dpr;el.height=height*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);});resize.observe(el);
    const visibility=new IntersectionObserver(([e])=>{visible=e.isIntersecting});visibility.observe(el);
    const render=(timestamp:number)=>{
      const dt=last?Math.min((timestamp-last)/1000,.04):0;last=timestamp;
      if(visible&&!document.hidden){
        if(playing&&!reduced){elapsed.current+=dt;if(!drag.current)yaw.current+=dt*.045;}
        const t=reduced?7.5:elapsed.current%15;
        ctx.clearRect(0,0,width,height);
        const scale=Math.min(width/880,height/580)*zoom.current;
        const angle=yaw.current,tilt=pitch.current;
        const projected=profiles.map(p=>{
          const [x,y,z]=position(p.id,concept);
          const rx=x*Math.cos(angle)+z*Math.sin(angle),rz=-x*Math.sin(angle)+z*Math.cos(angle);
          const ry=y*Math.cos(tilt)-rz*Math.sin(tilt),depth=y*Math.sin(tilt)+rz*Math.cos(tilt);
          const perspective=850/(850+depth);
          return {...p,x:width/2+rx*scale*perspective,y:height/2+ry*scale*perspective,r:(p.id%12===0?24:18)*scale*perspective,depth,active:t>p.community*2.2+(p.id%12)*.15};
        });
        const byId=new Map(projected.map(p=>[p.id,p]));
        const ink=theme==='dark'?'168,185,208':'67,92,117';
        ctx.strokeStyle=`rgba(${ink},.05)`;ctx.lineWidth=1;
        for(let x=0;x<width;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke();}
        for(let y=0;y<height;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(width,y);ctx.stroke();}
        // Each community has a soft glow sitting behind its portrait cluster.
        for(let i=0;i<4;i++){
          const group=projected.filter(p=>p.community===i),x=group.reduce((s,p)=>s+p.x,0)/12,y=group.reduce((s,p)=>s+p.y,0)/12;
          const grad=ctx.createRadialGradient(x,y,0,x,y,130*scale);grad.addColorStop(0,communities[i].color+'15');grad.addColorStop(1,communities[i].color+'00');ctx.fillStyle=grad;ctx.fillRect(x-140*scale,y-140*scale,280*scale,280*scale);
        }
        for(const edge of connections){
          if(edge.bridge||profiles[edge.a].community!==profiles[edge.b].community)continue;
          const a=byId.get(edge.a)!,b=byId.get(edge.b)!,active=a.active&&b.active;
          ctx.strokeStyle=active?(edge.bridge?'#e6bc88aa':communities[a.community].color+'55'):`rgba(${ink},.15)`;
          ctx.lineWidth=edge.bridge?1.6: .7;ctx.setLineDash(edge.bridge?[4,6]:[]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);
          if(active&&playing&&!reduced){const f=(t*.38+edge.b*.073)%1,x=a.x+(b.x-a.x)*f,y=a.y+(b.y-a.y)*f;ctx.fillStyle=edge.bridge?'#efc58e':communities[a.community].color;ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=edge.bridge?12:5;ctx.beginPath();ctx.arc(x,y,edge.bridge?3:1.5,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;}
        }
        for(const p of projected.sort((a,b)=>b.depth-a.depth)){
          const color=communities[p.community].color;
          ctx.globalAlpha=p.active?1:.52;
          if(p.active||p.id===selected){ctx.strokeStyle=color+(p.id===selected?'ff':'88');ctx.lineWidth=p.id===selected?2.5:1;ctx.beginPath();ctx.arc(p.x,p.y,p.r+4,0,Math.PI*2);ctx.stroke();}
          ctx.save();ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.clip();ctx.fillStyle=theme==='dark'?'#1b2c41':'#e0e6e9';ctx.fillRect(p.x-p.r,p.y-p.r,p.r*2,p.r*2);
          const img=images.current.get(p.id);
          if(img){ctx.drawImage(img,p.x-p.r,p.y-p.r,p.r*2,p.r*2);}else{ctx.fillStyle=color;ctx.font=`500 ${p.r*.65}px "DM Sans"`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(p.initials,p.x,p.y);}
          ctx.restore();ctx.globalAlpha=1;
          if(p.id===selected){ctx.font='10px "DM Sans"';ctx.textAlign='center';ctx.fillStyle=theme==='dark'?'#eaf0f5':'#20354a';ctx.fillText(p.name,p.x,p.y+p.r+19);}
        }
        hitPoints.current=projected.map(p=>({id:p.id,x:p.x,y:p.y,r:p.r}));
      }
      frame.current=requestAnimationFrame(render);
    };
    frame.current=requestAnimationFrame(render);
    return()=>{cancelAnimationFrame(frame.current);resize.disconnect();visibility.disconnect();media.removeEventListener('change',handleMotion);};
  },[concept,playing,theme,selected]);
  return <canvas ref={canvas} className="network-canvas" data-bridge-edge-count="0" tabIndex={0} role="img" aria-label="Interactive three-dimensional audience network with portrait nodes across four communities. Drag to orbit, scroll to zoom, and select a profile." onKeyDown={e=>{if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","+","-"].includes(e.key)){e.preventDefault();if(e.key==="ArrowLeft")yaw.current-=.12;if(e.key==="ArrowRight")yaw.current+=.12;if(e.key==="ArrowUp")pitch.current=Math.max(-.8,pitch.current-.08);if(e.key==="ArrowDown")pitch.current=Math.min(.8,pitch.current+.08);if(e.key==="+")zoom.current=Math.min(1.6,zoom.current+.1);if(e.key==="-")zoom.current=Math.max(.65,zoom.current-.1);}}} onPointerDown={e=>{drag.current={x:e.clientX,y:e.clientY,moving:false};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{const d=drag.current;if(!d)return;const dx=e.clientX-d.x,dy=e.clientY-d.y;if(Math.abs(dx)+Math.abs(dy)>2)d.moving=true;yaw.current+=dx*.005;pitch.current=Math.max(-.8,Math.min(.8,pitch.current+dy*.003));d.x=e.clientX;d.y=e.clientY;}} onPointerUp={e=>{if(drag.current&&!drag.current.moving){const box=e.currentTarget.getBoundingClientRect(),x=e.clientX-box.left,y=e.clientY-box.top;const found=hitPoints.current.slice().reverse().find(p=>Math.hypot(p.x-x,p.y-y)<p.r+5);if(found)onSelect(found.id);}drag.current=null;}} onPointerCancel={()=>{drag.current=null;}} onWheel={e=>{zoom.current=Math.max(.65,Math.min(1.6,zoom.current-e.deltaY*.001));}}/>;
}
