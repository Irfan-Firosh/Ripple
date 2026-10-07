import { audienceFixture as fixture } from './audience-fixture';
import { test, expect } from '@playwright/test';
import { buildLiveNetwork, MAX_GRAPH_NODES, MAX_GRAPH_LINKS, NetworkSizeError } from '../src/visuals/liveNetwork';
import type { Audience } from '../src/audience/liveAudience';
import { buildPlanarLayout } from '../src/visuals/networkLayout2D';
import { buildClusterEdges } from '../src/visuals/clusterEdges';

function audience(count:number):Audience {
  return {
    brand:{userId:'brand',username:'spacetimedb',name:'SpacetimeDB',avatar:'',platform:'x'},
    niches:[0,1,2,3].map(i=>({slug:`niche-${i}`,label:`Niche ${i+1}`})),links:[],
    members:Array.from({length:count},(_,i)=>({
      userId:`person-${i}`,username:`person${i}`,name:`Person ${i}`,avatar:'',followers:count-i,profileUrl:`https://x.com/person${i}`,
      postCount:10,engagementRate:.1+(i%4)*.02,replyShare:.1,tone:'friendly',personaSummary:'Test profile',hotButtons:[],
      niches:[{slug:`niche-${i%4}`,label:`Niche ${i%4+1}`,affinity:.8}],primaryNiche:`niche-${i%4}`,
    })),
  };
}

test('display edges aggregate unique recorded connections without changing propagation',()=>{
  const data=audience(36);
  data.links=[['person-0','person-1'],['person-4','person-5'],['person-8','person-9'],['person-1','person-0'],['person-2','person-3'],['person-0','person-4']];
  const network=buildLiveNetwork(data);
  const topology=JSON.stringify({edges:network.edges,arrivals:network.arrivals});
  const edges=buildClusterEdges(network),posts=edges.filter(e=>e.kind==='post'),bridges=edges.filter(e=>e.kind==='bridge');
  expect(posts).toHaveLength(network.communities.length);
  expect(new Set(posts.map(e=>e.b)).size).toBe(network.communities.length);
  expect(bridges).toHaveLength(2);
  expect(bridges.map(e=>e.connections).sort()).toEqual([1,3]);
  expect(bridges.find(e=>e.connections===3)!.strength).toBeGreaterThan(bridges.find(e=>e.connections===1)!.strength);
  expect(JSON.stringify({edges:network.edges,arrivals:network.arrivals})).toBe(topology);
});

test('shared interests pull people and related communities closer in both dimensions',()=>{
  const data=audience(40);
  data.members.forEach((member,i)=>{
    member.primaryNiche='niche-0';
    member.niches=[{slug:'niche-0',label:'Niche 1',affinity:.8},{slug:i<20?'secondary-a':'secondary-b',label:'Secondary interest',affinity:.95}];
  });
  const network=buildLiveNetwork(data);
  const planar=buildPlanarLayout(network);
  for(const positions of [network.nodes.map(n=>n.position),planar.positions]){
    let within=0,between=0,withinCount=0,betweenCount=0;
    for(let a=0;a<40;a++)for(let b=a+1;b<40;b++){
      const d=Math.hypot(...positions[a].map((v,axis)=>v-positions[b][axis]));
      if((a<20)===(b<20)){within+=d;withinCount++;}else{between+=d;betweenCount++;}
    }
    expect(within/withinCount).toBeLessThan(between/betweenCount);
  }
  const groups=audience(36);groups.members=groups.members.filter(m=>m.primaryNiche!=='niche-3');
  groups.members.forEach(m=>{if(m.primaryNiche!=='niche-2')m.niches.push({slug:'shared',label:'Shared interest',affinity:.95});});
  const grouped=buildLiveNetwork(groups);
  for(const centers of [grouped.communities.map(c=>c.center),buildPlanarLayout(grouped).centers]){
    const d=(a:number,b:number)=>Math.hypot(...centers[a].map((v,axis)=>v-centers[b][axis]));
    expect(d(0,1)).toBeLessThan(d(0,2));expect(d(0,1)).toBeLessThan(d(1,2));
  }
});

