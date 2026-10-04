import { test, expect } from '@playwright/test';
import { buildLiveNetwork, MAX_GRAPH_NODES, MAX_GRAPH_LINKS, NetworkSizeError } from '../src/visuals/liveNetwork';
import type { Audience } from '../src/audience/liveAudience';

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

async function fixture(page:import('@playwright/test').Page,count:number){
  const data=audience(count);
  const tables:Record<string,Record<string,unknown>[]>= {
    niche:data.niches,
    twin:data.members.map(m=>({user_id:m.userId,username:m.username,post_count:m.postCount,engagement_rate:m.engagementRate,reply_share:m.replyShare,tone:m.tone,persona_summary:m.personaSummary,hot_buttons:[]})),
    twin_niche:data.members.map(m=>({user_id:m.userId,niche:m.primaryNiche,affinity:.8})),
    x_user:[{user_id:'brand',username:'spacetimedb',name:'SpacetimeDB',profile_image_url:'',followers_count:10000},...data.members.map(m=>({user_id:m.userId,username:m.username,name:m.name,profile_image_url:'',followers_count:m.followers}))],
    twin_audience:data.members.map(m=>({brand_user_id:'brand',user_id:m.userId})),x_post:[],x_post_entity:[],
  };
  await page.route('**/v1/database/ripple-mhacks/sql',route=>{
    const table=/FROM\s+(\w+)/i.exec(route.request().postData()??'')?.[1]??'';
    const records=tables[table]??[],keys=Object.keys(records[0]??{});
    return route.fulfill({json:[{schema:{elements:keys.map(name=>({name:{some:name},algebraic_type:{String:{}}}))},rows:records.map(r=>keys.map(k=>r[k]))}]});
  });
}

test('500-person graph prepares cached sprites, stops drawing when idle, and keeps zoom responsive',async({page})=>{
  await fixture(page,500);await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/dashboard');
  const stage=page.getByRole('region',{name:'Network visualization'});
  const canvas=page.getByRole('img',{name:/Three-dimensional audience network/});
  await expect(stage).toHaveAttribute('aria-busy','false');
  await expect(canvas).toHaveAttribute('data-sprite-count','501');
  await expect(canvas).toHaveAttribute('data-active-count','500');
  await page.waitForTimeout(150);
  const frames=await canvas.getAttribute('data-draw-count');
  await page.waitForTimeout(300);
  await expect(canvas).toHaveAttribute('data-draw-count',frames!);
  await canvas.hover();await page.mouse.wheel(0,-500);
  await expect.poll(async()=>Number(await canvas.getAttribute('data-camera-zoom'))).toBeGreaterThan(1);
  await expect(canvas).toHaveAttribute('data-sprite-count','501');
  await page.getByRole('button',{name:'Switch to light mode'}).click();
  await expect(stage).toHaveAttribute('aria-busy','false');
  await expect(canvas).toHaveAttribute('data-sprite-count','501');
});

test('oversized audience shows a size message without mounting the graph',async({page})=>{
  await fixture(page,MAX_GRAPH_NODES+1);await page.goto('/dashboard');
  await expect(page.getByRole('status')).toContainText('too large to display');
  await expect(page.getByRole('img',{name:/Three-dimensional audience network/})).toHaveCount(0);
  await expect(page.getByRole('link',{name:/Raycast/})).toBeVisible();
});
