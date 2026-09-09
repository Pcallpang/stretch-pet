import Jimp from 'jimp';
import fs from 'node:fs';
import path from 'node:path';

// Import the generated 4x4 sheets into the runtime's existing PNG frame layout.
const jobs = [
  ['miyo', '01-miyo-stretch-sheet.png'],
  ['miyox', '02-miyox-stretch-sheet.png'],
  ['deodeumiyo', '03-deodeumiyo-stretch-sheet.png'],
  ['godmiyo', '04-godmiyo-stretch-sheet.png'],
];
const names = ['idle/1', 'idle/2', 'standing/overhead', 'standing/side_bend',
  'walk/1', 'walk/2', 'walk/3', 'walk/4', 'stretch/start', 'stretch/neck_tilt',
  'stretch/shoulder_roll', 'stretch/torso_twist', 'stretch/hip_glute',
  'stretch/leg_extension', 'stretch/spinal_twist', 'stretch/deep_breath'];
function clearBackground(image) {
  const { width: w, height: h, data } = image.bitmap;
  const seen = new Uint8Array(w*h), queue = [];
  function add(x,y) {
    const p = y*w+x, i = p*4;
    if (seen[p]) return;
    const lo = Math.min(data[i],data[i+1],data[i+2]);
    const hi = Math.max(data[i],data[i+1],data[i+2]);
    // Traverse pale aura too, but only erase neutral checker colors.
    if (lo < 145 || hi-lo > 105) return;
    seen[p]=1; queue.push(p);
  }
  for(let x=0;x<w;x++){add(x,0);add(x,h-1);}
  for(let y=0;y<h;y++){add(0,y);add(w-1,y);}
  for(let head=0;head<queue.length;head++) {
    const p=queue[head], x=p%w, y=Math.floor(p/w), i=p*4;
    const lo=Math.min(data[i],data[i+1],data[i+2]);
    const hi=Math.max(data[i],data[i+1],data[i+2]);
    if(hi-lo <= 14) data[i+3]=0;
    else if(hi-lo < 45) data[i+3]=Math.round(255*(hi-lo-14)/31);
    if(x>0)add(x-1,y);if(x<w-1)add(x+1,y);
    if(y>0)add(x,y-1);if(y<h-1)add(x,y+1);
  }
  // Discard isolated background compression specks; retain character and effects.
  const marked = new Uint8Array(w*h);
  for (let start=0; start<w*h; start++) {
    if (marked[start] || data[start*4+3] === 0) continue;
    const component=[start]; marked[start]=1;
    for(let k=0;k<component.length;k++) {
      const p=component[k], x=p%w, y=Math.floor(p/w);
      for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) {
        const nx=x+dx,ny=y+dy,np=ny*w+nx;
        if(nx<0||nx>=w||ny<0||ny>=h||marked[np]||data[np*4+3]===0)continue;
        marked[np]=1;component.push(np);
      }
    }
    if(component.length<24) for(const p of component)data[p*4+3]=0;
  }
  return image;
}
for(const [id,file] of jobs){
  const sheet=await Jimp.read(path.join('output/stretch-assets-v1',file));
  for(let n=0;n<16;n++){
    const col=n%4,row=Math.floor(n/4);
    const rows = id === 'deodeumiyo' ? [0,320,610,920,1254] : [0,320,620,930,1254];
    const x=Math.round(col*sheet.bitmap.width/4),y=rows[row];
    const right=Math.round((col+1)*sheet.bitmap.width/4),bottom=rows[row+1];
    const frame=clearBackground(sheet.clone().crop(x,y,right-x,bottom-y));
    // Uniform canvas preserves the sheet's registration across animations.
    frame.contain(320,320,Jimp.HORIZONTAL_ALIGN_CENTER|Jimp.VERTICAL_ALIGN_MIDDLE);
    const out=path.join('assets/characters',id,names[n]+'.png');
    fs.mkdirSync(path.dirname(out),{recursive:true});await frame.writeAsync(out);
  }
  console.log(`Imported ${id}: 16 transparent frames`);
}
