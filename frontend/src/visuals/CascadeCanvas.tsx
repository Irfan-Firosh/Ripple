import { useEffect, useMemo, useRef } from 'react';
import type { SimRunState } from '../audience/liveSimulation';
import type { CascadeNetwork, Vec3 } from './liveNetwork';
import { createNodeSprite, createClusterBadge, loadPortraits } from './nodeSprites';
import { buildPlanarLayout } from './networkLayout2D';
import { buildClusterEdges } from './clusterEdges';
import { percentShares } from './communityShares';
const GOLDEN_ANGLE=2.399963;

type Props={audienceOnly?:boolean;network:CascadeNetwork;view:'2d'|'3d';elapsed:number;theme:'dark'|'light';selected:number|null;focus:number|null;zoomStep:number;reset:number;onSelect:(id:number)=>void;onPrepared:(ready:boolean)=>void;replay?:{run:SimRunState;tick:number}|null};
export function CascadeCanvas(props:Props) {
  const canvas=useRef<HTMLCanvasElement>(null);
  const latest=useRef(props);latest.current=props;
  const lastZoomStep=useRef(props.zoomStep);
  const images=useRef(new Map<number,HTMLCanvasElement>());
  const sprites=useRef(new Map<number,HTMLCanvasElement>());
  const glows=useRef<HTMLCanvasElement[]>([]);
  const badges=useRef<ReturnType<typeof createClusterBadge>[]>([]);
  const revision=useRef(0);
  const hits=useRef<{id:number;x:number;y:number;r:number}[]>([]);
  const camera=useRef({yaw:.45,pitch:-.3,zoom:1,targetZoom:1,center:[0,0,0] as number[],target:[0,0,0] as number[]});
  const drag=useRef<{x:number;y:number;moved:boolean}|null>(null);
  const interaction=useRef({hovered:false,resumeAt:0});
  const {network}=props;
  const planar=useMemo(()=>network.planarLayout??buildPlanarLayout(network),[network]);
  const latestPlanar=useRef(planar);latestPlanar.current=planar;
  // Show one weighted connection per cluster pair; audience maps omit the company source.
  const clusterEdges=useMemo(()=>buildClusterEdges(network).filter(edge=>!props.audienceOnly||edge.kind==='bridge'),[network,props.audienceOnly]);
  const latestEdges=useRef(clusterEdges);latestEdges.current=clusterEdges;
  const firstArrivals=useMemo(()=>network.communities.map((_,index)=>Math.min(...network.nodes.filter(node=>node.community===index).map(node=>network.arrivalById.get(node.id)?.at??Infinity))),[network]);
  const latestArrivals=useRef(firstArrivals);latestArrivals.current=firstArrivals;
  const currentScale=useRef(1);
  useEffect(()=>{
    const el=canvas.current;if(!el)return;
    const zoom=(event:WheelEvent)=>{
      event.preventDefault();interaction.current.resumeAt=performance.now()+2500;
      const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?el.clientHeight:1);
      camera.current.targetZoom=Math.max(.55,Math.min(4,camera.current.targetZoom-delta*.001));
    };
    el.addEventListener('wheel',zoom,{passive:false});
    return()=>el.removeEventListener('wheel',zoom);
  },[]);
  useEffect(()=>{camera.current.target=props.focus===null?[0,0,0]:[...(props.view==='2d'?planar.centers[props.focus]:network.communities[props.focus].center)];camera.current.targetZoom=props.focus===null?1:2.2;},[props.focus,props.view,network,planar]);
  useEffect(()=>{camera.current.targetZoom=Math.max(.55,Math.min(4,camera.current.targetZoom+(props.zoomStep-lastZoomStep.current)*.15));lastZoomStep.current=props.zoomStep;},[props.zoomStep]);
  useEffect(()=>{camera.current.target=[0,0,0];camera.current.targetZoom=1;camera.current.yaw=.45;camera.current.pitch=-.3;interaction.current.resumeAt=performance.now()+1500;},[props.reset]);
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
    const shares=percentShares(network.communities.map(community=>community.size));
    badges.current=network.communities.map((community,index)=>createClusterBadge(community.name,shares[index],community.color,props.theme));
    glows.current=network.communities.map(community=>{
      const tile=document.createElement('canvas');tile.width=128;tile.height=128;
      const ctx=tile.getContext('2d')!,gradient=ctx.createRadialGradient(64,64,0,64,64,64);
      gradient.addColorStop(0,community.color+'18');gradient.addColorStop(1,community.color+'00');
      ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);return tile;
    });
    const prepare=async()=>{
      for(let id=0;id<network.nodes.length+(props.audienceOnly?0:1);id++){
        if(cancelled)return;
        sprites.current.set(id,createNodeSprite(network,id,props.theme,images.current.get(id)));
        // Yield between batches so the preparation loader remains responsive.
        if(id%32===31)await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      }
      if(!cancelled){revision.current++;props.onPrepared(true);}
    };
    void prepare();return()=>{cancelled=true;};
  },[network,props.theme,props.onPrepared,props.audienceOnly]);
  useEffect(()=>{
    const el=canvas.current;if(!el)return;const ctx=el.getContext('2d');if(!ctx)return;
    let width=1,height=1,frame=0,previous=0,lastDraw=0,lastSignature='',drawCount=0,angleKey='';
    let order:number[]=[];
    const motion=matchMedia('(prefers-reduced-motion: reduce)');
    const resize=new ResizeObserver(([entry])=>{width=entry.contentRect.width;height=entry.contentRect.height;const dpr=Math.min(devicePixelRatio,2);el.width=width*dpr;el.height=height*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);});resize.observe(el);
    const render=(now:number)=>{
      const c=camera.current,p=latest.current,n=p.network,flat=p.view==='2d',layout=latestPlanar.current;
      const dt=previous?Math.min((now-previous)/1000,.05):.016;previous=now;
      const reduced=motion.matches;
      // Only the overview drifts. Keep inspection, zoomed views and 2D stationary.
      const idle=!reduced&&!flat&&!document.hidden&&p.focus===null&&p.selected===null&&!drag.current&&!interaction.current.hovered&&now>=interaction.current.resumeAt&&c.targetZoom<=1.02&&sprites.current.size===n.nodes.length+(p.audienceOnly?0:1);
      el.dataset.idleOrbit=String(idle);
      if(idle)c.yaw=(c.yaw+dt*.026)%(Math.PI*2);
      const ease=reduced?1:1-Math.exp(-dt*7);
      c.center=c.center.map((v,i)=>v+(c.target[i]-v)*ease);c.zoom+=(c.targetZoom-c.zoom)*ease;
      c.center=c.center.map((v,i)=>Math.abs(v-c.target[i])<.001?c.target[i]:v);
      if(Math.abs(c.zoom-c.targetZoom)<.0001)c.zoom=c.targetZoom;
      const signature=[width,height,c.yaw,c.pitch,c.zoom,...c.center,p.elapsed,p.selected,p.theme,p.view,revision.current,p.replay?.run.runId,p.replay?.tick].join('|');
      const settled=Math.abs(c.zoom-c.targetZoom)<.001&&c.center.every((v,i)=>Math.abs(v-c.target[i])<.01);
      if(document.hidden||signature===lastSignature||(idle&&settled&&lastSignature&&now-lastDraw<1000/30)){frame=requestAnimationFrame(render);return;}
      lastSignature=signature;lastDraw=now;drawCount++;el.dataset.drawCount=String(drawCount);
      ctx.clearRect(0,0,width,height);
      const extent=flat?layout.extent:n.extent;
      const scale=Math.min(width/((flat?layout.halfWidth:extent)*2+120),height/((flat?layout.halfHeight:extent)*2+120))*c.zoom;currentScale.current=scale;
      const cosYaw=Math.cos(c.yaw),sinYaw=Math.sin(c.yaw),cosPitch=Math.cos(c.pitch),sinPitch=Math.sin(c.pitch);
      const projectPoint=(point:Vec3)=>{
        const [x,y,z]=point.map((v,i)=>v-c.center[i]);
        if(flat)return {x:width/2+x*scale,y:height/2+y*scale,perspective:1,depth:0};
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
        const source=id===n.sourceId,pt=projectPoint(source?[0,0,0]:flat?layout.positions[id]:n.nodes[id].position);
        const sim=!source&&replay?simState(id):undefined;
        const active=p.audienceOnly?true:replay?source||(sim?.seenTick!=null&&sim.seenTick<=replay.tick):(n.arrivalById.get(id)?.at??Infinity)<=p.elapsed;
        const engaged=!!replay&&!source&&sim?.engagedTick!=null&&sim.engagedTick<=replay.tick;
        return {id,x:pt.x,y:pt.y,depth:pt.depth,r:(source?n.nodeRadius*1.6:n.nodeRadius)*scale*pt.perspective,active,engaged};
      };
      const points=n.nodes.map(node=>project(node.id));if(!p.audienceOnly)points.push(project(n.sourceId));
      const clusterPoints=n.communities.map((community,index)=>projectPoint(flat?layout.centers[index]:community.center));
      const activeClusters=n.communities.map(()=>false);
      points.forEach(point=>{if(point.id!==n.sourceId&&point.active)activeClusters[n.nodes[point.id].community]=true;});
      n.communities.forEach((community,index)=>{
        const center=projectPoint(flat?layout.centers[index]:community.center),r=((flat?layout.radii[index]:community.radius)+16)*scale*center.perspective;
        const glow=glows.current[index];if(glow)ctx.drawImage(glow,center.x-r,center.y-r,r*2,r*2);
      });
      ctx.lineCap='round';
      for(const edge of latestEdges.current){
        const post=edge.kind==='post',a=post?points[n.sourceId]:clusterPoints[edge.a],b=clusterPoints[edge.b];
        const active=activeClusters[edge.b]&&(post||activeClusters[edge.a]);
        ctx.globalAlpha=post?(active?.42:.15):(active?.35+edge.strength*.6:.15+edge.strength*.2);
        ctx.lineWidth=(post?1:1.1+edge.strength*3.5)*Math.max(.85,Math.min(1.4,scale));
        if(post)ctx.strokeStyle=p.theme==='dark'?'#e6bc88':'#9b642a';
        else{
          const gradient=ctx.createLinearGradient(a.x,a.y,b.x,b.y);
          gradient.addColorStop(0,n.communities[edge.a].color);gradient.addColorStop(1,n.communities[edge.b].color);ctx.strokeStyle=gradient;
        }
        ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.globalAlpha=1;
        if(post&&!reduced&&!replay){
          const at=latestArrivals.current[edge.b],f=p.elapsed/at;
          if(Number.isFinite(at)&&f>=0&&f<1){ctx.beginPath();ctx.arc(a.x+(b.x-a.x)*f,a.y+(b.y-a.y)*f,2.4,0,Math.PI*2);ctx.fillStyle='#e6bc88';ctx.fill();}
        }
      }
      // Depth order changes with orbit, but not with zoom or camera translation.
      const angles=`${p.view}|${c.yaw}|${c.pitch}|${n.nodes.length}`;
      if(angleKey!==angles){order=points.map(point=>point.id).sort((a,b)=>points[b].depth-points[a].depth);angleKey=angles;}
      const bounds=n.communities.map(()=>({left:Infinity,right:-Infinity,bottom:-Infinity}));
      for(const id of order){
        const node=points[id];
        const source=node.id===n.sourceId,color=source?'#e6bc88':n.communities[n.nodes[node.id].community].color;
        ctx.globalAlpha=p.audienceOnly?1:replay&&!source?(node.engaged?1:node.active?.45:.12):node.active?1:.24;
        if(!source){const b=bounds[n.nodes[id].community];b.left=Math.min(b.left,node.x-node.r);b.right=Math.max(b.right,node.x+node.r);b.bottom=Math.max(b.bottom,node.y+node.r);}
        const sprite=sprites.current.get(id),size=node.r*128/48;
        if(sprite&&node.x+size>0&&node.x-size<width&&node.y+size>0&&node.y-size<height)ctx.drawImage(sprite,node.x-size/2,node.y-size/2,size,size);
        ctx.globalAlpha=1;
        if(node.engaged){ctx.strokeStyle='#e6bc88';ctx.lineWidth=2;ctx.beginPath();ctx.arc(node.x,node.y,node.r+1.5*scale,0,Math.PI*2);ctx.stroke();}
        if(node.id===p.selected){ctx.strokeStyle=color;ctx.lineWidth=2.5;ctx.beginPath();ctx.arc(node.x,node.y,node.r+3*scale,0,Math.PI*2);ctx.stroke();}
        if(source){ctx.strokeStyle=color+'30';ctx.beginPath();ctx.arc(node.x,node.y,node.r+11*scale,0,Math.PI*2);ctx.stroke();ctx.fillStyle=p.theme==='dark'?'#e6bc88':'#805322';ctx.font=`${Math.max(8,9*scale)}px "Space Mono"`;ctx.textAlign='center';ctx.textBaseline='alphabetic';ctx.fillText(`@${n.source.handle.toUpperCase()} POST`,node.x,node.y+node.r+26*scale);}
        if(node.id===p.selected){ctx.fillStyle=p.theme==='dark'?'#f3f1ed':'#1d2d40';ctx.font=`${Math.max(10,11*scale)}px "DM Sans"`;ctx.textAlign='center';ctx.textBaseline='alphabetic';ctx.fillText(`@${n.nodes[node.id].handle}`,node.x,node.y+node.r+18*scale);}
      }
      const labels:{x:number;y:number;width:number;height:number}[]=[];
      n.communities.forEach((community,index)=>{
        const {left,right,bottom}=bounds[index];if(!Number.isFinite(left))return;
        if(right<0||left>width||bottom<0||bottom>height+100)return;
        const badge=badges.current[index];if(!badge)return;
        const center=projectPoint(flat?layout.centers[index]:community.center),anchorX=center.x,anchorY=center.y;
        const labelScale=width<500?.8:1,bw=badge.width*labelScale,bh=badge.height*labelScale;
        let x=anchorX,y=anchorY;
        const free=(cx:number,cy:number)=>!labels.some(label=>Math.abs(label.y-cy)<(label.height+bh)/2+8&&Math.abs(label.x-cx)<(label.width+bw)/2+8)
          &&(p.audienceOnly||!(Math.abs(cx-width/2)<bw/2+45&&Math.abs(cy-height/2)<bh/2+45));
        for(let attempt=0;attempt<32;attempt++){
          const angle=attempt*GOLDEN_ANGLE,offset=attempt===0?0:30+Math.sqrt(attempt)*20;
          x=Math.max(bw/2+8,Math.min(width-bw/2-8,anchorX+Math.cos(angle)*offset));
          y=Math.max(bh/2+8,Math.min(height-bh/2-8,anchorY+Math.sin(angle)*offset));
          if(free(x,y))break;
        }
        if(Math.hypot(x-anchorX,y-anchorY)>40){ctx.strokeStyle=community.color+'55';ctx.lineWidth=.6;ctx.beginPath();ctx.moveTo(anchorX,anchorY);ctx.lineTo(x,y);ctx.stroke();}
        ctx.drawImage(badge.canvas,x-bw/2,y-bh/2,bw,bh);labels.push({x,y,width:bw,height:bh});
      });
      hits.current=order.filter(id=>id!==n.sourceId).map(id=>points[id]);
      el.dataset.cameraYaw=c.yaw.toFixed(4);el.dataset.cameraX=c.center[0].toFixed(1);el.dataset.cameraY=c.center[1].toFixed(1);el.dataset.cameraZoom=c.zoom.toFixed(2);el.dataset.spriteCount=String(sprites.current.size);
      frame=requestAnimationFrame(render);
    };frame=requestAnimationFrame(render);
    return()=>{cancelAnimationFrame(frame);resize.disconnect();};
  },[]);
  const reached=props.audienceOnly?network.nodes.length:network.arrivals.filter(a=>a.id!==network.sourceId&&a.at<=props.elapsed).length;
  const engagedCount=props.replay?network.nodes.filter(node=>{const sim=props.replay!.run.nodes.get(node.member.userId);return sim?.engagedTick!=null&&sim.engagedTick<=props.replay!.tick;}).length:undefined;
  return <canvas ref={canvas} role="img" aria-label={props.view==='2d'?'Two-dimensional audience network. Drag to pan, scroll to zoom, or choose an interest to focus it.':'Three-dimensional audience network. Drag to orbit, scroll to zoom, or choose an interest to fly to it.'} tabIndex={0} data-view={props.view}
    data-source-node-count={props.audienceOnly?0:1} data-node-count={network.nodes.length} data-active-count={reached} data-focus-community={props.focus??'all'} data-complete={props.elapsed>=network.duration} data-run={props.replay?.run.runId} data-engaged-count={engagedCount}
    data-post-edge-count={clusterEdges.filter(edge=>edge.kind==='post').length} data-bridge-edge-count={clusterEdges.filter(edge=>edge.kind==='bridge').length}
    onPointerEnter={()=>{interaction.current.hovered=true;}}
    onPointerLeave={()=>{interaction.current.hovered=false;interaction.current.resumeAt=performance.now()+2500;}}
    onFocus={()=>{interaction.current.resumeAt=performance.now()+2500;}}
    onPointerDown={e=>{interaction.current.resumeAt=performance.now()+2500;drag.current={x:e.clientX,y:e.clientY,moved:false};e.currentTarget.setPointerCapture(e.pointerId);}}
    onPointerMove={e=>{const d=drag.current;if(!d)return;const dx=e.clientX-d.x,dy=e.clientY-d.y;if(Math.abs(dx)+Math.abs(dy)>2)d.moved=true;if(latest.current.view==='2d'){camera.current.target[0]-=dx/currentScale.current;camera.current.target[1]-=dy/currentScale.current;camera.current.center=[...camera.current.target];}else{camera.current.yaw+=dx*.005;camera.current.pitch=Math.max(-.9,Math.min(.9,camera.current.pitch+dy*.004));}d.x=e.clientX;d.y=e.clientY;}}
    onPointerUp={e=>{if(drag.current&&!drag.current.moved){const rect=e.currentTarget.getBoundingClientRect();const found=hits.current.slice().reverse().find(h=>Math.hypot(h.x-(e.clientX-rect.left),h.y-(e.clientY-rect.top))<h.r+4);if(found)latest.current.onSelect(found.id);}drag.current=null;}}
    onPointerCancel={()=>{drag.current=null;interaction.current.resumeAt=performance.now()+2500;}}
    onKeyDown={e=>{interaction.current.resumeAt=performance.now()+2500;if(['+','-','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();if(e.key==='+')camera.current.targetZoom=Math.min(4,camera.current.targetZoom+.15);if(e.key==='-')camera.current.targetZoom=Math.max(.55,camera.current.targetZoom-.15);if(props.view==='2d'){if(e.key==='ArrowLeft')camera.current.target[0]-=30;if(e.key==='ArrowRight')camera.current.target[0]+=30;if(e.key==='ArrowUp')camera.current.target[1]-=30;if(e.key==='ArrowDown')camera.current.target[1]+=30;}else{if(e.key==='ArrowLeft')camera.current.yaw-=.12;if(e.key==='ArrowRight')camera.current.yaw+=.12;if(e.key==='ArrowUp')camera.current.pitch-=.08;if(e.key==='ArrowDown')camera.current.pitch+=.08;}}}}/>;
}
