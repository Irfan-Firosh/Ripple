export type Concept = 'constellation' | 'orbit' | 'bridge';
export const communities = [
  { name: 'AI builders', color: '#88b9ed' },
  { name: 'Open source', color: '#efc58e' },
  { name: 'Design & tools', color: '#93d3bb' },
  { name: 'Indie makers', color: '#b4a1e5' },
];
const names = ['Jamie Lee', 'Alex Chen', 'Maya Brooks', 'Sam Rivera', 'Morgan Park', 'Jordan Kim', 'Riley Stone', 'Drew Evans', 'Casey Reed', 'Taylor Wells', 'Avery Fox', 'Robin Lane'];
const surnames = names.map(name=>name.split(" ")[1]);
export const profiles = Array.from({length:48},(_,i)=>({
  id:i, name:`${names[i%names.length].split(" ")[0]} ${surnames[(i%12+Math.floor(i/12)*3)%12]}`, community:Math.floor(i/12),
  avatar:`https://i.pravatar.cc/128?img=${i+11}`,
  initials:names[i%names.length].split(' ').map(v=>v[0]).join(''),
  role:i%12===0?'Community bridge':i===1?'Your starting point':'Audience member',
}));
export function position(id:number,concept:Concept):[number,number,number] {
  const group=Math.floor(id/12), index=id%12, a=index*2.399963+group*.7;
  if(concept==='orbit'){
    const azimuth=id*2.399963, y=1-2*(id+.5)/48, r=Math.sqrt(1-y*y);
    return [r*Math.cos(azimuth)*265,y*265,r*Math.sin(azimuth)*265];
  }
  const centers: [number,number,number][] = concept==='bridge'
    ? [[-245,-65,-30],[-75,60,75],[115,-65,-40],[265,65,30]]
    : [[-180,-105,-30],[165,-100,45],[-155,125,45],[180,130,-30]];
  const c=centers[group], r=25+Math.sqrt(index/11)*82;
  return [c[0]+Math.cos(a)*r,c[1]+Math.sin(a)*r*.75,c[2]+Math.sin(a*1.7)*60];
}
export const connections = profiles.flatMap(p=>{
  const groupStart=p.community*12, i=p.id%12;
  return i===0?[]:[{a:groupStart,b:p.id,bridge:false},{a:p.id,b:groupStart+(i+1)%12,bridge:false}];
}).concat([{a:0,b:12,bridge:true},{a:12,b:24,bridge:true},{a:24,b:36,bridge:true},{a:0,b:36,bridge:true}]);
