import { useEffect, useRef } from 'react';
import type { CascadeNetwork, Vec3 } from './liveNetwork';

type Props={network:CascadeNetwork;elapsed:number;theme:'dark'|'light';selected:number|null;focus:number|null;zoomStep:number;reset:number;onSelect:(id:number)=>void};
export function CascadeCanvas(props:Props) {
  const canvas=useRef<HTMLCanvasElement>(null);
  const latest=useRef(props);latest.current=props;
  const lastZoomStep=useRef(props.zoomStep);
  const images=useRef(new Map<number,HTMLImageElement>());
  const hits=useRef<{id:number;x:number;y:number;r:number}[]>([]);
  const camera=useRef({yaw:.12,pitch:-.18,zoom:1,targetZoom:1,center:[0,0,0] as number[],target:[0,0,0] as number[]});
  const drag=useRef<{x:number;y:number;moved:boolean}|null>(null);
  const {network}=props;
  useEffect(()=>{camera.current.target=props.focus===null?[0,0,0]:[...network.communities[props.focus].center];camera.current.targetZoom=props.focus===null?1:2.2;},[props.focus,network]);
  useEffect(()=>{camera.current.targetZoom=Math.max(.55,Math.min(4,camera.current.targetZoom+(props.zoomStep-lastZoomStep.current)*.15));lastZoomStep.current=props.zoomStep;},[props.zoomStep]);
  useEffect(()=>{camera.current.target=[0,0,0];camera.current.targetZoom=1;camera.current.yaw=.12;camera.current.pitch=-.18;},[props.reset]);
  useEffect(()=>{
    // Profile pictures scraped from X; a missing or blocked image falls back to initials.
    images.current=new Map();
    const load=(id:number,src:string)=>{if(!src)return;const img=new Image();img.referrerPolicy='no-referrer';img.src=src;img.onload=()=>images.current.set(id,img);};
    network.nodes.forEach(n=>load(n.id,n.avatar));load(network.sourceId,network.source.avatar);
  },[network]);
  useEffect(()=>{
    const el=canvas.current;if(!el)return;const ctx=el.getContext('2d');if(!ctx)return;
    let width=1,height=1,frame=0,previous=0;
    const resize=new ResizeObserver(([entry])=>{width=entry.contentRect.width;height=entry.contentRect.height;const dpr=Math.min(devicePixelRatio,2);el.width=width*dpr;el.height=height*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);});resize.observe(el);
    const render=(now:number)=>{
      const c=camera.current,p=latest.current,n=p.network;
      const dt=previous?Math.min((now-previous)/1000,.05):.016;previous=now;
      const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
      const ease=reduced?1:1-Math.exp(-dt*7);
      c.center=c.center.map((v,i)=>v+(c.target[i]-v)*ease);c.zoom+=(c.targetZoom-c.zoom)*ease;
      ctx.clearRect(0,0,width,height);
      const scale=Math.min(width/(n.extent*2+120),height/(n.extent*1.5+120))*c.zoom;
      const projectPoint=(point:Vec3)=>{
        const [x,y,z]=point.map((v,i)=>v-c.center[i]);
        const rx=x*Math.cos(c.yaw)+z*Math.sin(c.yaw),rz=-x*Math.sin(c.yaw)+z*Math.cos(c.yaw);
        const ry=y*Math.cos(c.pitch)-rz*Math.sin(c.pitch),depth=y*Math.sin(c.pitch)+rz*Math.cos(c.pitch);
        const perspective=1000/(1000+depth);
        return {x:width/2+rx*scale*perspective,y:height/2+ry*scale*perspective,perspective,depth};
      };
      const project=(id:number)=>{
        const source=id===n.sourceId,pt=projectPoint(source?[0,0,0]:n.nodes[id].position);
        return {id,x:pt.x,y:pt.y,depth:pt.depth,r:(source?n.nodeRadius*1.6:n.nodeRadius)*scale*pt.perspective,active:(n.arrivalById.get(id)?.at??Infinity)<=p.elapsed};
      };
      const points=[...n.nodes.map(node=>project(node.id)),project(n.sourceId)];
      const byId=new Map(points.map(point=>[point.id,point]));
      n.communities.forEach(community=>{
        const center=projectPoint(community.center),r=(40+Math.sqrt(community.size)*22)*scale;
        const gradient=ctx.createRadialGradient(center.x,center.y,0,center.x,center.y,r);
        gradient.addColorStop(0,community.color+'14');gradient.addColorStop(1,community.color+'00');ctx.fillStyle=gradient;ctx.fillRect(center.x-r,center.y-r,r*2,r*2);
      });
      for(const edge of n.edges){
        const a=byId.get(edge.a)!,b=byId.get(edge.b)!;const active=a.active&&b.active;
        const fromSource=edge.a===n.sourceId||edge.b===n.sourceId;
        if(fromSource){
          // The brand reaches everyone; only draw the links the post actually travelled along.
          const target=edge.a===n.sourceId?edge.b:edge.a;
          if(!active||n.arrivalById.get(target)?.from!==n.sourceId)continue;
          ctx.strokeStyle='#e6bc8826';
        }else ctx.strokeStyle=edge.bridge?(active?'#e6bc8899':'#e6bc8830'):(p.theme==='dark'?(active?'#9caec34a':'#9caec315'):(active?'#4b658b50':'#4b658b18'));
        ctx.lineWidth=(edge.bridge?1.3:.6)*Math.max(.8,scale);ctx.setLineDash(edge.bridge?[3,7]:[]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);
      }
      for(const arrival of n.arrivals){
        if(arrival.from===null)continue;
        const from=byId.get(arrival.from)!,to=byId.get(arrival.id)!;
        const start=n.arrivalById.get(arrival.from)!.at,f=(p.elapsed-start)/(arrival.at-start);
        if(f>=0&&f<1&&!reduced){ctx.beginPath();ctx.arc(from.x+(to.x-from.x)*f,from.y+(to.y-from.y)*f,2.4*scale,0,Math.PI*2);ctx.fillStyle='#e6bc88';ctx.shadowColor='#e6bc88';ctx.shadowBlur=12;ctx.fill();ctx.shadowBlur=0;}
      }
      for(const node of points.sort((a,b)=>b.depth-a.depth)){
        const source=node.id===n.sourceId,color=source?'#e6bc88':n.communities[n.nodes[node.id].community].color;
        ctx.globalAlpha=node.active?1:.24;
        ctx.shadowColor='#000000';ctx.shadowBlur=10*scale;ctx.shadowOffsetY=3*scale;
        const sphere=ctx.createRadialGradient(node.x-node.r*.4,node.y-node.r*.5,0,node.x,node.y,node.r*1.15);
        sphere.addColorStop(0,p.theme==='dark'?'#35475e':'#ffffff');sphere.addColorStop(.6,p.theme==='dark'?'#142439':'#dbe2e9');sphere.addColorStop(1,p.theme==='dark'?'#050e1b':'#a7b6c7');
        ctx.fillStyle=sphere;ctx.beginPath();ctx.arc(node.x,node.y,node.r,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.shadowOffsetY=0;
        const img=images.current.get(node.id);
        if(img){ctx.save();ctx.beginPath();ctx.arc(node.x,node.y,node.r*.9,0,Math.PI*2);ctx.clip();ctx.drawImage(img,node.x-node.r,node.y-node.r,node.r*2,node.r*2);const shade=ctx.createLinearGradient(node.x-node.r,node.y-node.r,node.x+node.r,node.y+node.r);shade.addColorStop(0,'#ffffff20');shade.addColorStop(.5,'#00000000');shade.addColorStop(1,'#00000065');ctx.fillStyle=shade;ctx.fillRect(node.x-node.r,node.y-node.r,node.r*2,node.r*2);ctx.restore();}
        else{ctx.fillStyle=color;ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`500 ${node.r*.7}px "DM Sans"`;ctx.fillText(source?'✳':n.nodes[node.id].initials,node.x,node.y);}
        ctx.strokeStyle=color;ctx.globalAlpha=node.active? .85:.12;ctx.lineWidth=node.id===p.selected?2.5:1;ctx.beginPath();ctx.arc(node.x,node.y,node.r+3*scale,0,Math.PI*2);ctx.stroke();ctx.globalAlpha=1;
        if(source){ctx.strokeStyle=color+'30';ctx.beginPath();ctx.arc(node.x,node.y,node.r+11*scale,0,Math.PI*2);ctx.stroke();ctx.fillStyle=p.theme==='dark'?'#e6bc88':'#805322';ctx.font=`${Math.max(8,9*scale)}px "Space Mono"`;ctx.textAlign='center';ctx.textBaseline='alphabetic';ctx.fillText(`@${n.source.handle.toUpperCase()} POST`,node.x,node.y+node.r+26*scale);}
        if(node.id===p.selected){ctx.fillStyle=p.theme==='dark'?'#f3f1ed':'#1d2d40';ctx.font=`${Math.max(10,11*scale)}px "DM Sans"`;ctx.textAlign='center';ctx.textBaseline='alphabetic';ctx.fillText(`@${n.nodes[node.id].handle}`,node.x,node.y+node.r+18*scale);}
      }
      n.communities.forEach((community,index)=>{
        const cluster=points.filter(node=>node.id!==n.sourceId&&n.nodes[node.id].community===index);
        if(!cluster.length)return;
        const left=Math.min(...cluster.map(node=>node.x-node.r)),right=Math.max(...cluster.map(node=>node.x+node.r));
        const bottom=Math.max(...cluster.map(node=>node.y+node.r));
        ctx.font=`500 ${Math.max(9,Math.min(13,11*scale))}px "DM Sans"`;
        ctx.textAlign='center';ctx.textBaseline='top';
        ctx.fillStyle=p.theme==='dark'?community.color:'#43566e';
        ctx.fillText(community.name,(left+right)/2,bottom+10);
      });
      hits.current=points.filter(q=>q.id!==n.sourceId).map(({id,x,y,r})=>({id,x,y,r}));
      el.dataset.cameraX=c.center[0].toFixed(1);el.dataset.cameraY=c.center[1].toFixed(1);
      frame=requestAnimationFrame(render);
    };frame=requestAnimationFrame(render);
    return()=>{cancelAnimationFrame(frame);resize.disconnect();};
  },[]);
  const reached=network.arrivals.filter(a=>a.id!==network.sourceId&&a.at<=props.elapsed).length;
  return <canvas ref={canvas} role="img" aria-label="Three-dimensional audience network. Drag to orbit, scroll to zoom, or choose a niche to fly to it." tabIndex={0}
    data-node-count={network.nodes.length} data-active-count={reached} data-focus-community={props.focus??'all'} data-complete={props.elapsed>=network.duration}
    onPointerDown={e=>{drag.current={x:e.clientX,y:e.clientY,moved:false};e.currentTarget.setPointerCapture(e.pointerId);}}
    onPointerMove={e=>{const d=drag.current;if(!d)return;const dx=e.clientX-d.x,dy=e.clientY-d.y;if(Math.abs(dx)+Math.abs(dy)>2)d.moved=true;camera.current.yaw+=dx*.005;camera.current.pitch=Math.max(-.9,Math.min(.9,camera.current.pitch+dy*.004));d.x=e.clientX;d.y=e.clientY;}}
    onPointerUp={e=>{if(drag.current&&!drag.current.moved){const rect=e.currentTarget.getBoundingClientRect();const found=hits.current.slice().reverse().find(h=>Math.hypot(h.x-(e.clientX-rect.left),h.y-(e.clientY-rect.top))<h.r+4);if(found)latest.current.onSelect(found.id);}drag.current=null;}}
    onPointerCancel={()=>{drag.current=null;}}
    onWheel={e=>{camera.current.targetZoom=Math.max(.55,Math.min(4,camera.current.targetZoom-e.deltaY*.001));}}
    onKeyDown={e=>{if(['+','-','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();if(e.key==='+')camera.current.targetZoom=Math.min(4,camera.current.targetZoom+.15);if(e.key==='-')camera.current.targetZoom=Math.max(.55,camera.current.targetZoom-.15);if(e.key==='ArrowLeft')camera.current.yaw-=.12;if(e.key==='ArrowRight')camera.current.yaw+=.12;if(e.key==='ArrowUp')camera.current.pitch-=.08;if(e.key==='ArrowDown')camera.current.pitch+=.08;}}}/>;
}
