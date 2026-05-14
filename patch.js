const fs = require('fs');

const fpath = 'C:\\Users\\HP\\Desktop\\EXAMENGINE\\script.js';
let text = fs.readFileSync(fpath, 'utf8');

// 1. API_KEY blocks
text = text.replace("if(!API_KEY) throw new Error('No API key.');", "if(!API_KEY) API_KEY=FALLBACK_API_KEY;");
text = text.replace("if(!API_KEY) throw new Error('No API key configured.');", "if(!API_KEY) API_KEY=FALLBACK_API_KEY;");
text = text.replace("if(!API_KEY) throw new Error('No API key.');", "if(!API_KEY) API_KEY=FALLBACK_API_KEY;");
text = text.replace("if(!API_KEY) throw new Error('No API key.');", "if(!API_KEY) API_KEY=FALLBACK_API_KEY;");
text = text.replace("if(!API_KEY) throw new Error('No API key.');", "if(!API_KEY) API_KEY=FALLBACK_API_KEY;");

// 2. UI blockers
text = text.replace(
    "+(!API_KEY?'<div class=\"banner b-warn\">⚠️ No API key — <a onclick=\"navTo(\\'sett\\')\">add your OpenRouter key</a> to generate questions.</div>':'')",
    ""
);
text = text.replace(
    "+(API_KEY?'<button class=\"btn bp\" id=\"genAllBtn\" onclick=\"generateAll()\">⚡ Generate All Questions</button>':'')",
    "+('<button class=\"btn bp\" id=\"genAllBtn\" onclick=\"generateAll()\">⚡ Generate All Questions</button>')"
);
text = text.replace(
    "+(!API_KEY?'<div class=\"banner b-warn\">⚠️ No API key. <a onclick=\"navTo(\\'sett\\')\">Add your OpenRouter key</a> to use these tools.</div>':'')",
    ""
);
text = text.replace(
    "if(!API_KEY){ toast('Add your API key first','warn'); navTo('sett'); return; }",
    "if(!API_KEY) API_KEY=FALLBACK_API_KEY;"
);
text = text.replace(
    "if(!API_KEY||S.generating) return;",
    "if(!API_KEY) API_KEY=FALLBACK_API_KEY;\n  if(S.generating) return;"
);
text = text.replace(
    "if(!API_KEY) return;",
    "if(!API_KEY) API_KEY=FALLBACK_API_KEY;"
);

// 3. SVG in buildPrompt
text = text.replace(
    '{"q":"question text (LaTeX for math)","options":["A","B","C","D"],"answer":0,"topic":"topic","difficulty":"easy|medium|hard"}',
    '{"q":"question text (LaTeX for math)","options":["A","B","C","D"],"answer":0,"topic":"topic","difficulty":"easy|medium|hard","svgDescription":""}'
);
text = text.replace(
    '{"q":"sentence with ___________ at the end where the answer goes","answer":"expected answer","topic":"topic","difficulty":"easy|medium|hard","marks":2}',
    '{"q":"sentence with ___________ at the end where the answer goes","answer":"expected answer","topic":"topic","difficulty":"easy|medium|hard","marks":2,"svgDescription":""}'
);
text = text.replace(
    '{"q":"question text (LaTeX for formulas)","marks":10,"showSteps":true,"topic":"topic","difficulty":"easy|medium|hard"}',
    '{"q":"question text (LaTeX for formulas)","marks":10,"showSteps":true,"topic":"topic","difficulty":"easy|medium|hard","svgDescription":""}'
);

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

// 6. Global Term Synchronization
text = text.replace(
    "window.setAdminTerm=function(term){\n  ADMIN.selectedTerm=term;",
    "window.setAdminTerm=function(term){\n  ADMIN.selectedTerm=term;\n  _saveSetting('defterm', term);"
);
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

// Handle \r\n vs \n for matching
text = text.replace(/\r\n/g, '\n');

fs.writeFileSync(fpath, text, 'utf8');
console.log("JS patch applied!");
