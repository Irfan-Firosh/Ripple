import type { CascadeNetwork, Vec3 } from './liveNetwork';

type Vector=Map<string,number>;
const GOLDEN=2.399963;
function normalize(vector:Vector):Vector {
  const length=Math.hypot(...vector.values())||1;
  return new Map([...vector].map(([key,value])=>[key,value/length]));
}
function cosine(a:Vector,b:Vector){let sum=0;for(const [key,value] of a)sum+=value*(b.get(key)??0);return Math.max(0,Math.min(1,sum));}
const distance=(a:Vec3,b:Vec3)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);

// Bounded preparation work; no force simulation runs during zoom or playback.
export function buildAffinityLayout(network:CascadeNetwork,dimensions:2|3){
  const {nodes,communities,nodeRadius}=network,count=communities.length;
  const members=communities.map((_,i)=>nodes.filter(n=>n.community===i));
  const radii=communities.map((c,i)=>dimensions===2?Math.max(c.radius,Math.sqrt(members[i].length)*nodeRadius*1.55):c.radius);
  const vectors=nodes.map(n=>normalize(new Map(n.member.niches.map(interest=>[
    interest.slug,interest.affinity*(interest.slug===communities[n.community].slug? .35:1),
  ]))));
  const averages=members.map(group=>{
    const vector:Vector=new Map();
    for(const node of group)for(const interest of node.member.niches)vector.set(interest.slug,(vector.get(interest.slug)??0)+interest.affinity/group.length);
    return normalize(vector);
  });
  const bridgeCounts=communities.map(()=>communities.map(()=>0));
  const realNeighbors=nodes.map(()=>new Set<number>());
  for(const edge of network.edges){
    if(!edge.bridge||edge.a===network.sourceId||edge.b===network.sourceId)continue;
    realNeighbors[edge.a].add(edge.b);realNeighbors[edge.b].add(edge.a);
    const a=nodes[edge.a].community,b=nodes[edge.b].community;
    if(a!==b){bridgeCounts[a][b]++;bridgeCounts[b][a]++;}
  }
  const centers:Vec3[]=communities.map((_,i)=>{
    const angle=i*GOLDEN,latitude=-1+2*(i+.5)/Math.max(1,count),r=190+Math.max(0,...radii)*.5;
    if(dimensions===2)return [Math.cos(i/Math.max(1,count)*Math.PI*2-Math.PI/2)*r,Math.sin(i/Math.max(1,count)*Math.PI*2-Math.PI/2)*r,0];
    return [Math.cos(angle)*Math.sqrt(1-latitude*latitude)*r,latitude*r,Math.sin(angle)*Math.sqrt(1-latitude*latitude)*r];
  });
  const relations:{a:number;b:number;length:number}[]=[];
  for(let a=0;a<count;a++)for(let b=a+1;b<count;b++){
    const connection=Math.min(.45,bridgeCounts[a][b]/Math.sqrt(communities[a].size*communities[b].size));
    const similarity=Math.min(1,cosine(averages[a],averages[b])+connection);
    relations.push({a,b,length:radii[a]+radii[b]+36+(1-similarity)*150});
  }
  for(let iteration=0;iteration<100;iteration++)for(const relation of relations){
    const a=centers[relation.a],b=centers[relation.b],d=distance(a,b)||1,force=(d-relation.length)/d*.055;
    for(let axis=0;axis<dimensions;axis++){const delta=(b[axis]-a[axis])*force;a[axis]+=delta;b[axis]-=delta;}
  }
  if(count>1){
    const mean:Vec3=[0,0,0];centers.forEach(c=>c.forEach((value,axis)=>{mean[axis]+=value/count;}));
    centers.forEach(c=>c.forEach((_,axis)=>{c[axis]-=mean[axis];}));
  }
  // Resolve community collisions locally instead of stretching the entire map for one tight pair.
  for(let iteration=0;iteration<100;iteration++){
    for(const relation of relations){
      const a=centers[relation.a],b=centers[relation.b],d=distance(a,b)||1;
      const force=(d-relation.length)/d*.015;
      for(let axis=0;axis<dimensions;axis++){const delta=(b[axis]-a[axis])*force;a[axis]+=delta;b[axis]-=delta;}
    }
    for(let a=0;a<count;a++){
      const center=centers[a],originDistance=Math.hypot(...center),minOrigin=radii[a]+45;
      if(originDistance<minOrigin)center.forEach((value,axis)=>{center[axis]=value*minOrigin/Math.max(.001,originDistance);});
      for(let b=a+1;b<count;b++){
        const other=centers[b],d=distance(center,other),minimum=radii[a]+radii[b]+32;
        if(d>=minimum)continue;
        const force=(minimum-d)/Math.max(.001,d)*.51;
        for(let axis=0;axis<dimensions;axis++){const delta=(other[axis]-center[axis])*force;center[axis]-=delta;other[axis]+=delta;}
      }
    }
  }
  let separation=1;
  for(let a=0;a<count;a++){
    separation=Math.max(separation,(radii[a]+45)/Math.max(1,distance(centers[a],[0,0,0])));
    for(let b=a+1;b<count;b++)separation=Math.max(separation,(radii[a]+radii[b]+32)/Math.max(1,distance(centers[a],centers[b])));
  }
  centers.forEach(c=>c.forEach((value,axis)=>{c[axis]=value*separation;}));
  let rotation=count? -Math.PI/2-Math.atan2(centers[0][1],centers[0][0]):0;
  if(dimensions===2){
    const xx=centers.reduce((sum,c)=>sum+c[0]*c[0],0),yy=centers.reduce((sum,c)=>sum+c[1]*c[1],0),xy=centers.reduce((sum,c)=>sum+c[0]*c[1],0);
    rotation=-.5*Math.atan2(2*xy,xx-yy);
  }
  centers.forEach(c=>{const x=c[0],y=c[1];c[0]=x*Math.cos(rotation)-y*Math.sin(rotation);c[1]=x*Math.sin(rotation)+y*Math.cos(rotation);});

  const positions:Vec3[]=new Array(nodes.length);
  members.forEach((group,ci)=>{
    const local:Vec3[]=group.map((_,i)=>{
      if(i===0)return [0,0,0];
      const angle=i*GOLDEN,r=radii[ci]*Math.sqrt(i/Math.max(1,group.length-1))*.8;
      if(dimensions===2)return [Math.cos(angle)*r,Math.sin(angle)*r,0];
      const y=1-2*(i-.5)/Math.max(1,group.length-1),cross=Math.sqrt(Math.max(0,1-y*y));
      return [Math.cos(angle)*cross*r,y*r,Math.sin(angle)*cross*r];
    });
    const indexById=new Map(group.map((node,index)=>[node.id,index]));
    const postings=new Map<string,number[]>();
    group.forEach((node,index)=>node.member.niches.forEach(niche=>{const list=postings.get(niche.slug)??[];list.push(index);postings.set(niche.slug,list);}));
    const springs=new Map<string,{a:number;b:number;length:number;weight:number}>();
    group.forEach((node,index)=>{
      const candidates=new Set<number>();
      node.member.niches.slice(0,6).forEach(niche=>{
        const list=postings.get(niche.slug)!;
        for(let sample=0;sample<Math.min(12,list.length);sample++)candidates.add(list[(index*7+Math.floor(sample*list.length/Math.min(12,list.length)))%list.length]);
      });
      realNeighbors[node.id].forEach(id=>{const candidate=indexById.get(id);if(candidate!==undefined)candidates.add(candidate);});
      const ranked=[...candidates].filter(i=>i!==index).map(i=>({index:i,score:cosine(vectors[node.id],vectors[group[i].id]),linked:realNeighbors[node.id].has(group[i].id)}))
        .sort((a,b)=>Number(b.linked)-Number(a.linked)||b.score-a.score||distance(local[index],local[a.index])-distance(local[index],local[b.index])).slice(0,8);
      for(const candidate of ranked){
        if(candidate.score<.25&&!candidate.linked)continue;
        const a=Math.min(index,candidate.index),b=Math.max(index,candidate.index);
        springs.set(`${a}:${b}`,{a,b,length:nodeRadius*(2.5+(1-candidate.score)*(candidate.linked?2:7)),weight:candidate.linked?2.5:.7});
      }
    });
    const minSpacing=nodeRadius*2.35;
    const collisions=()=>{
      const cells=new Map<string,number[]>();
      local.forEach((point,index)=>{const key=point.map(v=>Math.floor(v/minSpacing)).join(':');const list=cells.get(key)??[];list.push(index);cells.set(key,list);});
      local.forEach((point,a)=>{
        const cell=point.map(v=>Math.floor(v/minSpacing));
        for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=dimensions===2?0:-1;z<=(dimensions===2?0:1);z++){
          for(const b of cells.get(`${cell[0]+x}:${cell[1]+y}:${cell[2]+z}`)??[]){
            if(b<=a)continue;
            const other=local[b],d=distance(point,other);if(d>=minSpacing)continue;
            const force=(minSpacing-d)/Math.max(.001,d)*.55;
            for(let axis=0;axis<dimensions;axis++){const delta=(other[axis]-point[axis])*force;if(a!==0)point[axis]-=delta;other[axis]+=delta;}
          }
        }
      });
    };
    for(let iteration=0;iteration<65;iteration++){
      if(iteration<55)for(const spring of springs.values()){
        const a=local[spring.a],b=local[spring.b],d=distance(a,b)||1,force=(d-spring.length)/d*.065*spring.weight;
        for(let axis=0;axis<dimensions;axis++){const delta=(b[axis]-a[axis])*force;if(spring.a!==0)a[axis]+=delta;if(spring.b!==0)b[axis]-=delta;}
      }
      collisions();
      local.forEach((point,index)=>{
        if(index===0)return;
        const d=Math.hypot(...point),limit=radii[ci];if(d>limit)point.forEach((value,axis)=>{point[axis]=value*limit/d;});
      });
    }
    group.forEach((node,index)=>{positions[node.id]=local[index].map((value,axis)=>value+centers[ci][axis]) as Vec3;});
  });
  const extent=Math.max(200,...centers.map((center,i)=>Math.hypot(...center)+radii[i]+30));
  const halfWidth=Math.max(100,...centers.map((c,i)=>Math.abs(c[0])+radii[i]+30));
  const halfHeight=Math.max(100,...centers.map((c,i)=>Math.abs(c[1])+radii[i]+30));
  return {centers,positions,radii,extent,halfWidth,halfHeight};
}
