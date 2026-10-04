import type { CascadeNetwork, NetworkLayout } from './liveNetwork';

export function prepareNetwork(network:CascadeNetwork,signal:AbortSignal):Promise<CascadeNetwork>{
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new DOMException('Aborted','AbortError'));return;}
    const worker=new Worker(new URL('./layout.worker.ts',import.meta.url),{type:'module'});
    const cleanup=()=>{clearTimeout(timeout);worker.terminate();signal.removeEventListener('abort',abort);};
    const abort=()=>{cleanup();reject(new DOMException('Aborted','AbortError'));};
    const timeout=setTimeout(()=>{cleanup();reject(new Error('Network preparation timed out. Try loading the audience again.'));},15000);
    signal.addEventListener('abort',abort,{once:true});
    worker.onerror=()=>{cleanup();reject(new Error('Could not prepare the network layout. Try again.'));};
    worker.onmessage=(event:MessageEvent<{spatial:NetworkLayout;planar:NetworkLayout;error?:string}>)=>{
      cleanup();
      if(event.data.error){reject(new Error(event.data.error));return;}
      const {spatial,planar}=event.data;
      network.nodes.forEach(node=>{node.position=spatial.positions[node.id];});
      network.communities.forEach((community,i)=>{community.center=spatial.centers[i];community.radius=spatial.radii[i];});
      network.extent=spatial.extent;network.planarLayout=planar;resolve(network);
    };
    worker.postMessage(network);
  });
}
