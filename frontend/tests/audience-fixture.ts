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

export async function audienceFixture(page:import('@playwright/test').Page,count:number){
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

