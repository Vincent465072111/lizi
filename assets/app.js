(() => {
  const root=document.getElementById('particle-photo-studio');
  const $=s=>root.querySelector(s), $$=s=>Array.from(root.querySelectorAll(s));
  const canvas=$('#ps-canvas'), stage=$('.ps-stage'), image=$('#ps-source'), status=$('#ps-status');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const defaults={clarity:.94,density:340,size:1.45,dispersion:.65,exposure:1.3,speed:.65,flow:.72,depth:.8,zoom:1,radius:.4,attract:.7,repel:.65,restore:.85,rotate:1};
  const params={...defaults};
  const descriptions={image:'保留主体细节，让颗粒感集中在边缘。',motion:'速度控制快慢，幅度控制形变距离。',pointer:'外圈向指针聚拢，内圈向外推开；拖拽时旋转整体。'};
  const config=[
    ['image','clarity','主体清晰度',0,1,.01,v=>Math.round(v*100)+'%'],
    ['image','density','粒子密度',140,480,20,v=>Math.round(v/340*100)+'%'],
    ['image','size','粒子大小',.6,3,.05,v=>v.toFixed(2)],
    ['image','dispersion','边缘消散',0,1.8,.02,v=>Math.round(v*100)+'%'],
    ['image','exposure','画面亮度',.6,2,.02,v=>v.toFixed(2)+'×'],
    ['motion','speed','流动速度',.05,2.2,.05,v=>v.toFixed(2)+'×'],
    ['motion','flow','流动幅度',0,2,.02,v=>Math.round(v*100)+'%'],
    ['motion','depth','三维起伏',0,2,.02,v=>Math.round(v*100)+'%'],
    ['motion','zoom','画面缩放',.65,1.65,.01,v=>Math.round(v*100)+'%'],
    ['pointer','radius','鼠标影响范围',.15,.8,.01,v=>Math.round(v*100)+'%'],
    ['pointer','attract','向鼠标吸引',0,2,.02,v=>Math.round(v*100)+'%'],
    ['pointer','repel','近处排斥',0,2,.02,v=>Math.round(v*100)+'%'],
    ['pointer','restore','复原时间',.15,2,.05,v=>v.toFixed(2)+' 秒'],
    ['pointer','rotate','拖拽灵敏度',.3,2,.05,v=>v.toFixed(2)+'×']
  ];
  let gl,program,loc={},texture,mesh,points,seed=17,photoAspect=1.28,worldW=2.35,worldH=1.84,columns=340;
  let ready=false,paused=reduced.matches,raf=0,last=0,time=0,rotation=[.07,-.08],targetRotation=[.07,-.08];
  let pointer={active:false,x:0,y:0,strength:0},drag=null,inertia=[0,0],camera=3.9,viewAspect=1,dpr=1,wantedStrength=0,currentImage=image;
  const fov=.69,clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const cursor=$('.ps-cursor');
  const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  let rebuildTimer;
  config.forEach(([group,key,label,min,max,step,format])=>{
    const wrap=document.createElement('label');wrap.className='ps-control';wrap.htmlFor='ps-'+key;
    const heading=document.createElement('span');heading.className='ps-control-heading';
    const title=document.createElement('span');title.textContent=label;
    const output=document.createElement('output');output.id='ps-value-'+key;output.htmlFor='ps-'+key;output.textContent=format(params[key]);
    const input=document.createElement('input');Object.assign(input,{type:'range',min,max,step,value:params[key],id:'ps-'+key});
    input.setAttribute('aria-label',label);
    heading.append(title,output);wrap.append(heading,input);$('#ps-'+group+'-controls').append(wrap);
    input.addEventListener('input',()=>{
      params[key]=Number(input.value);output.textContent=format(params[key]);
      if(key==='density'){clearTimeout(rebuildTimer);rebuildTimer=setTimeout(()=>{if(ready)buildPoints();},100);}
      wake();
    });
  });
  function syncControls(){config.forEach(([,key,,, , ,format])=>{$('#ps-'+key).value=params[key];$('#ps-value-'+key).textContent=format(params[key]);});}
  function selectTab(key){
    $$('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===key)));
    ['image','motion','pointer'].forEach(k=>$('#ps-'+k+'-controls').hidden=k!==key);
    $('#ps-panel-note').textContent=descriptions[key];
  }
  $$('[data-tab]').forEach((b,i)=>{
    b.addEventListener('click',()=>selectTab(b.dataset.tab));
    b.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tabs=$$('[data-tab]');const n=e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowRight'?1:2))%3;selectTab(tabs[n].dataset.tab);tabs[n].focus();});
  });
  function motionState(){ $('#ps-play').textContent=paused?'继续流动':'暂停流动';$('#ps-play').setAttribute('aria-pressed',String(paused));$('#ps-motion-label').textContent=paused?'流动已暂停':'持续流动'; }
  $('#ps-play').addEventListener('click',()=>{paused=!paused;motionState();wake();});motionState();
  reduced.addEventListener('change',e=>{if(e.matches){paused=true;motionState();wake();}});
  $('#ps-panel-button').addEventListener('click',()=>{const open=$('#ps-panel').hidden;$('#ps-panel').hidden=!open;root.dataset.panel=open?'open':'closed';$('#ps-panel-button').setAttribute('aria-expanded',String(open));});
  $('#ps-reset').addEventListener('click',()=>{Object.assign(params,defaults);$('#ps-preset').value='clear';targetRotation=[.07,-.08];inertia=[0,0];pointer.active=false;syncControls();if(ready)buildPoints();status.textContent='已恢复默认参数和视角。';wake();});
  $('#ps-preset').addEventListener('change',e=>{
    Object.assign(params,defaults);
    if(e.target.value==='silk')Object.assign(params,{flow:1.18,depth:1.35,dispersion:.9,speed:.45,clarity:.88});
    if(e.target.value==='vortex')Object.assign(params,{flow:.95,depth:1.05,attract:1.55,repel:1.15,radius:.52,dispersion:.9});
    syncControls();if(ready)buildPoints();status.textContent='已应用“'+e.target.selectedOptions[0].textContent+'”。';wake();
  });
  $$('[data-view]').forEach(b=>b.addEventListener('click',()=>{
    const k=b.dataset.view;inertia=[0,0];
    if(k==='left')targetRotation[1]-=Math.PI/5;
    if(k==='right')targetRotation[1]+=Math.PI/5;
    if(k==='tilt')targetRotation[0]=targetRotation[0]>.65?.07:1.04;
    if(k==='front'){targetRotation=[.07,Math.round(targetRotation[1]/(Math.PI*2))*Math.PI*2];params.zoom=1;syncControls();}
    pointer.active=false;cursor.hidden=true;wake();
  }));
  const vertex=`
    precision highp float;
    attribute vec4 aData;
    uniform mat4 uModel,uProjection;
    uniform vec2 uWorld,uPointer;
    uniform float uTime,uFlow,uDepth,uScatter,uRadius,uAttract,uRepel,uStrength,uCamera,uPixelH,uSpacing,uSize,uMode;
    varying vec2 vUv;
    varying float vAlpha,vEdge,vHole;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
    void main(){
      vec2 uv=aData.xy;vUv=clamp(uv,0.,1.);
      vec2 q=(uv-.5)*2.;
      float r=pow(pow(abs(q.x),4.)+pow(abs(q.y),4.),.25);
      float contour=r+(noise(q*2.4+uTime*.11)-.5)*.17;
      float edge=smoothstep(.48,1.11,contour);vEdge=edge;
      vec3 p=vec3((uv-.5)*uWorld,0.);
      float t=uTime;
      float n=noise(q*2.+vec2(t*.17,-t*.12))-.5;
      p.x+=uFlow*(sin(q.y*3.0+t*.85)*.042+sin(q.x*2.-q.y*3.+t*.4)*.020)*(1.+edge*1.7);
      p.y+=uFlow*(cos(q.x*3.2-t*.66)*.040+sin(q.y*4.+t*.58)*.020)*(1.+edge*1.7);
      p.z=uDepth*(sin(q.x*2.2+t*.70)*cos(q.y*2.0-t*.36)*.16+sin(q.y*3.6+t*.54)*.085+n*.09);
      if(uMode>0.5){
        float scatter=pow(edge,3.)*uScatter;
        float s=aData.z*6.2831853;
        p.xy+=vec2(cos(s+t*.18+n*2.),sin(s+t*.14+n*2.))*scatter*(.035+aData.w*.23);
        p.z+=(aData.w-.5)*scatter*.55;
        float plume=smoothstep(.75,1.18,contour)*uScatter;
        p.y+=plume*sin(q.x*5.+t*.37)*.08;
      }
      vec2 delta=p.xy-uPointer;
      float dist=length(delta),rad=max(.05,uRadius*uWorld.x*.65);
      vec2 direction=delta/(dist+.001);
      float outer=exp(-pow(dist/(rad*.8),2.));
      float inner=exp(-pow(dist/(rad*.22),2.));
      vHole=inner*uStrength*clamp(uRepel*1.4,0.,1.);
      float attraction=-uAttract*.52*rad*outer*(1.-inner);
      float repulsion=uRepel*.72*rad*inner;
      float field=uStrength*(attraction+repulsion);
      p.xy+=direction*field;
      p.xy+=vec2(-direction.y,direction.x)*outer*(1.-inner)*uAttract*uStrength*rad*.16;
      p.z+=uStrength*outer*uAttract*rad*.32;
      vec4 view=uModel*vec4(p,1.);view.z-=uCamera;
      gl_Position=uProjection*view;
      gl_PointSize=clamp(uSize*uSpacing*uPixelH/(max(.4,-view.z)*.718),.7,12.);
      float body=1.-smoothstep(.72,1.04,contour);
      float dust=1.-smoothstep(.86,1.37,contour);
      vAlpha=uMode<.5?body:dust;
      if(uMode>.5){vAlpha*=mix(1.,.42,edge);if(aData.w>dust) vAlpha=0.;}
    }
  `;
  const fragment=`
    precision highp float;
    uniform sampler2D uPhoto;
    uniform float uMode,uClarity,uExposure;
    varying vec2 vUv;
    varying float vAlpha,vEdge,vHole;
    void main(){
      vec4 sample=texture2D(uPhoto,vec2(vUv.x,1.-vUv.y));
      float alpha=vAlpha*sample.a;
      vec3 color=clamp(sample.rgb*uExposure,0.,1.);
      if(uMode<.5) alpha*=uClarity*(1.-vHole);
      else {
        float d=length(gl_PointCoord-.5)*2.;
        if(d>1.)discard;
        alpha*=(1.-smoothstep(.6,1.,d))*(1.-vHole*.75);
        alpha*=mix(1.-uClarity*.42,1.,vEdge);
        color*=1.+vEdge*.22;
      }
      if(alpha<.008)discard;
      gl_FragColor=vec4(color,alpha);
    }
  `;
  function compile(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;}
  function makeBuffer(data){const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);return{buffer:b,count:data.length/4};}
  function buildMesh(){
    if(mesh)gl.deleteBuffer(mesh.buffer);
    const data=[],nx=100,ny=Math.max(60,Math.round(nx/photoAspect));
    const put=(x,y)=>data.push(x/nx,y/ny,0,0);
    for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){put(x,y);put(x+1,y);put(x,y+1);put(x+1,y);put(x+1,y+1);put(x,y+1);}
    mesh=makeBuffer(data);
  }
  function buildPoints(){
    if(points)gl.deleteBuffer(points.buffer);
    seed=17;columns=Math.round(params.density);const rows=Math.max(80,Math.round(columns/photoAspect)),data=[];
    for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
      data.push((x+(rand()-.5)*.22)/(columns-1)*1.16-.08,(y+(rand()-.5)*.22)/(rows-1)*1.16-.08,rand(),rand());
    }
    points=makeBuffer(data);wake();
  }
  function rotationMatrix(){
    const cx=Math.cos(rotation[0]),sx=Math.sin(rotation[0]),cy=Math.cos(rotation[1]),sy=Math.sin(rotation[1]);
    return new Float32Array([cy,0,-sy,0,sy*sx,cx,cy*sx,0,sy*cx,-sx,cy*cx,0,0,0,0,1]);
  }
  function projection(){const f=1/Math.tan(fov/2),a=100/(.1-100),b=10/(.1-100);return new Float32Array([f/viewAspect,0,0,0,0,f,0,0,0,0,a,-1,0,0,b,0]);}
  function inverseRotate(v,m){return[m[0]*v[0]+m[1]*v[1]+m[2]*v[2],m[4]*v[0]+m[5]*v[1]+m[6]*v[2],m[8]*v[0]+m[9]*v[1]+m[10]*v[2]];}
  function localPointer(m){
    const w=stage.clientWidth,h=stage.clientHeight;
    const origin=inverseRotate([0,0,camera],m);
    const direction=inverseRotate([(pointer.x/w*2-1)*viewAspect*Math.tan(fov/2),(1-pointer.y/h*2)*Math.tan(fov/2),-1],m);
    if(Math.abs(direction[2])<.08)return null;
    const hit=-origin[2]/direction[2];if(hit<0)return null;
    return[clamp(origin[0]+direction[0]*hit,-worldW*1.5,worldW*1.5),clamp(origin[1]+direction[1]*hit,-worldH*1.5,worldH*1.5)];
  }
  function resize(){
    if(!gl)return;
    dpr=Math.min(devicePixelRatio||1,1.7);canvas.width=Math.round(stage.clientWidth*dpr);canvas.height=Math.round(stage.clientHeight*dpr);
    viewAspect=canvas.width/Math.max(1,canvas.height);gl.viewport(0,0,canvas.width,canvas.height);wake();
  }
  function render(dt){
    const smooth=1-Math.exp(-dt*10);
    if(!drag){targetRotation[0]=clamp(targetRotation[0]+inertia[0]*dt,-1.48,1.48);targetRotation[1]+=inertia[1]*dt;inertia[0]*=Math.exp(-dt*6);inertia[1]*=Math.exp(-dt*6);}
    rotation[0]+=(targetRotation[0]-rotation[0])*smooth;rotation[1]+=(targetRotation[1]-rotation[1])*smooth;
    camera=(Math.max(worldH*.72,worldW/viewAspect*.66)/Math.tan(fov/2)+.24)/params.zoom;
    const model=rotationMatrix(),hit=localPointer(model),wanted=pointer.active&&!drag&&hit?1:0;wantedStrength=wanted;
    pointer.strength+=(wanted-pointer.strength)*(1-Math.exp(-dt*(wanted?7:3/params.restore)));
    gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(program);
    gl.uniformMatrix4fv(loc.uModel,false,model);gl.uniformMatrix4fv(loc.uProjection,false,projection());
    gl.uniform2f(loc.uWorld,worldW,worldH);gl.uniform2f(loc.uPointer,hit?hit[0]:0,hit?hit[1]:0);
    const values={uTime:time,uFlow:params.flow,uDepth:params.depth,uScatter:params.dispersion,uRadius:params.radius,uAttract:params.attract,uRepel:params.repel,uStrength:pointer.strength,uCamera:camera,uPixelH:canvas.height,uSpacing:worldW/(columns-1)*1.16,uSize:params.size,uClarity:params.clarity,uExposure:params.exposure};
    for(const [key,value]of Object.entries(values))gl.uniform1f(loc[key],value);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1i(loc.uPhoto,0);
    gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.disable(gl.DEPTH_TEST);
    gl.uniform1f(loc.uMode,0);drawBuffer(mesh,gl.TRIANGLES);
    gl.uniform1f(loc.uMode,1);drawBuffer(points,gl.POINTS);
  }
  function drawBuffer(b,mode){gl.bindBuffer(gl.ARRAY_BUFFER,b.buffer);gl.vertexAttribPointer(loc.aData,4,gl.FLOAT,false,0,0);gl.enableVertexAttribArray(loc.aData);gl.drawArrays(mode,0,b.count);}
  function tick(now){
    raf=0;if(!ready||!root.isConnected)return;
    const dt=last?Math.min(.045,(now-last)/1000):1/60;last=now;
    if(!paused)time+=dt*params.speed;
    render(dt);
    const settling=Math.abs(rotation[0]-targetRotation[0])+Math.abs(rotation[1]-targetRotation[1])+Math.abs(inertia[0])+Math.abs(inertia[1])>.0001||Math.abs(pointer.strength-wantedStrength)>.001;
    if(!paused||settling)raf=requestAnimationFrame(tick);else last=0;
  }
  function wake(){if(ready&&!raf)raf=requestAnimationFrame(tick);}
  function init(){
    try{
      gl=canvas.getContext('webgl',{alpha:false,antialias:true,powerPreference:'high-performance',preserveDrawingBuffer:true});
      if(!gl)throw new Error('WebGL unavailable');
      const vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragment);
      program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
      gl.deleteShader(vs);gl.deleteShader(fs);
      for(const key of ['uModel','uProjection','uWorld','uPointer','uTime','uFlow','uDepth','uScatter','uRadius','uAttract','uRepel','uStrength','uCamera','uPixelH','uSpacing','uSize','uMode','uClarity','uExposure','uPhoto'])loc[key]=gl.getUniformLocation(program,key);
      loc.aData=gl.getAttribLocation(program,'aData');texture=gl.createTexture();setImage(currentImage);ready=true;resize();wake();
      root.dataset.ready='true';
      if(reduced.matches)status.textContent='已按减少动态效果设置暂停；点击“继续流动”可开启。';
    }catch(e){console.error(e);$('#ps-error').hidden=false;$('#ps-error').textContent='三维画面暂时无法启动，请在支持 WebGL 的浏览器中重新打开。';status.textContent='三维画面未能载入。';root.dataset.ready='error';}
  }
  function setImage(img){
    photoAspect=img.naturalWidth/img.naturalHeight;worldW=photoAspect>=1?2.35:2.35*photoAspect;worldH=worldW/photoAspect;
    gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    buildMesh();buildPoints();
  }
  let uploadVersion=0;
  $('#ps-upload').addEventListener('click',()=>$('#ps-file').click());
  $('#ps-file').addEventListener('change',()=>{
    const file=$('#ps-file').files[0];if(!file)return;
    if(!file.type.startsWith('image/')){status.textContent='请选择图片文件。';return;}
    const version=++uploadVersion,reader=new FileReader();
    reader.onload=()=>{const img=new Image();img.onload=()=>{if(version!==uploadVersion||!ready)return;
      const maxSize=Math.min(2048,gl.getParameter(gl.MAX_TEXTURE_SIZE));let source=img;
      if(Math.max(img.width,img.height)>maxSize){const resized=document.createElement('canvas'),ratio=maxSize/Math.max(img.width,img.height);resized.width=Math.round(img.width*ratio);resized.height=Math.round(img.height*ratio);resized.getContext('2d').drawImage(img,0,0,resized.width,resized.height);Object.defineProperties(resized,{naturalWidth:{value:resized.width},naturalHeight:{value:resized.height}});source=resized;}
      currentImage=source;setImage(source);targetRotation=[.07,-.08];inertia=[0,0];$('#ps-image-name').textContent=file.name;status.textContent='照片已更新，可继续调节形变和鼠标反馈。';wake();
    };img.onerror=()=>{status.textContent='这张图片未能读取，请尝试 JPG、PNG 或 WebP。';};img.src=reader.result;};
    reader.onerror=()=>{status.textContent='图片读取失败，请重新选择。';};reader.readAsDataURL(file);$('#ps-file').value='';
  });
  function updatePointer(e){const r=canvas.getBoundingClientRect();pointer.x=e.clientX-r.left;pointer.y=e.clientY-r.top;pointer.active=true;cursor.style.left=pointer.x+'px';cursor.style.top=pointer.y+'px';cursor.hidden=!!drag;}
  canvas.addEventListener('pointermove',e=>{
    updatePointer(e);
    if(drag&&drag.id===e.pointerId){const dx=e.clientX-drag.x,dy=e.clientY-drag.y,dt=Math.max(.016,(e.timeStamp-drag.time)/1000);targetRotation[1]+=dx*.008*params.rotate;targetRotation[0]=clamp(targetRotation[0]+dy*.008*params.rotate,-1.48,1.48);inertia=[clamp(dy*.008*params.rotate/dt,-3,3),clamp(dx*.008*params.rotate/dt,-3,3)];drag.x=e.clientX;drag.y=e.clientY;drag.time=e.timeStamp;}
    wake();
  });
  canvas.addEventListener('pointerdown',e=>{if(e.button!==0&&e.pointerType==='mouse')return;updatePointer(e);drag={id:e.pointerId,x:e.clientX,y:e.clientY,time:e.timeStamp};inertia=[0,0];canvas.setPointerCapture(e.pointerId);canvas.classList.add('ps-dragging');cursor.hidden=true;wake();});
  function endDrag(e){if(!drag||e.pointerId!==drag.id)return;drag=null;canvas.classList.remove('ps-dragging');const r=canvas.getBoundingClientRect();pointer.active=e.pointerType==='mouse'&&e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;cursor.hidden=!pointer.active;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);wake();}
  canvas.addEventListener('pointerup',endDrag);canvas.addEventListener('pointercancel',e=>{endDrag(e);pointer.active=false;cursor.hidden=true;inertia=[0,0];wake();});
  canvas.addEventListener('lostpointercapture',()=>{if(drag){drag=null;canvas.classList.remove('ps-dragging');pointer.active=false;cursor.hidden=true;wake();}});
  canvas.addEventListener('pointerleave',()=>{if(!drag){pointer.active=false;cursor.hidden=true;wake();}});
  canvas.addEventListener('wheel',e=>{e.preventDefault();params.zoom=clamp(params.zoom*Math.exp(-e.deltaY*.001),.65,1.65);syncControls();wake();},{passive:false});
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();ready=false;if(raf)cancelAnimationFrame(raf);raf=0;$('#ps-error').hidden=false;$('#ps-error').textContent='画面暂时中断，正在等待恢复。';});
  canvas.addEventListener('webglcontextrestored',()=>{$('#ps-error').hidden=true;mesh=null;points=null;init();});
  new ResizeObserver(resize).observe(stage);
  document.addEventListener('visibilitychange',()=>{last=0;if(!document.hidden)wake();});
  if(image.complete&&image.naturalWidth)init();else image.addEventListener('load',init,{once:true});
  image.addEventListener('error',()=>{status.textContent='示例照片未能载入。';});
})();