test('recorded connections reduce separation and layout preparation is deterministic',()=>{
  const data=audience(32);
  data.members.forEach((m,i)=>{m.primaryNiche='niche-0';m.niches=[{slug:'niche-0',label:'Niche 1',affinity:.8},{slug:i<16?'a':'b',label:'Secondary',affinity:.95}];});
  const baseline=buildLiveNetwork(data);
  const d=(positions:number[][],a:number,b:number)=>Math.hypot(...positions[a].map((v,axis)=>v-positions[b][axis]));
  const before=baseline.nodes.map(n=>n.position);let pair=[0,16],largest=0;
  for(let a=1;a<16;a++)for(let b=16;b<32;b++){const length=d(before,a,b);if(length>largest){largest=length;pair=[a,b];}}
  data.links=[[baseline.nodes[pair[0]].member.userId,baseline.nodes[pair[1]].member.userId]];
  const linked=buildLiveNetwork(data);
  expect(d(linked.nodes.map(n=>n.position),pair[0],pair[1])).toBeLessThan(largest);
  expect(buildLiveNetwork(data).nodes.map(n=>n.position)).toEqual(linked.nodes.map(n=>n.position));
});

test('niche spheres are separate, every user is retained, and cascade arrivals follow valid shortest paths',()=>{
  const network=buildLiveNetwork(audience(500));
  expect(network.nodes).toHaveLength(500);
  const radii=network.communities.map((community,index)=>Math.max(...network.nodes.filter(n=>n.community===index).map(n=>Math.hypot(...n.position.map((v,axis)=>v-community.center[axis])))));
  for(let i=0;i<network.communities.length;i++)for(let j=i+1;j<network.communities.length;j++){
    const distance=Math.hypot(...network.communities[i].center.map((v,axis)=>v-network.communities[j].center[axis]));
    expect(distance).toBeGreaterThan(radii[i]+radii[j]+20);
  }
  expect(network.arrivals).toHaveLength(501);
  for(const arrival of network.arrivals){
    if(arrival.from===null)continue;
    const parent=network.arrivalById.get(arrival.from)!;
    expect(parent.at).toBeLessThan(arrival.at);
    expect(network.edges.some(e=>(e.a===arrival.id&&e.b===arrival.from)||(e.b===arrival.id&&e.a===arrival.from))).toBe(true);
  }
  for(const edge of network.edges){
    const a=network.arrivalById.get(edge.a)!.at,b=network.arrivalById.get(edge.b)!.at;
    expect(Math.abs(a-b)).toBeLessThanOrEqual(edge.delay+1e-9);
  }
});

test('oversized node and edge inputs are rejected before geometry is built',()=>{
  expect(()=>buildLiveNetwork(audience(MAX_GRAPH_NODES+1))).toThrow(NetworkSizeError);
  const dense=audience(20);dense.links=Array.from({length:MAX_GRAPH_LINKS},()=>['person-0','person-1']);
  expect(()=>buildLiveNetwork(dense)).toThrow(NetworkSizeError);
  expect(buildLiveNetwork(audience(MAX_GRAPH_NODES)).nodes).toHaveLength(MAX_GRAPH_NODES);
});

test('500-person graph prepares cached sprites, stops drawing when idle, and keeps zoom responsive',async({page})=>{
  await fixture(page,500);await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/dashboard');
  const stage=page.getByRole('region',{name:'Network visualization'});
  const canvas=page.getByRole('img',{name:/Three-dimensional audience network/});
  await expect(stage).toHaveAttribute('aria-busy','false',{timeout:30000});
  await expect(canvas).toHaveAttribute('data-sprite-count','500');
  await expect(canvas).toHaveAttribute('data-active-count','500');
  await expect(canvas).toHaveAttribute('data-post-edge-count','0');
  await expect(canvas).toHaveAttribute('data-bridge-edge-count','0');
  await page.waitForTimeout(150);
  const frames=await canvas.getAttribute('data-draw-count');
  await page.waitForTimeout(300);
  await expect(canvas).toHaveAttribute('data-draw-count',frames!);
  await canvas.hover();await page.mouse.wheel(0,-500);
  await expect.poll(async()=>Number(await canvas.getAttribute('data-camera-zoom'))).toBeGreaterThan(1);
  await expect(canvas).toHaveAttribute('data-sprite-count','500');
  await page.getByRole('button',{name:'Switch to light mode'}).click();
  await expect(stage).toHaveAttribute('aria-busy','false');
  await expect(canvas).toHaveAttribute('data-sprite-count','500');
});

