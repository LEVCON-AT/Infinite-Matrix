
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// DATA MODEL
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let nodes={}, nid=1;
function uid(){return 'n'+(nid++);}

// â”€â”€ Shared constants â”€â”€
const WEEKDAY_NAMES=['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'];
const WEEKDAY_SHORT=['Mo','Di','Mi','Do','Fr','Sa','So'];
const MONTH_NAMES=['Januar','Februar','MÃ¤rz','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const MONTH_SHORT=['Jan','Feb','MÃ¤r','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
const PRIO_COLORS={high:'var(--red)',medium:'var(--amber)',low:'var(--teal)'};
const DAILY_COL_TYPES=[['today','Heute'],['thisweek','Diese Woche'],['nextweek','NÃ¤chste Woche'],['thismonth','Dieser Monat'],['nextmonth','NÃ¤chster Monat'],['thisquarter','Dieses Quartal'],['thisyear','Dieses Jahr'],['nextyear','NÃ¤chstes Jahr']];
const DCTYPE_LABELS=Object.fromEntries(DAILY_COL_TYPES);
const SAVE_INDICATOR_MS=1800;
const SAVE_WARN_MS=4000;
const SAVE_WARN_KB=3500;
const NOTE_TRUNCATE=80;
const SEARCH_MAX=20;
const SEARCH_MIN_LEN=2;
const HINT_DISPLAY_MS=2500;
const ANIM_EXIT_MS=180;
const ANIM_ENTER_MS=220;
const ANIM_CHECK_MS=350;
const RENDER_DELAY_MS=200;
const FOCUS_RESTORE_MS=50;
const MODAL_FOCUS_DELAY_MS=30;
const SMODAL_EXIT_MS=150;
const ARCHIVE_SCROLL_THRESHOLD=20;
const ARCHIVE_SCROLL_HEIGHT='480px';
const PRIO_LABELS={high:'Hoch ðŸ”´',medium:'Mittel ðŸŸ¡',low:'Niedrig ðŸŸ¢','':'â€” Keine'};

// Global stores (persisted)
let globalTags=[];   // [{id,label}]
let globalPeople=[]; // [{id,label}]
let dailyCols=[];    // [{id,label}]  â€” user-defined time buckets

function mkMatrix(label){
  const id=uid();
  nodes[id]={id,type:'matrix',label,data:{rows:[],cols:[],cells:{}}};
  return id;
}
function mkBoard(label){
  const id=uid();
  nodes[id]={id,type:'board',label,data:{
    infoFields:[],   // [{id,label,value}]
    links:[],        // [{id,label,url}]
    kbCols:[],       // [{id,label,archived?}]
    kbCards:[],      // [{id,colId,name,note,tags[],who[],deadline,recur{type,every,day,weekday},checklist[{id,text,done}],archived,done}]
    checklists:[],   // [{id,label,items:[{id,text,done}]}]
  }};
  return id;
}
function getCell(nid,key){
  if(!nodes[nid])return{boardId:null,matrixId:null};
  const d=nodes[nid].data;
  if(!d.cells[key])d.cells[key]={boardId:null,matrixId:null};
  return d.cells[key];
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// STATE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const SAVE_KEY='imatrix-v2';
const DATA_VERSION=1;
let stack=[], editMode=false, mmOpen=false;
let currentTab={}; // nodeId -> tab name
let rootId;

// â”€â”€ File System Access API â”€â”€
let fileHandle=null; // active file handle (null = localStorage mode)
let fileDirty=false;
let fileSaveTimer=null;
const FILE_DEBOUNCE_MS=2000;
const FILE_OPTS={types:[{description:'Matrix JSON',accept:{'application/json':['.json']}}]};
const hasFileAPI=typeof window.showOpenFilePicker==='function';

function getPayload(){return JSON.stringify({version:DATA_VERSION,nodes,nid,rootId,globalTags,globalPeople,dailyCols});}
function getPayloadPretty(){return JSON.stringify({version:DATA_VERSION,nodes,nid,rootId,globalTags,globalPeople,dailyCols},null,2);}

function showSaveStatus(text,color,duration){
  const d=document.getElementById('savedot');if(!d)return;
  d.style.color=color;d.textContent=text;d.style.display='inline';
  clearTimeout(d._t);
  if(duration)d._t=setTimeout(()=>d.style.display='none',duration);
}

function save(){
  const payload=getPayload();
  // Always save to localStorage immediately
  try{localStorage.setItem(SAVE_KEY,payload);}catch(e){}

  if(fileHandle){
    fileDirty=true;
    showSaveStatus('â— ungespeichert','var(--blue)',0); // persistent, no timeout
    clearTimeout(fileSaveTimer);
    fileSaveTimer=setTimeout(()=>flushToFile(),FILE_DEBOUNCE_MS);
  } else {
    const kb=Math.round(payload.length/1024);
    const warn=kb>SAVE_WARN_KB;
    showSaveStatus(
      warn?`âš  localStorage ${kb} KB â€” Datei wÃ¤hlen!`:'âœ“ gespeichert',
      warn?'var(--amber)':'var(--teal)',
      warn?SAVE_WARN_MS:SAVE_INDICATOR_MS
    );
  }
}

async function flushToFile(){
  if(!fileHandle||!fileDirty)return;
  try{
    const writable=await fileHandle.createWritable();
    await writable.write(getPayloadPretty());
    await writable.close();
    fileDirty=false;
    showSaveStatus('âœ“ gespeichert','var(--teal)',SAVE_INDICATOR_MS);
  }catch(e){
    showSaveStatus(`âœ— Schreibfehler: ${fileHandle.name}`,'var(--red)',SAVE_WARN_MS);
  }
  updateFileBtn();
}

async function openFile(){
  if(!hasFileAPI)return;
  try{
    const[handle]=await window.showOpenFilePicker(FILE_OPTS);
    const file=await handle.getFile();
    const text=await file.text();
    const d=JSON.parse(text);
    if(!validateImport(d)){alert('UngÃ¼ltiges Dateiformat.');return;}
    fileHandle=handle;
    loadData(d);save();render();
  }catch(e){
    if(e.name!=='AbortError')alert('Fehler beim Ã–ffnen: '+e.message);
  }
}

async function saveFileAs(){
  if(!hasFileAPI)return;
  try{
    const handle=await window.showSaveFilePicker({...FILE_OPTS,suggestedName:'matrix-data.json'});
    fileHandle=handle;
    fileDirty=true;
    await flushToFile();
    render();
  }catch(e){
    if(e.name!=='AbortError')alert('Fehler beim Speichern: '+e.message);
  }
}

function disconnectFile(){
  fileHandle=null;
  showSaveStatus('âœ“ localStorage','var(--teal)',SAVE_INDICATOR_MS);
  updateFileBtn();
}

function updateFileBtn(){
  const btn=document.getElementById('filebtn');if(!btn)return;
  if(fileHandle){
    btn.textContent='ðŸ“„ '+fileHandle.name;
    btn.title='Verbundene Datei: '+fileHandle.name+' â€” Klick zum Trennen';
    btn.onclick=()=>{if(confirm('Datei trennen? Daten bleiben in localStorage.'))disconnectFile();};
  } else {
    btn.textContent='ðŸ“‚ Datei';
    btn.title='JSON-Datei Ã¶ffnen oder neu anlegen';
    btn.onclick=()=>openFile();
  }
}

function loadData(d){
  nodes=d.nodes; nid=d.nid; rootId=d.rootId;
  globalTags=d.globalTags||[];
  globalPeople=d.globalPeople||[];
  dailyCols=d.dailyCols||[];
  stack=[{nodeId:rootId,label:nodes[rootId].label,cellRef:null}];
}
function tryLoad(){
  try{const r=localStorage.getItem(SAVE_KEY);if(!r)return false;loadData(JSON.parse(r));return true;}catch(e){return false;}
}
function exportJSON(){
  const blob=new Blob([getPayloadPretty()],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='matrix-backup.json';a.click();
}
function validateImport(d){
  if(!d||typeof d!=='object')return false;
  if(!d.nodes||typeof d.nodes!=='object')return false;
  if(typeof d.nid!=='number'||d.nid<1)return false;
  if(!d.rootId||!d.nodes[d.rootId])return false;
  const root=d.nodes[d.rootId];
  if(!root||root.type!=='matrix'||!root.data)return false;
  for(const[id,n]of Object.entries(d.nodes)){
    if(!n.id||!n.type||!n.data)return false;
    if(!['matrix','board','cell'].includes(n.type))return false;
  }
  if(d.globalTags&&!Array.isArray(d.globalTags))return false;
  if(d.globalPeople&&!Array.isArray(d.globalPeople))return false;
  if(d.dailyCols&&!Array.isArray(d.dailyCols))return false;
  return true;
}
function importJSON(e){
  const f=e.target.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=ev=>{try{
    const d=JSON.parse(ev.target.result);
    if(!validateImport(d)){alert('UngÃ¼ltiges Dateiformat â€” Import abgebrochen.');return;}
    loadData(d);save();render();
  }catch(x){alert('UngÃ¼ltige Datei');}};
  r.readAsText(f);
}
function resetAll(){
  if(!confirm('Alle Daten lÃ¶schen?'))return;
  localStorage.removeItem(SAVE_KEY);
  fileHandle=null;
  location.reload();
}

if(!tryLoad()){
  rootId=mkMatrix('Meine Matrix');
  // default daily cols
  dailyCols=[{id:uid(),label:'Heute',type:'today'},{id:uid(),label:'Diese Woche',type:'thisweek'},{id:uid(),label:'Dieser Monat',type:'thismonth'},{id:uid(),label:'NÃ¤chster Monat',type:'nextmonth'}];
  stack=[{nodeId:rootId,label:'Meine Matrix',cellRef:null}];
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// RENDER ROUTER
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function render(){
  try{
    renderBC(); renderMM();
    document.getElementById('editbtn').textContent=editMode?'âœ“ Fertig':'âœŽ Bearbeiten';
    document.getElementById('editbtn').style.color=editMode?'var(--amber)':'';
    const cur=stack[stack.length-1];
    const el=document.getElementById('panel');
    if(cur.cellRef) el.innerHTML=renderCellPage(cur);
    else el.innerHTML=renderMatrixPage(nodes[cur.nodeId]);
  }catch(err){
    console.error('Render error:',err);
    document.getElementById('panel').innerHTML=`<div class="empty-state"><div class="empty-big">âš </div><div>Darstellungsfehler â€” bitte Seite neu laden.</div><div style="font-size:11px;color:var(--text3);margin-top:6px;">${esc(err.message)}</div></div>`;
  }
}

let _animating=false;
function renderAnimated(dir){
  if(_animating){render();return;}
  const p=document.getElementById('panel');
  _animating=true;
  p.classList.add('exit-'+dir);
  setTimeout(()=>{

    p.classList.remove('exit-'+dir);
    render();
    p.classList.add('enter-'+dir);
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      p.classList.remove('enter-'+dir);
      p.classList.add('anim-enter');
      setTimeout(()=>{p.classList.remove('anim-enter');_animating=false;},ANIM_ENTER_MS);
    }));
  },ANIM_EXIT_MS);
}

function getTab(id,def){return currentTab[id]||def;}
function setTab(id,t){currentTab[id]=t;}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// BREADCRUMB & MINIMAP
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function renderBC(){
  document.getElementById('bc').innerHTML=stack.map((s,i)=>{
    const sep=i>0?'<span class="bca">â€º</span>':'';
    return i<stack.length-1
      ?sep+`<span class="bcs" tabindex="0" role="link" onclick="navTo(${i})" onkeydown="if(event.key==='Enter'){event.preventDefault();navTo(${i});}">${esc(s.label)}</span>`
      :sep+`<span class="bcc">${esc(s.label)}</span>`;
  }).join('');
}
function navTo(i){stack=stack.slice(0,i+1);renderAnimated('out');}

function renderMM(){
  function walk(nodeId,depth){
    const n=nodes[nodeId];if(!n||nodeId.startsWith('cell-'))return'';
    const color=n.type==='board'?'#1D9E75':'#378ADD';
    const active=nodeId===stack[stack.length-1].nodeId;
    let h=`<div class="mm-node${active?' active':''}" style="padding-left:${depth*10}px" tabindex="0" role="link" onclick="mmNav('${nodeId}')" onkeydown="if(event.key==='Enter'){event.preventDefault();mmNav('${nodeId}');}"><div class="mm-dot" style="background:${color}"></div><span>${esc(n.label)}</span></div>`;
    if(n.type==='matrix')Object.values(n.data.cells).forEach(c=>{if(c.boardId)h+=walk(c.boardId,depth+1);if(c.matrixId)h+=walk(c.matrixId,depth+1);});
    return h;
  }
  document.getElementById('mmtree').innerHTML=walk(stack[0].nodeId,0);
}
function toggleMM(){mmOpen=!mmOpen;document.getElementById('minimap-panel').classList.toggle('open',mmOpen);renderMM();}
function mmNav(nodeId){
  const target=nodes[nodeId];if(!target)return;
  // For boards/sub-matrices: find their parent cell and open via openCell
  if(target.type==='board'||target.type==='matrix'){
    for(const[nid,n]of Object.entries(nodes)){
      if(n.type!=='matrix')continue;
      for(const[k,c]of Object.entries(n.data.cells)){
        const match=(c.boardId===nodeId)?'board':(c.matrixId===nodeId)?'matrix':null;
        if(match){
          const[rowId,colId]=k.split('-');
          // First navigate to parent matrix
          function findPath(from,tgt,path){
            if(from===tgt)return[...path,from];
            const nd=nodes[from];if(!nd||nd.type!=='matrix')return null;
            for(const[key,cell]of Object.entries(nd.data.cells)){
              for(const cid of[cell.boardId,cell.matrixId]){if(!cid)continue;const r=findPath(cid,tgt,[...path,from]);if(r)return r;}
            }return null;
          }
          const parentPath=findPath(stack[0].nodeId,nid,[]);
          if(parentPath){
            stack=parentPath.map(id=>({nodeId:id,label:nodes[id].label,cellRef:null}));
            mmOpen=false;document.getElementById('minimap-panel').classList.remove('open');
            openCell(nid,rowId,colId,target.label,match==='board'?'board':'matrix');
            return;
          }
        }
      }
    }
  }
  // For matrix nodes: direct navigation
  function findPath(from,tgt,path){
    if(from===tgt)return[...path,from];
    const n=nodes[from];if(!n||n.type!=='matrix')return null;
    for(const[k,c]of Object.entries(n.data.cells)){
      for(const cid of[c.boardId,c.matrixId]){if(!cid)continue;const r=findPath(cid,tgt,[...path,from]);if(r)return r;}
    }return null;
  }
  const path=findPath(stack[0].nodeId,nodeId,[]);if(!path)return;
  stack=path.map(id=>({nodeId:id,label:nodes[id].label,cellRef:null}));
  mmOpen=false;document.getElementById('minimap-panel').classList.remove('open');renderAnimated('in');
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// MATRIX PAGE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function renderMatrixPage(node){
  const{rows,cols}=node.data;
  const isRoot=node.id===rootId;
  let h=`<div class="phd">
    <div style="flex:1;min-width:0;">
      ${editMode
        ?`<input class="ptitle" style="border:none;outline:none;background:transparent;font-size:17px;font-weight:500;width:100%;font-family:inherit;" value="${esc(node.label)}" onchange="renameMatrixNode('${node.id}',this.value)" />`
        :`<div class="ptitle">${esc(node.label)}</div>`}
      <div class="psub">Hover auf Zelle â†’ Tasks / Sub-Matrix anlegen</div>
    </div>
    <div style="display:flex;gap:6px;flex-shrink:0;">
      <button class="btn edit-only" onclick="addCol('${node.id}')">+ Spalte</button>
      <button class="btn edit-only" onclick="addRow('${node.id}')">+ Zeile</button>
    </div></div>`;

  if(rows.length===0&&cols.length===0){
    h+=`<div class="empty-state"><div class="empty-big">âŠž</div><div style="margin-bottom:10px;">Leere Matrix â€” leg los.</div>
      <div style="display:flex;gap:8px;justify-content:center;">
        <button class="btn edit-only" onclick="addCol('${node.id}')">+ Spalte</button>
        <button class="btn edit-only" onclick="addRow('${node.id}')">+ Zeile</button>
      </div></div>`;
  } else {
    const gc=`110px repeat(${cols.length},minmax(110px,1fr))${editMode?' 36px':''}`;
    h+=`<div class="mwrap"><div class="matrix${editMode?' emode':''}" style="grid-template-columns:${gc};">`;
    h+=`<div class="mh corner"></div>`;
    cols.forEach(col=>{
      h+=`<div class="mh ch"><input class="ni" value="${esc(col.label)}" onchange="renameCol('${node.id}','${col.id}',this.value)" ${editMode?'':'readonly'} style="text-align:center;"/>
        <span class="edel" onclick="delCol('${node.id}','${col.id}')">âœ•</span></div>`;
    });
    if(editMode)h+=`<div class="addcolhdr"><button class="addbtn" onclick="addCol('${node.id}')">+</button></div>`;
    rows.forEach(row=>{
      h+=`<div class="mh rh"><input class="ni" value="${esc(row.label)}" onchange="renameRow('${node.id}','${row.id}',this.value)" ${editMode?'':'readonly'}/>
        <span class="edel" onclick="delRow('${node.id}','${row.id}')">âœ•</span></div>`;
      cols.forEach(col=>{h+=cellHTML(node.id,row,col);});
      if(editMode)h+=`<div class="addrowcol"></div>`;
    });
    if(editMode)h+=`<div class="addrowfull"><button class="addbtn" onclick="addRow('${node.id}')">+</button></div>`;
    h+=`</div></div>`;
  }

  // Daily overview only on root
  if(isRoot) h+=renderDailyOverview();
  return h;
}

function cellHTML(nodeId,row,col){
  const key=`${row.id}-${col.id}`;
  const cell=getCell(nodeId,key);
  const hb=!!cell.boardId, hm=!!cell.matrixId;
  const lbl=esc(row.label+' / '+col.label);

  // SVG icons â€” larger when active
  const bicoSm=`<svg width="11" height="11" viewBox="0 0 14 14" fill="none"><line x1="2" y1="4" x2="12" y2="4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><line x1="2" y1="7.5" x2="12" y2="7.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><line x1="2" y1="11" x2="8" y2="11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
  const micoSm=`<svg width="11" height="11" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="8" y="1" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="1" y="8" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="8" y="8" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/></svg>`;
  const bicoLg=`<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><line x1="2" y1="4" x2="12" y2="4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><line x1="2" y1="7.5" x2="12" y2="7.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><line x1="2" y1="11" x2="8" y2="11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
  const micoLg=`<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="8" y="1" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="1" y="8" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="8" y="8" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/></svg>`;

  let boardBadge='', matrixBadge='', bottomHints='';

  const hasBoth=hb&&hm;

  // â”€â”€ BOARD (immer Zeile 1) â”€â”€
  if(hb){
    const b=nodes[cell.boardId];
    const active=b.data.kbCards.filter(c=>!c.archived);
    const tot=active.length;
    const dn=active.filter(c=>c.done).length;
    const hasRecur=active.some(c=>c.recur&&c.recur.type!=='none');
    const solo=!hasBoth?'flex:1;':'';
    boardBadge=`<div style="display:flex;align-items:center;gap:5px;background:var(--tealbg);color:var(--tealtxt);border-radius:var(--r);padding:4px 7px;cursor:pointer;transition:filter 0.1s;${solo}" onmouseenter="this.style.filter='brightness(0.95)'" onmouseleave="this.style.filter=''" onclick="iconClick('${nodeId}','${row.id}','${col.id}','board','${lbl}')">
      ${bicoLg}
      <span style="font-size:11px;font-weight:500;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(b.label)}</span>
      <span style="font-size:10px;opacity:0.8;">${dn}/${tot}${hasRecur?' â†»':''}</span>
      ${editMode?`<span class="edel" style="display:inline;color:var(--tealtxt);opacity:0.6;font-size:11px;" onclick="event.stopPropagation();delCellChild('${nodeId}','${row.id}','${col.id}','board')" title="Board lÃ¶schen">âœ•</span>`:''}
    </div>`;
  } else {
    bottomHints+=`<span class="cell-ghost edit-only" onclick="iconClick('${nodeId}','${row.id}','${col.id}','board','${lbl}')" title="Task Board anlegen">${bicoSm}</span>`;
  }

  // â”€â”€ MATRIX (immer Zeile 2) â”€â”€
  if(hm){
    const m=nodes[cell.matrixId];
    const solo=!hasBoth?'flex:1;':'';
    matrixBadge=`<div style="display:flex;align-items:center;gap:5px;background:var(--bluebg);color:var(--bluetxt);border-radius:var(--r);padding:4px 7px;cursor:pointer;transition:filter 0.1s;${solo}" onmouseenter="this.style.filter='brightness(0.95)'" onmouseleave="this.style.filter=''" onclick="iconClick('${nodeId}','${row.id}','${col.id}','matrix','${lbl}')">
      ${micoLg}
      <span style="font-size:11px;font-weight:500;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(m.label)}</span>
      <span style="font-size:10px;opacity:0.8;">${m.data.rows.length}Ã—${m.data.cols.length}</span>
      ${editMode?`<span class="edel" style="display:inline;color:var(--bluetxt);opacity:0.6;font-size:11px;" onclick="event.stopPropagation();delCellChild('${nodeId}','${row.id}','${col.id}','matrix')" title="Sub-Matrix lÃ¶schen">âœ•</span>`:''}
    </div>`;
  } else {
    bottomHints+=`<span class="cell-ghost edit-only" onclick="iconClick('${nodeId}','${row.id}','${col.id}','matrix','${lbl}')" title="Sub-Matrix anlegen">${micoSm}</span>`;
  }

  // Feste Reihenfolge: Board oben, Matrix unten
  const topBadges=boardBadge+(boardBadge&&matrixBadge?`<div style="height:3px;"></div>`:'')+matrixBadge;

  // Enter key: open first available child (board preferred)
  const enterAction=hb
    ?`iconClick('${nodeId}','${row.id}','${col.id}','board','${lbl}')`
    :hm?`iconClick('${nodeId}','${row.id}','${col.id}','matrix','${lbl}')`:'' ;

  return `<div class="mcell" style="justify-content:space-between;" tabindex="0" data-row="${row.id}" data-col="${col.id}" data-node="${nodeId}"
    data-enter-node="${nodeId}" data-enter-row="${row.id}" data-enter-col="${col.id}" data-enter-type="${hb?'board':hm?'matrix':''}" data-enter-lbl="${lbl}"
    onkeydown="mcellKeydown(event,this)">
    <div style="flex:1;display:flex;flex-direction:column;">${topBadges}</div>
    ${bottomHints?`<div class="cell-ghosts">${bottomHints}</div>`:''}
  </div>`;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// CELL PAGE (tabs: Info | Kanban | Checklisten)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function renderCellPage(cur){
  const{parentId,rowId,colId}=cur.cellRef;
  const cell=getCell(parentId,`${rowId}-${colId}`);
  const hb=!!cell.boardId,hm=!!cell.matrixId;
  const tab=getTab(cur.nodeId, hb?'board':'matrix');
  // Find the boardId or matrixId to allow renaming
  const _cell=cur.cellRef?getCell(cur.cellRef.parentId,`${cur.cellRef.rowId}-${cur.cellRef.colId}`):null;
  const _renamableId=_cell?(tab==='board'?_cell.boardId:_cell.matrixId):null;
  const _exportId=tab==='board'?cell.boardId:cell.matrixId;
  const _exportType=tab==='board'?'board':'matrix';
  let h=`<div class="phd"><div style="flex:1;min-width:0;">
    ${editMode&&_renamableId
      ?`<input class="ptitle" style="border:none;outline:none;background:transparent;font-size:17px;font-weight:500;width:100%;font-family:inherit;" value="${esc(cur.label)}" onchange="renameBoardOrMatrix('${_renamableId}',this.value,'${cur.nodeId}')" />`
      :`<div class="ptitle">${esc(cur.label)}</div>`}
  </div>
  ${editMode?`<div style="display:flex;gap:5px;flex-shrink:0;align-items:center;">
    ${_exportId?`<button class="btn" style="font-size:11px;" onclick="exportNode('${_exportId}')">â†“ Export</button>`:''}
    <label class="btn" style="font-size:11px;cursor:pointer;">â†‘ Import<input type="file" accept=".json" style="display:none;" onchange="importNode(event,'${parentId}','${rowId}','${colId}','${_exportType}')"/></label>
  </div>`:''}
  </div>`;
  h+=`<div class="tabs">`;
  if(hb){
    const b=nodes[cell.boardId];
    const tot=b.data.kbCards.filter(c=>!c.archived).length;
    h+=tabBtn('info',tab,cur.nodeId,'ðŸ“‹ Info');
    h+=tabBtn('board',tab,cur.nodeId,`â˜° Kanban <span class="tbadge">${tot}</span>`);
    const cl=b.data.checklists.reduce((a,c)=>a+c.items.length,0);
    h+=tabBtn('checklists',tab,cur.nodeId,`âœ“ Checklisten <span class="tbadge">${cl}</span>`);
  }
  if(hm){h+=tabBtn('matrix',tab,cur.nodeId,'âŠž Sub-Matrix');}
  h+=`</div>`;
  if(tab==='info'&&hb) h+=renderInfoTab(nodes[cell.boardId]);
  else if(tab==='board'&&hb) h+=renderKanban(nodes[cell.boardId]);
  else if(tab==='checklists'&&hb) h+=renderChecklists(nodes[cell.boardId]);
  else if(tab==='matrix'&&hm) h+=renderSubMatrix(nodes[cell.matrixId]);
  return h;
}
function tabBtn(name,cur,nodeId,label){
  return `<div class="tab${cur===name?' active':''}" tabindex="0" role="tab" onclick="switchTab('${nodeId}','${name}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();switchTab('${nodeId}','${name}');}">${label}</div>`;
}
function switchTab(nodeId,tab){setTab(nodeId,tab);renderAnimated('fade');}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// INFO TAB
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function renderInfoTab(node){
  const{infoFields,links}=node.data;
  let h=`<div class="card">`;
  h+=`<div class="cardhd">Info-Felder ${editMode?`<button class="btn" style="margin-left:auto;padding:3px 8px;" onclick="addInfoField('${node.id}')">+ Feld</button>`:''}`;
  h+=`</div>`;
  if(infoFields.length===0&&!editMode) h+=`<div style="padding:12px 13px;font-size:12px;color:var(--text3);">Keine Felder â€” Bearbeiten-Modus zum Anlegen.</div>`;
  infoFields.forEach((f,idx)=>{
    h+=`<div class="info-field">
      <div style="display:flex;align-items:center;gap:6px;">
        ${editMode?`<div style="display:flex;flex-direction:column;gap:1px;margin-right:2px;">
          <span style="font-size:9px;color:var(--text3);cursor:pointer;line-height:1;" onclick="moveInfoField('${node.id}','${f.id}',-1)" title="Nach oben">â–²</span>
          <span style="font-size:9px;color:var(--text3);cursor:pointer;line-height:1;" onclick="moveInfoField('${node.id}','${f.id}',1)" title="Nach unten">â–¼</span>
        </div>`:''}
        <span class="info-label">${esc(f.label)}</span>
        ${editMode?`<span style="font-size:11px;color:var(--red);cursor:pointer;margin-left:auto;" onclick="delInfoField('${node.id}','${f.id}')">âœ•</span>`:''}
      </div>
      <div class="info-val" contenteditable="true" onblur="saveInfoField('${node.id}','${f.id}',this.innerHTML)">${sanitizeHtml(f.value)||''}</div>
    </div>`;
  });
  h+=`</div>`;

  // Links block
  h+=`<div class="card" style="margin-top:8px;">`;
  h+=`<div class="cardhd">Links & AbsprÃ¼nge</div>`;
  h+=`<div class="links-grid">`;
  links.forEach(l=>{
    if(l.type==='mail'){
      const mailto=buildMailto(l);
      h+=`<a class="link-btn" href="${esc(mailto)}" style="color:var(--tealtxt);">
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 4l6 4 6-4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><rect x="1" y="3" width="12" height="8" rx="1.5" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>
        ${esc(l.label)}
        ${editMode?`<span onclick="event.preventDefault();editMailTemplate('${node.id}','${l.id}')" style="color:var(--text3);margin-left:4px;" title="Bearbeiten">âœŽ</span>`:''}
        ${editMode?`<span onclick="event.preventDefault();delLink('${node.id}','${l.id}')" style="color:var(--red);margin-left:4px;">âœ•</span>`:''}
      </a>`;
    } else {
      h+=`<a class="link-btn" href="${esc(sanitizeUrl(l.url)||'#')}" target="_blank" rel="noopener">
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M6 3H3a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1V8" stroke="currentColor" stroke-width="1.3"/><path d="M9 1h4m0 0v4m0-4L7 7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        ${esc(l.label)}
        ${editMode?`<span onclick="event.preventDefault();delLink('${node.id}','${l.id}')" style="color:var(--red);margin-left:4px;">âœ•</span>`:''}
      </a>`;
    }
  });
  h+=`<span class="link-btn link-add" onclick="addLink('${node.id}')">+ Link</span>`;
  h+=`<span class="link-btn link-add" onclick="addMailTemplate('${node.id}')" style="color:var(--tealtxt);">âœ‰ Mailvorlage</span>`;
  h+=`</div></div>`;
  return h;
}
function addInfoField(boardId){
  smodal('Neues Feld',[{label:'Feldname',id:'l',ph:'z.B. Kunde'}],v=>{
    if(!v.l)return;
    nodes[boardId].data.infoFields.push({id:uid(),label:v.l,value:''});
    save();render();
  });
}
function delInfoField(boardId,fid){nodes[boardId].data.infoFields=nodes[boardId].data.infoFields.filter(f=>f.id!==fid);save();render();}
function moveInfoField(boardId,fid,dir){
  const arr=nodes[boardId].data.infoFields;
  const idx=arr.findIndex(f=>f.id===fid);
  const newIdx=idx+dir;
  if(newIdx<0||newIdx>=arr.length)return;
  const tmp=arr[idx];arr[idx]=arr[newIdx];arr[newIdx]=tmp;
  save();render();
}
function saveInfoField(boardId,fid,val){const f=nodes[boardId].data.infoFields.find(x=>x.id===fid);if(f)f.value=sanitizeHtml(val);save();}
function addLink(boardId){
  smodal('Neuer Link',[{label:'Bezeichnung',id:'l',ph:'z.B. Confluence'},{label:'URL',id:'u',ph:'https://...'}],v=>{
    if(!v.u)return;
    const safeUrl=sanitizeUrl(v.u);if(!safeUrl)return;
    nodes[boardId].data.links.push({id:uid(),label:v.l||safeUrl,url:safeUrl});
    save();render();
  });
}
function delLink(boardId,lid){nodes[boardId].data.links=nodes[boardId].data.links.filter(l=>l.id!==lid);save();render();}
function buildMailto(l){
  const params=[];
  if(l.cc)params.push('cc='+encodeURIComponent(l.cc));
  if(l.bcc)params.push('bcc='+encodeURIComponent(l.bcc));
  if(l.subject)params.push('subject='+encodeURIComponent(l.subject));
  if(l.body)params.push('body='+encodeURIComponent(l.body));
  return'mailto:'+(l.to||'')+(params.length?'?'+params.join('&'):'');
}
function addMailTemplate(boardId){
  const id=uid();
  nodes[boardId].data.links.push({id,type:'mail',label:'Neue Mail',to:'',cc:'',bcc:'',subject:'',body:''});
  save();editMailTemplate(boardId,id);
}
function editMailTemplate(boardId,linkId){
  const link=nodes[boardId].data.links.find(l=>l.id===linkId);if(!link)return;
  let h=`<div class="smodal-overlay" onclick="closeS(event)"><div class="smodal" style="width:420px;"><h3>âœ‰ Mailvorlage</h3>`;
  h+=`<label>Bezeichnung</label><input id="mf-ml" value="${esc(link.label)}"/>`;
  h+=`<label>An (To)</label><input id="mf-to" value="${esc(link.to||'')}" placeholder="empfaenger@firma.de"/>`;
  h+=`<label>CC</label><input id="mf-cc" value="${esc(link.cc||'')}" placeholder="cc@firma.de"/>`;
  h+=`<label>BCC</label><input id="mf-bcc" value="${esc(link.bcc||'')}" placeholder="bcc@firma.de"/>`;
  h+=`<label>Betreff</label><input id="mf-subj" value="${esc(link.subject||'')}" placeholder="Betreff..."/>`;
  h+=`<label>Nachricht</label><textarea id="mf-body" style="width:100%;font-size:13px;padding:7px 9px;border:0.5px solid var(--border2);border-radius:var(--r);min-height:80px;resize:vertical;font-family:inherit;outline:none;">${esc(link.body||'')}</textarea>`;
  h+=`<div class="smodal-actions"><button class="btn-c" onclick="closeS()">Abbrechen</button><button class="btn-p" onclick="saveMailTemplate('${boardId}','${linkId}')">Speichern</button></div></div></div>`;
  document.getElementById('mc').innerHTML=h;
  setTimeout(()=>{const el=document.getElementById('mf-ml');if(el){el.focus();el.select();}},MODAL_FOCUS_DELAY_MS);
}
function saveMailTemplate(boardId,linkId){
  const link=nodes[boardId].data.links.find(l=>l.id===linkId);if(!link)return;
  link.label=document.getElementById('mf-ml')?.value||'Mail';
  link.to=document.getElementById('mf-to')?.value||'';
  link.cc=document.getElementById('mf-cc')?.value||'';
  link.bcc=document.getElementById('mf-bcc')?.value||'';
  link.subject=document.getElementById('mf-subj')?.value||'';
  link.body=document.getElementById('mf-body')?.value||'';
  document.getElementById('mc').innerHTML='';
  save();render();
}

// â”€â”€ NODE EXPORT / IMPORT â”€â”€
function collectNodeTree(nodeId){
  const collected={};
  function walk(id){
    const n=nodes[id];if(!n||collected[id])return;
    collected[id]=JSON.parse(JSON.stringify(n));
    if(n.type==='matrix'){
      Object.values(n.data.cells).forEach(c=>{
        if(c.boardId)walk(c.boardId);
        if(c.matrixId)walk(c.matrixId);
      });
    }
  }
  walk(nodeId);
  return collected;
}
function exportNode(nodeId){
  const n=nodes[nodeId];if(!n)return;
  const tree=collectNodeTree(nodeId);
  const payload={exportType:n.type,rootId:nodeId,nodes:tree,exportDate:new Date().toISOString()};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=(n.label||n.type)+'-export.json';
  a.click();
}
function importNode(e,parentId,rowId,colId,targetType){
  const f=e.target.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=ev=>{
    try{
      const d=JSON.parse(ev.target.result);
      if(!d.nodes||!d.rootId||!d.nodes[d.rootId]){alert('UngÃ¼ltiges Export-Format.');return;}
      const srcRoot=d.nodes[d.rootId];
      // Remap all IDs to avoid conflicts
      const idMap={};
      Object.keys(d.nodes).forEach(oldId=>{idMap[oldId]=uid();});
      // Rebuild nodes with new IDs
      Object.entries(d.nodes).forEach(([oldId,node])=>{
        const newNode=JSON.parse(JSON.stringify(node));
        newNode.id=idMap[oldId];
        // Remap cell references
        if(newNode.type==='matrix'&&newNode.data.cells){
          const newCells={};
          Object.entries(newNode.data.cells).forEach(([k,c])=>{
            if(c.boardId&&idMap[c.boardId])c.boardId=idMap[c.boardId];
            if(c.matrixId&&idMap[c.matrixId])c.matrixId=idMap[c.matrixId];
            newCells[k]=c;
          });
          newNode.data.cells=newCells;
        }
        // Remap kanban card IDs
        if(newNode.type==='board'&&newNode.data.kbCards){
          newNode.data.kbCards.forEach(c=>{c.id=uid();});
          newNode.data.kbCols.forEach(c=>{
            const oldColId=c.id;c.id=uid();
            newNode.data.kbCards.forEach(card=>{if(card.colId===oldColId)card.colId=c.id;});
          });
          (newNode.data.checklists||[]).forEach(cl=>{cl.id=uid();cl.items.forEach(i=>{i.id=uid();});});
          (newNode.data.infoFields||[]).forEach(f=>{f.id=uid();});
          (newNode.data.links||[]).forEach(l=>{l.id=uid();});
        }
        nodes[newNode.id]=newNode;
      });
      // Attach to cell
      const key=`${rowId}-${colId}`;
      const cell=getCell(parentId,key);
      const newRootId=idMap[d.rootId];
      if(srcRoot.type==='board'){
        if(cell.boardId&&!confirm('Bestehendes Board Ã¼berschreiben?'))return;
        if(cell.boardId)delete nodes[cell.boardId];
        cell.boardId=newRootId;
      } else if(srcRoot.type==='matrix'){
        if(cell.matrixId&&!confirm('Bestehende Sub-Matrix Ã¼berschreiben?'))return;
        if(cell.matrixId)removeTree(cell.matrixId);
        cell.matrixId=newRootId;
      }
      save();render();
    }catch(x){alert('Fehler beim Import: '+x.message);}
  };
  r.readAsText(f);
  e.target.value=''; // reset file input
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// KANBAN
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function renderKanban(node){
  const{kbCols,kbCards}=node.data;
  // Filter: show non-archived in columns, archived in Archiv col
  let h=`<div style="margin-bottom:10px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
    <button class="btn" onclick="addKbCard('${node.id}')">+ Karte</button>
    <button class="btn edit-only" onclick="addKbCol('${node.id}')">+ Spalte</button>
    <span id="kb-no-col-hint" style="display:none;font-size:12px;color:var(--amber);padding:4px 8px;background:var(--amberbg);border-radius:var(--r);">Erst eine Spalte anlegen</span>
  </div>`;
  h+=`<div class="kb-wrap">`;
  kbCols.forEach(col=>{
    const cards=kbCards.filter(c=>c.colId===col.id&&!c.archived);
    const colColor=col.color||'';
    h+=`<div class="kb-col" style="border-top:${colColor?`3px solid ${colColor}`:'0.5px solid var(--border2)'};border-radius:var(--rl);">
      <div class="kb-col-hd">
        ${colColor?`<span style="width:8px;height:8px;border-radius:50%;background:${colColor};flex-shrink:0;display:inline-block;"></span>`:''}
        ${editMode?`<input class="ni" value="${esc(col.label)}" onchange="renameKbCol('${node.id}','${col.id}',this.value)" style="font-size:12px;font-weight:500;"/>`:`<span>${esc(col.label)}</span>`}
        <span class="cnt">${cards.length}</span>
        ${editMode?`<span style="font-size:11px;color:var(--text3);cursor:pointer;margin-left:2px;" onclick="editKbColColor('${node.id}','${col.id}')">ðŸŽ¨</span>`:''}
        <span class="delbtn" onclick="delKbCol('${node.id}','${col.id}')">âœ•</span>
      </div>
      <div class="kb-cards" data-col-id="${col.id}" data-board-id="${node.id}" ondragover="dragOver(event)" ondragleave="dragLeave(event)" ondrop="dragDrop(event)">`;
    cards.forEach(card=>{h+=kbCardHTML(node.id,card);});
    h+=`</div>
      <div class="kb-add-card"><button class="addfull" onclick="addKbCardToCol('${node.id}','${col.id}')">+ Karte</button></div>
    </div>`;
  });
  // Archiv column â€” compact cards
  const archived=kbCards.filter(c=>c.archived);
  h+=`<div class="kb-col">
    <div class="kb-col-hd"><span>Archiv</span><span class="cnt">${archived.length}</span></div>
    <div class="kb-cards" style="${archived.length>ARCHIVE_SCROLL_THRESHOLD?'max-height:'+ARCHIVE_SCROLL_HEIGHT+';overflow-y:auto;scrollbar-width:thin;':''}">`;
  archived.forEach(card=>{
    const doneTag=card.doneDate?`<span class="kc-recur" style="background:var(--tealbg);color:var(--tealtxt);font-size:9px;">âœ“ ${fmtDate(card.doneDate)}</span>`
      :(card.doneOccurrences&&card.doneOccurrences.length>0?`<span class="kc-recur" style="background:var(--tealbg);color:var(--tealtxt);font-size:9px;">âœ“ ${fmtDate([...card.doneOccurrences].sort().reverse()[0])}</span>`:'');
    h+=`<div class="kb-card archived" tabindex="0" onclick="openCard('${node.id}','${card.id}')" style="padding:6px 8px;">
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="font-size:12px;color:var(--text3);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(card.name)||'(ohne Name)'}</span>
        ${doneTag}
      </div>
    </div>`;
  });
  h+=`</div></div>`;
  // Add col button
  h+=`<div class="kb-add-col edit-only"><button class="addfull" style="height:48px;" onclick="addKbCol('${node.id}')">+ Spalte</button></div>`;
  h+=`</div>`;
  return h;
}

function kbCardHTML(boardId,card){
  const now=new Date();now.setHours(0,0,0,0);
  let dlBadge='';
  if(card.deadline){
    const dl=new Date(card.deadline);dl.setHours(0,0,0,0);
    const overdue=dl<now&&!card.done;
    dlBadge=`<span class="kc-dl${overdue?' overdue':''}">ðŸ“… ${fmtDate(card.deadline)}</span>`;
  }
  let recurBadge='';
  if(card.recur&&card.recur.type!=='none'){
    const now7=new Date();now7.setDate(now7.getDate()+7);
    const endingSoon=card.recur.endType==='date'&&card.recur.endDate&&new Date(card.recur.endDate)<=now7;
    const endedCount=card.recur.endType==='count'&&card.recur.endCount&&card.recur.startDate&&(()=>{
      const sd=new Date(card.recur.startDate);sd.setHours(0,0,0,0);
      const nd=new Date();nd.setHours(0,0,0,0);
      let cnt=0;const d=new Date(sd);
      while(d<=nd){if(recurFiresOn(card.recur,d))cnt++;d.setDate(d.getDate()+1);}
      return cnt>=card.recur.endCount;
    })();
    const warn=endingSoon||endedCount;
    recurBadge=`<span class="kc-recur" style="${warn?'background:var(--amberbg);color:var(--ambertxt);':''}">â†» ${recurLabel(card.recur,true)}</span>`;
  }
  // Last done badge â€” occurrence-based for recurring, doneDate for one-off
  let lastDoneBadge='';
  const doneOcc=card.doneOccurrences||[];
  if(doneOcc.length>0){
    const last=[...doneOcc].sort().reverse()[0];
    lastDoneBadge=`<span class="kc-recur" style="background:var(--tealbg);color:var(--tealtxt);">âœ“ ${fmtDate(last)}</span>`;
  } else if(card.done&&card.doneDate){
    lastDoneBadge=`<span class="kc-recur" style="background:var(--tealbg);color:var(--tealtxt);">âœ“ ${fmtDate(card.doneDate)}</span>`;
  }
  const cl=card.checklist||[];
  const clDone=cl.filter(x=>x.done).length;
  const cols=nodes[boardId].data.kbCols;
  const colIdx=cols.findIndex(col=>col.id===card.colId);
  const canLeft=colIdx>0;
  const canRight=colIdx<cols.length-1;
  // Priority dot
  const prioDot=card.priority?`<span style="width:8px;height:8px;border-radius:50%;background:${PRIO_COLORS[card.priority]||'transparent'};display:inline-block;flex-shrink:0;margin-top:3px;" title="${card.priority}"></span>`:'';
  return `<div class="kb-card${card.archived?' archived':''}${card.done?' kb-done':''}" tabindex="0" draggable="${card.archived?'false':'true'}" data-card-id="${card.id}" data-board-id="${boardId}" onclick="openCard('${boardId}','${card.id}')" onkeydown="kbCardKeydown(event,'${boardId}','${card.id}')" ondragstart="dragStart(event)" ondragend="dragEnd(event)">
    <div style="display:flex;align-items:flex-start;gap:5px;">
      ${prioDot}
      <div style="flex:1;min-width:0;">
        <div class="kc-name" style="${card.done?'text-decoration:line-through;color:var(--text3)':''}">${esc(card.name)}</div>
        ${card.note?`<div style="font-size:11px;color:var(--text2);margin-top:2px;">${esc(stripHtml(card.note)).slice(0,NOTE_TRUNCATE)}${stripHtml(card.note).length>NOTE_TRUNCATE?'â€¦':''}</div>`:''}
      </div>
    </div>
    <div class="kc-meta">
      ${(card.tags||[]).map(t=>`<span class="kc-tag">${esc(t)}</span>`).join('')}
      ${(card.who||[]).map(w=>`<span class="kc-who">${esc(w)}</span>`).join('')}
      ${dlBadge}${recurBadge}${lastDoneBadge}
      ${cl.length?`<span class="kc-checklist">âœ“ ${clDone}/${cl.length}</span>`:''}
    </div>
    <div class="kc-actions" onclick="event.stopPropagation()">
      <span class="kc-act${canLeft?'':' disabled'}" onclick="${canLeft?`moveCard('${boardId}','${card.id}',-1)`:''}" title="Spalte zurÃ¼ck">â†</span>
      <span class="kc-act${canRight?'':' disabled'}" onclick="${canRight?`moveCard('${boardId}','${card.id}',1)`:''}" title="Spalte vor">â†’</span>
      <span style="margin-left:auto;"></span>
      <div class="cl-check${card.done?' done':''}" onclick="quickDoneCard(event,'${boardId}','${card.id}')" title="${card.done?'WiedererÃ¶ffnen':'Erledigt'}" style="width:13px;height:13px;margin-top:0;"></div>
    </div>
  </div>`;
}

function recurLabel(r,short){
  if(!r||r.type==='none')return'';
  const WD=WEEKDAY_SHORT;
  const ORD=['','1.','2.','3.','4.','letzten'];
  const MON=MONTH_SHORT;
  const every=r.every||1;
  let base='';
  if(r.type==='daily') base=every===1?'tÃ¤glich':`alle ${every} Tage`;
  else if(r.type==='weekly'){
    const days=(r.weekdays||[r.weekday||0]).map(i=>WD[i]).join(', ');
    base=every===1?`wÃ¶chentlich (${days})`:`alle ${every} Wo. (${days})`;
  }
  else if(r.type==='monthly'){
    const ord=r.weekdayOrd||-99;
    const ordLabel=ord===-1?'letzten':(ORD[ord]||'1.');
    base=r.monthType==='weekday'
      ?`monatl. (${ordLabel} ${WD[r.weekday||0]})`
      :`monatl. (am ${r.day||1}.)`;
  }
  else if(r.type==='yearly'){
    const m=MON[r.yearMonth!==undefined?r.yearMonth:0];
    base=r.monthType==='weekday'
      ?`jÃ¤hrl. (${r.weekdayOrd===-1?'letzter':'1.'} ${WD[r.weekday||0]} ${m})`
      :`jÃ¤hrl. (${r.yearDay||1}. ${m})`;
  }
  if(short)return base;
  // Append end info
  if(r.endType==='date'&&r.endDate) base+=` Â· bis ${fmtDate(r.endDate)}`;
  else if(r.endType==='count'&&r.endCount) base+=` Â· ${r.endCount}Ã—`;
  return base;
}

const KB_COL_COLORS=[['','Standard'],['#E24B4A','Rot'],['#BA7517','Orange'],['#1D9E75','GrÃ¼n'],['#378ADD','Blau'],['#7F77DD','Lila'],['#888780','Grau']];
function addKbCol(boardId){
  smodal('Neue Spalte',[
    {label:'Name',id:'l',ph:'z.B. In Review'},
    {label:'Farbe',id:'clr',sel:KB_COL_COLORS.map(x=>x[0]),sellabels:KB_COL_COLORS.map(x=>x[1])}
  ],v=>{
    if(!v.l)return;
    nodes[boardId].data.kbCols.push({id:uid(),label:v.l,color:v.clr||''});
    save();render();
  });
}
function renameKbCol(boardId,colId,val){const c=nodes[boardId].data.kbCols.find(x=>x.id===colId);if(c)c.label=val;save();}
function editKbColColor(boardId,colId){
  smodal('Spaltenfarbe',[
    {label:'Farbe',id:'clr',sel:KB_COL_COLORS.map(x=>x[0]),sellabels:KB_COL_COLORS.map(x=>x[1])}
  ],v=>{
    const col=nodes[boardId].data.kbCols.find(x=>x.id===colId);
    if(col){col.color=v.clr||'';save();render();}
  });
}
function delKbCol(boardId,colId){
  if(!confirm('Spalte lÃ¶schen? Karten bleiben erhalten (werden archiviert).'))return;
  const b=nodes[boardId].data;
  b.kbCards.filter(c=>c.colId===colId).forEach(c=>c.archived=true);
  b.kbCols=b.kbCols.filter(c=>c.id!==colId);
  save();render();
}
function addKbCard(boardId){
  const b=nodes[boardId].data;
  const colId=b.kbCols[0]?.id||null;
  if(!colId){
    // Show inline hint instead of alert
    const hint=document.getElementById('kb-no-col-hint');
    if(hint){hint.style.display='block';setTimeout(()=>hint.style.display='none',HINT_DISPLAY_MS);}
    return;
  }
  openNewCard(boardId,colId);
}
function addKbCardToCol(boardId,colId){openNewCard(boardId,colId);}
function openNewCard(boardId,colId){
  const card={id:uid(),colId,name:'',note:'',tags:[],who:[],deadline:'',recur:{type:'none'},checklist:[],archived:false,done:false,priority:''};
  nodes[boardId].data.kbCards.push(card);
  openCard(boardId,card.id);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// CARD DETAIL MODAL
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function openCard(boardId,cardId){
  if(!nodes[boardId])return;
  const b=nodes[boardId].data;
  const card=b.kbCards.find(c=>c.id===cardId);
  if(!card)return;
  const cols=b.kbCols;

  let h=`<div class="modal-overlay" onclick="closeCardIfBg(event)"><div class="modal" onclick="event.stopPropagation()">`;
  h+=`<div class="modal-hd">
    <h3><input style="font-size:15px;font-weight:500;border:none;outline:none;background:transparent;width:100%;font-family:inherit;" value="${esc(card.name)}" placeholder="Aufgabenname" onchange="card_set('${boardId}','${cardId}','name',this.value)" id="cn"/></h3>
    <button class="btn-c" onclick="closeCard()">âœ•</button>
  </div>`;
  h+=`<div class="modal-body">`;

  // Column
  h+=`<span class="modal-label">Spalte</span>`;
  h+=`<select class="modal-select" onchange="card_set('${boardId}','${cardId}','colId',this.value)">`;
  cols.forEach(c=>h+=`<option value="${c.id}"${card.colId===c.id?' selected':''}>${esc(c.label)}</option>`);
  h+=`</select>`;

  // Priority
  const prioMap={high:'Hoch ðŸ”´',medium:'Mittel ðŸŸ¡',low:'Niedrig ðŸŸ¢'};
  h+=`<span class="modal-label">PrioritÃ¤t</span>
  <div style="display:flex;gap:6px;margin-bottom:10px;">
    ${['high','medium','low',''].map(p=>`
      <span onclick="card_set('${boardId}','${cardId}','priority','${p}')" style="font-size:11px;padding:4px 10px;border-radius:20px;cursor:pointer;border:0.5px solid var(--border2);background:${card.priority===p?(p==='high'?'var(--redbg)':p==='medium'?'var(--amberbg)':p==='low'?'var(--tealbg)':'var(--bg3)'):'var(--bg)'};color:${card.priority===p?(p==='high'?'var(--redtxt)':p==='medium'?'var(--ambertxt)':p==='low'?'var(--tealtxt)':'var(--text2)'):'var(--text2)'};">
        ${p==='high'?'ðŸ”´ Hoch':p==='medium'?'ðŸŸ¡ Mittel':p==='low'?'ðŸŸ¢ Niedrig':'â€” Keine'}
      </span>`).join('')}
  </div>`;

  // Note
  h+=`<span class="modal-label">Notiz (mit Links)</span>`;
  h+=`<div class="modal-textarea" contenteditable="true" onblur="card_set('${boardId}','${cardId}','note',sanitizeHtml(this.innerHTML))" style="min-height:70px;border:0.5px solid var(--border2);border-radius:var(--r);padding:7px 9px;font-size:12px;outline:none;">${sanitizeHtml(card.note)||''}</div>`;
  h+=`<div style="margin-bottom:10px;"></div>`;

  // Tags
  h+=`<span class="modal-label">Tags</span>`;
  h+=`<div class="tags-row">`;
  globalTags.forEach(t=>{
    const sel=(card.tags||[]).includes(t.label);
    h+=`<span class="tag-pick${sel?' sel':''}" onclick="toggleCardTagById('${boardId}','${cardId}','${t.id}')">${esc(t.label)}</span>`;
  });
  h+=`<span class="tag-pick" onclick="addGlobalTag('${boardId}','${cardId}')" style="border-style:dashed;color:var(--text3);">+ Neu</span>`;
  h+=`</div>`;

  // Who
  h+=`<span class="modal-label">Verantwortlich</span>`;
  h+=`<div class="tags-row">`;
  globalPeople.forEach(p=>{
    const sel=(card.who||[]).includes(p.label);
    h+=`<span class="who-pick${sel?' sel':''}" onclick="toggleCardWhoById('${boardId}','${cardId}','${p.id}')">${esc(p.label)}</span>`;
  });
  h+=`<span class="who-pick" onclick="addGlobalPerson('${boardId}','${cardId}')" style="border-style:dashed;color:var(--text3);">+ Neu</span>`;
  h+=`</div>`;

  // Deadline
  h+=`<div class="recur-row">`;
  h+=`<div><span class="modal-label">Deadline</span><input type="date" class="modal-input" value="${card.deadline||''}" onchange="card_set('${boardId}','${cardId}','deadline',this.value)" style="margin-bottom:0;"/></div>`;

  // Recurrence
  const rv=card.recur||{type:'none'};
  h+=`<div><span class="modal-label">Wiederholung</span>
    <select class="modal-select" style="margin-bottom:0;" onchange="card_recur_type('${boardId}','${cardId}',this.value)">
      <option value="none"${rv.type==='none'?' selected':''}>keine</option>
      <option value="daily"${rv.type==='daily'?' selected':''}>tÃ¤glich</option>
      <option value="weekly"${rv.type==='weekly'?' selected':''}>wÃ¶chentlich</option>
      <option value="monthly"${rv.type==='monthly'?' selected':''}>monatlich</option>
      <option value="yearly"${rv.type==='yearly'?' selected':''}>jÃ¤hrlich</option>
    </select>
  </div></div>`;

  // â”€â”€ Recurrence detail (Outlook-like) â”€â”€
  if(rv.type==='daily'){
    h+=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
      <span class="modal-label" style="margin:0;white-space:nowrap;">Alle</span>
      <input type="number" min="1" max="365" class="modal-input" style="width:70px;margin:0;" value="${rv.every||1}" onchange="card_recur_field('${boardId}','${cardId}','every',parseInt(this.value))"/>
      <span class="modal-label" style="margin:0;">Tag(e)</span>
    </div>`;
  }
  if(rv.type==='weekly'){
    const WDNAMES=WEEKDAY_NAMES;
    const selWd=rv.weekdays||[rv.weekday||0];
    h+=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
      <span class="modal-label" style="margin:0;white-space:nowrap;">Alle</span>
      <input type="number" min="1" max="52" class="modal-input" style="width:60px;margin:0;" value="${rv.every||1}" onchange="card_recur_field('${boardId}','${cardId}','every',parseInt(this.value))"/>
      <span class="modal-label" style="margin:0;">Woche(n) am</span>
    </div>`;
    h+=`<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">`;
    WDNAMES.forEach((name,i)=>{
      const sel=selWd.includes(i);
      h+=`<label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;padding:4px 8px;border-radius:var(--r);border:0.5px solid ${sel?'var(--blue)':'var(--border2)'};background:${sel?'var(--bluebg)':'var(--bg)'};">
        <input type="checkbox" style="margin:0;" ${sel?'checked':''} onchange="toggleWeekday('${boardId}','${cardId}',${i},this.checked)"/>
        ${name.slice(0,2)}
      </label>`;
    });
    h+=`</div>`;
  }
  if(rv.type==='monthly'){
    h+=`<div style="margin-bottom:8px;">
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;margin-bottom:6px;">
        <input type="radio" name="mtype_${cardId}" value="day" ${rv.monthType!=='weekday'?'checked':''} onchange="card_recur_field('${boardId}','${cardId}','monthType','day')"/>
        Am
        <input type="number" min="1" max="31" class="modal-input" style="width:55px;margin:0;" value="${rv.day||1}" onchange="card_recur_field('${boardId}','${cardId}','day',parseInt(this.value))"/>
        . des Monats
      </label>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;flex-wrap:wrap;">
        <input type="radio" name="mtype_${cardId}" value="weekday" ${rv.monthType==='weekday'?'checked':''} onchange="card_recur_field('${boardId}','${cardId}','monthType','weekday')"/>
        Am
        <select class="modal-select" style="width:auto;margin:0;padding:3px 6px;" onchange="card_recur_field('${boardId}','${cardId}','weekdayOrd',parseInt(this.value))">
          ${[1,2,3,4,-1].map(o=>`<option value="${o}"${(rv.weekdayOrd||1)===o?' selected':''}>${o===-1?'letzten':o+'.'}</option>`).join('')}
        </select>
        <select class="modal-select" style="width:auto;margin:0;padding:3px 6px;" onchange="card_recur_field('${boardId}','${cardId}','weekday',parseInt(this.value))">
          ${WEEKDAY_NAMES.map((d,i)=>`<option value="${i}"${(rv.weekday||0)===i?' selected':''}>${d}</option>`).join('')}
        </select>
        des Monats
      </label>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
      <span class="modal-label" style="margin:0;white-space:nowrap;">Alle</span>
      <input type="number" min="1" max="12" class="modal-input" style="width:60px;margin:0;" value="${rv.every||1}" onchange="card_recur_field('${boardId}','${cardId}','every',parseInt(this.value))"/>
      <span class="modal-label" style="margin:0;">Monat(e)</span>
    </div>`;
  }
  if(rv.type==='yearly'){
    const MONTHS=MONTH_NAMES;
    h+=`<div style="margin-bottom:8px;">
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;margin-bottom:6px;flex-wrap:wrap;">
        <input type="radio" name="ytype_${cardId}" value="day" ${rv.monthType!=='weekday'?'checked':''} onchange="card_recur_field('${boardId}','${cardId}','monthType','day')"/>
        Am
        <input type="number" min="1" max="31" class="modal-input" style="width:55px;margin:0;" value="${rv.yearDay||rv.anchorDay||1}" onchange="card_recur_field('${boardId}','${cardId}','yearDay',parseInt(this.value))"/>
        .
        <select class="modal-select" style="width:auto;margin:0;padding:3px 6px;" onchange="card_recur_field('${boardId}','${cardId}','yearMonth',parseInt(this.value))">
          ${MONTHS.map((m,i)=>`<option value="${i}"${(rv.yearMonth!==undefined?rv.yearMonth:rv.anchorMonth||0)===i?' selected':''}>${m}</option>`).join('')}
        </select>
      </label>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;flex-wrap:wrap;">
        <input type="radio" name="ytype_${cardId}" value="weekday" ${rv.monthType==='weekday'?'checked':''} onchange="card_recur_field('${boardId}','${cardId}','monthType','weekday')"/>
        Am
        <select class="modal-select" style="width:auto;margin:0;padding:3px 6px;" onchange="card_recur_field('${boardId}','${cardId}','weekdayOrd',parseInt(this.value))">
          ${[1,2,3,4,-1].map(o=>`<option value="${o}"${(rv.weekdayOrd||1)===o?' selected':''}>${o===-1?'letzten':o+'.'}</option>`).join('')}
        </select>
        <select class="modal-select" style="width:auto;margin:0;padding:3px 6px;" onchange="card_recur_field('${boardId}','${cardId}','weekday',parseInt(this.value))">
          ${WEEKDAY_NAMES.map((d,i)=>`<option value="${i}"${(rv.weekday||0)===i?' selected':''}>${d}</option>`).join('')}
        </select>
        im
        <select class="modal-select" style="width:auto;margin:0;padding:3px 6px;" onchange="card_recur_field('${boardId}','${cardId}','yearMonth',parseInt(this.value))">
          ${MONTHS.map((m,i)=>`<option value="${i}"${(rv.yearMonth!==undefined?rv.yearMonth:rv.anchorMonth||0)===i?' selected':''}>${m}</option>`).join('')}
        </select>
      </label>
    </div>`;
  }
  // â”€â”€ Seriendauer â”€â”€
  const endType=rv.endType||'none';
  h+=`<div class="section-divider">Seriendauer</div>
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
    <span class="modal-label" style="margin:0;white-space:nowrap;">Beginn</span>
    <input type="date" class="modal-input" style="margin:0;flex:1;" value="${rv.startDate||''}" onchange="card_recur_field('${boardId}','${cardId}','startDate',this.value)"/>
  </div>
  <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;">
    <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;">
      <input type="radio" name="end_${cardId}" value="none" ${endType==='none'?'checked':''} onchange="card_recur_field('${boardId}','${cardId}','endType','none')"/>
      Kein Enddatum
    </label>
    <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;">
      <input type="radio" name="end_${cardId}" value="date" ${endType==='date'?'checked':''} onchange="card_recur_field('${boardId}','${cardId}','endType','date')"/>
      Endet am
      <input type="date" class="modal-input" style="margin:0;flex:1;" value="${rv.endDate||''}" ${endType!=='date'?'disabled':''} onchange="card_recur_field('${boardId}','${cardId}','endDate',this.value)"/>
    </label>
    <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;">
      <input type="radio" name="end_${cardId}" value="count" ${endType==='count'?'checked':''} onchange="card_recur_field('${boardId}','${cardId}','endType','count')"/>
      Endet nach
      <input type="number" min="1" max="999" class="modal-input" style="width:65px;margin:0;" value="${rv.endCount||10}" ${endType!=='count'?'disabled':''} onchange="card_recur_field('${boardId}','${cardId}','endCount',parseInt(this.value))"/>
      Terminen
    </label>
  </div>`;

  // Occurrence tracking for recurring cards
  const doneOcc=card.doneOccurrences||[];
  if(rv.type!=='none'&&doneOcc.length>0){
    const sorted=[...doneOcc].sort().reverse();
    const lastDone=sorted[0];
    h+=`<div class="section-divider">Erledigte Termine <span style="font-weight:400;color:var(--text3);">${doneOcc.length}${rv.endType==='count'&&rv.endCount?'/'+rv.endCount:''}</span></div>`;
    h+=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <span style="font-size:12px;color:var(--teal);">âœ“ Zuletzt: ${fmtDate(lastDone)}</span>
      ${doneOcc.length>1?`<span style="font-size:11px;color:var(--text3);">(${sorted.slice(1,4).map(d=>fmtDate(d)).join(', ')}${doneOcc.length>4?' â€¦':''})</span>`:''}
    </div>`;
    h+=`<button class="btn" style="font-size:11px;margin-bottom:10px;" onclick="clearOccurrences('${boardId}','${cardId}')">Verlauf zurÃ¼cksetzen</button>`;
  }

  // Checklist
  h+=`<div class="section-divider">Checkliste</div>`;
  const cl=card.checklist||[];
  cl.forEach(item=>{
    h+=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <div class="cl-check${item.done?' done':''}" onclick="toggleClItem('${boardId}','${cardId}','${item.id}')"></div>
      <input style="flex:1;font-size:12px;border:none;outline:none;background:transparent;font-family:inherit;text-decoration:${item.done?'line-through':''};color:${item.done?'var(--text3)':'var(--text)'};" value="${esc(item.text)}" onchange="updateClItem('${boardId}','${cardId}','${item.id}',this.value)"/>
      <span style="font-size:12px;color:var(--red);cursor:pointer;" onclick="delClItem('${boardId}','${cardId}','${item.id}')">âœ•</span>
    </div>`;
  });
  h+=`<button class="btn" style="font-size:11px;" onclick="addClItem('${boardId}','${cardId}')">+ Punkt</button>`;

  h+=`</div>`; // modal-body
  h+=`<div class="modal-actions">
    <button class="btn-c" onclick="card_set('${boardId}','${cardId}','archived',${!card.archived});closeCard()" style="margin-right:auto;">${card.archived?'Aus Archiv':'Archivieren'}</button>
    <button class="btn-c${card.done?' active':''}" onclick="toggleCardDone('${boardId}','${cardId}')" style="${card.done?'background:var(--tealbg);color:var(--tealtxt);border-color:var(--tealbg);':''}">
      ${card.done?'âœ“ Erledigt':'Als erledigt markieren'}
    </button>
    <button class="btn danger btn-c" onclick="deleteCard('${boardId}','${cardId}')">LÃ¶schen</button>
    <button class="btn-p" onclick="closeCard()">Fertig</button>
  </div></div></div>`;

  const container=document.getElementById('cardmodal');
  // Remove old listeners by replacing the node (clears all event listeners)
  const fresh=container.cloneNode(false);
  container.parentNode.replaceChild(fresh,container);
  fresh.innerHTML=h;
  const cnEl=document.getElementById('cn');
  if(cnEl){
    cnEl.focus();
    cnEl.addEventListener('keydown',e=>{
      if(e.key==='Enter'){e.preventDefault();closeCard();}
    });
  }
  fresh.addEventListener('keydown',e=>{
    if(e.key==='Tab'){
      const modal=fresh.querySelector('.modal');
      if(!modal)return;
      const focusable=Array.from(modal.querySelectorAll('input:not([disabled]),select:not([disabled]),button,[contenteditable]'));
      const idx=focusable.indexOf(document.activeElement);
      if(idx>=0){
        e.preventDefault();
        const next=focusable[(idx+(e.shiftKey?-1:1)+focusable.length)%focusable.length];
        if(next)next.focus();
      }
    }
    if(e.key==='Escape'){e.stopPropagation();closeCard();}
  });
}

function closeCard(){
  const overlay=document.querySelector('#cardmodal .modal-overlay');
  if(overlay){
    overlay.classList.add('closing');
    setTimeout(()=>{document.getElementById('cardmodal').innerHTML='';render();},ANIM_EXIT_MS);
  } else {document.getElementById('cardmodal').innerHTML='';render();}
}
function closeCardIfBg(e){if(e.target===e.currentTarget)closeCard();}

function card_set(boardId,cardId,field,val){
  const c=nodes[boardId].data.kbCards.find(x=>x.id===cardId);
  if(!c)return;
  c[field]=val;save();
  // Re-render modal for visual fields
  if(field==='priority'||field==='archived')openCard(boardId,cardId);
}
function card_recur_type(boardId,cardId,type){
  const card=nodes[boardId].data.kbCards.find(x=>x.id===cardId);
  if(!card)return;
  const anchor=card.deadline?new Date(card.deadline):new Date();
  const today=new Date();today.setHours(0,0,0,0);
  card.recur={
    type,
    every:1,
    weekdays:[anchor.getDay()===0?6:anchor.getDay()-1], // Mon=0
    weekday:anchor.getDay()===0?6:anchor.getDay()-1,
    weekdayOrd:1,
    day:anchor.getDate(),
    monthType:'day',
    yearMonth:anchor.getMonth(),
    yearDay:anchor.getDate(),
    anchorMonth:anchor.getMonth(),
    anchorDay:anchor.getDate(),
    endType:'none',
    endDate:'',
    endCount:10,
    startDate:today.toISOString().split('T')[0],
  };
  save();openCard(boardId,cardId);
}
function card_recur_field(boardId,cardId,field,val){
  const card=nodes[boardId].data.kbCards.find(x=>x.id===cardId);
  if(!card)return;
  if(!card.recur)card.recur={type:'none'};
  card.recur[field]=val;
  save();
  // Only re-open modal for fields that change the UI structure
  const rerenderFields=['type','monthType','endType'];
  if(rerenderFields.includes(field))openCard(boardId,cardId);
}
function toggleWeekday(boardId,cardId,day,checked){
  const card=nodes[boardId].data.kbCards.find(x=>x.id===cardId);
  if(!card||!card.recur)return;
  if(!card.recur.weekdays)card.recur.weekdays=[card.recur.weekday||0];
  if(checked){if(!card.recur.weekdays.includes(day))card.recur.weekdays.push(day);}
  else{card.recur.weekdays=card.recur.weekdays.filter(d=>d!==day);if(card.recur.weekdays.length===0)card.recur.weekdays=[0];}
  card.recur.weekday=card.recur.weekdays[0];
  save();
}
function toggleCardTagById(boardId,cardId,tagId){
  const t=globalTags.find(x=>x.id===tagId);if(!t)return;
  toggleCardTag(boardId,cardId,t.label);
}
function toggleCardWhoById(boardId,cardId,whoId){
  const p=globalPeople.find(x=>x.id===whoId);if(!p)return;
  toggleCardWho(boardId,cardId,p.label);
}
function toggleCardTag(boardId,cardId,tag){
  const c=nodes[boardId].data.kbCards.find(x=>x.id===cardId);
  if(!c)return;if(!c.tags)c.tags=[];
  c.tags=c.tags.includes(tag)?c.tags.filter(t=>t!==tag):[...c.tags,tag];
  save();openCard(boardId,cardId);
}
function toggleCardWho(boardId,cardId,who){
  const c=nodes[boardId].data.kbCards.find(x=>x.id===cardId);
  if(!c)return;if(!c.who)c.who=[];
  c.who=c.who.includes(who)?c.who.filter(w=>w!==who):[...c.who,who];
  save();openCard(boardId,cardId);
}
function addGlobalTag(boardId,cardId){
  smodal('Neuer Tag',[{label:'Name',id:'l',ph:'z.B. Reporting'}],v=>{
    if(!v.l)return;
    if(!globalTags.find(t=>t.label===v.l))globalTags.push({id:uid(),label:v.l});
    toggleCardTag(boardId,cardId,v.l);
  });
}
function addGlobalPerson(boardId,cardId){
  smodal('Neue Person',[{label:'Name',id:'l',ph:'z.B. Max'}],v=>{
    if(!v.l)return;
    if(!globalPeople.find(p=>p.label===v.l))globalPeople.push({id:uid(),label:v.l});
    toggleCardWho(boardId,cardId,v.l);
  });
}
function addClItem(boardId,cardId){
  const c=nodes[boardId].data.kbCards.find(x=>x.id===cardId);
  if(!c)return;if(!c.checklist)c.checklist=[];
  c.checklist.push({id:uid(),text:'',done:false});
  save();openCard(boardId,cardId);
}
function toggleClItem(boardId,cardId,itemId){
  const c=nodes[boardId].data.kbCards.find(x=>x.id===cardId);
  if(!c)return;const i=c.checklist.find(x=>x.id===itemId);if(i)i.done=!i.done;save();openCard(boardId,cardId);
}
function updateClItem(boardId,cardId,itemId,val){
  const c=nodes[boardId].data.kbCards.find(x=>x.id===cardId);
  if(!c)return;const i=c.checklist.find(x=>x.id===itemId);if(i)i.text=val;save();
}
function delClItem(boardId,cardId,itemId){
  const c=nodes[boardId].data.kbCards.find(x=>x.id===cardId);
  if(!c)return;c.checklist=c.checklist.filter(x=>x.id!==itemId);save();openCard(boardId,cardId);
}
function setCardDone(boardId,cardId,toggle){
  const card=nodes[boardId].data.kbCards.find(x=>x.id===cardId);
  if(!card)return card;
  card.done=toggle?!card.done:true;
  card.doneDate=card.done?new Date().toISOString().split('T')[0]:'';
  const cols=nodes[boardId].data.kbCols;
  if(card.done&&cols.length>0) card.colId=cols[cols.length-1].id;
  else if(!card.done&&cols.length>0) card.colId=cols[0].id;
  save();
  return card;
}
function toggleCardDone(boardId,cardId){
  if(!setCardDone(boardId,cardId,true))return;
  openCard(boardId,cardId);
}
function moveCard(boardId,cardId,dir){
  const b=nodes[boardId].data;
  const card=b.kbCards.find(x=>x.id===cardId);
  if(!card)return;
  const cols=b.kbCols;
  const idx=cols.findIndex(c=>c.id===card.colId);
  const newIdx=idx+dir;
  if(newIdx<0||newIdx>=cols.length)return;
  card.colId=cols[newIdx].id;
  save();render();
}
function quickDoneCard(e,boardId,cardId){
  const el=e&&e.target?e.target.closest('.cl-check'):null;
  if(el){el.classList.add('anim-done');setTimeout(()=>el.classList.remove('anim-done'),ANIM_CHECK_MS);}
  const card=nodes[boardId]?.data.kbCards.find(x=>x.id===cardId);
  if(!card)return;
  if(card.recur&&card.recur.type!=='none'){
    if(!card.doneOccurrences)card.doneOccurrences=[];
    const todayStr=new Date().toISOString().split('T')[0];
    if(!card.doneOccurrences.includes(todayStr))card.doneOccurrences.push(todayStr);
    save();setTimeout(()=>render(),RENDER_DELAY_MS);
  } else {
    if(!setCardDone(boardId,cardId,true))return;
    setTimeout(()=>render(),RENDER_DELAY_MS);
  }
}
function deleteCard(boardId,cardId){
  if(!confirm('Karte lÃ¶schen?'))return;
  nodes[boardId].data.kbCards=nodes[boardId].data.kbCards.filter(c=>c.id!==cardId);
  closeCard();
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// CHECKLISTS TAB
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function renderChecklists(node){
  const{checklists}=node.data;
  let h=`<div style="margin-bottom:10px;"><button class="btn edit-only" onclick="addChecklist('${node.id}')">+ Checkliste</button></div>`;
  if(checklists.length===0) h+=`<div class="empty-state"><div class="empty-big">âœ“</div><div>Noch keine Checklisten.</div></div>`;
  checklists.forEach(cl=>{
    const done=cl.items.filter(i=>i.done).length;
    h+=`<div class="card">
      <div class="cardhd">
        ${editMode?`<input class="ni" value="${esc(cl.label)}" onchange="renameCl('${node.id}','${cl.id}',this.value)" style="font-size:12px;font-weight:500;"/>`:`<span>${esc(cl.label)}</span>`}
        <span style="font-size:10px;color:var(--text3);font-weight:400;">${done}/${cl.items.length}</span>
        ${editMode?`<span class="edel" style="display:inline;" onclick="delChecklist('${node.id}','${cl.id}')">âœ•</span>`:''}
      </div>
      <div class="cl-list">`;
    cl.items.forEach(item=>{
      h+=`<div class="cl-item">
        <div class="cl-check${item.done?' done':''}" onclick="toggleCl('${node.id}','${cl.id}','${item.id}')"></div>
        <span class="cl-text${item.done?' done':''}">${esc(item.text)}</span>
        ${editMode?`<span style="font-size:12px;color:var(--red);cursor:pointer;" onclick="delClFromList('${node.id}','${cl.id}','${item.id}')">âœ•</span>`:''}
      </div>`;
    });
    h+=`</div>
      <div style="padding:6px 13px;border-top:0.5px solid var(--border);">
        <button class="addfull edit-only" onclick="addClItem2('${node.id}','${cl.id}')">+ Punkt</button>
      </div>
    </div>`;
  });
  return h;
}
function addChecklist(boardId){
  smodal('Neue Checkliste',[{label:'Name',id:'l',ph:'z.B. Onboarding Schritte'}],v=>{
    if(!v.l)return;
    nodes[boardId].data.checklists.push({id:uid(),label:v.l,items:[]});
    save();render();
  });
}
function renameCl(boardId,clId,val){const c=nodes[boardId].data.checklists.find(x=>x.id===clId);if(c)c.label=val;save();}
function delChecklist(boardId,clId){nodes[boardId].data.checklists=nodes[boardId].data.checklists.filter(c=>c.id!==clId);save();render();}
function toggleCl(boardId,clId,itemId){const cl=nodes[boardId].data.checklists.find(x=>x.id===clId);if(!cl)return;const i=cl.items.find(x=>x.id===itemId);if(i)i.done=!i.done;save();render();}
function delClFromList(boardId,clId,itemId){const cl=nodes[boardId].data.checklists.find(x=>x.id===clId);if(cl)cl.items=cl.items.filter(i=>i.id!==itemId);save();render();}
function addClItem2(boardId,clId){
  smodal('Neuer Punkt',[{label:'Text',id:'t',ph:'z.B. Vertrag prÃ¼fen'}],v=>{
    if(!v.t)return;
    const cl=nodes[boardId].data.checklists.find(x=>x.id===clId);
    if(cl)cl.items.push({id:uid(),text:v.t,done:false});
    save();render();
  });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SUB-MATRIX (inline)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function renderSubMatrix(node){
  const{rows,cols}=node.data;
  let h=`<div style="display:flex;gap:6px;margin-bottom:10px;">
    <button class="btn edit-only" onclick="addCol('${node.id}')">+ Spalte</button>
    <button class="btn edit-only" onclick="addRow('${node.id}')">+ Zeile</button></div>`;
  if(rows.length===0&&cols.length===0){
    h+=`<div class="empty-state"><div class="empty-big">âŠž</div><div>Sub-Matrix leer.</div></div>`;
    return h;
  }
  const gc=`110px repeat(${cols.length},minmax(110px,1fr))${editMode?' 36px':''}`;
  h+=`<div class="mwrap"><div class="matrix${editMode?' emode':''}" style="grid-template-columns:${gc};">`;
  h+=`<div class="mh corner"></div>`;
  cols.forEach(col=>{
    h+=`<div class="mh ch"><input class="ni" value="${esc(col.label)}" onchange="renameCol('${node.id}','${col.id}',this.value)" ${editMode?'':'readonly'} style="text-align:center;"/>
      <span class="edel" onclick="delCol('${node.id}','${col.id}')">âœ•</span></div>`;
  });
  if(editMode)h+=`<div class="addcolhdr"><button class="addbtn" onclick="addCol('${node.id}')">+</button></div>`;
  rows.forEach(row=>{
    h+=`<div class="mh rh"><input class="ni" value="${esc(row.label)}" onchange="renameRow('${node.id}','${row.id}',this.value)" ${editMode?'':'readonly'}/>
      <span class="edel" onclick="delRow('${node.id}','${row.id}')">âœ•</span></div>`;
    cols.forEach(col=>{h+=cellHTML(node.id,row,col);});
    if(editMode)h+=`<div class="addrowcol"></div>`;
  });
  if(editMode)h+=`<div class="addrowfull"><button class="addbtn" onclick="addRow('${node.id}')">+</button></div>`;
  h+=`</div></div>`;
  return h;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// DAILY OVERVIEW
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function renderDailyOverview(){
  const today=new Date();today.setHours(0,0,0,0);
  // Collect all cards from all boards in tree
  const allCards=[];
  function collectBoards(nodeId){
    const n=nodes[nodeId];if(!n)return;
    if(n.type==='board'){
      n.data.kbCards.filter(c=>{
        if(c.archived||c.done)return false;
        if(!c.deadline&&(!c.recur||c.recur.type==='none'))return false;
        // endCount: if recur has fired endCount times already, hide
        if(c.recur&&c.recur.endType==='count'&&c.recur.endCount&&c.recur.startDate){
          const sd=new Date(c.recur.startDate);sd.setHours(0,0,0,0);
          const now=new Date();now.setHours(0,0,0,0);
          let count=0;const d=new Date(sd);
          while(d<=now){if(recurFiresOn(c.recur,d))count++;d.setDate(d.getDate()+1);}
          if(count>=c.recur.endCount)return false;
        }
        return true;
      }).forEach(c=>{allCards.push({card:c,boardId:n.id,boardLabel:n.label});});
    }
    if(n.type==='matrix'){
      Object.values(n.data.cells).forEach(cell=>{
        if(cell.boardId)collectBoards(cell.boardId);
        if(cell.matrixId)collectBoards(cell.matrixId);
      });
    }
  }
  collectBoards(rootId);

  // For each daily col, filter by explicit colType config
  function getTimeRange(type){
    const s=new Date(today),e=new Date(today);
    if(type==='today') return {s,e};
    if(type==='thisweek'){
      s.setDate(today.getDate()-((today.getDay()+6)%7)); // Mon
      e.setDate(s.getDate()+6); return {s,e};
    }
    if(type==='nextweek'){
      s.setDate(today.getDate()-((today.getDay()+6)%7)+7);
      e.setDate(s.getDate()+6); return {s,e};
    }
    if(type==='thismonth'){
      s.setDate(1);
      e.setFullYear(today.getFullYear(),today.getMonth()+1,0); return {s,e};
    }
    if(type==='nextmonth'){
      s.setFullYear(today.getFullYear(),today.getMonth()+1,1);
      e.setFullYear(today.getFullYear(),today.getMonth()+2,0); return {s,e};
    }
    if(type==='thisquarter'){
      const q=Math.floor(today.getMonth()/3);
      s.setMonth(q*3,1);
      e.setMonth(q*3+3,0); return {s,e};
    }
    if(type==='thisyear'){
      s.setMonth(0,1);e.setMonth(11,31); return {s,e};
    }
    if(type==='nextyear'){
      s.setFullYear(today.getFullYear()+1,0,1);
      e.setFullYear(today.getFullYear()+1,11,31); return {s,e};
    }
    return null;
  }
  function cardFitsCol(card,colIdx){
    const col=dailyCols[colIdx];
    const type=col.type||'today';
    const range=getTimeRange(type);
    if(!range)return false;
    const{s,e}=range;
    const isRecur=card.recur&&card.recur.type!=='none';
    let dlDate=card.deadline?new Date(card.deadline):null;
    if(dlDate)dlDate.setHours(0,0,0,0);
    function inRange(d){return d&&d>=s&&d<=e;}
    if(type==='today'){
      if(dlDate&&sameDay(dlDate,today))return true;
      if(isRecur&&recurFiresOn(card.recur,today))return true;
      return false;
    }
    if(inRange(dlDate))return true;
    if(isRecur&&recurFiresInRange(card.recur,s,e))return true;
    return false;
  }

  let h=`<div class="daily-wrap">
    <div class="daily-title">
      ðŸ“… TagesÃ¼bersicht â€” ${fmtDateFull(today)}
      <button class="btn edit-only" style="font-size:11px;margin-left:auto;" onclick="addDailyCol()">+ Spalte</button>
    </div>
    <div class="daily-cols">`;

  dailyCols.forEach((col,idx)=>{
    const colType=col.type||'today';
    const colRange=getTimeRange(colType);
    const items=allCards.filter(({card})=>{
      if(!cardFitsCol(card,idx))return false;
      // For recurring tasks: hide if all occurrences in this range are done
      const isRecur=card.recur&&card.recur.type!=='none';
      if(isRecur&&colRange){
        if(colType==='today'){
          const todayStr=today.toISOString().split('T')[0];
          if(isOccurrenceDone(card,todayStr))return false;
        } else {
          if(allOccurrencesDoneInRange(card,colRange.s,colRange.e))return false;
        }
      }
      return true;
    });
    const typeLabel=DCTYPE_LABELS[col.type||'today']||col.type||'';
    h+=`<div class="daily-col">
      <div class="daily-col-hd">
        <div style="flex:1;min-width:0;">
          ${editMode
            ?`<input class="ni" value="${esc(col.label)}" onchange="renameDailyCol('${col.id}',this.value)" style="font-size:12px;font-weight:500;width:100%;"/>`
            :`<span style="font-size:12px;font-weight:500;">${esc(col.label)}</span>`}
          <div style="font-size:10px;color:var(--text3);margin-top:1px;">${typeLabel}</div>
        </div>
        <span style="font-size:10px;color:var(--text3);margin-left:4px;">${items.length}</span>
        ${editMode?`<span style="font-size:12px;color:var(--text2);cursor:pointer;margin-left:4px;" onclick="editDailyCol('${col.id}')" title="Zeitfenster Ã¤ndern">âš™</span>`:''}
        ${editMode?`<span class="delbtn" style="display:inline;margin-left:2px;" onclick="delDailyCol('${col.id}')">âœ•</span>`:''}
      </div>`;
    if(items.length===0){
      h+=`<div style="padding:10px 12px;font-size:12px;color:var(--text3);">Nichts fÃ¤llig</div>`;
    } else {
      items.forEach(({card,boardId,boardLabel})=>{
        const isRecur=card.recur&&card.recur.type!=='none';
        const prioDot2=card.priority?`<span style="width:7px;height:7px;border-radius:50%;background:${PRIO_COLORS[card.priority]};display:inline-block;margin-right:4px;flex-shrink:0;margin-top:4px;"></span>`:'';
        h+=`<div class="daily-item">
          <div class="task-check" onclick="quickDoneFromDaily(event,'${boardId}','${card.id}')" title="Erledigt markieren" style="flex-shrink:0;margin-top:3px;cursor:pointer;"></div>
          <div style="flex:1;min-width:0;cursor:pointer;" tabindex="0" role="link" onclick="openCardFromDaily('${boardId}','${card.id}')" onkeydown="if(event.key==='Enter'){event.preventDefault();openCardFromDaily('${boardId}','${card.id}');}">
            <div class="di-name" style="display:flex;align-items:flex-start;">${prioDot2}${esc(card.name)||'(ohne Name)'}</div>
            <div class="di-from">
              ${esc(boardLabel)}${card.deadline?' Â· '+fmtDate(card.deadline):''}
              ${isRecur?`<span style="color:var(--teal);">Â· â†» ${recurLabel(card.recur,true)}</span>`:''}
            </div>
          </div>
          ${(card.tags||[]).slice(0,2).map(t=>`<span class="kc-tag" style="font-size:9px;">${esc(t)}</span>`).join('')}
        </div>`;
      });
    }
    h+=`</div>`;
  });
  if(editMode)h+=`<div style="min-width:160px;flex-shrink:0;padding:7px;"><button class="addfull" style="height:48px;" onclick="addDailyCol()">+ Spalte</button></div>`;
  h+=`</div></div>`;
  return h;
}

function sameDay(a,b){return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();}
function recurFiresOn(r,date){
  if(!r||r.type==='none')return false;
  // Check endType gates
  if(r.endType==='date'&&r.endDate){
    const ed=new Date(r.endDate);ed.setHours(0,0,0,0);
    if(date>ed)return false;
  }
  if(r.startDate){
    const sd=new Date(r.startDate);sd.setHours(0,0,0,0);
    if(date<sd)return false;
  }
  const every=r.every||1;
  if(r.type==='daily'){
    if(!r.startDate)return true;
    const sd=new Date(r.startDate);sd.setHours(0,0,0,0);
    const diff=Math.round((date-sd)/(1000*60*60*24));
    return diff>=0&&diff%every===0;
  }
  if(r.type==='weekly'){
    // weekdays array (Mon=0..Sun=6), JS getDay: Sun=0..Sat=6
    const wd=r.weekdays||(r.weekday!==undefined?[r.weekday]:[0]);
    const jsDay=date.getDay(); // 0=Sun
    // Convert our Mon=0 to JS: Mon=1,Tue=2,...Sun=0
    const ourDay=jsDay===0?6:jsDay-1;
    if(!wd.includes(ourDay))return false;
    if(every===1)return true;
    // Check week interval from startDate
    if(!r.startDate)return true;
    const sd=new Date(r.startDate);sd.setHours(0,0,0,0);
    const dayDiff=Math.round((Date.UTC(date.getFullYear(),date.getMonth(),date.getDate())-Date.UTC(sd.getFullYear(),sd.getMonth(),sd.getDate()))/(1000*60*60*24));
    const weekDiff=Math.floor(dayDiff/7);
    return weekDiff>=0&&weekDiff%every===0;
  }
  if(r.type==='monthly'){
    let fires=false;
    if(r.monthType==='weekday'){
      const wd=r.weekday||0;const ord=r.weekdayOrd||1;const jsWd=wd===6?0:wd+1;
      if(ord===-1){const last=new Date(date.getFullYear(),date.getMonth()+1,0);while(last.getDay()!==jsWd)last.setDate(last.getDate()-1);fires=sameDay(date,last);}
      else{const first=new Date(date.getFullYear(),date.getMonth(),1);let count=0;const d=new Date(first);while(d.getMonth()===date.getMonth()){if(d.getDay()===jsWd){count++;if(count===ord){fires=sameDay(date,d);break;}}d.setDate(d.getDate()+1);}}
    } else {fires=date.getDate()===(r.day||1);}
    if(!fires)return false;
    if(every===1)return true;
    if(!r.startDate)return true;
    const sd=new Date(r.startDate);sd.setHours(0,0,0,0);
    const mDiff=(date.getFullYear()-sd.getFullYear())*12+(date.getMonth()-sd.getMonth());
    return mDiff>=0&&mDiff%every===0;
  }
  if(r.type==='yearly'){
    const month=r.yearMonth!==undefined?r.yearMonth:(r.anchorMonth||0);
    if(date.getMonth()!==month)return false;
    let fires=false;
    if(r.monthType==='weekday'){
      const wd=r.weekday||0;const ord=r.weekdayOrd||1;const jsWd=wd===6?0:wd+1;
      if(ord===-1){const last=new Date(date.getFullYear(),month+1,0);while(last.getDay()!==jsWd)last.setDate(last.getDate()-1);fires=sameDay(date,last);}
      else{const first=new Date(date.getFullYear(),month,1);let count=0;const d=new Date(first);while(d.getMonth()===month){if(d.getDay()===jsWd){count++;if(count===ord){fires=sameDay(date,d);break;}}d.setDate(d.getDate()+1);}}
    } else {fires=date.getDate()===(r.yearDay||r.anchorDay||1);}
    if(!fires)return false;
    if(every===1)return true;
    if(!r.startDate)return true;
    const sd=new Date(r.startDate);sd.setHours(0,0,0,0);
    const yDiff=date.getFullYear()-sd.getFullYear();
    return yDiff>=0&&yDiff%every===0;
  }
  return false;
}
function recurFiresInRange(r,start,end){
  if(!r||r.type==='none')return false;
  // endCount: check if we'd exceed count by start of range
  if(r.endType==='count'&&r.endCount&&r.startDate){
    // Count how many times it has already fired before this range
    const sd=new Date(r.startDate);sd.setHours(0,0,0,0);
    let count=0;
    const d2=new Date(sd);
    while(d2<start){if(recurFiresOn(r,d2))count++;d2.setDate(d2.getDate()+1);}
    if(count>=r.endCount)return false;
  }
  const d=new Date(start);
  while(d<=end){if(recurFiresOn(r,d))return true;d.setDate(d.getDate()+1);}
  return false;
}
function addDailyCol(){
  smodal('Neue Spalte',[
    {label:'Name',id:'l',ph:'z.B. Diese Woche'},
    {label:'Zeitfenster',id:'t',sel:DAILY_COL_TYPES.map(x=>x[0]),sellabels:DAILY_COL_TYPES.map(x=>x[1])}
  ],v=>{
    if(!v.l)return;
    dailyCols.push({id:uid(),label:v.l,type:v.t||'today'});
    save();render();
  });
}
function renameDailyCol(colId,val){const c=dailyCols.find(x=>x.id===colId);if(c)c.label=val;save();}
function delDailyCol(colId){if(!confirm('Spalte lÃ¶schen?'))return;dailyCols=dailyCols.filter(c=>c.id!==colId);save();render();}
function editDailyCol(colId){
  const col=dailyCols.find(x=>x.id===colId);if(!col)return;
  smodal('Spalte bearbeiten',[
    {label:'Name',id:'l',ph:'',v:col.label},
    {label:'Zeitfenster',id:'t',sel:DAILY_COL_TYPES.map(x=>x[0]),sellabels:DAILY_COL_TYPES.map(x=>x[1]),v:col.type||'today'}
  ],v=>{
    if(v.l)col.label=v.l;
    if(v.t)col.type=v.t;
    save();render();
  });
}
function openCardFromDaily(boardId,cardId){
  openCard(boardId,cardId);
}
function quickDoneFromDaily(e,boardId,cardId){
  if(!nodes[boardId])return;
  const card=nodes[boardId].data.kbCards.find(x=>x.id===cardId);
  if(!card)return;
  const el=e&&e.target?e.target.closest('.task-check'):null;
  if(el){el.classList.add('anim-done');setTimeout(()=>el.classList.remove('anim-done'),ANIM_CHECK_MS);}
  const isRecur=card.recur&&card.recur.type!=='none';
  if(isRecur){
    if(!card.doneOccurrences)card.doneOccurrences=[];
    const todayStr=new Date().toISOString().split('T')[0];
    if(!card.doneOccurrences.includes(todayStr))card.doneOccurrences.push(todayStr);
    save();setTimeout(()=>render(),RENDER_DELAY_MS);
  } else {
    if(!setCardDone(boardId,cardId,false))return;
    setTimeout(()=>render(),RENDER_DELAY_MS);
  }
}
function clearOccurrences(boardId,cardId){
  const c=nodes[boardId]?.data.kbCards.find(x=>x.id===cardId);
  if(!c)return;
  c.doneOccurrences=[];
  save();openCard(boardId,cardId);
}
function isOccurrenceDone(card,dateStr){
  return(card.doneOccurrences||[]).includes(dateStr);
}
function getOccurrenceDatesInRange(card,start,end){
  const dates=[];
  if(!card.recur||card.recur.type==='none')return dates;
  const d=new Date(start);
  while(d<=end){
    if(recurFiresOn(card.recur,d))dates.push(d.toISOString().split('T')[0]);
    d.setDate(d.getDate()+1);
  }
  return dates;
}
function allOccurrencesDoneInRange(card,start,end){
  const dates=getOccurrenceDatesInRange(card,start,end);
  if(dates.length===0)return false;
  return dates.every(d=>isOccurrenceDone(card,d));
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// MATRIX CELL KEYBOARD NAVIGATION
function mcellKeydown(e,el){
  if(e.key==='Enter'){
    e.preventDefault();
    const t=el.dataset;
    if(t.enterType)iconClick(t.enterNode,t.enterRow,t.enterCol,t.enterType,t.enterLbl);
    return;
  }
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Tab'].includes(e.key)){
    e.preventDefault();
    const nodeId=el.dataset.node;
    const n=nodes[nodeId];if(!n||n.type!=='matrix')return;
    const{rows,cols}=n.data;
    const ri=rows.findIndex(r=>r.id===el.dataset.row);
    const ci=cols.findIndex(c=>c.id===el.dataset.col);
    if(ri<0||ci<0)return;
    let nr=ri,nc=ci;
    if(e.key==='ArrowUp')nr=Math.max(0,ri-1);
    else if(e.key==='ArrowDown')nr=Math.min(rows.length-1,ri+1);
    else if(e.key==='ArrowLeft')nc=Math.max(0,ci-1);
    else if(e.key==='ArrowRight')nc=Math.min(cols.length-1,ci+1);
    else if(e.key==='Tab'){
      if(e.shiftKey){nc--;if(nc<0){nc=cols.length-1;nr--;}}
      else{nc++;if(nc>=cols.length){nc=0;nr++;}}
      if(nr<0||nr>=rows.length)return;
    }
    const target=document.querySelector(`.mcell[data-node="${nodeId}"][data-row="${rows[nr].id}"][data-col="${cols[nc].id}"]`);
    if(target)target.focus();
  }
  // Escape: go up one level
  if(e.key==='Escape'&&stack.length>1){e.preventDefault();navTo(stack.length-2);}
}

// DRAG & DROP
let _dragCardId=null,_dragBoardId=null;
function dragStart(e){
  const el=e.target.closest('.kb-card');if(!el)return;
  _dragCardId=el.dataset.cardId;_dragBoardId=el.dataset.boardId;
  el.classList.add('dragging');
  e.dataTransfer.effectAllowed='move';
  e.dataTransfer.setData('text/plain',_dragCardId);
}
function dragEnd(e){
  const el=e.target.closest('.kb-card');if(el)el.classList.remove('dragging');
  document.querySelectorAll('.kb-cards.drag-over').forEach(c=>c.classList.remove('drag-over'));
  _dragCardId=null;_dragBoardId=null;
}
function dragOver(e){
  e.preventDefault();e.dataTransfer.dropEffect='move';
  const col=e.target.closest('.kb-cards');if(col)col.classList.add('drag-over');
}
function dragLeave(e){
  const col=e.target.closest('.kb-cards');
  if(col&&!col.contains(e.relatedTarget))col.classList.remove('drag-over');
}
function dragDrop(e){
  e.preventDefault();
  const col=e.target.closest('.kb-cards');if(!col||!_dragCardId||!_dragBoardId)return;
  col.classList.remove('drag-over');
  const boardId=col.dataset.boardId;const colId=col.dataset.colId;
  if(boardId!==_dragBoardId)return; // cross-board not supported
  const b=nodes[boardId].data;
  const card=b.kbCards.find(c=>c.id===_dragCardId);if(!card)return;
  card.colId=colId;
  // Determine drop position within column
  const cardEls=Array.from(col.querySelectorAll('.kb-card:not(.dragging)'));
  const afterEl=cardEls.find(el=>{
    const rect=el.getBoundingClientRect();
    return e.clientY<rect.top+rect.height/2;
  });
  // Reorder: remove card, insert at position
  b.kbCards=b.kbCards.filter(c=>c.id!==_dragCardId);
  if(afterEl){
    const afterId=afterEl.dataset.cardId;
    const idx=b.kbCards.findIndex(c=>c.id===afterId);
    b.kbCards.splice(idx,0,card);
  } else {
    b.kbCards.push(card);
  }
  card.archived=false;
  save();render();
}

// KEYBOARD SHORTCUTS FOR KANBAN CARDS
function kbCardKeydown(e,boardId,cardId){
  if(e.key==='Enter'){e.preventDefault();openCard(boardId,cardId);return;}
  const b=nodes[boardId]?.data;if(!b)return;
  const card=b.kbCards.find(c=>c.id===cardId);if(!card)return;
  // Shift+Left/Right: move between columns â€” animate card
  if(e.shiftKey&&(e.key==='ArrowLeft'||e.key==='ArrowRight')){
    e.preventDefault();
    const srcEl=e.target.closest('.kb-card');
    if(srcEl)srcEl.style.transition='opacity 0.15s,transform 0.15s';
    if(srcEl)srcEl.style.opacity='0';
    if(srcEl)srcEl.style.transform=e.key==='ArrowLeft'?'translateX(-20px)':'translateX(20px)';
    const dir=e.key==='ArrowLeft'?-1:1;
    setTimeout(()=>{
      moveCard(boardId,cardId,dir);
      setTimeout(()=>{const el=document.querySelector(`[data-card-id="${cardId}"]`);if(el){el.classList.add('anim-add');el.focus();setTimeout(()=>el.classList.remove('anim-add'),250);}},FOCUS_RESTORE_MS);
    },150);
    return;
  }
  // Shift+Up/Down: reorder within column â€” animate swap
  if(e.shiftKey&&(e.key==='ArrowUp'||e.key==='ArrowDown')){
    e.preventDefault();
    const colCards=b.kbCards.filter(c=>c.colId===card.colId&&!c.archived);
    const idx=colCards.findIndex(c=>c.id===cardId);
    const newIdx=idx+(e.key==='ArrowUp'?-1:1);
    if(newIdx<0||newIdx>=colCards.length)return;
    const mainIdx=b.kbCards.indexOf(colCards[idx]);
    const mainNewIdx=b.kbCards.indexOf(colCards[newIdx]);
    const tmp=b.kbCards[mainIdx];b.kbCards[mainIdx]=b.kbCards[mainNewIdx];b.kbCards[mainNewIdx]=tmp;
    save();render();
    setTimeout(()=>{const el=document.querySelector(`[data-card-id="${cardId}"]`);if(el){el.classList.add('anim-add');el.focus();setTimeout(()=>el.classList.remove('anim-add'),250);}},FOCUS_RESTORE_MS);
    return;
  }
  // Shift+A: archive â€” fade out
  if(e.shiftKey&&e.key==='A'){
    e.preventDefault();
    const srcEl=e.target.closest('.kb-card');
    if(srcEl){srcEl.style.transition='opacity 0.2s,transform 0.2s';srcEl.style.opacity='0';srcEl.style.transform='scale(0.95)';}
    setTimeout(()=>{card.archived=!card.archived;save();render();},RENDER_DELAY_MS);
    return;
  }
  // Delete: delete card â€” fade out
  if(e.key==='Delete'){
    e.preventDefault();
    if(!confirm('Karte lÃ¶schen?'))return;
    const srcEl=e.target.closest('.kb-card');
    if(srcEl){srcEl.style.transition='opacity 0.18s,transform 0.18s';srcEl.style.opacity='0';srcEl.style.transform='scale(0.9)';}
    setTimeout(()=>{b.kbCards=b.kbCards.filter(c=>c.id!==cardId);save();render();},ANIM_EXIT_MS);
    return;
  }
}

// MATRIX EDIT ACTIONS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function delCellChild(nodeId,rowId,colId,type){
  const label=type==='board'?'Task Board':'Sub-Matrix';
  if(!confirm(`${label} unwiderruflich lÃ¶schen? Alle enthaltenen Daten gehen verloren.`))return;
  const key=`${rowId}-${colId}`;
  const cell=getCell(nodeId,key);
  if(type==='board'&&cell.boardId){
    delete nodes[cell.boardId];
    cell.boardId=null;
  } else if(type==='matrix'&&cell.matrixId){
    removeTree(cell.matrixId);
    cell.matrixId=null;
  }
  save();render();
}
function iconClick(nodeId,rowId,colId,type,label){
  const key=`${rowId}-${colId}`;const cell=getCell(nodeId,key);
  if(type==='board'){
    if(!cell.boardId){smodal('Task Board Name',[{label:'Name',id:'l',ph:label,v:label}],v=>{cell.boardId=mkBoard(v.l||label);save();openCell(nodeId,rowId,colId,v.l||label,'board');});}
    else openCell(nodeId,rowId,colId,nodes[cell.boardId].label,'board');
  } else {
    if(!cell.matrixId){smodal('Sub-Matrix Name',[{label:'Name',id:'l',ph:label,v:label}],v=>{cell.matrixId=mkMatrix(v.l||label);save();openCell(nodeId,rowId,colId,v.l||label,'matrix');});}
    else openCell(nodeId,rowId,colId,nodes[cell.matrixId].label,'matrix');
  }
}
function openCell(parentId,rowId,colId,label,tab){
  const pseudoId=`cell-${parentId}-${rowId}-${colId}`;
  nodes[pseudoId]={id:pseudoId,type:'cell',label,data:{}};
  setTab(pseudoId,tab);
  // Remove any existing entry for this cell before pushing (dedup)
  const existingIdx=stack.findIndex(s=>s.nodeId===pseudoId);
  if(existingIdx>=0) stack=stack.slice(0,existingIdx);
  stack.push({nodeId:pseudoId,label,cellRef:{parentId,rowId,colId}});
  renderAnimated('in');
}
function renameMatrixNode(nodeId,val){
  const n=nodes[nodeId];if(!n||!val.trim())return;
  n.label=val.trim();
  // Update stack label if present
  const s=stack.find(x=>x.nodeId===nodeId);
  if(s)s.label=val.trim();
  save();renderBC();
}
function renameBoardOrMatrix(nodeId,val,pseudoId){
  const n=nodes[nodeId];if(!n||!val.trim())return;
  n.label=val.trim();
  // Update label in stack
  const s=stack.find(x=>x.nodeId===pseudoId);
  if(s)s.label=val.trim();
  save();renderBC();
}
function toggleEdit(){
  editMode=!editMode;
  document.body.classList.toggle('editing', editMode);
  document.getElementById('content').style.borderLeft=editMode?'3px solid var(--amber)':'';
  document.getElementById('content').style.paddingLeft=editMode?'13px':'14px';
  render();
}
function addRow(nodeId){smodal('Neue Zeile',[{label:'Bezeichnung',id:'l',ph:'z.B. Kunde A'}],v=>{nodes[nodeId].data.rows.push({id:uid(),label:v.l||'Zeile'});save();render();});}
function addCol(nodeId){smodal('Neue Spalte',[{label:'Bezeichnung',id:'l',ph:'z.B. wÃ¶chentlich'}],v=>{nodes[nodeId].data.cols.push({id:uid(),label:v.l||'Spalte'});save();render();});}
function renameRow(nodeId,rowId,val){const r=nodes[nodeId].data.rows.find(x=>x.id===rowId);if(r)r.label=val;save();}
function renameCol(nodeId,colId,val){const c=nodes[nodeId].data.cols.find(x=>x.id===colId);if(c)c.label=val;save();}
function removeTree(nid){
  const n=nodes[nid];if(!n)return;
  if(n.type==='matrix'){Object.values(n.data.cells).forEach(c=>{if(c.boardId){delete nodes[c.boardId];}if(c.matrixId){removeTree(c.matrixId);}});}
  delete nodes[nid];
}
function cleanupCellChildren(cell){
  if(!cell)return;
  if(cell.boardId){delete nodes[cell.boardId];}
  if(cell.matrixId){removeTree(cell.matrixId);}
}
function delRow(nodeId,rowId){if(!confirm('Zeile lÃ¶schen?'))return;const d=nodes[nodeId].data;d.rows=d.rows.filter(r=>r.id!==rowId);Object.keys(d.cells).forEach(k=>{if(k.startsWith(rowId+'-')){cleanupCellChildren(d.cells[k]);delete d.cells[k];}});save();render();}
function delCol(nodeId,colId){if(!confirm('Spalte lÃ¶schen?'))return;const d=nodes[nodeId].data;d.cols=d.cols.filter(c=>c.id!==colId);Object.keys(d.cells).forEach(k=>{if(k.endsWith('-'+colId)){cleanupCellChildren(d.cells[k]);delete d.cells[k];}});save();render();}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// STAMMDATEN: Tags & People management
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let sdTab='tags';
function openStammdaten(){
  sdTab=sdTab||'tags';
  renderStammdaten();
}
function renderStammdaten(){
  const isTags=sdTab==='tags';
  const list=isTags?globalTags:globalPeople;
  const color=isTags?'var(--purplebg)':'var(--bluebg)';
  let h=`<div class="smodal-overlay" onclick="closeSdIfBg(event)">
    <div class="sdmodal" onclick="event.stopPropagation()">
      <div class="sdmodal-hd">
        <h3>Tags &amp; Personen</h3>
        <button class="btn-c" onclick="closeStammdaten()">âœ•</button>
      </div>
      <div class="sd-tabs">
        <div class="sd-tab${sdTab==='tags'?' active':''}" onclick="sdTab='tags';renderStammdaten()">Tags (${globalTags.length})</div>
        <div class="sd-tab${sdTab==='people'?' active':''}" onclick="sdTab='people';renderStammdaten()">Personen (${globalPeople.length})</div>
      </div>
      <div class="sd-body">`;
  list.forEach(item=>{
    h+=`<div class="sd-item">
      <div class="sd-dot" style="background:${color};border:0.5px solid var(--border2);"></div>
      <input value="${esc(item.label)}" onchange="renameGlobal('${isTags?'tags':'people'}','${item.id}',this.value)" />
      <span style="font-size:12px;color:var(--red);cursor:pointer;" onclick="delGlobal('${isTags?'tags':'people'}','${item.id}')">âœ•</span>
    </div>`;
  });
  h+=`<div style="margin-top:10px;">
    <button class="btn" onclick="addGlobal('${isTags?'tags':'people'}')">+ ${isTags?'Neuer Tag':'Neue Person'}</button>
  </div>`;
  h+=`</div></div></div>`;
  document.getElementById('mc').innerHTML=h;
}
function closeSdIfBg(e){if(e.target.classList.contains('smodal-overlay'))closeStammdaten();}
function closeStammdaten(){
  const overlay=document.querySelector('#mc .smodal-overlay');
  if(overlay){overlay.classList.add('closing');setTimeout(()=>{document.getElementById('mc').innerHTML='';render();},SMODAL_EXIT_MS);}
  else{document.getElementById('mc').innerHTML='';render();}
}
function renameGlobal(type,id,val){
  const list=type==='tags'?globalTags:globalPeople;
  const oldLabel=(list.find(x=>x.id===id)||{}).label;
  const item=list.find(x=>x.id===id);
  if(!item)return;
  const newLabel=val.trim();
  if(!newLabel||newLabel===oldLabel)return;
  // Update all cards that use this tag/person
  Object.values(nodes).forEach(n=>{
    if(n.type!=='board')return;
    n.data.kbCards.forEach(card=>{
      if(type==='tags'&&card.tags){card.tags=card.tags.map(t=>t===oldLabel?newLabel:t);}
      if(type==='people'&&card.who){card.who=card.who.map(w=>w===oldLabel?newLabel:w);}
    });
  });
  item.label=newLabel;
  save();
}
function delGlobal(type,id){
  if(!confirm('LÃ¶schen? Wird auch von allen Karten entfernt.'))return;
  const list=type==='tags'?globalTags:globalPeople;
  const item=list.find(x=>x.id===id);
  if(!item)return;
  // Remove from all cards
  Object.values(nodes).forEach(n=>{
    if(n.type!=='board')return;
    n.data.kbCards.forEach(card=>{
      if(type==='tags'&&card.tags)card.tags=card.tags.filter(t=>t!==item.label);
      if(type==='people'&&card.who)card.who=card.who.filter(w=>w!==item.label);
    });
  });
  if(type==='tags')globalTags=globalTags.filter(x=>x.id!==id);
  else globalPeople=globalPeople.filter(x=>x.id!==id);
  save();renderStammdaten();
}
function addGlobal(type){
  const title=type==='tags'?'Neuer Tag':'Neue Person';
  const ph=type==='tags'?'z.B. Reporting':'z.B. Max';
  smodal(title,[{label:'Name',id:'l',ph}],v=>{
    if(!v.l||!v.l.trim())return;
    const l=v.l.trim();
    if(type==='tags'){if(!globalTags.find(x=>x.label===l))globalTags.push({id:uid(),label:l});}
    else{if(!globalPeople.find(x=>x.label===l))globalPeople.push({id:uid(),label:l});}
    save();renderStammdaten();
  });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SIMPLE MODAL
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let mcb=null,mfields=[];
function smodal(title,fields,cb){
  mcb=cb;mfields=fields.map(f=>f.id);
  let h=`<div class="smodal-overlay" onclick="closeS(event)"><div class="smodal"><h3>${title}</h3>`;
  fields.forEach(f=>{
    h+=`<label>${f.label}</label>`;
    if(f.sel)h+=`<select id="mf-${f.id}">${f.sel.map((o,i)=>`<option value="${o}"${f.v===o?' selected':''}>${f.sellabels?f.sellabels[i]:o}</option>`).join('')}</select>`;
    else h+=`<input id="mf-${f.id}" type="text" placeholder="${f.ph||''}" value="${f.v||''}"/>`;
  });
  h+=`<div class="smodal-actions"><button class="btn-c" onclick="closeS()">Abbrechen</button><button class="btn-p" onclick="subS()">OK</button></div></div></div>`;
  document.getElementById('mc').innerHTML=h;
  document.getElementById('mc').onkeydown=e=>{
    if(e.key==='Enter'){
      // Don't submit if focus is on select or textarea
      if(document.activeElement&&(document.activeElement.tagName==='SELECT'||document.activeElement.tagName==='TEXTAREA'))return;
      e.preventDefault();subS();
    }
    // Tab: cycle through focusable fields within modal
    if(e.key==='Tab'){
      const focusable=Array.from(document.getElementById('mc').querySelectorAll('input,select,button'));
      const idx=focusable.indexOf(document.activeElement);
      if(idx>=0){
        e.preventDefault();
        const next=focusable[(idx+(e.shiftKey?-1:1)+focusable.length)%focusable.length];
        if(next)next.focus();
      }
    }
  };
  setTimeout(()=>{const el=document.getElementById('mf-'+fields[0].id);if(el){el.focus();el.select();}},MODAL_FOCUS_DELAY_MS);
}
function subS(){const v={};mfields.forEach(id=>{const el=document.getElementById('mf-'+id);if(el)v[id]=el.value;});document.getElementById('mc').innerHTML='';if(mcb){mcb(v);mcb=null;}}
function closeS(e){
  if(!e||e.target.classList.contains('smodal-overlay')){
    const overlay=document.querySelector('#mc .smodal-overlay');
    if(overlay){overlay.classList.add('closing');setTimeout(()=>{document.getElementById('mc').innerHTML='';mcb=null;},SMODAL_EXIT_MS);}
    else{document.getElementById('mc').innerHTML='';mcb=null;}
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// KEYBOARD HELP
function showKeyboardHelp(){
  const rows=[
    ['Navigation',''],
    ['â†‘ â†“ â† â†’','Matrix-Zellen navigieren'],
    ['Enter','In Board / Sub-Matrix eintreten'],
    ['Escape','Eine Ebene hoch / Modal schlieÃŸen'],
    ['Tab / Shift+Tab','NÃ¤chstes / vorheriges Element'],
    ['',''],
    ['Kanban-Karten',''],
    ['Shift + â† â†’','Karte in Nachbarspalte'],
    ['Shift + â†‘ â†“','Karte umsortieren'],
    ['Shift + A','Karte archivieren'],
    ['Entf','Karte lÃ¶schen'],
    ['Enter','Karte Ã¶ffnen'],
    ['',''],
    ['Global',''],
    ['Ctrl+Shift+E','Bearbeitungsmodus'],
    ['Ctrl+Shift+S','Sofort in Datei speichern'],
  ];
  let h=`<div class="smodal-overlay" onclick="closeS(event)"><div class="smodal" style="width:380px;">
    <h3>TastenkÃ¼rzel</h3>
    <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;">`;
  rows.forEach(([key,desc])=>{
    if(!key&&!desc){h+=`<div style="grid-column:1/-1;height:6px;"></div>`;return;}
    if(!desc){h+=`<div style="grid-column:1/-1;font-size:11px;font-weight:500;color:var(--text2);padding-top:4px;border-bottom:0.5px solid var(--border);padding-bottom:3px;">${key}</div>`;return;}
    h+=`<div style="font-size:12px;font-family:monospace;color:var(--bluetxt);background:var(--bluebg);padding:2px 6px;border-radius:4px;white-space:nowrap;text-align:right;">${key}</div>`;
    h+=`<div style="font-size:12px;color:var(--text);padding:2px 0;">${desc}</div>`;
  });
  h+=`</div><div class="smodal-actions"><button class="btn-p" onclick="closeS()">OK</button></div></div></div>`;
  document.getElementById('mc').innerHTML=h;
}

// SEARCH
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function doSearch(q){
  const el=document.getElementById('searchresults');
  if(!q||q.length<SEARCH_MIN_LEN){el.style.display='none';return;}
  const ql=q.toLowerCase();
  const results=[];
  // Collect all searchable items from entire tree
  function searchNode(nodeId){
    const n=nodes[nodeId];if(!n)return;
    if(n.type==='board'){
      // Cards
      n.data.kbCards.forEach(card=>{
        const score=matchScore(ql,[card.name,stripHtml(card.note),...(card.tags||[]),...(card.who||[])]);
        if(score>0)results.push({type:'card',boardId:nodeId,boardLabel:n.label,id:card.id,name:card.name||'(ohne Name)',from:n.label,score});
      });
      // Info fields
      n.data.infoFields.forEach(f=>{
        if((f.label+' '+stripHtml(f.value)).toLowerCase().includes(ql))
          results.push({type:'info',boardId:nodeId,id:f.id,name:f.label+': '+stripHtml(f.value).slice(0,60),from:n.label+' Â· Info',score:1});
      });
    }
    if(n.type==='matrix'){
      // Matrix label itself
      if(n.label.toLowerCase().includes(ql))results.push({type:'matrix',nodeId,name:n.label,from:'Matrix',score:2});
      Object.values(n.data.cells).forEach(cell=>{
        if(cell.boardId)searchNode(cell.boardId);
        if(cell.matrixId)searchNode(cell.matrixId);
      });
    }
  }
  searchNode(stack[0].nodeId);
  results.sort((a,b)=>b.score-a.score);
  if(results.length===0){
    el.style.display='block';el.classList.add('sr-anim');
    el.innerHTML=`<div style="padding:12px;font-size:12px;color:var(--text3);text-align:center;">Keine Ergebnisse</div>`;
    return;
  }
  el.style.display='block';el.classList.add('sr-anim');
  window._searchResults=results.slice(0,SEARCH_MAX);
  const safe=q.replace(/[.*+?^${}()|\[\]]/g,'\\$&');
  const re=new RegExp('('+safe+')','gi');
  const hi=s=>s?esc(s).replace(re,'<mark class="sr-mark">$1</mark>'):'';
  el.innerHTML=window._searchResults.map((r,i)=>{
    return '<div class="sr-item" onclick="searchOpen('+i+')">'
      +'<div class="sr-name">'+hi(r.name)+'</div>'
      +'<div class="sr-from">'+esc(r.from)+'</div>'
      +'</div>';
  }).join('');
}
function matchScore(q,fields){
  let score=0;
  fields.forEach(f=>{if(f&&f.toLowerCase().includes(q))score+=(f.toLowerCase()===q?3:1);});
  return score;
}
function searchOpen(i){
  const r=(window._searchResults||[])[i];
  if(!r)return;
  closeSearch();
  if(r.type==='card') openCard(r.boardId,r.id);
  else if(r.type==='info'){
    // Navigate to board â€” find parent matrix cell that holds this board
    const boardId=r.boardId;
    if(nodes[boardId]){
      // Find which matrix cell references this board
      let found=false;
      for(const[nid,n]of Object.entries(nodes)){
        if(n.type!=='matrix')continue;
        for(const[k,c]of Object.entries(n.data.cells)){
          if(c.boardId===boardId){
            const[rowId,colId]=k.split('-');
            openCell(nid,rowId,colId,nodes[boardId].label,'info');
            found=true;break;
          }
        }
        if(found)break;
      }
    }
  }
  else if(r.type==='matrix'){
    const s=stack.find(x=>x.nodeId===r.nodeId);
    if(!s)stack.push({nodeId:r.nodeId,label:r.name,cellRef:null});
    render();
  }
}
function closeSearch(){
  const sr=document.getElementById('searchresults');
  sr.classList.remove('sr-anim');sr.style.display='none';
  const inp=document.getElementById('searchinput');
  if(inp)inp.value='';
}
document.addEventListener('click',e=>{
  // Close search dropdown
  if(!e.target.closest('#searchresults')&&!e.target.closest('#searchinput'))
    document.getElementById('searchresults').style.display='none';
  // Close minimap if click outside panel and outside toggle button
  if(mmOpen&&!e.target.closest('#minimap-panel')&&!e.target.closest('[onclick="toggleMM()"]')){
    mmOpen=false;
    document.getElementById('minimap-panel').classList.remove('open');
  }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// UTILS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function esc(s){if(!s)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function sanitizeHtml(s){if(!s)return'';const d=document.createElement('div');d.innerHTML=s;d.querySelectorAll('script,iframe,object,embed,form,meta,link,style').forEach(e=>e.remove());d.querySelectorAll('*').forEach(el=>{for(const a of Array.from(el.attributes)){if(a.name.startsWith('on')||a.name==='srcdoc'||(a.name==='href'&&a.value.trim().toLowerCase().startsWith('javascript:')))el.removeAttribute(a.name);}});return d.innerHTML;}
function sanitizeUrl(url){if(!url)return'';const u=url.trim().toLowerCase();if(u.startsWith('javascript:')||u.startsWith('data:')||u.startsWith('vbscript:'))return'';return url;}
function stripHtml(s){return s?s.replace(/<[^>]+>/g,''):'';  }
function fmtDate(d){if(!d)return'';const x=new Date(d);return x.toLocaleDateString('de-AT',{day:'2-digit',month:'2-digit',year:'numeric'});}
function fmtDateFull(d){return d.toLocaleDateString('de-AT',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});}
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    // Priority 1: close card modal
    if(document.getElementById('cardmodal').innerHTML){closeCard();return;}
    // Priority 2: close simple modal
    if(document.getElementById('mc').innerHTML){closeS();return;}
    // Priority 3: go one level up in stack
    if(stack.length>1){navTo(stack.length-2);}
  }
  // Ctrl+Shift+S â€” Sofort in Datei speichern
  if(e.ctrlKey&&e.shiftKey&&e.key==='S'){e.preventDefault();flushToFile();return;}
  // Ctrl+Shift+E â€” Bearbeitungsmodus toggle (kein Browser-Konflikt)
  if(e.ctrlKey&&e.shiftKey&&e.key==='E'){
    // Don't toggle edit mode when typing in an input/textarea/contenteditable
    const tag=document.activeElement?.tagName;
    const isEditing=tag==='INPUT'||tag==='TEXTAREA'||document.activeElement?.isContentEditable;
    if(!isEditing){e.preventDefault();toggleEdit();}
  }
});

// â”€â”€ THEME: 3-state toggle (sun/moon/auto) â”€â”€
const THEME_KEY='imatrix-theme';
const THEME_ICONS={light:'â˜€',dark:'â˜½',auto:'â—‘'};
const THEME_TITLES={light:'Hell',dark:'Dunkel',auto:'Automatisch'};
const THEME_CYCLE=['light','dark','auto'];
let currentTheme=localStorage.getItem(THEME_KEY)||'auto';

function applyTheme(mode){
  let effective=mode;
  if(mode==='auto'){
    const h=new Date().getHours();
    effective=(h>=7&&h<19)?'light':'dark';
  }
  document.documentElement.setAttribute('data-theme',effective==='dark'?'dark':'');
  const btn=document.getElementById('themebtn');
  if(btn){btn.textContent=THEME_ICONS[mode];btn.title='Design: '+THEME_TITLES[mode];}
}
function cycleTheme(){
  const idx=THEME_CYCLE.indexOf(currentTheme);
  currentTheme=THEME_CYCLE[(idx+1)%THEME_CYCLE.length];
  localStorage.setItem(THEME_KEY,currentTheme);
  applyTheme(currentTheme);
}
applyTheme(currentTheme);
// Auto-mode: recheck every minute
if(currentTheme==='auto')setInterval(()=>{if(currentTheme==='auto')applyTheme('auto');},60000);

render();
// Warn before closing with unsaved file changes
window.addEventListener('beforeunload',e=>{if(fileDirty){e.preventDefault();e.returnValue='';}});
// Init file button
if(hasFileAPI){updateFileBtn();}
else{const fb=document.getElementById('filebtn');if(fb)fb.style.display='none';const sb=document.getElementById('saveasbtn');if(sb)sb.style.display='none';}

