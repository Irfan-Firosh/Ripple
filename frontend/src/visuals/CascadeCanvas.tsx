import { useEffect, useRef } from 'react';
import type { SimRunState } from '../audience/liveSimulation';
import type { CascadeNetwork, Vec3 } from './liveNetwork';
import { createNodeSprite, loadPortraits } from './nodeSprites';

type Props={network:CascadeNetwork;elapsed:number;theme:'dark'|'light';selected:number|null;focus:number|null;zoomStep:number;reset:number;onSelect:(id:number)=>void;onPrepared:(ready:boolean)=>void;replay?:{run:SimRunState;tick:number}|null};
export function CascadeCanvas(props:Props) {
  const canvas=useRef<HTMLCanvasElement>(null);
  const latest=useRef(props);latest.current=props;
  const lastZoomStep=useRef(props.zoomStep);
  const images=useRef(new Map<number,HTMLCanvasElement>());
  const sprites=useRef(new Map<number,HTMLCanvasElement>());
  const glows=useRef<HTMLCanvasElement[]>([]);
  const revision=useRef(0);
  const hits=useRef<{id:number;x:number;y:number;r:number}[]>([]);
  const camera=useRef({yaw:.45,pitch:-.3,zoom:1,targetZoom:1,center:[0,0,0] as number[],target:[0,0,0] as number[]});
  const drag=useRef<{x:number;y:number;moved:boolean}|null>(null);
  const {network}=props;
  useEffect(()=>{
    const el=canvas.current;if(!el)return;
    const zoom=(event:WheelEvent)=>{
      event.preventDefault();
      const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?el.clientHeight:1);
      camera.current.targetZoom=Math.max(.55,Math.min(4,camera.current.targetZoom-delta*.001));
    };
    el.addEventListener('wheel',zoom,{passive:false});
    return()=>el.removeEventListener('wheel',zoom);
  },[]);
  useEffect(()=>{camera.current.target=props.focus===null?[0,0,0]:[...network.communities[props.focus].center];camera.current.targetZoom=props.focus===null?1:2.2;},[props.focus,network]);
  useEffect(()=>{camera.current.targetZoom=Math.max(.55,Math.min(4,camera.current.targetZoom+(props.zoomStep-lastZoomStep.current)*.15));lastZoomStep.current=props.zoomStep;},[props.zoomStep]);
  useEffect(()=>{camera.current.target=[0,0,0];camera.current.targetZoom=1;camera.current.yaw=.45;camera.current.pitch=-.3;},[props.reset]);
  useEffect(()=>{
    images.current=new Map();const controller=new AbortController();
    void loadPortraits(network,controller.signal,(id,image)=>{
      // Keep a small decoded portrait for theme changes rather than the full source image.
      const thumbnail=document.createElement('canvas');thumbnail.width=96;thumbnail.height=96;
      thumbnail.getContext('2d')!.drawImage(image,0,0,96,96);images.current.set(id,thumbnail);
      sprites.current.set(id,createNodeSprite(network,id,latest.current.theme,thumbnail));revision.current++;
    });
    return()=>controller.abort();
  },[network]);
  useEffect(()=>{
    let cancelled=false;props.onPrepared(false);sprites.current=new Map();revision.current++;
    glows.current=network.communities.map(community=>{
      const tile=document.createElement('canvas');tile.width=128;tile.height=128;
      const ctx=tile.getContext('2d')!,gradient=ctx.createRadialGradient(64,64,0,64,64,64);
      gradient.addColorStop(0,community.color+'18');gradient.addColorStop(1,community.color+'00');
      ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);return tile;
    });
    const prepare=async()=>{
      for(let id=0;id<=network.sourceId;id++){
        if(cancelled)return;
        sprites.current.set(id,createNodeSprite(network,id,props.theme,images.current.get(id)));
        // Yield between batches so the preparation loader remains responsive.
        if(id%32===31)await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      }
      if(!cancelled){revision.current++;props.onPrepared(true);}
    };
    void prepare();return()=>{cancelled=true;};
  },[network,props.theme,props.onPrepared]);
  useEffect(()=>{
    const el=canvas.current;if(!el)return;const ctx=el.getContext('2d');if(!ctx)return;
    let width=1,height=1,frame=0,previous=0,lastSignature='',drawCount=0,angleKey='';
    let order:number[]=[];
    const motion=matchMedia('(prefers-reduced-motion: reduce)');
    const resize=new ResizeObserver(([entry])=>{width=entry.contentRect.width;height=entry.contentRect.height;const dpr=Math.min(devicePixelRatio,2);el.width=width*dpr;el.height=height*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);});resize.observe(el);
    const render=(now:number)=>{
      const c=camera.current,p=latest.current,n=p.network;
      const dt=previous?Math.min((now-previous)/1000,.05):.016;previous=now;
      const reduced=motion.matches;
      const ease=reduced?1:1-Math.exp(-dt*7);
      c.center=c.center.map((v,i)=>v+(c.target[i]-v)*ease);c.zoom+=(c.targetZoom-c.zoom)*ease;
      c.center=c.center.map((v,i)=>Math.abs(v-c.target[i])<.001?c.target[i]:v);
      if(Math.abs(c.zoom-c.targetZoom)<.0001)c.zoom=c.targetZoom;
      const signature=[width,height,c.yaw,c.pitch,c.zoom,...c.center,p.elapsed,p.selected,p.theme,revision.current,p.replay?.run.runId,p.replay?.tick].join('|');
      if(document.hidden||signature===lastSignature){frame=requestAnimationFrame(render);return;}
      lastSignature=signature;drawCount++;el.dataset.drawCount=String(drawCount);
      ctx.clearRect(0,0,width,height);
      const scale=Math.min(width/(n.extent*2+120),height/(n.extent*2+120))*c.zoom;
      const cosYaw=Math.cos(c.yaw),sinYaw=Math.sin(c.yaw),cosPitch=Math.cos(c.pitch),sinPitch=Math.sin(c.pitch);
      const projectPoint=(point:Vec3)=>{
        const [x,y,z]=point.map((v,i)=>v-c.center[i]);
        const rx=x*cosYaw+z*sinYaw,rz=-x*sinYaw+z*cosYaw;
        const ry=y*cosPitch-rz*sinPitch,depth=y*sinPitch+rz*cosPitch;
        const focalLength=Math.max(800,n.extent*2.6);
        const perspective=focalLength/Math.max(focalLength*.25,focalLength+depth);
        return {x:width/2+rx*scale*perspective,y:height/2+ry*scale*perspective,perspective,depth};
      };
      // Replay mode: a simulated run (trial 0 of the cascade) decides who saw and who engaged, tick by tick.
      const replay=p.replay;
      const simState=(id:number)=>replay?.run.nodes.get(n.nodes[id].member.userId);
      const project=(id:number)=>{
        const source=id===n.sourceId,pt=projectPoint(source?[0,0,0]:n.nodes[id].position);
        const sim=!source&&replay?simState(id):undefined;
        const active=replay?source||(sim?.seenTick!=null&&sim.seenTick<=replay.tick):(n.arrivalById.get(id)?.at??Infinity)<=p.elapsed;
        const engaged=!!replay&&!source&&sim?.engagedTick!=null&&sim.engagedTick<=replay.tick;
        return {id,x:pt.x,y:pt.y,depth:pt.depth,r:(source?n.nodeRadius*1.6:n.nodeRadius)*scale*pt.perspective,active,engaged};
      };
      const points=[...n.nodes.map(node=>project(node.id)),project(n.sourceId)];
      const byId=points;
      n.communities.forEach((community,index)=>{
        const center=projectPoint(community.center),r=(community.radius+16)*scale*center.perspective;
        const glow=glows.current[index];if(glow)ctx.drawImage(glow,center.x-r,center.y-r,r*2,r*2);
      });
      const edgePaths=new Map<string,{path:Path2D;bridge:boolean}>();
      for(const edge of n.edges){
        const a=byId[edge.a],b=byId[edge.b];const active=a.active&&b.active;
        const fromSource=edge.a===n.sourceId||edge.b===n.sourceId;
        if(fromSource){
          // The brand reaches everyone; only draw the links the post actually travelled along.
          const target=edge.a===n.sourceId?edge.b:edge.a;
          if(!active||(replay?simState(target)?.seenTick!==0:n.arrivalById.get(target)?.from!==n.sourceId))continue;
        }
        const color=fromSource?'#e6bc8826':edge.bridge?(active?'#e6bc8899':'#e6bc8830'):(p.theme==='dark'?(active?'#9caec34a':'#9caec315'):(active?'#4b658b50':'#4b658b18'));
        let group=edgePaths.get(color);if(!group){group={path:new Path2D(),bridge:edge.bridge};edgePaths.set(color,group);}
        group.path.moveTo(a.x,a.y);group.path.lineTo(b.x,b.y);
      }
      edgePaths.forEach(({path,bridge},color)=>{ctx.strokeStyle=color;ctx.lineWidth=(bridge?1.3:.6)*Math.max(.8,scale);ctx.setLineDash(bridge?[3,7]:[]);ctx.stroke(path);});ctx.setLineDash([]);
      for(const arrival of n.arrivals){
        if(arrival.from===null)continue;
        const from=byId[arrival.from],to=byId[arrival.id];
        const start=n.arrivalById.get(arrival.from)!.at,f=(p.elapsed-start)/(arrival.at-start);
        if(f>=0&&f<1&&!reduced&&!replay){ctx.beginPath();ctx.arc(from.x+(to.x-from.x)*f,from.y+(to.y-from.y)*f,2.4*scale,0,Math.PI*2);ctx.fillStyle='#e6bc88';ctx.shadowColor='#e6bc88';ctx.shadowBlur=12;ctx.fill();ctx.shadowBlur=0;}
      }
      // Depth order changes with orbit, but not with zoom or camera translation.
      const angles=`${c.yaw}|${c.pitch}|${n.nodes.length}`;
      if(angleKey!==angles){order=points.map(point=>point.id).sort((a,b)=>points[b].depth-points[a].depth);angleKey=angles;}
      const bounds=n.communities.map(()=>({left:Infinity,right:-Infinity,bottom:-Infinity}));
      for(const id of order){
        const node=points[id];
        const source=node.id===n.sourceId,color=source?'#e6bc88':n.communities[n.nodes[node.id].community].color;
        ctx.globalAlpha=replay&&!source?(node.engaged?1:node.active?.45:.12):node.active?1:.24;
        if(!source){const b=bounds[n.nodes[id].community];b.left=Math.min(b.left,node.x-node.r);b.right=Math.max(b.right,node.x+node.r);b.bottom=Math.max(b.bottom,node.y+node.r);}
        const sprite=sprites.current.get(id),size=node.r*128/48;
        if(sprite&&node.x+size>0&&node.x-size<width&&node.y+size>0&&node.y-size<height)ctx.drawImage(sprite,node.x-size/2,node.y-size/2,size,size);
        ctx.globalAlpha=1;
        if(node.engaged){ctx.strokeStyle='#e6bc88';ctx.lineWidth=2;ctx.beginPath();ctx.arc(node.x,node.y,node.r+1.5*scale,0,Math.PI*2);ctx.stroke();}
        if(node.id===p.selected){ctx.strokeStyle=color;ctx.lineWidth=2.5;ctx.beginPath();ctx.arc(node.x,node.y,node.r+3*scale,0,Math.PI*2);ctx.stroke();}
        if(source){ctx.strokeStyle=color+'30';ctx.beginPath();ctx.arc(node.x,node.y,node.r+11*scale,0,Math.PI*2);ctx.stroke();ctx.fillStyle=p.theme==='dark'?'#e6bc88':'#805322';ctx.font=`${Math.max(8,9*scale)}px "Space Mono"`;ctx.textAlign='center';ctx.textBaseline='alphabetic';ctx.fillText(`@${n.source.handle.toUpperCase()} POST`,node.x,node.y+node.r+26*scale);}
        if(node.id===p.selected){ctx.fillStyle=p.theme==='dark'?'#f3f1ed':'#1d2d40';ctx.font=`${Math.max(10,11*scale)}px "DM Sans"`;ctx.textAlign='center';ctx.textBaseline='alphabetic';ctx.fillText(`@${n.nodes[node.id].handle}`,node.x,node.y+node.r+18*scale);}
      }
      n.communities.forEach((community,index)=>{
        const {left,right,bottom}=bounds[index];if(!Number.isFinite(left))return;
        ctx.font=`500 ${Math.max(9,Math.min(13,11*scale))}px "DM Sans"`;
        ctx.textAlign='center';ctx.textBaseline='top';
        ctx.fillStyle=p.theme==='dark'?community.color:'#43566e';
        ctx.fillText(community.name,(left+right)/2,bottom+10);
      });
      hits.current=order.filter(id=>id!==n.sourceId).map(id=>points[id]);
      el.dataset.cameraX=c.center[0].toFixed(1);el.dataset.cameraY=c.center[1].toFixed(1);el.dataset.cameraZoom=c.zoom.toFixed(2);el.dataset.spriteCount=String(sprites.current.size);
      frame=requestAnimationFrame(render);
    };frame=requestAnimationFrame(render);
    return()=>{cancelAnimationFrame(frame);resize.disconnect();};
  },[]);
  const reached=network.arrivals.filter(a=>a.id!==network.sourceId&&a.at<=props.elapsed).length;
  const engagedCount=props.replay?network.nodes.filter(node=>{const sim=props.replay!.run.nodes.get(node.member.userId);return sim?.engagedTick!=null&&sim.engagedTick<=props.replay!.tick;}).length:undefined;
  return <canvas ref={canvas} role="img" aria-label="Three-dimensional audience network. Drag to orbit, scroll to zoom, or choose a niche to fly to it." tabIndex={0}
    data-node-count={network.nodes.length} data-active-count={reached} data-focus-community={props.focus??'all'} data-complete={props.elapsed>=network.duration} data-run={props.replay?.run.runId} data-engaged-count={engagedCount}
    onPointerDown={e=>{drag.current={x:e.clientX,y:e.clientY,moved:false};e.currentTarget.setPointerCapture(e.pointerId);}}
    onPointerMove={e=>{const d=drag.current;if(!d)return;const dx=e.clientX-d.x,dy=e.clientY-d.y;if(Math.abs(dx)+Math.abs(dy)>2)d.moved=true;camera.current.yaw+=dx*.005;camera.current.pitch=Math.max(-.9,Math.min(.9,camera.current.pitch+dy*.004));d.x=e.clientX;d.y=e.clientY;}}
    onPointerUp={e=>{if(drag.current&&!drag.current.moved){const rect=e.currentTarget.getBoundingClientRect();const found=hits.current.slice().reverse().find(h=>Math.hypot(h.x-(e.clientX-rect.left),h.y-(e.clientY-rect.top))<h.r+4);if(found)latest.current.onSelect(found.id);}drag.current=null;}}
    onPointerCancel={()=>{drag.current=null;}}
    onKeyDown={e=>{if(['+','-','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();if(e.key==='+')camera.current.targetZoom=Math.min(4,camera.current.targetZoom+.15);if(e.key==='-')camera.current.targetZoom=Math.max(.55,camera.current.targetZoom-.15);if(e.key==='ArrowLeft')camera.current.yaw-=.12;if(e.key==='ArrowRight')camera.current.yaw+=.12;if(e.key==='ArrowUp')camera.current.pitch-=.08;if(e.key==='ArrowDown')camera.current.pitch+=.08;}}}/>;
}