test('oversized audience shows a size message without mounting the graph',async({page})=>{
  await fixture(page,MAX_GRAPH_NODES+1);await page.goto('/dashboard');
  await expect(page.getByRole('status')).toContainText('too large to display');
  await expect(page.getByRole('img',{name:/Three-dimensional audience network/})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Open history'})).toBeVisible();
});

test('3D inspection preserves cached sprites and supports orbit and niche focus',async({page})=>{
  await fixture(page,120);await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/dashboard');
  const canvas=page.locator('.nt-stage>canvas');
  await expect(canvas).toHaveAttribute('data-sprite-count','120');
  await expect(canvas).toHaveAttribute('data-active-count','120');
  await expect(canvas).toHaveAttribute('data-source-node-count','0');
  const initial=Number(await canvas.getAttribute('data-camera-yaw'));
  const box=(await canvas.boundingBox())!;
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.down();await page.mouse.move(box.x+box.width/2+70,box.y+box.height/2+30,{steps:5});await page.mouse.up();
  await expect.poll(async()=>Number(await canvas.getAttribute('data-camera-yaw'))).not.toBe(initial);
  await page.getByRole('button',{name:/^01 /}).click();
  await expect(canvas).toHaveAttribute('data-focus-community','0');
  await expect(canvas).toHaveAttribute('data-camera-zoom','2.20');
  await expect(canvas).toHaveAttribute('data-sprite-count','120');
  await expect(canvas).toHaveAttribute('data-active-count','120');
  await page.getByRole('button',{name:'Reset network view'}).click();
  await expect(canvas).toHaveAttribute('data-focus-community','all');
});

test('mobile ignores obsolete 2D URLs and supports 3D keyboard navigation',async({page})=>{
  const network=buildLiveNetwork(audience(120)),layout=buildPlanarLayout(network);
  expect(layout.positions.every(p=>p[2]===0)).toBe(true);
  for(let i=0;i<layout.centers.length;i++)for(let j=i+1;j<layout.centers.length;j++){
    const distance=Math.hypot(layout.centers[i][0]-layout.centers[j][0],layout.centers[i][1]-layout.centers[j][1]);
    expect(distance).toBeGreaterThanOrEqual(layout.radii[i]+layout.radii[j]+23.99);
  }
  await fixture(page,120);await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/test?view=2d');
  const canvas=page.getByRole('img',{name:/Three-dimensional audience network/});
  await expect(canvas).toHaveAttribute('data-active-count','120');
  await page.getByRole('button',{name:/^02 /}).click();
  await expect(canvas).toHaveAttribute('data-focus-community','1');
  await page.getByRole('button',{name:'Reset network view'}).click();
  await expect(canvas).toHaveAttribute('data-focus-community','all');
  await canvas.focus();await page.keyboard.press('ArrowRight');
  await expect(canvas).toHaveAttribute('data-view','3d');
  await expect(canvas).toHaveAttribute('data-source-node-count','0');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('3D overview drifts gently but stays still during inspection and with reduced motion',async({page})=>{
  await fixture(page,36);await page.goto('/dashboard');
  const canvas=page.locator('.nt-stage>canvas');
  await expect(canvas).toHaveAttribute('data-idle-orbit','true');
  const initial=Number(await canvas.getAttribute('data-camera-yaw'));
  await expect.poll(async()=>Number(await canvas.getAttribute('data-camera-yaw'))-initial).toBeGreaterThan(.006);
  await canvas.hover();
  await expect(canvas).toHaveAttribute('data-idle-orbit','false');
  await page.waitForTimeout(100);
  const hovered=await canvas.getAttribute('data-camera-yaw');
  await page.waitForTimeout(300);
  await expect(canvas).toHaveAttribute('data-camera-yaw',hovered!);
  await page.mouse.move(0,0);
  await expect(canvas).toHaveAttribute('data-idle-orbit','true');
  await page.getByLabel('Interest index').getByRole('button',{name:/^01 /}).click();
  await expect(canvas).toHaveAttribute('data-idle-orbit','false');
  const focused=await canvas.getAttribute('data-camera-yaw');
  await page.waitForTimeout(300);
  await expect(canvas).toHaveAttribute('data-camera-yaw',focused!);
  await page.getByRole('button',{name:'All interests',exact:true}).click();
  await expect(canvas).toHaveAttribute('data-idle-orbit','true');
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(canvas).toHaveAttribute('data-idle-orbit','false');
  const reduced=await canvas.getAttribute('data-camera-yaw');
  await page.waitForTimeout(300);
  await expect(canvas).toHaveAttribute('data-camera-yaw',reduced!);
});
