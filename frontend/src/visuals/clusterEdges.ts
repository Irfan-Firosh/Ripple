import type { CascadeNetwork } from './liveNetwork';

export type ClusterEdge={kind:'post'|'bridge';a:number;b:number;connections:number;strength:number};

// Display edges summarize the graph; propagation retains the complete member-level topology.
export function buildClusterEdges(network:CascadeNetwork):ClusterEdge[]{
  const counts=new Map<string,{a:number;b:number;connections:number}>(),seen=new Set<string>();
  for(const edge of network.edges){
    if(!edge.bridge||edge.a===network.sourceId||edge.b===network.sourceId)continue;
    const pair=[Math.min(edge.a,edge.b),Math.max(edge.a,edge.b)].join(':');
    if(seen.has(pair))continue;seen.add(pair);
    const ca=network.nodes[edge.a].community,cb=network.nodes[edge.b].community;
    if(ca===cb)continue;
    const a=Math.min(ca,cb),b=Math.max(ca,cb),key=`${a}:${b}`;
    const aggregate=counts.get(key)??{a,b,connections:0};aggregate.connections++;counts.set(key,aggregate);
  }
  const maximum=Math.max(1,...[...counts.values()].map(edge=>edge.connections));
  return [
    ...network.communities.map((_,b):ClusterEdge=>({kind:'post',a:-1,b,connections:1,strength:0})),
    ...[...counts.values()].map((edge):ClusterEdge=>({...edge,kind:'bridge',strength:Math.log1p(edge.connections)/Math.log1p(maximum+3)})),
  ];
}
