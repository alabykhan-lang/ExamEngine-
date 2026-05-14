const fs = require('fs');
const fpath = 'C:\\Users\\HP\\Desktop\\EXAMENGINE\\script.js';
let text = fs.readFileSync(fpath, 'utf8');

// Normalize \r\n to \n BEFORE replacing!
text = text.replace(/\r\n/g, '\n');

// 4. SVG in batchGen
const old_batch = `      if(Array.isArray(qs)){
        qs.forEach(function(raw,i){
          var s=slots[i]; if(!s) return;
          s.loading=false; s.err=null;
          if(type==='obj'){
            s.q={t:raw.q||raw.question||'',k:'obj',o:raw.options||raw.opts,a:raw.answer,topic:raw.topic,diff:raw.difficulty,g:S.cfg.std,ai:true,marks:1};
          } else if(type==='fitb'){
            s.q={t:raw.q||raw.question||'',k:'fitb',answer:raw.answer||'',topic:raw.topic,diff:raw.difficulty,g:S.cfg.std,ai:true,marks:raw.marks||2};
          } else {
            s.q={t:raw.q||raw.question||'',k:'theory',marks:raw.marks||10,s:raw.showSteps,topic:raw.topic,diff:raw.difficulty,g:S.cfg.std,ai:true};
          }
          var el=$('slot_'+s.id); if(el) el.outerHTML=renderSlot(s);
          scheduleDraftSave();
        });
      }`;
const new_batch = `      if(Array.isArray(qs)){
        for(var i=0; i<qs.length; i++){
          var raw=qs[i];
          var s=slots[i]; if(!s) continue;
          s.loading=false; s.err=null;
          
          var qText = raw.q||raw.question||'';
          if(raw.svgDescription){
            try{
              var svg=await callGeminiDraw(raw.svgDescription, {width:420, height:250});
              if(svg) qText += '<br/><div class="gen-svg-wrap" style="text-align:center;margin:10px 0;">' + svg + '</div>';
            }catch(e){ console.warn('SVG failed:', e.message); }
          }
          
          if(type==='obj'){
            s.q={t:qText,k:'obj',o:raw.options||raw.opts,a:raw.answer,topic:raw.topic,diff:raw.difficulty,g:S.cfg.std,ai:true,marks:1};
          } else if(type==='fitb'){
            s.q={t:qText,k:'fitb',answer:raw.answer||'',topic:raw.topic,diff:raw.difficulty,g:S.cfg.std,ai:true,marks:raw.marks||2};
          } else {
            s.q={t:qText,k:'theory',marks:raw.marks||10,s:raw.showSteps,topic:raw.topic,diff:raw.difficulty,g:S.cfg.std,ai:true};
          }
          var el=$('slot_'+s.id); if(el) el.outerHTML=renderSlot(s);
          scheduleDraftSave();
        }
      }`;
text = text.replace(old_batch, new_batch);

// 5. SVG in genSingleSlot
const old_single = `    var raw=Array.isArray(res)?res[0]:res;
    s.loading=false;
    if(s.k==='obj'){
      s.q={t:raw.q||raw.question||'',k:'obj',o:raw.options||raw.opts,a:raw.answer,topic:raw.topic,diff:raw.difficulty,g:S.cfg.std,ai:true,marks:1};
    } else if(s.k==='fitb'){
      s.q={t:raw.q||raw.question||'',k:'fitb',answer:raw.answer||'',topic:raw.topic,diff:raw.difficulty,g:S.cfg.std,ai:true,marks:raw.marks||2};
    } else {
      s.q={t:raw.q||raw.question||'',k:'theory',marks:raw.marks||10,s:raw.showSteps,topic:raw.topic,diff:raw.difficulty,g:S.cfg.std,ai:true};
    }`;
const new_single = `    var raw=Array.isArray(res)?res[0]:res;
    s.loading=false;
    
    var qText = raw.q||raw.question||'';
    if(raw.svgDescription){
      try{
        var svg=await callGeminiDraw(raw.svgDescription, {width:420, height:250});
        if(svg) qText += '<br/><div class="gen-svg-wrap" style="text-align:center;margin:10px 0;">' + svg + '</div>';
      }catch(e){ console.warn('SVG failed:', e.message); }
    }
    
    if(s.k==='obj'){
      s.q={t:qText,k:'obj',o:raw.options||raw.opts,a:raw.answer,topic:raw.topic,diff:raw.difficulty,g:S.cfg.std,ai:true,marks:1};
    } else if(s.k==='fitb'){
      s.q={t:qText,k:'fitb',answer:raw.answer||'',topic:raw.topic,diff:raw.difficulty,g:S.cfg.std,ai:true,marks:raw.marks||2};
    } else {
      s.q={t:qText,k:'theory',marks:raw.marks||10,s:raw.showSteps,topic:raw.topic,diff:raw.difficulty,g:S.cfg.std,ai:true};
    }`;
text = text.replace(old_single, new_single);

// 6. Global Term Synchronization (Fixing regex escapes)
text = text.replace(
    "\\$('fterm').onchange=function(e){ S.cfg.term=e.target.value; onClassTermChange(); };",
    "\\$('fterm').onchange=function(e){ S.cfg.term=e.target.value; _saveSetting('defterm', e.target.value); onClassTermChange(); };"
);
text = text.replace(
    "\\$('mfterm').onchange=function(e){ S.cfg.term=e.target.value; };",
    "\\$('mfterm').onchange=function(e){ S.cfg.term=e.target.value; _saveSetting('defterm', e.target.value); };"
);
text = text.replace(
    "S.cfg.session=e.target.value;",
    "S.cfg.session=e.target.value; _saveSetting('defsession', e.target.value);"
);

// Without the regex escape since it's just a string match in node
text = text.replace(
    "$('fterm').onchange=function(e){ S.cfg.term=e.target.value; onClassTermChange(); };",
    "$('fterm').onchange=function(e){ S.cfg.term=e.target.value; _saveSetting('defterm', e.target.value); onClassTermChange(); };"
);
text = text.replace(
    "$('mfterm').onchange=function(e){ S.cfg.term=e.target.value; };",
    "$('mfterm').onchange=function(e){ S.cfg.term=e.target.value; _saveSetting('defterm', e.target.value); };"
);

fs.writeFileSync(fpath, text, 'utf8');
console.log("JS patch 2 applied!");
