import type { CascadeNetwork } from './liveNetwork';

// Bake lighting, image clipping, portrait shading and the rim once; zoom only scales this bitmap.
export function createNodeSprite(network:CascadeNetwork,id:number,theme:'dark'|'light',image?:CanvasImageSource):HTMLCanvasElement {
  const source=id===network.sourceId,node=network.nodes[id];
  const color=source?'#e6bc88':network.communities[node.community].color;
  const sprite=document.createElement('canvas');sprite.width=128;sprite.height=128;
  const ctx=sprite.getContext('2d')!;const x=64,y=64,r=48;
  ctx.shadowColor='#00000040';ctx.shadowBlur=8;ctx.shadowOffsetY=3;
  const sphere=ctx.createRadialGradient(x-r*.4,y-r*.5,0,x,y,r*1.15);
  sphere.addColorStop(0,theme==='dark'?'#35475e':'#ffffff');sphere.addColorStop(.6,theme==='dark'?'#142439':'#dbe2e9');sphere.addColorStop(1,theme==='dark'?'#050e1b':'#a7b6c7');
  ctx.fillStyle=sphere;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.shadowOffsetY=0;
  if(image){
    ctx.save();ctx.beginPath();ctx.arc(x,y,r*.9,0,Math.PI*2);ctx.clip();ctx.drawImage(image,x-r,y-r,r*2,r*2);
    const shade=ctx.createLinearGradient(x-r,y-r,x+r,y+r);shade.addColorStop(0,'#ffffff20');shade.addColorStop(.5,'#00000000');shade.addColorStop(1,'#00000065');
    ctx.fillStyle=shade;ctx.fillRect(x-r,y-r,r*2,r*2);ctx.restore();
  }else{
    ctx.fillStyle=color;ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='500 34px "DM Sans"';ctx.fillText(source?'✳':node.initials,x,y);
  }
  ctx.strokeStyle=color;ctx.globalAlpha=.85;ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,r+4,0,Math.PI*2);ctx.stroke();
  return sprite;
}

// Bounded concurrency avoids issuing hundreds of image requests at once. Failed images keep initials.
export async function loadPortraits(network:CascadeNetwork,signal:AbortSignal,onImage:(id:number,image:HTMLImageElement)=>void){
  const queue=[...network.nodes.map(n=>({id:n.id,src:n.avatar})),{id:network.sourceId,src:network.source.avatar}].filter(n=>n.src);
  let cursor=0;
  await Promise.all(Array.from({length:Math.min(8,queue.length)},async()=>{
    while(cursor<queue.length&&!signal.aborted){
      const {id,src}=queue[cursor++];
      await new Promise<void>(resolve=>{
        const image=new Image();let settled=false;
        const finish=(loaded:boolean)=>{
          if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);
          image.onload=null;image.onerror=null;
          if(loaded&&!signal.aborted)onImage(id,image);else image.src='';resolve();
        };
        const abort=()=>finish(false),timer=setTimeout(()=>finish(false),4000);
        signal.addEventListener('abort',abort,{once:true});image.referrerPolicy='no-referrer';
        image.onload=()=>finish(true);image.onerror=()=>finish(false);image.src=src;
      });
    }
  }));
}
