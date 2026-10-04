import { buildAffinityLayout } from './affinityLayout';
import type { CascadeNetwork } from './liveNetwork';

self.onmessage=(event:MessageEvent<CascadeNetwork>)=>{
  try{
    const network=event.data;
    self.postMessage({spatial:buildAffinityLayout(network,3),planar:buildAffinityLayout(network,2)});
  }catch(error){self.postMessage({error:error instanceof Error?error.message:'Could not prepare the network layout.'});}
};
