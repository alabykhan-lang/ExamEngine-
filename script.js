'use strict';

/* ══════════════════════════════════════
   MODELS
══════════════════════════════════════ */
var MODELS = {
  primary:  'deepseek/deepseek-v4-flash:free',
  fallback: 'meta-llama/llama-3.3-70b-instruct:free',
  scheme:   'qwen/qwen3-coder:free',
  lab:      'google/gemma-4-31b-it:free',
  drawing:  'openai/gpt-oss-120b:free',
  autoGen:  'nvidia/nemotron-3-super-120b-a12b:free'
};
/* Free model rotation pool — tried in order when a model has no endpoints */
var FREE_MODEL_POOL = [
  'deepseek/deepseek-v4-flash:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen3-coder:free',
  'google/gemma-4-31b-it:free',
  'openai/gpt-oss-120b:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'qwen/qwen3-next-80b-a3b-instruct:free',
  'google/gemma-4-26b-a4b-it:free'
];
var OR_BASE    = 'https://openrouter.ai/api/v1/chat/completions';
var GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
var OR_REFERER = 'https://examengine.pro';
var OR_TITLE   = 'ExamEngine Pro v12.5';
// No bundled production key: the admin OpenRouter key must come from admin_settings.
var FALLBACK_API_KEY = '';

/* ══════════════════════════════════════
   SUPABASE INIT
══════════════════════════════════════ */
var _supabase;
var _supabaseUrl = (window.ENV && window.ENV.SUPABASE_URL) || '%%SUPABASE_URL%%';
var _supabaseKey = (window.ENV && window.ENV.SUPABASE_ANON_KEY) || '%%SUPABASE_ANON_KEY%%';

function _initSupabase(){
  var lib = window.supabase || (typeof supabase !== 'undefined' ? supabase : null);
  if(lib && lib.createClient){
    _supabase = lib.createClient(_supabaseUrl, _supabaseKey);
    return true;
  }
  return false;
}

// Try immediately (sync CDN scripts should be ready)
_initSupabase();

// Fallback: retry after DOM loads
if(!_supabase){
  document.addEventListener('DOMContentLoaded', function(){
    if(!_initSupabase()){
      var err=document.getElementById('authErr');
      if(err){ err.textContent='Database library failed to load. Check your internet connection and refresh.'; err.classList.add('show'); }
    }
  });
}

/* ── AUTH STATE ───────────────────── */
var CURRENT_USER = null;   // { id, email, name, role }
var _authMode = 'login';

/* ── TAB SWITCHER ─────────────────── */
window.authTab = function(mode){
  _authMode = mode;
  clearAuthErr();
  var lp=$('authLoginPanel'), rp=$('authRegisterPanel');
  var tl=$('tabLogin'), tr=$('tabRegister');
  if(mode==='login'){
    if(lp) lp.style.display='block';
    if(rp) rp.style.display='none';
    if(tl){ tl.style.background='var(--blue)'; tl.style.color='#fff'; tl.style.fontWeight='700'; }
    if(tr){ tr.style.background='transparent'; tr.style.color='var(--mute)'; tr.style.fontWeight='600'; }
  } else {
    if(lp) lp.style.display='none';
    if(rp) rp.style.display='block';
    if(tr){ tr.style.background='var(--blue)'; tr.style.color='#fff'; tr.style.fontWeight='700'; }
    if(tl){ tl.style.background='transparent'; tl.style.color='var(--mute)'; tl.style.fontWeight='600'; }
  }
};

/* ── SIGN IN ──────────────────────── */
window.doLogin = async function(){
  // Re-init if not ready
  if(!_supabase){ _initSupabase(); }
  if(!_supabase){ showAuthErr('Database not ready. Please refresh the page.'); return; }
  var email = ($('authEmail')||{}).value||'';
  var pass  = ($('authPass')||{}).value||'';
  email = email.trim().toLowerCase();
  if(!email||!pass){ showAuthErr('Please enter your email and password.'); return; }
  setAuthLoading(true);
  try{
    var res = await _supabase.auth.signInWithPassword({ email: email, password: pass });
    if(res.error){ setAuthLoading(false); showAuthErr(res.error.message); return; }
    await _loadUserAndBoot(res.data.user);
  }catch(e){
    var msg = e.message||'';
    // Retry once on transient network failure
    if(msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('network')){
      try{
        await new Promise(function(r){ setTimeout(r, 1500); });
        var res2 = await _supabase.auth.signInWithPassword({ email: email, password: pass });
        if(res2.error){ setAuthLoading(false); showAuthErr(res2.error.message); return; }
        await _loadUserAndBoot(res2.data.user);
        return;
      }catch(e2){
        setAuthLoading(false);
        showAuthErr('Cannot reach the database server. Your Supabase project may be paused — visit supabase.com/dashboard to resume it, then try again.');
        return;
      }
    }
    setAuthLoading(false);
    showAuthErr('Sign in failed: '+msg);
  }
};

/* ── REGISTER ─────────────────────── */
window.doRegister = async function(){
  if(!_supabase){ _initSupabase(); }
  if(!_supabase){ showAuthErr('Database not ready. Please refresh the page.'); return; }
  var name  = ($('regName')||{}).value||'';
  var email = ($('regEmail')||{}).value||'';
  var pass  = ($('regPass')||{}).value||'';
  var pass2 = ($('regPass2')||{}).value||'';
  name  = name.trim();
  email = email.trim().toLowerCase();
  pass  = pass.trim();
  pass2 = pass2.trim();
  if(!name)       { showAuthErr('Please enter your full name.'); return; }
  if(!email)      { showAuthErr('Please enter your email address.'); return; }
  if(pass.length < 6){ showAuthErr('Password must be at least 6 characters.'); return; }
  if(pass!==pass2){ showAuthErr('Passwords do not match.'); return; }
  setAuthLoading(true);
  try{
    var res = await _supabase.auth.signUp({ email: email, password: pass });
    if(res.error){ setAuthLoading(false); showAuthErr(res.error.message); return; }
    var uid = res.data.user && res.data.user.id;
    if(!uid){ setAuthLoading(false); showAuthErr('Registration failed. Please try again.'); return; }
    await _supabase.from('profiles').upsert({ id:uid, email:email, name:name, role:'teacher' });
    var loginRes = await _supabase.auth.signInWithPassword({ email:email, password:pass });
    if(loginRes.error){ setAuthLoading(false); showAuthErr('Account created! Please sign in.'); authTab('login'); return; }
    await _loadUserAndBoot(loginRes.data.user);
  }catch(e){ setAuthLoading(false); showAuthErr('Registration failed: '+e.message); }
};

window.forgotPassword = async function(){
  if(!_supabase){ _initSupabase(); }
  if(!_supabase){ showAuthErr('Database not ready. Please refresh the page.'); return; }
  var email=(($('authEmail')||{}).value||'').trim().toLowerCase();
  if(!email){ showAuthErr('Enter your email address first, then click reset.'); return; }
  setAuthLoading(true);
  try{
    var res=await _supabase.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});
    setAuthLoading(false);
    if(res.error){ showAuthErr(res.error.message); return; }
    showAuthErr('Password reset link sent. Check your email inbox.');
  }catch(e){ setAuthLoading(false); showAuthErr('Reset failed: '+e.message); }
};

window.completePasswordReset = async function(){
  if(!_supabase){ _initSupabase(); }
  var card = document.querySelector('.auth-card');
  if(!card) return;
  
  // Save original content
  if(!window._origAuthCard) window._origAuthCard = card.innerHTML;
  
  card.innerHTML = '<div class="auth-logo"><div class="auth-logo-mark">E</div><div class="auth-logo-name">Reset Password</div></div>'
    +'<div style="font-size:13px;color:var(--mute);margin-bottom:20px;text-align:center;">Please enter your new password below.</div>'
    +'<div class="auth-err" id="resetErr"></div>'
    +'<div class="auth-field"><label>New Password</label><input type="password" id="resetP1" placeholder="Min 6 characters"/></div>'
    +'<div class="auth-field"><label>Confirm New Password</label><input type="password" id="resetP2" placeholder="Repeat password"/></div>'
    +'<button class="auth-btn" id="resetBtn" onclick="doCompletePasswordReset()">Update Password →</button>';
};

window.doCompletePasswordReset = async function(){
  var p1 = ($('resetP1')||{}).value||'';
  var p2 = ($('resetP2')||{}).value||'';
  var err = $('resetErr');
  var btn = $('resetBtn');
  var showErr = function(msg){ err.textContent=msg; err.classList.add('show'); };
  
  if(p1.length<6){ showErr('Password must be at least 6 characters.'); return; }
  if(p1!==p2){ showErr('Passwords do not match.'); return; }
  
  err.classList.remove('show');
  btn.disabled = true; btn.textContent = 'Updating...';
  
  try{
    var res=await _supabase.auth.updateUser({password:p1});
    if(res.error){ btn.disabled=false; btn.textContent='Update Password →'; showErr(res.error.message); return; }
    
    // Restore auth card and show success
    var card = document.querySelector('.auth-card');
    if(card && window._origAuthCard) card.innerHTML = window._origAuthCard;
    authTab('login');
    showAuthErr('Password reset successful. Please sign in with your new password.');
  }catch(e){ btn.disabled=false; btn.textContent='Update Password →'; showErr('Password update failed: '+e.message); }
};

window.doLogout = async function(){
  if(!confirm('Sign out?')) return;
  await _supabase.auth.signOut();
  CURRENT_USER = null;
  showAuthScreen();
};

function showAuthErr(msg){
  var el=$('authErr'); if(!el) return;
  el.textContent=msg; el.classList.add('show');
}
function clearAuthErr(){ var el=$('authErr'); if(el) el.classList.remove('show'); }
function setAuthLoading(on){
  var btn=$('authBtn'), rb=$('regBtn'), sp=$('authSpinner');
  if(btn){ btn.disabled=on; btn.textContent=on?'Signing in…':'Sign In →'; }
  if(rb){  rb.disabled=on;  rb.textContent=on?'Creating account…':'Create Account →'; }
  if(sp){ sp.classList.toggle('show',on); }
}

/* ── Load profile from DB ─────────── */
async function _loadUserAndBoot(authUser){
  try{
    var blocked=await _getBlockedUsers();
    var blockedHit=blocked.find(function(u){ return u&&(u.id===authUser.id||String(u.email||'').toLowerCase()===String(authUser.email||'').toLowerCase()); });
    if(blockedHit){
      await _supabase.auth.signOut();
      showAuthScreen();
      showAuthErr('This account has been removed by the admin.');
      return;
    }
    var res = await _supabase.from('profiles').select('*').eq('id', authUser.id).single();
    var profile = res.data;
    if(!profile){
      var name = (authUser.email||'').split('@')[0];
      var insertRes = await _supabase.from('profiles').insert({
        id: authUser.id, email: authUser.email, name: name, role: 'teacher'
      }).select().single();
      profile = insertRes.data || { id:authUser.id, email:authUser.email, name:name, role:'teacher' };
    }
    CURRENT_USER = { id:profile.id, email:profile.email, name:profile.name||profile.email, role:profile.role||'teacher' };
    if((CURRENT_USER.email||'').toLowerCase()==='alabykhan@gmail.com' && CURRENT_USER.role!=='admin'){
      CURRENT_USER.role='admin';
      try{ await _supabase.from('profiles').update({role:'admin'}).eq('id',CURRENT_USER.id); }catch(roleErr){ console.warn('super admin role sync failed:',roleErr.message); }
    }
    hideAuthScreen();
    bootApp();
  } catch(e){
    setAuthLoading(false);
    showAuthErr('Could not load profile: '+e.message+'. Please try again.');
  }
}

async function _getBlockedUsers(){
  try{
    var res=await _supabase.from('admin_settings').select('value').eq('key','blocked_users').single();
    if(res.data&&res.data.value) return JSON.parse(res.data.value)||[];
  }catch(e){}
  return [];
}

/* ── Load user settings from Supabase ── */
async function _loadUserSettings(){
  if(!CURRENT_USER) return;
  try{
    var res = await _supabase.from('user_settings').select('*').eq('user_id', CURRENT_USER.id);
    if(res.error){ console.warn('user_settings load error:', res.error.message); }
    var m = {};
    (res.data||[]).forEach(function(r){ m[r.key]=r.value; });

    // Migrate localStorage to Supabase
    var oldKey = localStorage.getItem('ee_api_key') || localStorage.getItem('api_key');
    if (oldKey && !m.api_key) {
      _saveSetting('api_key', oldKey);
      m.api_key = oldKey;
      localStorage.removeItem('ee_api_key');
      localStorage.removeItem('api_key');
    }

    S.tradeSubject  = m.trade    || DEFAULT_TRADE;
    S.cfg.school    = m.school   || '';
    // Restore in-progress draft if present
    if(m.current_draft){
      try{
        var draft=JSON.parse(m.current_draft);
        if(draft && draft.slots && draft.slots.length && draft.cfg){
          window._savedDraft=draft;
        }
      }catch(e){}
    }
    // Store per-user api_key + term/session temporarily
    window._userApiKey      = m.api_key     || '';
    window._userDefTerm     = m.defterm     || '';
    window._userDefSession  = m.defsession  || '';
  }catch(e){ console.warn('_loadUserSettings exception:', e.message); }

  // Pre-load admin settings (shared across all devices — sets API key, term, branding)
  await _fetchAdminSettings();
  var adm = getAdminSettings();
  applyAdminSettings();

  // ── API KEY: admin_settings > user_settings ──
  // Auto-promote admin's device key to global if global slot is empty
  if(CURRENT_USER && CURRENT_USER.role==='admin' && isUsableApiKey(window._userApiKey) && !adm.api_key){
    adm.api_key = cleanApiKey(window._userApiKey);
    await _saveAdminSetting('api_key',adm.api_key);
  }
  // Apply key: global > per-user. Empty means no valid key is configured.
  API_KEY = isUsableApiKey(adm.api_key) ? cleanApiKey(adm.api_key) : (isUsableApiKey(window._userApiKey) ? cleanApiKey(window._userApiKey) : '');

  // ── TERM: admin_settings > user_settings > '1st Term' ──
  // Priority: global admin setting first, then what the user personally saved
  if(getAdminSettings().selected_term){
    S.cfg.term = getAdminSettings().selected_term;
  } else if(window._userDefTerm){
    S.cfg.term = window._userDefTerm;
    // Push user's saved term up to global so all devices sync
    if(CURRENT_USER && CURRENT_USER.role==='admin'){
      _supabase.from('admin_settings').upsert({key:'selected_term',value:window._userDefTerm},{onConflict:'key'});
      if(window._adminSettingsCache) window._adminSettingsCache.selected_term=window._userDefTerm;
    }
  } else {
    S.cfg.term = '1st Term';
  }

  // ── SESSION: admin_settings > user_settings > '2025/2026' ──
  if(getAdminSettings().selected_session){
    S.cfg.session = getAdminSettings().selected_session;
  } else if(window._userDefSession){
    S.cfg.session = window._userDefSession;
    if(CURRENT_USER && CURRENT_USER.role==='admin'){
      _supabase.from('admin_settings').upsert({key:'selected_session',value:window._userDefSession},{onConflict:'key'});
      if(window._adminSettingsCache) window._adminSettingsCache.selected_session=window._userDefSession;
    }
  } else {
    S.cfg.session = '2025/2026';
  }

  if(CURRENT_USER && CURRENT_USER.role==='admin'){
    ADMIN.selectedTerm = S.cfg.term;
  }
}

/* ── Robust single-key upsert helper ── */
async function _saveSetting(key, value){
  if(!CURRENT_USER) return;
  try{
    var res=await _supabase.from('user_settings').upsert(
      {user_id:CURRENT_USER.id, key:key, value:value},
      {onConflict:'user_id,key'}
    );
    if(res.error){
      // Fallback: try delete + insert if upsert fails (constraint may not exist)
      await _supabase.from('user_settings').delete().eq('user_id',CURRENT_USER.id).eq('key',key);
      await _supabase.from('user_settings').insert({user_id:CURRENT_USER.id, key:key, value:value});
    }
  }catch(e){ console.warn('_saveSetting failed:', key, e.message); }
}
async function _saveAdminSetting(key,value){
  if(!_supabase) return false;
  try{
    var res=await _supabase.from('admin_settings').upsert({key:key,value:value},{onConflict:'key'});
    if(res.error){ console.warn('admin_settings save failed:', key, res.error.message); return false; }
    if(!window._adminSettingsCache) window._adminSettingsCache={};
    window._adminSettingsCache[key]=value;
    return true;
  }catch(e){ console.warn('admin_settings save exception:', key, e.message); return false; }
}
async function markApiKeyInvalid(key){
  key=cleanApiKey(key);
  if(!key) return;
  _badApiKeys[key]=true;
  if(cleanApiKey(API_KEY)===key) API_KEY='';
  // Also clear from admin cache so applyAdminSettings() won't re-inject the bad key
  if(window._adminSettingsCache && cleanApiKey(window._adminSettingsCache.api_key)===key){
    window._adminSettingsCache.api_key='';
  }
}

/* ── Auto-save draft to Supabase ── */
var _draftSaveTimer=null;
function scheduleDraftSave(){
  clearTimeout(_draftSaveTimer);
  _draftSaveTimer=setTimeout(function(){
    if(!CURRENT_USER||!S.slots.length) return;
    var draft={
      cfg:JSON.parse(JSON.stringify(S.cfg)),
      at:S.at,
      path:S.path,
      scr:S.scr,
      tradeSubject:S.tradeSubject,
      difficultyLevel:S.difficultyLevel,
      slots:S.slots.filter(function(s){ return s.q; }).map(function(s){
        return {id:s.id,k:s.k,q:s.q,included:s.included};
      }),
      schemeWeeks:S.schemeWeeks,
      ts:Date.now()
    };
    _saveSetting('current_draft', JSON.stringify(draft));
  }, 3000); // debounce 3s
}
function clearDraft(){
  _saveSetting('current_draft','');
  window._savedDraft=null;
}
function showAuthScreen(){
  var c=$('c-auth'); if(c){ c.style.display='block'; c.style.position='fixed'; c.style.inset='0'; c.style.zIndex='10000'; }
  var s=$('screen-auth'); if(s){ s.style.display='flex'; s.style.position='fixed'; s.style.inset='0'; s.style.zIndex='10001'; s.style.background='linear-gradient(135deg,#0A0F1E 0%,#1B2A4A 100%)'; s.style.alignItems='center'; s.style.justifyContent='center'; s.style.flexDirection='column'; s.style.padding='24px'; }
  var nav=$('c-nav'); if(nav) nav.style.display='none';
  var sb=$('c-sidebar'); if(sb) sb.style.display='none';
  var sc=$('c-screens'); if(sc) sc.style.display='none';
  clearAuthErr(); setAuthLoading(false);
  var p=$('authPass'); if(p) p.value='';
}
function hideAuthScreen(){
  var c=$('c-auth'); if(c) c.style.display='none';
  var s=$('screen-auth'); if(s) s.style.display='none';
  var nav=$('c-nav'); if(nav) nav.style.display='';
  var sb=$('c-sidebar'); if(sb) sb.style.display='';
  var sc=$('c-screens'); if(sc) sc.style.display='';
}

/* ── Boot the app after auth ────────── */
async function bootApp(){
  var chip=$('userChipName');
  if(chip) chip.textContent = (CURRENT_USER.name||CURRENT_USER.email).split(' ')[0];

  // Init app state from Supabase user_settings
  await _loadUserSettings();

  // Force super-admin role
  if((CURRENT_USER.email||'').toLowerCase()==='alabykhan@gmail.com') CURRENT_USER.role='admin';

  // Force role based on DB profile — admins cannot be faked
  ROLE = CURRENT_USER.role === 'admin' ? 'admin' : 'teacher';
  _applyRoleUI(ROLE);
  _applyRoleSidebarLinks(ROLE);
  applyAdminSettings();
  refreshApiStatus();
  startDeadlineWatcher();

  // Admin: start polling for new submissions every 60s
  if(ROLE==='admin'){
    clearInterval(window._adminPollTimer);
    window._adminPollTimer=setInterval(async function(){
      if(S.screen==='admin-dash'){
        var count=await _supabase.from('papers').select('id',{count:'exact',head:true}).eq('status','submitted');
        var n=count.count||0;
        var badge=$('adminNewBadge');
        if(badge) badge.textContent=n>0?n+' new':'';
        if(badge) badge.style.display=n>0?'inline-block':'none';
      }
    },60000);
  }

  renderDash();
  $('screen-dash').style.display='block';
}

/* ── ROLE STATE ───────────────────── */
var ROLE = 'teacher'; // always set from DB, never from button click alone

function _applyRoleUI(role){
  var nt=$('sbNavTeacher'), na=$('sbNavAdmin');
  var st=$('swTeacher'),    sa=$('swAdmin');
  var bm=$('sbBrandMark'),  bn=$('sbBrandName');
  var rb=$('navRoleBadge');
  var rs=$('roleSwitcher'); // role-switcher container
  if(role==='admin'){
    if(nt) nt.style.display='none';
    if(na) na.style.display='block';
    if(st){ st.classList.remove('active'); }
    if(sa){ sa.classList.add('active'); }
    if(bm){ bm.style.background='var(--admin)'; bm.style.boxShadow='var(--sh-admin)'; }
    if(bn){ bn.style.color='var(--admin)'; }
    if(rb){ rb.className='role-badge admin'; rb.textContent='Admin'; }
    // Show role-switcher only for admins
    if(rs) rs.style.display='';
  } else {
    if(nt) nt.style.display='block';
    if(na) na.style.display='none';
    if(sa){ sa.classList.remove('active'); }
    if(st){ st.classList.add('active'); }
    if(bm){ bm.style.background='var(--blue)'; bm.style.boxShadow='var(--sh-blue)'; }
    if(bn){ bn.style.color='var(--blue)'; }
    if(rb){ rb.className='role-badge teacher'; rb.textContent='Teacher'; }
  }
  // Show role-switcher only for users who are true admins in the DB
  if(rs){
    rs.style.display = (CURRENT_USER && CURRENT_USER.role==='admin') ? '' : 'none';
  }
}

window.switchRole = function(role){
  // Only allow role switch if user actually has that role in DB
  if(role==='admin' && CURRENT_USER && CURRENT_USER.role!=='admin'){
    toast('⛔ Admin access only — contact your administrator','err',4000);
    return;
  }
  ROLE = role;
  _applyRoleUI(role);
  navTo(role==='admin'?'admin-dash':'dash');
  closeSidebar();
};

/* ══════════════════════════════════════
   NERDC 2026 — HARDCODED. EXACT AS PROVIDED.
══════════════════════════════════════ */
var NERDC = {
  'Primary 1-3': [
    'English Studies','Mathematics','Yoruba Language',
    'Nigerian Language (Igbo/Hausa)','Basic Science',
    'Physical & Health Education','Nigerian History',
    'Social and Citizenship Studies','Cultural & Creative Arts (CCA)',
    'I.R.S','Arabic (Optional)'
  ],
  'Primary 4-6': [
    'English Studies','Mathematics','Yoruba Language',
    'Nigerian Language (Igbo/Hausa)','Basic Science & Technology',
    'Physical & Health Education','Basic Digital Literacy',
    'Nigerian History','Social and Citizenship Studies',
    'Cultural & Creative Arts (CCA)','Pre-vocational Studies (Agric/Home Ec)',
    'French','I.R.S'
  ],
  'JSS 1-3': [
    'English Studies','Mathematics','Yoruba Language',
    'Nigerian Language (Igbo/Hausa)','Intermediate Science',
    'Physical & Health Education','Digital Technologies',
    'Nigerian History','Social and Citizenship Studies','Business Studies',
    'Cultural & Creative Arts (CCA)','French','I.R.S',
    'Trade Subject','Arabic (Optional)'
  ],
  'SS 1-3': [
    'English Language (Core)','General Mathematics (Core)',
    'Citizenship and Heritage Studies (Core)','Digital Technologies (Core)',
    'Trade Subject','Yoruba Language','Biology','Chemistry','Physics',
    'Further Mathematics','Agricultural Science','Geography','Economics',
    'Government','Literature-in-English','Financial Accounting','Commerce',
    'Nigerian History','I.R.S'
  ],
  'Creche': [
    'English Language','Mathematics','Social Habits','Health Habits','Poem','Physical and Health Education'
  ],
  'KG': [
    'English Language','Mathematics','Social Habits','Health Habits','Poem','Handwriting','P.H.E'
  ],
  'Nursery 1': [
    'English Language','Mathematics','Handwriting','Social Habits','Elementary Science','Health Habits','Yoruba'
  ],
  'Nursery 2': [
    'English Language','Mathematics','Handwriting','Verbal Reasoning','Quantitative Reasoning','Elementary Science','Civic Education','Social Studies'
  ],
  'Early': [
    'English Language','Mathematics','Literacy and Numeracy',
    'Cultural & Creative Arts','Physical & Health Education',
    'I.R.S','Yoruba Language','Nigerian Language','Social Habits'
  ]
};

var TRADE_SUBJECTS = [
  { id:'livestock', name:'Livestock Farming', icon:'🐄', desc:'Animal husbandry, rearing, and farm management' },
  { id:'solar',     name:'Solar Energy Tech',  icon:'☀️', desc:'Installation, maintenance, photovoltaic systems' },
  { id:'fashion',   name:'Fashion & Design',   icon:'✂️', desc:'Garment construction, textiles, pattern cutting' },
  { id:'beauty',    name:'Beauty Therapy',     icon:'💄', desc:'Cosmetology, skin care, nail technology' }
];
var DEFAULT_TRADE = 'livestock';

function getSubjectList(cls) {
  if (!cls) return NERDC['SS 1-3'];
  var c = cls.toLowerCase();
  if (c === 'creche') return NERDC['Creche'];
  if (c.includes('kg')) return NERDC['KG'];
  if (c === 'nursery 1') return NERDC['Nursery 1'];
  if (c === 'nursery 2') return NERDC['Nursery 2'];
  if (c.includes('nursery')) return NERDC['Early'];
  if (c.includes('primary')) {
    var n = parseInt(c.replace(/\D/g,'')) || 0;
    return n <= 3 ? NERDC['Primary 1-3'] : NERDC['Primary 4-6'];
  }
  if (c.includes('jss')) return NERDC['JSS 1-3'];
  if (c.includes('ss'))  return NERDC['SS 1-3'];
  return NERDC['SS 1-3'];
}
function canonicalClassName(cls){
  var s=String(cls||'').trim();
  var n=s.toLowerCase().replace(/[\s._-]+/g,'');
  var map={kg1:'KG 1',kg2:'KG 2',nursery1:'Nursery 1',nursery2:'Nursery 2',creche:'Creche'};
  if(map[n]) return map[n];
  var primary=n.match(/^primary([1-6])$/); if(primary) return 'Primary '+primary[1];
  var jss=n.match(/^jss([1-3])$/); if(jss) return 'JSS '+jss[1];
  var ss=n.match(/^ss([1-3])$/); if(ss) return 'SS '+ss[1];
  return s;
}

function isTradeSubject(cls) {
  if (!cls) return false;
  var c = cls.toLowerCase();
  return c.includes('jss') || c.includes('ss');
}

/* ══════════════════════════════════════
   STATIC DATA
══════════════════════════════════════ */
var L = ['A','B','C','D'];
var CL = ['Creche','KG 1','KG 2','Nursery 1','Nursery 2',
  'Primary 1','Primary 2','Primary 3','Primary 4','Primary 5','Primary 6',
  'JSS 1','JSS 2','JSS 3','SS 1','SS 2','SS 3'];
var TERMS    = ['1st Term','2nd Term','3rd Term'];
var STANDARDS = ['WAEC','NECO','JAMB','BECE','Common Entrance','NABTEB','Cambridge IGCSE','Custom/Internal'];

function stdTagCls(s) {
  var m={'WAEC':'t-waec','JAMB':'t-jamb','NECO':'t-neco','BECE':'t-bece','Common Entrance':'t-ce'};
  return m[s]||'t-cust';
}

/* ══════════════════════════════════════
   GLOBAL STATE
══════════════════════════════════════ */
var API_KEY = '';

function cleanApiKey(v){
  return String(v||'').trim().replace(/^["']|["']$/g,'').replace(/\s+/g,'');
}
var _badApiKeys={};
function looksLikeOpenRouterKey(v){
  v=cleanApiKey(v);
  return !!(v && (/^sk-or-v1-[A-Za-z0-9_-]{20,}$/.test(v)||/^AIza[0-9A-Za-z_-]{20,}$/.test(v)));
}
function apiProviderForKey(v){
  v=cleanApiKey(v);
  if(/^AIza[0-9A-Za-z_-]{20,}$/.test(v)) return 'google';
  if(/^sk-or-v1-[A-Za-z0-9_-]{20,}$/.test(v)) return 'openrouter';
  return '';
}
function isUsableApiKey(v){
  v=cleanApiKey(v);
  return !!(looksLikeOpenRouterKey(v) && !_badApiKeys[v]);
}
function getVisibleApiKeyInput(){
  var ids=['settKeyInp2','settKeyInp'];
  for(var i=0;i<ids.length;i++){
    var el=$(ids[i]);
    if(el && el.value && el.getClientRects && el.getClientRects().length){
      var v=cleanApiKey(el.value);
      if(looksLikeOpenRouterKey(v)) return v;
    }
  }
  return '';
}
function getEffectiveApiKey(){
  var live=getVisibleApiKeyInput();
  if(live){
    delete _badApiKeys[live];
    API_KEY=live;
    return live;
  }
  var adm=(window._adminSettingsCache&&window._adminSettingsCache.api_key)||'';
  var user=window._userApiKey||'';
  var keys=[adm,user,API_KEY].map(cleanApiKey);
  var key=keys.find(isUsableApiKey)||'';
  if(key && key!==API_KEY) API_KEY=key;
  return key;
}
function ensureApiKey(){
  var key=getEffectiveApiKey();
  var visible=getVisibleApiKeyInput();
  if(visible && visible!== (($('settKeyInp2')||$('settKeyInp')||{}).value||'')){
    var inp=$('settKeyInp2')||$('settKeyInp');
    if(inp) inp.value=visible;
  }
  refreshApiStatus();
  return key;
}

var S = {
  screen: 'dash',   // dash | gate | app | load | arch | sett
  path:   null,     // auto | manual
  scr:    0,        // app step 1-3
  at:     'Examination',
  difficultyLevel: 'Balanced',
  tradeSubject: DEFAULT_TRADE,
  schemeMode: null,
  manualSchemeFiles: [],
  _navStack: [],
  cfg: {
    cls:'', term:'1st Term', session:'2025/2026', subj:'', std:'',
    topics:[], topicText:'',
    objN:10, fitbN:0, thN:5,
    instr:'Answer all questions. Time allowed: 1 hour 30 minutes.',
    theoryPaperInstr:'', theoryAiInstr:'', school:''
  },
  subjects:[], schemeWeeks:[], schemeLoaded:false, schemeCommitted:false,
  slots:[], ocrSlots:[], ntxSlots:[], generating:false, cam:null,
  _imgQueue:[], _ntxQueue:[]
};

/* ══════════════════════════════════════
   UTILS
══════════════════════════════════════ */
function $(id){ return document.getElementById(id); }
function esc(s){ if(!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function math(el){
  if(!window.renderMathInElement) return;
  try{ window.renderMathInElement(el,{delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false},{left:'\\(',right:'\\)',display:false},{left:'\\[',right:'\\]',display:true}],throwOnError:false}); }catch(e){}
}
function renderRichText(s){
  if(!s) return '';
  var safe=esc(s);
  safe=safe.replace(/\n/g,'<br/>');
  safe=safe.replace(/\[TABLE:([\s\S]*?)\]/gi,function(_,body){ return renderInlineTable(body); });
  safe=safe.replace(/\[GRAPH:([\s\S]*?)\]/gi,function(_,body){ return '<div class="visual-card graph-card">'+esc(body).replace(/\|/g,'<br/>')+'</div>'; });
  safe=safe.replace(/\[SHAPE:([\s\S]*?)\]/gi,function(_,body){ return '<div class="visual-card shape-card">'+esc(body).replace(/\|/g,'<br/>')+'</div>'; });
  return safe;
}
function renderInlineTable(body){
  var rows=String(body||'').split('|').map(function(r){ return r.trim(); }).filter(Boolean);
  if(!rows.length) return '';
  return '<table class="exam-inline-table">'+rows.map(function(r,i){
    var cells=r.split(';').map(function(c){ return '<'+(i===0?'th':'td')+'>'+esc(c.trim())+'</'+(i===0?'th':'td')+'>'; }).join('');
    return '<tr>'+cells+'</tr>';
  }).join('')+'</table>';
}
function renderQuestionText(q,opts){
  opts=opts||{};
  if(!q) return '';
  var html=renderRichText(q.t||q.q||'');
  if(q.svgInline) html+='<div class="gen-svg-wrap">'+q.svgInline+'</div>';
  if(q._svgDiagram) html+='<div class="gen-svg-wrap">'+q._svgDiagram+'</div>';
  if(q.svgHint&&!q.svgInline&&!q._svgDiagram&&opts.showVisualPlaceholders&&!q.customImg) html+='<div class="visual-card shape-card"><strong>Visual:</strong> '+esc(q.svgHint)+'</div>';
  if(q.customImg) html+='<div class="custom-diagram-box" style="margin-top:8px;text-align:center;"><img src="'+q.customImg+'" class="custom-diagram-img" style="max-width:100%;max-height:55mm;object-fit:contain;" alt="Uploaded Diagram"/></div>';
  if(q.diagImg) html+='<div class="diagram-box"><img src="'+q.diagImg+'" alt="Diagram" onclick="showDiagramFull(this.src)" title="Click to expand"/><span class="diagram-label">Source diagram</span></div>';
  else if(q.diagDesc&&opts.showVisualPlaceholders) html+='<div class="visual-card shape-card"><strong>Diagram:</strong> '+esc(q.diagDesc)+'</div>';
  return html;
}
function questionMarks(q){
  var n=Number(q&&q.marks);
  return isFinite(n)&&n>0?n:0;
}
function hasPositiveMarks(q){ return questionMarks(q)>0; }
function sumQuestionMarks(qs){
  return (qs||[]).reduce(function(a,q){ return a+questionMarks(q); },0);
}
function marksLabel(n){
  n=Number(n);
  return isFinite(n)&&n>0?(n+' mark'+(n===1?'':'s')):'';
}
function totalMarksHtml(total, strong){
  var label=marksLabel(total);
  if(!label) return '';
  return strong?'<strong>'+label+'</strong>':label;
}
function normalizeSubjectName(s){
  s=String(s||'').trim();
  if(!s) return s;
  if(/^(c\.?r\.?s\.?|christian religious studies|religious studies \(crs\/is\)|religious studies)$/i.test(s)) return 'I.R.S';
  if(/^(islamic studies|islamic religious studies|i\.?r\.?s\.?)$/i.test(s)) return 'I.R.S';
  return s;
}
function paperSchoolName(p,adm){
  var adminName=(adm&&adm.school)||'';
  if(adminName && adminName!=='School Administration') return adminName;
  return (p&&p.school)||S.cfg.school||'School';
}
function paperLogo(p,adm){
  return (adm&&adm.logo)||(p&&p.logo)||'';
}
function renderVisualEditor(kind,id,q){
  q=q||{};
  var hint=esc(q.svgHint||q.diagDesc||'');
  return '<div class="visual-editor">'
    +'<div class="visual-editor-head"><span>Diagram / Shape</span>'
    +(q.svgInline||q._svgDiagram?'<span class="tag t-ai">Rendered</span>':hint?'<span class="tag t-cust">Description ready</span>':'<span class="tag">Optional</span>')
    +'</div>'
    +'<textarea class="fta visual-editor-input" placeholder="Describe a diagram, graph, table, apparatus, shape, labelled figure, axes, measurements..." oninput="updVisualHint(\''+kind+'\','+id+',this.value)">'+hint+'</textarea>'
    +'<div class="visual-editor-actions">'
    +'<button class="btn bq bsm" onclick="drawVisualForSlot(\''+kind+'\','+id+')">▣ Render visual</button>'
    +'<button class="btn bq bsm" onclick="uploadVisualForSlot(\''+kind+'\','+id+')">🖼️ Upload Image</button>'
    +'<button class="btn bq bsm" onclick="clearVisualForSlot(\''+kind+'\','+id+')">Clear visual</button>'
    +'</div></div>';
}
function persistQuestion(q,kind){
  q=q||{};
  var out={k:kind||q.k||'theory',t:q.t||q.q||'',marks:q.marks||null,topic:q.topic||'',layout:q.layout||'standard',
    svgInline:q.svgInline||q._svgDiagram||null,svgHint:q.svgHint||q.diagDesc||null,diagDesc:q.diagDesc||'',diagImg:q.diagImg||null,customImg:q.customImg||null};
  if(out.k==='obj'){ out.o=q.o||q.options||[]; out.a=q.a!==undefined?q.a:q.answer; out.marks=q.marks!==undefined?q.marks:0; }
  if(out.k==='fitb'){ out.answer=q.answer||''; out.marks=q.marks!==undefined?q.marks:0; }
  if(out.k==='theory'){ out.s=q.s||q.showSteps; out.marks=q.marks!==undefined?q.marks:0; }
  return out;
}
function normalizeAnswerIndex(answer,options){
  if(answer===undefined||answer===null||answer==='') return 0;
  if(typeof answer==='number') return Math.max(0,Math.min(3,answer));
  var s=String(answer).trim();
  var letter=s.match(/^[A-D]/i);
  if(letter) return L.indexOf(letter[0].toUpperCase());
  var n=parseInt(s,10);
  if(!isNaN(n)) return Math.max(0,Math.min(3,n>0?n-1:n));
  if(Array.isArray(options)){
    var idx=options.map(function(o){ return String(o).trim().toLowerCase(); }).indexOf(s.toLowerCase());
    if(idx>=0) return idx;
  }
  return 0;
}
function findQuestionSlot(kind,id){
  var arr=kind==='auto'?S.slots:kind==='scan'?S.ocrSlots:S.ntxSlots;
  return (arr||[]).find(function(x){ return x.id===id; });
}
window.updVisualHint=function(kind,id,v){
  var s=findQuestionSlot(kind,id); if(!s||!s.q) return;
  s.q.svgHint=v; s.q.diagDesc=v;
};
window.clearVisualForSlot=function(kind,id){
  var s=findQuestionSlot(kind,id); if(!s||!s.q) return;
  s.q.svgHint=''; s.q.diagDesc=''; s.q.svgInline=null; s.q._svgDiagram=null; s.q.customImg=null;
  if(kind==='auto'){ var el=document.getElementById('slot_'+id); if(el) el.outerHTML=renderSlot(s); }
  else if(kind==='scan') renderScanSlots();
  else renderNtxSlots();
};
window.uploadVisualForSlot=function(kind,id){
  var s=findQuestionSlot(kind,id); if(!s||!s.q) return;
  var inp=document.createElement('input'); inp.type='file'; inp.accept='image/*';
  inp.onchange=function(e){
    var file=e.target.files[0]; if(!file) return;
    var reader=new FileReader();
    reader.onload=function(ev){
      var img=new Image();
      img.onload=function(){
        var canvas=document.createElement('canvas'); var ctx=canvas.getContext('2d');
        var maxW=600,maxH=600,w=img.width,h=img.height;
        if(w>maxW||h>maxH){ var r=Math.min(maxW/w,maxH/h); w=Math.round(w*r); h=Math.round(h*r); }
        canvas.width=w; canvas.height=h; ctx.drawImage(img,0,0,w,h);
        s.q.customImg=canvas.toDataURL('image/jpeg',0.85);
        if(kind==='auto'){ var el=document.getElementById('slot_'+id); if(el) el.outerHTML=renderSlot(s); }
        else if(kind==='scan') renderScanSlots();
        else renderNtxSlots();
      };
      img.src=ev.target.result;
    };
    reader.readAsDataURL(file);
  };
  inp.click();
};
window.drawVisualForSlot=async function(kind,id){
  var s=findQuestionSlot(kind,id); if(!s||!s.q) return;
  var desc=(s.q.svgHint||s.q.diagDesc||'').trim();
  if(!desc){ toast('Describe the diagram or shape first','warn'); return; }
  ensureApiKey();
  toast('Rendering diagram/shape...','info',4500);
  try{
    s.q.svgInline=await callGeminiDraw(desc,{width:420,height:250});
    s.q.svgHint=desc;
    if(kind==='auto'){ var el=$('slot_'+id); if(el) el.outerHTML=renderSlot(s); }
    else if(kind==='scan') renderScanSlots();
    else renderNtxSlots();
    setTimeout(function(){ math(document.body); },200);
  }catch(e){ toast('Visual render failed: '+e.message,'err',5500); }
};
function getAdminTerm(){
  var adm=getAdminSettings?getAdminSettings():{};
  return (adm&&adm.selected_term)||ADMIN.selectedTerm||S.cfg.term||'1st Term';
}
function enforceAdminTerm(){
  var t=getAdminTerm();
  if(t) S.cfg.term=t;
  return t;
}
function isCATest(at){
  return at==='C.A.'||at==='C.A. Test 1'||at==='C.A. Test 2';
}
function assessmentLabel(at,compact){
  if(at==='C.A. Test 1') return compact?'1st C.A':'1st C.A';
  if(at==='C.A. Test 2') return compact?'2nd C.A':'2nd C.A';
  if(at==='C.A.') return compact?'C.A':'Continuous Assessment';
  return compact?'Exams':'Exams';
}
function getAssessmentTopicLimit(){
  if(S.at==='C.A. Test 1'||S.at==='C.A.') return 3;
  if(S.at==='C.A. Test 2') return 6;
  return 0;
}
function applyAssessmentTopicScope(){
  var weeks=S.schemeWeeks||[];
  if(!weeks.length) return;
  var limit=getAssessmentTopicLimit();
  var scoped=limit?weeks.slice(0,limit):weeks;
  S.cfg.topics=scoped.map(function(w){ return w.topic; }).filter(Boolean);
}

/* Diagram full-screen lightbox */
window.showDiagramFull=function(src){
  var ov=document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:9998;display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
  var img=document.createElement('img');
  img.src=src;
  img.style.cssText='max-width:92vw;max-height:88vh;border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,.5);';
  ov.appendChild(img);
  ov.onclick=function(){ document.body.removeChild(ov); };
  document.body.appendChild(ov);
};

var _toastTimer;
function toast(msg,type,dur){
  type=type||'info'; dur=dur||3200;
  var t=$('toast');
  t.textContent=msg;
  t.className='show '+(type==='warn'?'warn':type==='err'?'err':type==='ok'?'ok':'');
  clearTimeout(_toastTimer);
  _toastTimer=setTimeout(function(){t.className='';},dur);
}

/* ══════════════════════════════════════
   SCHEME PERSISTENCE
   Key: ee_scheme__{cls}__{subj}__{term}
══════════════════════════════════════ */
/* ── SCHEME PERSISTENCE — Supabase ── */
function schemeKey(cls,subj,term){
  return (cls||'')+'__'+(subj||'')+'__'+(term||'');
}
async function loadCommittedScheme(cls,subj,term){
  var key='ee_scheme__'+schemeKey(cls,subj,term);
  try{
    if(CURRENT_USER){
      var res=await _supabase.from('schemes').select('weeks').eq('user_id',CURRENT_USER.id).eq('scheme_key',schemeKey(cls,subj,term)).maybeSingle();
      if(res&&res.data&&res.data.weeks) return res.data.weeks;
    }
  }catch(e){ console.warn('scheme load fallback:',e.message); }
  try{ var local=localStorage.getItem(key); return local?JSON.parse(local):null; }catch(e2){ return null; }
}
async function commitScheme(cls,subj,term,weeks){
  var key='ee_scheme__'+schemeKey(cls,subj,term);
  try{ localStorage.setItem(key,JSON.stringify(weeks||[])); }catch(e){}
  if(!CURRENT_USER) return;
  await _supabase.from('schemes').upsert({user_id:CURRENT_USER.id,scheme_key:schemeKey(cls,subj,term),weeks:weeks},{onConflict:'user_id,scheme_key'});
}
async function clearCommittedScheme(cls,subj,term){
  var key='ee_scheme__'+schemeKey(cls,subj,term);
  try{ localStorage.removeItem(key); }catch(e){}
  if(!CURRENT_USER) return;
  await _supabase.from('schemes').delete().eq('user_id',CURRENT_USER.id).eq('scheme_key',schemeKey(cls,subj,term));
}

/* ══════════════════════════════════════
   FILE PROCESSING UTILITIES
   Handles PDF → canvas pages → base64
   Handles DOCX → plain text via mammoth
══════════════════════════════════════ */
async function pdfToImages(file){
  // Use PDF.js to render each page as a canvas image
  if(typeof pdfjsLib==='undefined'){ throw new Error('PDF.js not loaded. Try refreshing.'); }
  pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var arrayBuffer=await file.arrayBuffer();
  var pdf=await pdfjsLib.getDocument({data:arrayBuffer}).promise;
  var pages=[];
  for(var i=1;i<=Math.min(pdf.numPages,20);i++){
    var page=await pdf.getPage(i);
    var viewport=page.getViewport({scale:1.8});
    var canvas=document.createElement('canvas');
    canvas.width=viewport.width; canvas.height=viewport.height;
    var ctx=canvas.getContext('2d');
    await page.render({canvasContext:ctx,viewport:viewport}).promise;
    pages.push({dataUrl:canvas.toDataURL('image/jpeg',0.88),mimeType:'image/jpeg',label:'PDF Page '+i});
  }
  return pages;
}

async function docxToText(file){
  if(typeof mammoth==='undefined'){ throw new Error('Mammoth.js not loaded. Try refreshing.'); }
  var arrayBuffer=await file.arrayBuffer();
  var result=await mammoth.extractRawText({arrayBuffer:arrayBuffer});
  return result.value||'';
}

async function processFileForScanner(file){
  var name=file.name||'file';
  var type=file.type||'';
  if(type.startsWith('image/')){ 
    return {type:'images',pages:[{dataUrl:await readFileAsDataURL(file),mimeType:type,label:name}]};
  }
  if(type==='application/pdf'||name.toLowerCase().endsWith('.pdf')){
    var pages=await pdfToImages(file);
    return {type:'images',pages:pages};
  }
  if(type.includes('word')||name.toLowerCase().endsWith('.docx')||name.toLowerCase().endsWith('.doc')){
    var text=await docxToText(file);
    return {type:'text',text:text,label:name};
  }
  throw new Error('Unsupported file type: '+name);
}

async function processFileForNTX(file){
  var name=file.name||'file';
  var type=file.type||'';
  if(type.startsWith('image/')){
    return {type:'image',dataUrl:await readFileAsDataURL(file),mimeType:type,label:name};
  }
  if(type==='application/pdf'||name.toLowerCase().endsWith('.pdf')){
    var pages=await pdfToImages(file);
    // For NTX we extract text from each rendered page
    return {type:'pdf_images',pages:pages,label:name};
  }
  if(type.includes('word')||name.toLowerCase().endsWith('.docx')||name.toLowerCase().endsWith('.doc')){
    var text=await docxToText(file);
    return {type:'text',text:text,label:name};
  }
  throw new Error('Unsupported file type: '+name);
}

function readFileAsDataURL(file){
  return new Promise(function(res,rej){
    var r=new FileReader();
    r.onload=function(e){ res(e.target.result); };
    r.onerror=function(){ rej(new Error('Could not read: '+file.name)); };
    r.readAsDataURL(file);
  });
}

/* ══════════════════════════════════════
   SIDEBAR
══════════════════════════════════════ */
function openSidebar(){
  $('sidebar').classList.add('open');
  $('sb-overlay').classList.add('open');
}
function closeSidebar(){
  $('sidebar').classList.remove('open');
  $('sb-overlay').classList.remove('open');
}

function updateGlobalBackButton(){
  var b=$('globalBackBtn');
  if(!b) return;
  var home=(S.screen==='dash'||S.screen==='admin-dash')&&S.scr===0;
  b.style.display=home?'none':'inline-flex';
}

function goAppBack(){
  if(S.screen==='app'){
    if(S.scr===3){ goWorkshop(); return; }
    if(S.scr===2 && S.path==='auto'){ s1Auto(); return; }
    _navInternal('new');
    return;
  }
  var prev=S._navStack&&S._navStack.length?S._navStack.pop():null;
  if(prev && prev!==S.screen){ _navInternal(prev); return; }
  _navInternal((CURRENT_USER&&CURRENT_USER.role==='admin')?'admin-dash':'dash');
}
window.goBack=goAppBack;

function setSbActive(id){
  ['sbDash','sbNew','sbLoad','sbArch','sbSett',
   'sbAdminDash','sbAdminPrint','sbAdminSett'].forEach(function(i){
    var el=$(i); if(el) el.classList.remove('active');
  });
  var el=$(id); if(el) el.classList.add('active');
}

/* Hide teacher-inaccessible sidebar links based on role */
function _applyRoleSidebarLinks(role){
  var sbSett=$('sbSett');
  if(sbSett) sbSett.style.display=(role==='admin')?'':'none';
}

window.navTo = function(screen){
  closeSidebar();
  // Guard: Settings screens are admin-only
  if(screen==='sett' && CURRENT_USER && CURRENT_USER.role!=='admin'){
    toast('⛔ Settings are managed by your administrator','err',4000);
    return;
  }
  if((screen==='admin-dash'||screen==='admin-print'||screen==='admin-sett') && CURRENT_USER && CURRENT_USER.role!=='admin'){
    toast('⛔ Admin access only — contact your administrator','err',4000);
    return;
  }
  if(S.screen&&S.screen!==screen) S._navStack.push(S.screen);
  S.scr=0;
  // Push to browser history so back button works where the shell supports it
  try{ history.pushState({screen:screen},'','#'+screen); }catch(e){}
  _navInternal(screen);
};

function _navInternal(screen){
  S.screen = screen;
  if(screen!=='app') S.scr=0;
  ['screen-dash','screen-gate','screen-load','screen-arch','screen-sett',
   'screen-admin-dash','screen-admin-print','screen-admin-sett','app'].forEach(function(id){
    var el=$(id); if(el) el.style.display='none';
  });
  var stps=$('stps'); if(stps) stps.innerHTML='';

  if(screen==='dash')            { setSbActive('sbDash');       renderDash(); }
  else if(screen==='new')        { setSbActive('sbNew');         showGate(); }
  else if(screen==='load')       { setSbActive('sbLoad');        renderLoad(); }
  else if(screen==='arch')       { setSbActive('sbArch');        renderArch(); }
  else if(screen==='sett'){
    // Admin-only settings screen
    if(CURRENT_USER && CURRENT_USER.role==='admin'){
      setSbActive('sbSett'); renderSett();
    } else {
      toast('⛔ Settings are managed by your administrator','err',4000);
      _navInternal('dash');
    }
  }
  else if(screen==='admin-dash') { setSbActive('sbAdminDash');   renderAdminDash(); }
  else if(screen==='admin-print'){ setSbActive('sbAdminPrint');  renderAdminPrint(); }
  else if(screen==='admin-sett') { setSbActive('sbAdminSett');   renderAdminSett(); }
  updateGlobalBackButton();
}

// Back button support - improved
window.addEventListener('popstate',function(e){
  closeSidebar();
  if(e.state&&e.state.screen){ _navInternal(e.state.screen); }
  else goAppBack();
});

document.addEventListener('backbutton',function(e){
  if(e&&e.preventDefault) e.preventDefault();
  closeSidebar();
  goAppBack();
},false);

// Handle initial load with proper history state
window.addEventListener('load',function(){
  // Set initial state
  if(window.location.hash){
    var screen=window.location.hash.substring(1);
    if(screen) history.replaceState({screen:screen},'');
  } else {
    history.replaceState({screen:ROLE==='admin'?'admin-dash':'dash'},'');
  }
});

/* ══════════════════════════════════════
   API STATUS
══════════════════════════════════════ */
function refreshApiStatus(){
  var dot=$('apiDot'), lbl=$('apiLbl'), sd=$('sbDot'), sl=$('sbApiLbl');
  var ok=!!getEffectiveApiKey();
  if(dot){ dot.className='api-dot'+(ok?' ok':''); }
  if(lbl){ lbl.textContent=ok?'OpenRouter Ready':'No API Key'; }
  if(sd) { sd.className='sb-dot'+(ok?' ok':''); }
  if(sl) { sl.textContent=ok?'OpenRouter Ready':'No API Key'; }
}

/* ══════════════════════════════════════
   DASHBOARD
══════════════════════════════════════ */
async function renderDash(){
  applyAdminSettings();
  var el=$('screen-dash');
  el.style.display='block';
  el.innerHTML='<div class="pg fade"><div style="text-align:center;padding:60px 20px;color:var(--mute);"><span class="spin" style="font-size:22px;display:block;margin-bottom:12px;">⟳</span>Loading…</div></div>';

  var papers = await getPublished();
  var drafts  = [];
  // Show restore-draft banner if a draft is waiting
  var draftBanner='';
  if(window._savedDraft && window._savedDraft.slots && window._savedDraft.slots.length){
    var d=window._savedDraft;
    var dAge=Math.round((Date.now()-(d.ts||0))/60000);
    var dLabel=esc((d.cfg&&d.cfg.subj)||'Unknown subject')+' — '+esc((d.cfg&&d.cfg.cls)||'');
    draftBanner='<div class="banner b-teal" style="margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">'
      +'<div><strong>📝 Draft recovered</strong> — '+dLabel+' ('+dAge+' min ago, '+d.slots.length+' questions)</div>'
      +'<div style="display:flex;gap:8px;">'
      +'<button class="btn bp bsm" onclick="restoreDraft()">↩ Restore Draft</button>'
      +'<button class="btn bq bsm" onclick="discardDraft()">🗑 Discard</button>'
      +'</div></div>';
  }
  var school  = S.cfg.school||'Your School';
  var now     = new Date();
  var termKey = S.cfg.term || (now.getMonth()<4?'1st Term':now.getMonth()<8?'2nd Term':'3rd Term');
  var thisTerm= papers.filter(function(p){ return p.term===termKey; }).length;
  var recentAll = papers.slice(0,5);

  // Phase 2 — Correction notes
  var rejected = papers.filter(function(p){ return p.adminStatus==='rejected'&&p.correctionNote; });
  var correctionHtml='';
  if(rejected.length){
    correctionHtml='<div class="correction-banner">'
      +'<div class="correction-title">📮 Admin Correction Notes ('+rejected.length+')</div>'
      +rejected.map(function(p){
        return '<div class="correction-item">'
          +'<div class="correction-ref">'+esc(p.ref)+' · '+esc(p.subj)+' — '+esc(p.cls)+'</div>'
          +'<div class="correction-note">↩ '+esc(p.correctionNote)+'</div>'
          +'</div>';
      }).join('')
      +'</div>';
  }

  el.innerHTML = '<div class="pg fade">'
    +'<div class="dash-hero">'
    +'<div class="dash-greeting">Good '+(now.getHours()<12?'morning':now.getHours()<17?'afternoon':'evening')+'</div>'
    +'<div class="dash-title">Welcome back,<br/>'+esc(school)+'</div>'
    +'<button class="dash-new-btn" onclick="navTo(\'new\')">✏ Set New Questions</button>'
    +'</div>'
    +correctionHtml
    +draftBanner
    +'<div class="stat-grid">'
    +'<div class="stat-card"><div class="stat-num">'+papers.length+'</div><div class="stat-lbl">Total Papers</div><div class="stat-sub">All time</div></div>'
    +'<div class="stat-card"><div class="stat-num">'+thisTerm+'</div><div class="stat-lbl">This Term</div><div class="stat-sub">'+termKey+'</div></div>'
    +'<div class="stat-card"><div class="stat-num">'+drafts.length+'</div><div class="stat-lbl">Drafts</div><div class="stat-sub">In progress</div></div>'
    +'</div>'
    +'<div style="text-align:center;margin-top:24px;">'
    +'<button class="btn bq" onclick="navTo(\'arch\')" style="padding:10px 24px;border-radius:20px;font-weight:600;">📚 View My Questions Archive →</button>'
    +'</div>'
    +'</div>';
}

/* ══════════════════════════════════════
   GATE — PATH CHOICE
══════════════════════════════════════ */
function showGate(){
  applyAdminSettings();
  var el=$('screen-gate');
  el.style.display='flex';

  el.innerHTML = '<div class="gate-headline">How will you build<br>today\'s paper?</div>'
    +'<div class="gate-sub">Choose your path. Everything else follows from here.</div>'
    +'<div class="gate-grid">'
    +'<div class="gate-card" onclick="choosePath(\'auto\')">'
    +'<span class="gate-badge">Recommended</span>'
    +'<span class="gate-icon">🤖</span>'
    +'<div class="gate-title">Automated System Path</div>'
    +'<div class="gate-desc">Select Term, Class, and Subject — AI fetches the official NERDC 2026 Scheme of Work, then generates every question automatically.</div>'
    +'<div class="gate-cta">Set up my paper →</div>'
    +'</div>'
    +'<div class="gate-card" onclick="choosePath(\'manual\')">'
    +'<span class="gate-icon">📄</span>'
    +'<div class="gate-title">Manual Path</div>'
    +'<div class="gate-desc">Use exact transcription for question sheets, or paste copied Word text and convert it into well structured questions.</div>'
    +'<div class="gate-cta">Open manual tools →</div>'
    +'</div>'
    +'</div>';
}

window.choosePath = function(path){
  S.path = path;
  if(S.screen&&S.screen!=='app') S._navStack.push(S.screen);
  S.screen='app';
  ['screen-dash','screen-gate','screen-load','screen-arch','screen-sett'].forEach(function(id){
    var el=$(id); if(el) el.style.display='none';
  });
  $('app').style.display='';
  refreshApiStatus();
  if(path==='auto'){ S.scr=1; hdr(); s1Auto(); }
  else             { S.scr=2; hdr(); s2Manual(); }
};

/* ══════════════════════════════════════
   LOAD / VIEW SCREEN
══════════════════════════════════════ */
function renderLoad(){
  var el=$('screen-load');
  el.style.display='block';
  el.innerHTML='<div class="pg fade">'
    +'<div class="ptl">Load / View Questions</div>'
    +'<div class="pst">Enter a reference number to retrieve a published paper.</div>'
    +'<div class="arch-search">'
    +'<input class="fi" id="loadRef" placeholder="e.g. EE-LK3M9X" style="font-family:var(--mono);font-size:14px;"/>'
    +'<button class="btn bp" onclick="doLoadByRef()">🔍 Load</button>'
    +'</div>'
    +'<div id="loadResult"></div>'
    +'</div>';
}

window.doLoadByRef = async function(){
  var ref = ($('loadRef')||{}).value||'';
  ref = ref.trim().toUpperCase();
  if(!ref){ toast('Enter a reference number','warn'); return; }
  var el=$('loadResult');
  el.innerHTML='<div style="padding:20px;text-align:center;color:var(--mute);">Searching…</div>';
  var res = await _supabase.from('papers').select('*').eq('ref', ref).single();
  var p = res.data ? Object.assign({}, res.data.data||{}, { ref: res.data.ref, _db_id: res.data.id }) : null;
  if(!p){
    el.innerHTML='<div class="banner b-warn">⚠ No paper found with reference <strong>'+esc(ref)+'</strong>. Check the reference and try again.</div>';
    return;
  }
  el.innerHTML='<div class="arch-card" style="flex-direction:column;align-items:flex-start;gap:10px;">'
    +'<div style="display:flex;gap:14px;align-items:center;width:100%;">'
    +'<div class="arch-ico">📄</div>'
    +'<div class="arch-body">'
    +'<div class="arch-title">'+esc(p.subj)+' — '+esc(p.cls)+'</div>'
    +'<div class="arch-meta">'+esc(p.term)+' · '+esc(p.at)+' · '+esc(p.std)+(p.school?' · '+esc(p.school):'')+'</div>'
    +'<div class="arch-meta">'+p.objCount+' objectives · '+(p.fitbCount||0)+' fill-in-blank · '+p.thCount+' theory</div>'
    +'<div class="arch-ref">📋 '+esc(p.ref)+' · '+esc(p.date)+'</div>'
    +'</div>'
    +'<div class="status-pill sp-pub">Published</div>'
    +'</div>'
    +'</div>';
};

/* ══════════════════════════════════════
   ARCHIVE SCREEN
══════════════════════════════════════ */
async function renderArch(){
  var el=$('screen-arch');
  el.style.display='block';
  el.innerHTML='<div class="pgw fade"><div style="text-align:center;padding:60px 20px;color:var(--mute);"><span class="spin" style="font-size:22px;display:block;margin-bottom:12px;">⟳</span>Loading archive…</div></div>';
  var papers=await getPublished();

  el.innerHTML='<div class="pgw fade">'
    +'<div style="display:flex;justify-content:space-between;align-items:flex-start;">'
    +'<div><div class="ptl">Archive</div>'
    +'<div class="pst">All submitted papers — '+papers.length+' total.</div></div>'
    +''
    +'</div>'
    +'<div class="arch-search">'
    +'<input class="fi" id="archSearch" placeholder="Filter by subject, class or ref…" oninput="filterArch()"/>'
    +'</div>'
    +'<div id="archList">'
    +renderArchList(papers)
    +'</div></div>';
}

function renderArchList(papers){
  if(!papers.length) return '<div class="dash-empty"><div class="dash-empty-ico">🗄</div>No papers yet.<br/>Tap <strong>Set New Questions</strong> to create your first exam paper.</div>';
  return papers.map(function(p){
    var st=p.adminStatus||'submitted';
    var pillCls=st==='approved'?'sp-pub':st==='rejected'?'sp-rej':'sp-draft';
    var pillTxt=st==='approved'?'✓ Approved':st==='rejected'?'✕ Rejected':'⏳ Pending Admin';
    return '<div class="arch-card" onclick="viewPaperDetail(\''+esc(p.ref)+'\')">'
      +'<div class="arch-ico">📄</div>'
      +'<div class="arch-body">'
      +'<div class="arch-title">'+esc(p.subj)+' — '+esc(p.cls)+'</div>'
      +'<div class="arch-meta">'+esc(p.term)+(p.session?' ('+esc(p.session)+')':'')+' · '+esc(p.at)+' · '+esc(p.std)+(p.school?' · '+esc(p.school):'')+'</div>'
      +'<div class="arch-meta">'+(p.objCount||0)+' obj · '+(p.fitbCount||0)+' fill-in-blank · '+(p.thCount||0)+' theory</div>'
      +'<div class="arch-ref">📋 '+esc(p.ref)+' · '+esc(p.date||'')+'</div>'
      +(st==='rejected'&&p.correctionNote?'<div style="margin-top:6px;font-size:11.5px;color:var(--red);font-style:italic;">↩ '+esc(p.correctionNote)+'</div>':'')
      +'</div>'
      +'<div class="arch-acts">'
      +'<span class="status-pill '+pillCls+'">'+pillTxt+'</span>'
      +'</div>'
      +'</div>';
  }).join('');
}

window.filterArch = async function(){
  var q=($('archSearch')||{value:''}).value.toLowerCase();
  var papers=await getPublished();
  var filtered=papers.filter(function(p){
    return ((p.subj||'')+(p.cls||'')+(p.ref||'')+(p.term||'')+(p.school||'')).toLowerCase().includes(q);
  });
  var el=$('archList'); if(el) el.innerHTML=renderArchList(filtered);
};

/* ══════════════════════════════════════
   SETTINGS SCREEN
══════════════════════════════════════ */
function renderSett(){
  var el=$('screen-sett');
  el.style.display='block';
  var school=S.cfg.school||'';
  var defTerm=S.cfg.term||'1st Term';

  el.innerHTML='<div class="pg fade">'
    +'<div class="ptl">Settings</div>'
    +'<div class="pst">Configure your API key, school details, and defaults.</div>'

    +'<div class="card">'
    +'<div class="ct">OpenRouter API Key</div>'
    +'<div class="fl"><div class="key-row">'
    +'<input type="password" class="fi" id="settKeyInp" placeholder="sk-or-v1-…" value="'+esc(getEffectiveApiKey()||'')+'"/>'
    +'<button class="btn bq bsm" onclick="var i=$(\'settKeyInp\');i.type=i.type===\'password\'?\'text\':\'password\'">👁</button>'
    +'</div></div>'
    +'<div class="api-note">🔑 Accepts <strong>OpenRouter</strong> keys (<code>sk-or-v1-...</code>) or <strong>Google Gemini</strong> keys (<code>AIza...</code>).<br/>'
    +'Primary: <strong>DeepSeek R1</strong> · Fallback: <strong>Llama 3.3 70B, Qwen3, DeepSeek Chat, Phi-4, Mistral</strong><br/>'
    +'Scheme Engine: <strong>qwen/qwen3-235b-a22b:free</strong><br/>'
    +'Lab Agent: <strong>anthropic/claude-3.5-sonnet</strong><br/>'
    +'Costs pennies per full exam paper.</div>'
    +'<div style="margin-top:14px;display:flex;gap:9px;">'
    +'<button class="btn bq" onclick="clearApiKey()">🗑 Clear</button>'
    +'<button class="btn bp" onclick="saveApiKey()">💾 Save Key</button>'
    +'</div></div>'

    +'<div class="card">'
    +'<div class="ct">School Details</div>'
    +'<div class="fl"><label>School Name</label>'
    +'<input type="text" class="fi" id="settSchool" value="'+esc(school)+'" placeholder="e.g. Government Secondary School, Ikeja"/>'
    +'</div>'
    +'<div class="r2">'
    +'<div class="fl"><label>Academic Session</label>'
    +'<input type="text" class="fi" id="settSession" value="'+esc(S.cfg.session||'2025/2026')+'" placeholder="e.g. 2025/2026"/>'
    +'</div>'
    +'<div class="fl"><label>Default Term</label>'
    +'<select class="fs" id="settTerm">'
    +TERMS.map(function(t){ return '<option'+(t===defTerm?' selected':'')+'>'+t+'</option>'; }).join('')
    +'</select></div>'
    +'</div>'
    +'<button class="btn bp" onclick="saveSchool()" style="margin-top:10px;">💾 Save Details</button>'
    +'</div>'

    +'<div class="card">'
    +'<div class="ct">Trade Subject</div>'
    +'<div style="font-size:12.5px;color:var(--mute);margin-bottom:14px;">Select your school\'s registered trade subject. This is used in all JSS and SS papers.</div>'
    +TRADE_SUBJECTS.map(function(t){
      return '<div class="trade-opt'+(S.tradeSubject===t.id?' sel':'')+'" onclick="setTrade(\''+t.id+'\')">'
        +'<span class="to-ico">'+t.icon+'</span>'
        +'<div><div class="to-name">'+esc(t.name)+'</div><div class="to-desc">'+esc(t.desc)+'</div></div>'
        +'</div>';
    }).join('')
    +'<div style="margin-top:14px;"><button class="btn bp" onclick="saveTrade()">💾 Save Trade Subject</button></div>'
    +'</div>'

    +'</div>';
}

window.saveApiKey = async function(){
  var v=cleanApiKey(($('settKeyInp')||{}).value||'');
  if(v && !looksLikeOpenRouterKey(v)){ toast('Paste a valid OpenRouter sk-or-v1- key or Gemini AIza key','err',4500); return; }
  if(v) delete _badApiKeys[v];
  API_KEY=v;
  window._userApiKey=v;
  await _saveSetting('api_key', v);
  // Also push to admin_settings so it works across all devices
  var ok=await _saveAdminSetting('api_key',v);
  refreshApiStatus(); toast(ok?'API key saved ✓ — active across all devices':'API key saved locally, but global admin save failed',''+(ok?'ok':'err'),4500);
};
window.clearApiKey = async function(){
  API_KEY='';
  window._userApiKey='';
  await _saveSetting('api_key','');
  await _saveAdminSetting('api_key','');
  refreshApiStatus(); toast('API key cleared','ok');
  renderSett();
};
window.saveSchool = async function(){
  var s=($('settSchool')||{}).value||'';
  var t=($('settTerm')||{}).value||'1st Term';
  var sess=($('settSession')||{}).value||'2025/2026';
  await _saveSetting('school', s.trim());
  await _saveSetting('defterm', CURRENT_USER&&CURRENT_USER.role==='admin'?t:S.cfg.term);
  await _saveSetting('defsession', sess.trim());
  var isAdmin=CURRENT_USER&&CURRENT_USER.role==='admin';
  // Only the admin account controls the shared term/session/school used by all devices.
  var okTerm=isAdmin?await _saveAdminSetting('selected_term',t):true;
  var okSess=isAdmin?await _saveAdminSetting('selected_session',sess.trim()):true;
  var okSchool=isAdmin?await _saveAdminSetting('school',s.trim()):true;
  if(isAdmin){
    ADMIN.selectedTerm=t;
    S.cfg.term=t;
  } else {
    S.cfg.term=enforceAdminTerm();
  }
  S.cfg.school=s.trim(); S.cfg.session=sess.trim();
  toast((okTerm&&okSess&&okSchool)?'School details saved ✓ — enforced system-wide':'Saved locally, but one or more global admin settings failed',''+((okTerm&&okSess&&okSchool)?'ok':'err'),4500);
};
window.setTrade = function(id){
  S.tradeSubject=id;
  document.querySelectorAll('.trade-opt').forEach(function(el){
    el.classList.toggle('sel', el.onclick.toString().includes("'"+id+"'"));
  });
};
window.saveTrade = async function(){
  await _saveSetting('trade', S.tradeSubject);
  var ok=await _saveAdminSetting('trade_subject',S.tradeSubject);
  toast(ok?'Trade subject saved system-wide: '+getTradeById(S.tradeSubject).name+' ✓':'Trade subject saved locally, but global admin save failed',ok?'ok':'err');
};
/* clearAllData is defined below near admin functions — single source of truth */
window.restoreDraft=function(){
  var d=window._savedDraft; if(!d||!d.slots) return;
  S.cfg=Object.assign({cls:'',term:'1st Term',session:'2025/2026',subj:'',std:'',topics:[],topicText:'',objN:10,fitbN:0,thN:5,instr:'Answer all questions. Time allowed: 1 hour 30 minutes.',theoryPaperInstr:'',theoryAiInstr:'',school:S.cfg.school||''},d.cfg||{});
  S.at=d.at||'Examination';
  S.path=d.path||'auto';
  S.tradeSubject=d.tradeSubject||DEFAULT_TRADE;
  S.difficultyLevel=d.difficultyLevel||'Balanced';
  S.slots=d.slots||[];
  S.schemeWeeks=d.schemeWeeks||[];
  S.schemeLoaded=S.schemeWeeks.length>0;
  S.schemeCommitted=false;
  window._savedDraft=null;
  ['screen-dash','screen-gate','screen-load','screen-arch','screen-sett'].forEach(function(id){
    var el=$(id); if(el) el.style.display='none';
  });
  $('app').style.display='';
  S.scr=2; hdr();
  $('s1').style.display='none';
  $('s2').style.display='block';
  $('s3').style.display='none';
  renderWorkshop();
  toast('Draft restored — '+S.slots.filter(function(s){ return s.q; }).length+' questions ready','ok',4000);
};
window.discardDraft=function(){ clearDraft(); renderDash(); };

function getTradeById(id){
  return TRADE_SUBJECTS.find(function(t){ return t.id===id; }) || TRADE_SUBJECTS[0];
}

/* ══════════════════════════════════════
   PAPER DETAIL (view published)
══════════════════════════════════════ */
window.viewPaperDetail = async function(ref){
  var res=await _supabase.from('papers').select('*').eq('ref',ref).single();
  var row=res.data;
  if(!row){ toast('Paper not found','err'); return; }
  var d=row.data;
  if(typeof d==='string'){ try{ d=JSON.parse(d); }catch(ex){ d={}; } }
  d=d||{};
  var p=Object.assign({},d,{ref:row.ref,_db_id:row.id,adminStatus:row.status||'submitted'});
  var st=p.adminStatus||'submitted';
  var pillCls=st==='approved'?'sp-pub':st==='rejected'?'sp-rej':'sp-draft';
  var pillTxt=st==='approved'?'✓ Approved':st==='rejected'?'✕ Rejected':'⏳ Pending Admin';
  var qs=p.questions||[];
  var objQ=qs.filter(function(q){return q.k==='obj';});
  var fitbQ=qs.filter(function(q){return q.k==='fitb';});
  var thQ=qs.filter(function(q){return q.k==='theory';});

  // Build detail view in screen-load (reuse that screen)
  var el=$('screen-load');
  ['screen-dash','screen-gate','screen-arch','screen-sett',
   'screen-admin-dash','screen-admin-print','screen-admin-sett','app'].forEach(function(id){
    var e=$(id); if(e) e.style.display='none';
  });
  el.style.display='block';
  el.innerHTML='<div class="pgw fade">'
    +'<button class="btn bq bsm" onclick="navTo(\'arch\')" style="margin-bottom:16px;">← Back to Archive</button>'
    +'<div class="ptl">'+esc(p.subj||'Paper')+' — '+esc(p.cls||'')+'</div>'
    +'<div class="pst">'+esc(p.term||'')+' · '+esc(p.at||'')+' · '+esc(p.std||'')+(p.school?' · '+esc(p.school):'')+'</div>'

    +'<div class="sgrid">'
    +'<div class="sbox"><div class="sv">'+esc(p.cls||'—')+'</div><div class="slb">Class</div></div>'
    +'<div class="sbox"><div class="sv">'+assessmentLabel(p.at,true)+'</div><div class="slb">Type</div></div>'
    +'<div class="sbox"><div class="sv">'+(p.objCount||objQ.length)+'</div><div class="slb">Objectives</div></div>'
    +'<div class="sbox"><div class="sv">'+(p.thCount||thQ.length)+'</div><div class="slb">Theory</div></div>'
    +'</div>'

    +'<div class="card" style="margin-bottom:16px;">'
    +'<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">'
    +'<span class="ref-pill" style="margin:0;">📋 '+esc(p.ref)+'</span>'
    +'<span class="status-pill '+pillCls+'">'+pillTxt+'</span>'
    +(p.user_name?'<span style="font-size:11px;color:var(--mute);">by '+esc(p.user_name)+'</span>':'')
    +(p.date?'<span style="font-size:11px;color:var(--mute);">'+esc(p.date)+'</span>':'')
    +'</div>'
    +(st==='rejected'&&p.correctionNote?'<div class="banner b-warn" style="margin-top:12px;">📮 <strong>Admin Note:</strong> '+esc(p.correctionNote)+'</div>':'')
    +'</div>'

    +(objQ.length?'<div class="ct">Section A — Objectives ('+objQ.length+')</div>'
      +objQ.map(function(q,i){
        return '<div class="qp"><div class="qn">'+String(i+1).padStart(2,'0')+'</div>'
          +'<div style="flex:1;"><div>'+q.t+'</div>'
          +(q.o?'<div class="sopts" style="margin-top:7px;">'+q.o.map(function(o,oi){
            return '<div class="sopt '+(oi===q.a?'correct':'')+'"><span class="sok">'+L[oi]+'.</span><span>'+esc(o)+'</span></div>';
          }).join('')+'</div>':'')
          +'</div></div>';
      }).join(''):'')

    +(fitbQ.length?'<div class="ct" style="margin-top:20px;">Section B — Fill-in-the-Blank ('+fitbQ.length+')</div>'
      +fitbQ.map(function(q,i){
        return '<div class="qp fitb-qp"><div class="qn">'+String(i+1).padStart(2,'0')+'</div>'
          +'<div style="flex:1;"><div>'+q.t+'</div>'
          +(q.answer?'<div class="fitb-answer">✓ Answer: <span>'+esc(q.answer)+'</span></div>':'')
          +'</div></div>';
      }).join(''):'')

    +(thQ.length?'<div class="ct" style="margin-top:20px;">'+(fitbQ.length?'Section C':'Section B')+' — Theory ('+thQ.length+')</div>'
      +thQ.map(function(q,i){
        return '<div class="qp"><div class="qn">'+String(i+1).padStart(2,'0')+'</div>'
          +'<div style="flex:1;"><div>'+q.t+'</div>'
          +'<div style="margin-top:5px;display:flex;gap:5px;flex-wrap:wrap;">'
          +(hasPositiveMarks(q)?'<span class="tag t-marks">'+questionMarks(q)+' marks</span>':'')
          +'</div></div></div>';
      }).join(''):'')

    +'</div>';
  setTimeout(function(){ math(el); },300);
};

/* ══════════════════════════════════════
   NAV HEADER
══════════════════════════════════════ */
function hdr(){
  updateGlobalBackButton();
  var steps=[{n:1,l:'The Contract'},{n:2,l:'The Workshop'},{n:3,l:'The Hand-off'}];
  var c=$('stps'); if(!c) return;
  c.innerHTML='';
  var cur=S.scr;
  steps.forEach(function(s,i){
    var cls=(cur===s.n)?'on':(cur>s.n)?'dn':'';
    var nm=(cur>s.n)?'✓':s.n;
    c.insertAdjacentHTML('beforeend',
      "<div class='si "+cls+"'><div class='sb2'>"+nm+"</div><div class='sn'>"+s.l+"</div></div>"
      +(i<2?"<div class='sl "+(cur>s.n?'dn':'')+"'></div>":"")
    );
  });
}

/* ══════════════════════════════════════
   API ENGINE — OpenRouter
══════════════════════════════════════ */
var _apiQueue=Promise.resolve();
var _minGap=800;
var _lastCall=0;
function _wait(ms){ return new Promise(function(r){ setTimeout(r,ms); }); }
async function _gapWait(){
  var now=Date.now(), gap=now-_lastCall;
  if(gap<_minGap) await _wait(_minGap-gap);
  _lastCall=Date.now();
}
async function extractApiError(resp){
  try{
    var j=await resp.json();
    var msg=(j&&j.error&&j.error.message)?j.error.message:'';
    if(resp.status===429||(msg&&msg.toLowerCase().includes('rate')))
      return{is429:true,seconds:10,msg:'Rate limit hit. Retrying shortly…'};
    if(resp.status===401) return{is429:false,msg:'Invalid OpenRouter API key.'};
    if(resp.status===402) return{is429:false,msg:'Insufficient OpenRouter credits. Top up at openrouter.ai/credits.'};
    return{is429:false,msg:msg||('API error '+resp.status)};
  }catch(e){ return{is429:resp.status===429,seconds:10,msg:'API error '+resp.status}; }
}
async function _fetchOR(messages,model,isJson){
  var key=ensureApiKey();
  if(!key) throw new Error('No API key configured.');
  if(apiProviderForKey(key)==='google'){
    if(String(model||'').indexOf('gemini')<0) throw new Error('This generation path requires an OpenRouter sk-or-v1 key for '+model+'.');
    return _fetchGoogleGemini(messages,model,isJson,key);
  }
  var body={model:model,messages:messages,max_tokens:4096,temperature:0.7};
  if(isJson) body.response_format={type:'json_object'};
  var r;
  try{
    r=await fetch(OR_BASE,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+key,'HTTP-Referer':OR_REFERER,'X-Title':OR_TITLE},
      body:JSON.stringify(body)
    });
  }catch(fetchErr){
    var fe=new Error(fetchErr.message||'Network fetch failed');
    fe.isTransient=/fetch|network|timeout|failed/i.test(fe.message);
    throw fe;
  }
  if(!r.ok){ var info=await extractApiError(r); var e=new Error(info.msg); e.is429=info.is429; e.seconds=info.seconds||10; e.status=r.status; e.apiKey=key; throw e; }
  var data=await r.json();
  return(data.choices&&data.choices[0]&&data.choices[0].message&&data.choices[0].message.content)||'';
}
function googleModelName(model){
  model=String(model||MODELS.fallback);
  if(model.indexOf('gemini')>=0) return model.replace(/^google\//,'').replace(/:free$/i,'');
  return MODELS.fallback.replace(/^google\//,'').replace(/:free$/i,'');
}
function googlePartFromContent(part){
  if(typeof part==='string') return [{text:part}];
  if(!Array.isArray(part)) return [{text:String(part||'')}];
  return part.map(function(p){
    if(p.type==='text') return {text:p.text||''};
    if(p.type==='image_url'&&p.image_url&&p.image_url.url){
      var m=String(p.image_url.url).match(/^data:([^;]+);base64,(.+)$/);
      if(m) return {inlineData:{mimeType:m[1],data:m[2]}};
    }
    return {text:''};
  }).filter(function(p){ return p.text||p.inlineData; });
}
async function _fetchGoogleGemini(messages,model,isJson,key){
  var sys='';
  var contents=[];
  (messages||[]).forEach(function(m){
    if(m.role==='system'){ sys+=(sys?'\n':'')+(typeof m.content==='string'?m.content:JSON.stringify(m.content)); return; }
    contents.push({role:m.role==='assistant'?'model':'user',parts:googlePartFromContent(m.content)});
  });
  var body={
    contents:contents,
    generationConfig:{temperature:0.7,maxOutputTokens:4096}
  };
  if(sys) body.systemInstruction={parts:[{text:sys}]};
  if(isJson) body.generationConfig.responseMimeType='application/json';
  var gm=googleModelName(model);
  var r;
  try{
    r=await fetch(GEMINI_BASE+encodeURIComponent(gm)+':generateContent?key='+encodeURIComponent(key),{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body)
    });
  }catch(fetchErr){
    var fe=new Error(fetchErr.message||'Network fetch failed');
    fe.isTransient=/fetch|network|timeout|failed/i.test(fe.message);
    throw fe;
  }
  if(!r.ok){
    var msg='Gemini API error '+r.status;
    try{ var j=await r.json(); msg=(j.error&&j.error.message)||msg; }catch(e){}
    var er=new Error(r.status===400&&/API key/i.test(msg)?'Invalid Google Gemini API key.':msg);
    er.status=(r.status===400&&/API key/i.test(msg))?401:r.status;
    er.apiKey=key;
    throw er;
  }
  var data=await r.json();
  var parts=(((data.candidates||[])[0]||{}).content||{}).parts||[];
  return parts.map(function(p){ return p.text||''; }).join('');
}
async function _callWithRetry(messages,isJson,opts){
  opts=opts||{};
  // Build full model list: specified model → primary+fallback → full pool
  var specified=opts.model?[opts.model]:[];
  var base=[MODELS.primary,MODELS.fallback];
  // Merge: unique, preserve order
  var allModels=specified.concat(base).concat(FREE_MODEL_POOL).filter(function(m,i,a){ return a.indexOf(m)===i; });
  var lastErr;
  for(var mi=0;mi<allModels.length;mi++){
    var attempts=0,max=2;
    while(attempts<max){
      try{ await _gapWait(); return await _fetchOR(messages,allModels[mi],isJson&&!opts.noResponseFormat); }
      catch(e){
        lastErr=e; attempts++;
        var msg=String((e&&e.message)||'').toLowerCase();
        // 'No endpoints found' or model unavailable — skip to next model immediately
        if(msg.includes('no endpoint')||msg.includes('no provider')||msg.includes('not found')||e.status===404||e.status===503){
          if(mi<allModels.length-1) toast('⚡ Model unavailable, trying next…','warn',1500);
          break;
        }
        if(e.is429&&attempts<max){
          var w=Math.max(e.seconds||10,10);
          toast('⏳ Rate limit — waiting '+w+'s…','warn',(w+2)*1000);
          updateApiStatus('waiting','waiting '+w+'s');
          await _wait(w*1000);
          updateApiStatus('ready');
        } else if(e.status===401&&e.apiKey&&!_badApiKeys[e.apiKey]){
          await markApiKeyInvalid(e.apiKey);
          refreshApiStatus();
          toast('The API provider rejected the key being sent. Re-save a working OpenRouter or Gemini key in Admin Settings.','err',7000);
          break;
        } else if(e.isTransient&&attempts<max){
          var tw=2+attempts*2;
          toast('Network hiccup — retrying in '+tw+'s…','warn',(tw+1)*1000);
          await _wait(tw*1000);
        } else if(e.is429&&mi<allModels.length-1){ toast('⚡ Trying next model…','warn',2500); break; }
        else if(!e.is429&&!e.isTransient){ break; }
      }
    }
  }
  throw lastErr||new Error('API unavailable.');
}
function updateApiStatus(state,msg){
  var dot=$('apiDot'),lbl=$('apiLbl'),qc=$('queueChip'),ql=$('queueLbl');
  if(!dot) return;
  if(state==='waiting'){
    dot.className='api-dot'; dot.style.background='var(--amber)';
    lbl.textContent='Rate limited';
    if(qc) qc.style.display='inline-flex';
    if(ql) ql.textContent=msg||'queuing…';
  } else {
    refreshApiStatus(); dot.style.background='';
    if(qc) qc.style.display='none';
  }
}
function parseJsonText(text){
  if(!text) throw new Error('Empty API response.');
  try { return JSON.parse(text.trim()); } catch(e) {}
  var cleaned = text.trim();
  var fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch(e) {}
    cleaned = fenceMatch[1];
  }
  var startArr = cleaned.indexOf('[');
  var endArr = cleaned.lastIndexOf(']');
  if(startArr !== -1 && endArr !== -1 && endArr > startArr){
    try { return JSON.parse(cleaned.slice(startArr, endArr + 1)); } catch(e){}
  }
  var startObj = cleaned.indexOf('{');
  var endObj = cleaned.lastIndexOf('}');
  if(startObj !== -1 && endObj !== -1 && endObj > startObj){
    try {
      var o = JSON.parse(cleaned.slice(startObj, endObj + 1));
      var keys = ['questions', 'items', 'data', 'results', 'objectives', 'fillInBlank', 'fill_in_blank', 'theory'];
      for(var i = 0; i < keys.length; i++){ if(Array.isArray(o[keys[i]])) return o[keys[i]]; }
      return o;
    } catch(e){}
  }
  throw new Error('Could not parse API response as JSON.');
}
function unwrapQuestionArray(result){
  if(Array.isArray(result)) return result;
  if(result&&typeof result==='object'){
    var keys=['questions','items','data','results','objectives','fillInBlank','fill_in_blank','theory'];
    for(var i=0;i<keys.length;i++){ if(Array.isArray(result[keys[i]])) return result[keys[i]]; }
  }
  return [];
}
async function callGemini(prompt,opts){
  opts=opts||{};
  ensureApiKey();
  var sysInstr = opts.systemInstruction
    ? opts.systemInstruction
    : 'You are an expert Nigerian curriculum exam question generator. Always respond with valid JSON only — no explanation, no markdown, no code fences.';
  var messages=[
    {role:'system',content:sysInstr},
    {role:'user',content:prompt}
  ];
  var result=await(_apiQueue=_apiQueue.then(function(){ return _callWithRetry(messages,true,opts); }));
  return parseJsonText(result);
}
async function callGeminiVision(base64Image,mimeType,prompt){
  ensureApiKey();
  mimeType=mimeType||'image/jpeg';
  var messages=[{role:'user',content:[{type:'image_url',image_url:{url:'data:'+mimeType+';base64,'+base64Image}},{type:'text',text:prompt}]}];
  var text=await(_apiQueue=_apiQueue.then(function(){ return _callWithRetry(messages,false); }));
  return parseJsonText(text);
}

/* ══════════════════════════════════════
   SCHEME API — pinned to gemini-2.5-flash
   temperature 0.05 for maximum consistency
══════════════════════════════════════ */
async function callGeminiScheme(prompt){
  ensureApiKey();
  var messages=[
    {role:'system',content:'You are a Nigerian curriculum specialist with authoritative knowledge of the NERDC 2026 Basic and Secondary Education syllabuses. You produce only verified, real curriculum data as valid JSON. Never invent topics. Never include administrative or non-teaching weeks.'},
    {role:'user',content:prompt}
  ];
  // Route through _callWithRetry so 401s are caught, key is blacklisted and user is prompted
  var text=await(_apiQueue=_apiQueue.then(function(){ return _callWithRetry(messages,true); }));
  return parseJsonText(text);
}

/* ══════════════════════════════════════
   LAB NL COMMAND — Claude Sonnet via OpenRouter
══════════════════════════════════════ */
async function callLabNL(command){
  ensureApiKey();
  var prompt='You are a layout formatting assistant for a Nigerian school exam paper system.\n'
    +'Parse this admin command and return a JSON object with ONLY the fields the command explicitly mentions.\n\n'
    +'COMMAND: "'+command+'"\n\n'
    +'POSSIBLE OUTPUT FIELDS:\n'
    +'  "printMode": "auto" or "portrait" or "landscape" or "split" or "multi" or "dup2" or "dup4" or "dup5" or "dup6"\n'
    +'  "columns": 1 or 2\n'
    +'  "orientation": "portrait" or "landscape"\n'
    +'  "fontFamily": "Times New Roman" or "Arial" or "Georgia" or "Helvetica" or "Verdana"\n'
    +'  "fontSize": one of "9pt","10pt","11pt","12pt","13pt","14pt"\n'
    +'  "margins": one of "15mm","18mm","20mm","22mm","25mm"\n'
    +'  "spacing": "compact" or "standard" or "wide"\n'
    +'  "isDrawingCommand": true or false\n'
    +'  "drawingDescription": string describing what to draw (only if isDrawingCommand is true)\n'
    +'  "targetQuestionIndex": 0-based integer ("Question 1"=0, "Question 3"=2)\n\n'
    +'RULES:\n'
    +'- Only include fields the command directly mentions.\n'
    +'- Words like "economy", "2-in-1", "duplex", "half page", "cut", "split" → printMode:"split"\n'
    +'- Words like "normal", "standard", "portrait", "full page" → printMode:"portrait"\n'
    +'- Words like "landscape", "horizontal", "wide page" → printMode:"landscape"\n'
    +'- Words like "multi", "multiple subjects", "combined", "stack", "compact subjects" → printMode:"multi"\n'
    +'- Words like "2/4", "duplicate 2" → printMode:"dup2"; "4/4" → "dup4"; "5/5" → "dup5"; "6/6" → "dup6"\n'
    +'- Words like "auto", "automatic", "best fit", "smart" → printMode:"auto"\n'
    +'- If command mentions draw/diagram/figure/illustrate/sketch/SVG → isDrawingCommand:true\n'
    +'- JSON object ONLY. No explanation. No markdown.';
  var messages=[
    {role:'system',content:'You are a JSON-only formatting assistant. Always respond with a valid JSON object and nothing else.'},
    {role:'user',content:prompt}
  ];
  var result=await(_apiQueue=_apiQueue.then(function(){
    return _fetchOR(messages,MODELS.fallback,true);
  }));
  return parseJsonText(result);
}

/* ══════════════════════════════════════
   DRAWING API — SVG generation via Gemini
══════════════════════════════════════ */
async function callGeminiDraw(description, targetDims){
  // Default to medium size; caller can specify dimensions based on host layout
  var td = targetDims || {width:420, height:300, context:'standard A4 portrait'};
  var w = td.width, h = td.height, ctx = td.context || 'standard A4 portrait';
  var prompt='Generate a clean, labeled SVG diagram for a Nigerian secondary school exam paper.\n'
    +'Description: "'+description+'"\n'
    +'Target layout context: '+ctx+'\n\n'
    +'STRICT REQUIREMENTS:\n'
    +'1. Return ONLY the SVG element — no preamble, no explanation, no markdown.\n'
    +'2. SVG MUST use these EXACT dimensions: width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'" xmlns="http://www.w3.org/2000/svg"\n'
    +'3. Use black/dark lines (#000 or #333) on white/transparent background only.\n'
    +'4. All labels must use font-size between 9 and 12 and be clearly readable.\n'
    +'5. Diagram must be scientifically/educationally accurate.\n'
    +'6. Clean and simple — suitable for black-and-white A4 printing.\n'
    +'7. IMPORTANT: fill the given '+w+'x'+h+' canvas EFFICIENTLY — do not leave excess whitespace padding, but do not overflow either. All content (shapes + labels) must be visible inside the viewBox.\n'
    +'8. If the diagram is inherently small (e.g., a simple triangle), scale it UP to use at least 70% of the canvas width/height.\n'
    +'9. Include a brief title element inside the SVG.\n'
    +'SVG CODE ONLY. Start with <svg and end with </svg>.';
  var messages=[
    {role:'system',content:'You are a scientific diagram generator for educational exam papers. Produce accurate, clean, labeled SVG diagrams sized EXACTLY to the specified dimensions. Return SVG code only — no prose, no markdown fences.'},
    {role:'user',content:prompt}
  ];
  var text=await(_apiQueue=_apiQueue.then(function(){ return _fetchOR(messages,MODELS.drawing,false); }));
  // Strip markdown fences if present
  text=text.replace(/^```[a-z]*\s*/i,'').replace(/```\s*$/,'').trim();
  var svgMatch=text.match(/<svg[\s\S]*?<\/svg>/i);
  if(!svgMatch) throw new Error('No valid SVG returned by AI. Try rephrasing the description.');
  return svgMatch[0];
}

/* Compute target diagram dimensions based on current layout mode.
   Used by the AI Layout Agent to request appropriately-sized diagrams. */
function getDiagramTargetDims(mode){
  var m=mode||'portrait';
  if(m==='split'){
    // Each quadrant is ~138mm × 180mm; diagram should fit in ~50% of that
    return {width:260, height:180, context:'Split 2-in-1 quadrant (tight space, ~138mm wide column)'};
  }
  if(m==='multi'){
    return {width:300, height:200, context:'Multi-Subject block (shared page with other subjects)'};
  }
  if(m==='landscape'){
    return {width:380, height:260, context:'Full Landscape A4 (2-column flow, generous space)'};
  }
  // portrait default
  return {width:420, height:300, context:'Portrait A4 (standard generous space)'};
}

/* Advisory check before diagram injection. Returns {canFit, advice, severity} —
   never blocks; merely informs admin. */
function advisDiagramFit(paper, mode){
  var height=estimatePaperHeight(paper);
  var advisory={canFit:true, advice:'', severity:'ok'};
  if(mode==='split'){
    // Split already tight; adding a diagram may overflow a quadrant
    var parts=divideIntoParts(paper);
    var hA=estimateQuestionsHeight(parts.partA)+80; // assume diagram adds 80pt
    var hB=estimateQuestionsHeight(parts.partB)+80;
    if(hA>265 || hB>265){
      advisory.canFit=false;
      advisory.severity='warn';
      advisory.advice='Diagram may crowd the Split 2-in-1 quadrant. Consider switching this paper to Full Landscape for better diagram readability. Proceeding anyway.';
    }
  }
  return advisory;
}

/* ══════════════════════════════════════
   SCREEN 1 — THE CONTRACT
══════════════════════════════════════ */
function s1Auto(){
  S.scr=1; hdr();
  S.screen='app';
  S.path='auto';
  applyAdminSettings();
  enforceAdminTerm();
  $('s1').style.display='block';
  $('s2').style.display='none';
  $('s3').style.display='none';
  window.scrollTo({top:0,behavior:'smooth'});

  var c=S.cfg;
  var apiWarn=!getEffectiveApiKey()?'<div class="banner b-warn">⚠️ <div>No OpenRouter API key. <a onclick="navTo(\'sett\')">Add your key in Settings</a> to enable AI generation.</div></div>':'';

  $('s1').innerHTML='<div class="pg fade">'
    +'<div class="ptl">The Contract</div>'
    +'<div class="pst">Define the examination — AI generates every question to NERDC 2026 standards.</div>'
    +apiWarn

    // Assessment Type
    +'<div class="card"><div class="ct">Assessment Type</div>'
    +'<div class="atog">'
    +'<button class="ab '+(S.at==='Examination'?'on':'')+'" id="aex">📋 Examination</button>'
    +'<button class="ab '+(S.at==='C.A.'||S.at==='C.A. Test 1'||S.at==='C.A. Test 2'?'on':'')+'" id="aca">📝 C.A.</button>'
    +'</div>'
    // C.A. sub-options
    +'<div id="caSubOpts" style="display:'+(S.at==='C.A.'||S.at==='C.A. Test 1'||S.at==='C.A. Test 2'?'flex':'none')+';gap:8px;margin-top:10px;flex-wrap:wrap;">'
    +'<button class="ab bsm '+(S.at==='C.A. Test 1'?'on':'')+'" id="acat1" style="font-size:11.5px;">📝 Test 1 <span style="font-size:10px;font-weight:400;">(First 3 topics)</span></button>'
    +'<button class="ab bsm '+(S.at==='C.A. Test 2'?'on':'')+'" id="acat2" style="font-size:11.5px;">📝 Test 2 <span style="font-size:10px;font-weight:400;">(First 6 topics)</span></button>'
    +'</div>'
    +'<div style="margin-top:9px;font-size:12px;color:var(--mute);" id="atDesc">'
    +(S.at==='Examination'?'<b style="color:var(--blue)">EXAM</b> — Full terminal paper covering all term topics.'
     :S.at==='C.A. Test 1'?'<b style="color:var(--amber)">TEST 1</b> — Weeks 1–3 only. Questions drawn from the first 3 scheme topics.'
     :S.at==='C.A. Test 2'?'<b style="color:var(--amber)">TEST 2</b> — Weeks 1–6. Questions cover the first 6 scheme topics.'
     :'<b style="color:var(--amber)">C.A.</b> — Select Test 1 or Test 2 above.')
    +'</div></div>'

    // Step 1
    +'<div class="card"><div class="ct">Step 1 — Term &amp; Class</div>'
    +'<div class="r3">'
    +'<div class="fl"><label>Academic Session</label><input type="text" class="fi" id="fsess" value="'+esc(c.session||'2025/2026')+'"/></div>'
    +'<div class="fl"><label>NERDC Term</label><select class="fs" id="fterm">'
    +TERMS.map(function(x){ return '<option'+(x===c.term?' selected':'')+'>'+x+'</option>'; }).join('')
    +'</select></div>'
    +'<div class="fl"><label>Target Class</label><select class="fs" id="fcl"><option value="">Choose class…</option>'
    +CL.map(function(x){ return '<option'+(x===c.cls?' selected':'')+'>'+x+'</option>'; }).join('')
    +'</select></div>'
    +'</div>'
    +'<div class="fetch-note" id="subjFetchNote">'+(c.cls?'<span style="color:var(--green);font-size:11px;">✓ NERDC 2026 subjects loaded</span>':'Select Term and Class to load subjects.')+'</div>'
    +'</div>'

    // Step 2 — Subject
    +'<div class="card flow-step'+(c.cls?' unlocked':'')+'" id="subjCard">'
    +'<div class="ct">Step 2 — Subject</div>'
    +'<div class="subj-grid" id="subjGrid">'+renderSubjectPills()+'</div>'
    +'<div id="tradePanelWrap"></div>'
    +'</div>'

    // Step 3 — Scheme
    +'<div class="card flow-step'+(c.subj?' unlocked':'')+'" id="schemeCard">'
    +'<div class="ct">Step 3 — Scheme of Work</div>'
    +'<div id="schemeArea">'+(S.schemeLoaded?renderSchemePanel():renderSchemePrompt())+'</div>'
    +'<div style="margin-top:14px;">'
    +'<label style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--mute);display:block;margin-bottom:7px;">Topic Tags <span style="font-weight:400;text-transform:none;letter-spacing:0;">(✕ to remove any you didn\'t cover)</span></label>'
    +'<div class="tag-cloud" id="tagCloud">'+renderTagCloud()+'</div>'
    +'</div>'
    +'</div>'

    // Exam Standard
    +'<div class="card flow-step'+(c.subj?' unlocked':'')+'" id="stdCard">'
    +'<div class="ct">Exam Standard / DNA</div>'
    +'<div class="fl"><select class="fs" id="fst" required>'
    +'<option value=""'+(!c.std?' selected':'')+'>Choose exam standard...</option>'
    +STANDARDS.map(function(x){ return '<option'+(x===c.std?' selected':'')+'>'+x+'</option>'; }).join('')
    +'</select>'
    +'<div style="font-size:11px;color:var(--mute);margin-top:5px;">Sets tone, format, and difficulty ChatGPT will follow.</div>'
    +'</div>'
    +(c.std==='Custom/Internal'?renderDifficultyToggle():'')
    +'</div>'

    // Question Allocation
    +'<div class="card flow-step'+(c.subj?' unlocked':'')+'" id="qCard">'
    +'<div class="ct">Question Allocation</div>'
    +'<div class="r3">'
    +'<div class="fl"><label>Objective (A–D)</label>'
    +'<input type="number" class="num-input" id="objN" min="0" max="60" value="'+c.objN+'"/>'
    +'<div style="font-size:11px;color:var(--mute);margin-top:4px;">0–60</div></div>'
    +'<div class="fl"><label>Fill-in-Blank <span style="color:var(--purple);font-size:9px;">(Optional)</span></label>'
    +'<input type="number" class="num-input fitb-input" id="fitbN" min="0" max="20" value="'+c.fitbN+'"/>'
    +'<div style="font-size:11px;color:var(--mute);margin-top:4px;">0–20</div></div>'
    +'<div class="fl"><label>Theory / Essay</label>'
    +'<input type="number" class="num-input" id="thN" min="0" max="20" value="'+c.thN+'"/>'
    +'<div style="font-size:11px;color:var(--mute);margin-top:4px;">0–20</div></div>'
    +'</div>'
    +'<div style="margin-top:6px;font-size:11.5px;color:var(--mute);">📝 Fill-in-the-Blank: short-answer questions with a dash line — no options. Marked by teacher.</div>'
    +(isCATest(S.at)?'<div class="banner b-amber" style="margin-bottom:0;margin-top:10px;">💡 C.A. Tip: Max 20 objectives + 3 theory.</div>':'')
    +'</div>'

    // Theory Instructions
    +'<div class="card flow-step'+(c.subj?' unlocked':'')+'" id="thCard">'
    +'<div class="ct">Theory Section Instructions</div>'
    +'<div class="fl"><label>📄 Instructions printed on paper</label>'
    +'<textarea class="fta" id="ftheoryPaper" style="min-height:64px;" placeholder="e.g. Answer any 3 questions. Section A: Short answer (5 marks each).">'+esc(c.theoryPaperInstr||'')+'</textarea>'
    +'</div>'
    +'<div class="fl" style="margin-top:10px;"><label>🤖 How do you want your questions to be set? <span style="font-weight:400;text-transform:none;letter-spacing:0;">(sent to ChatGPT as a system instruction — not printed)</span></label>'
    +'<textarea class="fta" id="ftheoryAi" style="min-height:78px;" placeholder="e.g. Set 3 questions, make the second a diagram-based question. Focus on real-world application, not memorisation.">'+esc(c.theoryAiInstr||'')+'</textarea>'
    +'<div class="banner b-teal" style="margin-top:8px;margin-bottom:0;font-size:11.5px;">🎯 <strong>These instructions are mandatory</strong> — ChatGPT will follow them exactly when generating theory questions.</div>'
    +'<div style="font-size:11px;color:var(--mute);margin-top:4px;">Private — only sent to ChatGPT. Not printed on paper.</div>'
    +'</div></div>'

    +'<div class="card flow-step'+(c.subj?' unlocked':'')+'" id="metaCard">'
    +'<div class="ct">Paper Instructions</div>'
    +'<div class="fl"><label>Instructions to Candidates</label><input type="text" class="fi" id="fin" value="'+esc(c.instr)+'"/></div>'
    +'</div>'

    +'<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">'
    +'<button class="btn bq" onclick="navTo(\'new\')">← Change Path</button>'
    +'<button class="btn bp" id="s1n" disabled>Generate Workshop →</button>'
    +'</div></div>';

  // Events
  // ── Assessment Type wiring (inline — no full re-render) ──
  function _setAt(val){
    S.at=val;
    // Update toggle buttons
    [$('aex'),$('aca')].forEach(function(b){ if(b) b.classList.remove('on'); });
    if(val==='Examination'){ if($('aex')) $('aex').classList.add('on'); }
    else { if($('aca')) $('aca').classList.add('on'); }
    // Show/hide sub-options
    var sub=$('caSubOpts');
    if(sub) sub.style.display=(val==='Examination'?'none':'flex');
    // Update sub-option highlights
    [$('acat1'),$('acat2')].forEach(function(b){ if(b) b.classList.remove('on'); });
    if(val==='C.A. Test 1'&&$('acat1')) $('acat1').classList.add('on');
    if(val==='C.A. Test 2'&&$('acat2')) $('acat2').classList.add('on');
    // Update description text
    var atd=$('atDesc');
    if(atd){
      if(val==='Examination') atd.innerHTML='<b style="color:var(--blue)">EXAM</b> — Full terminal paper covering all term topics.';
      else if(val==='C.A. Test 1') atd.innerHTML='<b style="color:var(--amber)">TEST 1</b> — Weeks 1–3 only. Questions drawn from the first 3 scheme topics.';
      else if(val==='C.A. Test 2') atd.innerHTML='<b style="color:var(--amber)">TEST 2</b> — Weeks 1–6. Questions cover the first 6 scheme topics.';
      else atd.innerHTML='<b style="color:var(--amber)">C.A.</b> — Select Test 1 or Test 2 above.';
    }
    // Apply topic limits for CA tests
    applyAssessmentTopicScope();
    var tc=$('tagCloud'); if(tc) tc.innerHTML=renderTagCloud();
    // C.A. tip banner
    var qCard=$('qCard');
    if(qCard){
      var oldTip=qCard.querySelector('.ca-tip'); if(oldTip) oldTip.remove();
      if(val!=='Examination'){
        var tip=document.createElement('div');
        tip.className='banner b-amber ca-tip';
        tip.style.marginTop='10px';
        tip.innerHTML='💡 C.A. Tip: Typically max 20 objectives + 3 theory for '+val+'. Adjust counts above.';
        qCard.appendChild(tip);
      }
    }
    checkS1Ready();
  }
  $('aex').onclick=function(){ _setAt('Examination'); };
  $('aca').onclick=function(){ _setAt(S.at==='Examination'?'C.A. Test 1':S.at); };
  if($('acat1')) $('acat1').onclick=function(){ _setAt('C.A. Test 1'); };
  if($('acat2')) $('acat2').onclick=function(){ _setAt('C.A. Test 2'); };
  // Restore sub-option state on re-render
  if(S.at!=='Examination'){ var sub2=$('caSubOpts'); if(sub2) sub2.style.display='flex'; }
  if(S.at==='C.A. Test 1'&&$('acat1')) $('acat1').classList.add('on');
  if(S.at==='C.A. Test 2'&&$('acat2')) $('acat2').classList.add('on');
  $('fsess').oninput=function(e){ S.cfg.session=e.target.value; _saveSetting('defsession', e.target.value); _saveSetting('defsession', e.target.value); };
  $('fterm').disabled=true;
  $('fterm').title='Term is controlled by Admin Settings';
  $('fterm').onchange=function(e){ S.cfg.term=enforceAdminTerm(); e.target.value=S.cfg.term; onClassTermChange(); };
  $('fcl').onchange=function(e){ S.cfg.cls=e.target.value; onClassTermChange(); };
  $('fst').onchange=function(e){
    S.cfg.std=e.target.value;
    var sc=$('stdCard');
    if(sc){
      var ex=sc.querySelector('.diff-wrap'); if(ex) ex.remove();
      if(S.cfg.std==='Custom/Internal'){ var dw=document.createElement('div'); dw.className='diff-wrap'; dw.innerHTML=renderDifficultyToggle(); sc.appendChild(dw); }
    }
    checkS1Ready();
  };
  $('fin').oninput=function(e){ S.cfg.instr=e.target.value; };
  var ftp=$('ftp'); if(ftp) ftp.oninput=function(e){ S.cfg.topicText=e.target.value; checkS1Ready(); };
  $('ftheoryPaper').oninput=function(e){ S.cfg.theoryPaperInstr=e.target.value; };
  $('ftheoryAi').oninput=function(e){ S.cfg.theoryAiInstr=e.target.value; };
  $('s1n').onclick=function(){
    var on=parseInt($('objN').value)||0;
    var fn=parseInt($('fitbN').value)||0;
    var tn=parseInt($('thN').value)||0;
    if(on+fn+tn===0){ toast('Set at least 1 question','warn'); return; }
    if(!$('fst').value){ toast('Choose the exam standard first','warn'); return; }
    S.cfg.objN=Math.max(0,on); S.cfg.fitbN=Math.max(0,fn); S.cfg.thN=Math.max(0,tn);
    if(!S.schemeMode){ toast('Choose Automatic or Manual scheme first','warn'); return; }
    if(S.schemeMode==='manual'&&!S.schemeCommitted){ toast('Save the manual scheme before proceeding','warn'); return; }
    if(!S.cfg.topics.length){ toast('Add scheme topics first','warn'); return; }
    S.slots=[]; goWorkshop();
  };

  if(c.cls&&c.term&&!S.subjects.length){
    S.subjects=getSubjectList(c.cls).slice();
    var sg0=$('subjGrid'); if(sg0) sg0.innerHTML=renderSubjectPills();
    var note0=$('subjFetchNote'); if(note0) note0.innerHTML='<span style="color:var(--green);font-size:11px;">✓ NERDC 2026 subjects loaded ('+S.subjects.length+')</span>';
  }
  checkS1Ready();
}
window.backToAutoContract=function(){
  S.generating=false;
  s1Auto();
};

/* ── Subject pills ── */
function renderSubjectPills(){
  if(!S.cfg.cls) return '<span class="tag-empty">Select a class above to see subjects.</span>';
  var list=S.subjects.length?S.subjects:getSubjectList(S.cfg.cls);
  var trade=getTradeById(S.tradeSubject);
  return list.map(function(s){
    var isTrade=(s==='Trade Subject');
    var displayName=isTrade?('🌱 '+trade.name):s;
    return '<div class="spill'+(isTrade?' trade-pill':'')+(s===S.cfg.subj?' sel':'')+'" onclick="selectSubject(\''+s.replace(/'/g,"\\'")+'\')">'
      +esc(displayName)+'</div>';
  }).join('');
}

window.selectSubject=function(s){
  S.cfg.subj=s;
  S.schemeWeeks=[]; S.schemeLoaded=false; S.schemeCommitted=false; S.schemeMode=null; S.cfg.topics=[]; S.cfg.topicText=''; S.manualSchemeFiles=[];
  var sg=$('subjGrid'); if(sg) sg.innerHTML=renderSubjectPills();
  ['schemeCard','stdCard','qCard','thCard','metaCard'].forEach(function(id){
    var el=$(id); if(el) el.classList.add('unlocked');
  });

  // Show trade panel if Trade Subject selected
  var tw=$('tradePanelWrap');
  if(tw){
    if(s==='Trade Subject'){ tw.innerHTML=renderTradePanel(); }
    else{ tw.innerHTML=''; }
  }

  var tc=$('tagCloud'); if(tc) tc.innerHTML=renderTagCloud();
  checkS1Ready();
  var sa=$('schemeArea'); if(sa) sa.innerHTML=renderSchemePrompt();
};

function renderTradePanel(){
  var cur=S.tradeSubject;
  return '<div class="trade-panel" style="margin-top:12px;">'
    +'<div class="trade-panel-title">Select your trade subject for this paper:</div>'
    +TRADE_SUBJECTS.map(function(t){
      return '<div class="trade-opt'+(cur===t.id?' sel':'')+'" onclick="pickTrade(\''+t.id+'\')">'
        +'<span class="to-ico">'+t.icon+'</span>'
        +'<div><div class="to-name">'+esc(t.name)+'</div><div class="to-desc">'+esc(t.desc)+'</div></div>'
        +'</div>';
    }).join('')
    +'</div>';
}

window.pickTrade=function(id){
  S.tradeSubject=id;
  var tw=$('tradePanelWrap'); if(tw) tw.innerHTML=renderTradePanel();
  S.schemeWeeks=[]; S.schemeLoaded=false; S.schemeCommitted=false; S.cfg.topics=[]; S.cfg.topicText='';
  var sa=$('schemeArea'); if(sa) sa.innerHTML=renderSchemePrompt();
  var tc=$('tagCloud'); if(tc) tc.innerHTML=renderTagCloud();
  checkS1Ready();
};

/* ── Difficulty toggle ── */
function renderDifficultyToggle(){
  var d=S.difficultyLevel||'Balanced';
  return '<div class="diff-wrap" style="margin-top:6px;">'
    +'<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--mute);margin-bottom:6px;">Difficulty Level</div>'
    +'<div class="diff-toggle">'
    +'<button class="diff-btn lenient'+(d==='Lenient'?' on':'')+'" onclick="setDiff(\'Lenient\')">😊 Lenient</button>'
    +'<button class="diff-btn balanced'+(d==='Balanced'?' on':'')+'" onclick="setDiff(\'Balanced\')">⚖ Balanced</button>'
    +'<button class="diff-btn rigorous'+(d==='Rigorous'?' on':'')+'" onclick="setDiff(\'Rigorous\')">🔥 Rigorous</button>'
    +'</div></div>';
}
window.setDiff=function(level){
  S.difficultyLevel=level;
  document.querySelectorAll('.diff-btn').forEach(function(b){
    b.classList.remove('on');
    if(b.textContent.includes(level)) b.classList.add('on');
  });
};

/* ── Scheme ── */
function renderSchemePrompt(){
  if(!S.cfg.subj) return '<div class="fetch-note">Select a subject above to load the scheme.</div>';
  var autoOn=S.schemeMode==='auto', manualOn=S.schemeMode==='manual';
  return '<div class="scheme-choice">'
    +'<button class="scheme-choice-btn'+(autoOn?' on':'')+'" onclick="chooseSchemeMode(\'auto\')">'
      +'<strong>Automatic</strong><span>Use the current NERDC scheme fetch and committed scheme logic.</span></button>'
    +'<button class="scheme-choice-btn'+(manualOn?' on':'')+'" onclick="chooseSchemeMode(\'manual\')">'
      +'<strong>Manual</strong><span>Type topics or upload a scheme file/image, then save it.</span></button>'
    +'</div>'
    +(autoOn?renderAutoSchemeTools():manualOn?renderManualSchemeTools():'<div class="fetch-note" style="margin-top:10px;">Choose Automatic or Manual scheme before proceeding.</div>');
}
function renderAutoSchemeTools(){
  return '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px;">'
    +'<button class="btn bq bsm" onclick="doLoadScheme()">📋 Load Scheme of Work</button>'
    +'<span style="font-size:12px;color:var(--mute);">Fetches verified NERDC 2026 weekly plan</span>'
    +'</div>';
}
function renderManualSchemeTools(){
  var files=(S.manualSchemeFiles||[]).map(function(f,i){
    return '<div class="scheme-file-chip">'+esc(f.label||('File '+(i+1)))+'<button onclick="removeManualSchemeFile('+i+')" title="Delete file">×</button></div>';
  }).join('');
  return '<div class="manual-scheme-box">'
    +'<label class="fl"><span style="display:block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--mute);margin-bottom:6px;">Manual Scheme Topics</span>'
    +'<textarea class="fta" id="manualSchemeText" style="min-height:92px;" placeholder="Type topics separated by commas or new lines. Example: Fractions, Decimals, Percentages">'+esc(S.cfg.topicText||'')+'</textarea></label>'
    +'<div class="manual-scheme-actions">'
      +'<label class="upload-label">📁 Upload Scheme<input type="file" accept="image/*,application/pdf,.docx,.doc,.txt" multiple style="display:none;" onchange="handleManualSchemeUpload(event)"/></label>'
      +'<button class="btn bg bsm" onclick="saveManualScheme()">✓ Save Manual Scheme</button>'
      +'<button class="btn bq bsm" onclick="deleteManualScheme()">Delete Saved Scheme</button>'
    +'</div>'
    +(files?'<div class="scheme-file-list">'+files+'</div>':'')
    +'<div id="manualSchemeStatus" style="margin-top:10px;"></div>'
    +'</div>';
}
window.chooseSchemeMode=function(mode){
  S.schemeMode=mode;
  S.schemeWeeks=[]; S.schemeLoaded=false; S.schemeCommitted=false; S.cfg.topics=[];
  if(mode==='auto') S.cfg.topicText='';
  var sa=$('schemeArea'); if(sa) sa.innerHTML=renderSchemePrompt();
  var tc=$('tagCloud'); if(tc) tc.innerHTML=renderTagCloud();
  checkS1Ready();
  if(mode==='manual'){
    var actualSubj=S.cfg.subj==='Trade Subject'?getTradeById(S.tradeSubject).name:S.cfg.subj;
    loadCommittedScheme(S.cfg.cls,actualSubj,S.cfg.term).then(function(saved){
      if(saved&&saved.length&&saved.some(function(w){ return /manual scheme/i.test(w.subtopics||''); })){
        S.schemeWeeks=saved; S.schemeLoaded=true; S.schemeCommitted=true;
        S.cfg.topics=saved.map(function(w){ return w.topic; }).filter(Boolean);
        var sa2=$('schemeArea'); if(sa2) sa2.innerHTML=renderSchemePanel();
        var tc2=$('tagCloud'); if(tc2) tc2.innerHTML=renderTagCloud();
        checkS1Ready();
      }
    });
  }
};
function renderSchemePanel(){
  if(!S.schemeWeeks.length) return renderSchemePrompt();
  var committed=S.schemeCommitted;
  var isManual=S.schemeMode==='manual'||S.schemeWeeks.some(function(w){ return /manual scheme/i.test(w.subtopics||''); });
  return '<div class="scheme-panel">'
    +'<div class="scheme-head" style="flex-wrap:wrap;gap:8px;align-items:center;">'
    +'<span class="scheme-head-txt">📋 '+esc(S.cfg.subj==='Trade Subject'?getTradeById(S.tradeSubject).name:S.cfg.subj)+' — '+esc(S.cfg.term)+'</span>'
    +(committed
      ?'<span class="scheme-locked-shield">🔒 Scheme Locked</span>'
        +'<button class="scheme-change-btn" onclick="'+(isManual?'deleteManualScheme()':'confirmChangeScheme()')+'" title="Replace committed scheme">'+(isManual?'Delete Scheme':'⚠ Change Scheme')+'</button>'
      :'<span style="font-size:11px;color:var(--amber);font-weight:700;">⚠ Not yet committed — accept below to lock</span>'
    )
    +'</div>'
    +'<div class="scheme-body">'
    +S.schemeWeeks.map(function(w){
      return '<div class="scheme-wk"><span class="scheme-wk-num">'+esc(w.week)+'</span>'
        +'<div><div>'+esc(w.topic)+'</div>'
        +(w.subtopics?'<div class="scheme-sub">'+esc(w.subtopics)+'</div>':'')
        +'</div></div>';
    }).join('')
    +'</div>'
    +'<div class="scheme-foot">'
    +(committed
      ?'<button class="btn bg bsm" disabled style="opacity:.6;cursor:default;">🔒 '+(isManual?'Manual Scheme Saved':'Scheme Committed')+'</button>'
      :'<button class="btn bg bsm" onclick="acceptScheme()">✓ Accept &amp; Commit Scheme</button>'
    )
    +(isManual?'<button class="btn bq bsm" onclick="chooseSchemeMode(\'manual\')">✏ Edit Manual Scheme</button>':'<button class="btn bq bsm" onclick="chooseSchemeMode(\'manual\')">✏ Use Manual Scheme</button>')
    +'</div></div>';
}
window.removeTag=function(i){ S.cfg.topics.splice(i,1); var tc=$('tagCloud'); if(tc) tc.innerHTML=renderTagCloud(); };
function topicsToWeeks(topics,source){
  return (topics||[]).map(function(t,i){
    return {week:'Week '+(i+1),topic:String(t||'').trim(),subtopics:source||'Manual scheme'};
  }).filter(function(w){ return w.topic; });
}
function parseTopicText(text){
  return String(text||'').split(/[\n,;]+/).map(function(t){ return t.trim(); }).filter(Boolean)
    .filter(function(t,i,a){ return a.indexOf(t)===i; });
}
async function extractSchemeFromText(text,label){
  text=String(text||'').trim();
  if(!text) return [];
  if(!getEffectiveApiKey()) return parseTopicText(text);
  var prompt='Extract the teaching topics from this scheme of work content for '+S.cfg.cls+' '+getActualSubj()+'.\n'
    +"Return ONLY a JSON array of topic strings. Do not include revision, exams, holidays, tests, breaks, or administrative weeks. Preserve the teacher's actual topic wording where possible.\n\n"
    +'CONTENT ('+(label||'typed text')+'):\n'+text;
  try{
    var out=await callGemini(prompt,{systemInstruction:'You extract scheme of work topics as valid JSON only.'});
    if(Array.isArray(out)) return out.map(function(x){ return typeof x==='string'?x:(x.topic||x.title||''); }).filter(Boolean);
  }catch(e){ console.warn('manual scheme text extraction fallback:',e.message); }
  return parseTopicText(text);
}
async function extractSchemeFromImage(dataUrl,label){
  var m=String(dataUrl||'').match(/^data:([^;]+);base64,(.+)$/);
  if(!m) return [];
  var prompt='Extract ONLY scheme of work teaching topics from this image/file page for '+S.cfg.cls+' '+getActualSubj()+'. '
    +'Return ONLY a JSON array of topic strings. Exclude revision, exam, holiday, break, test week, resumption, orientation, and administrative rows.';
  var out=await callGeminiVision(m[2],m[1],prompt);
  if(!Array.isArray(out)){
    var vals=out&&typeof out==='object'?Object.values(out).filter(Array.isArray):[];
    out=vals.length?vals[0]:[];
  }
  return out.map(function(x){ return typeof x==='string'?x:(x.topic||x.title||''); }).filter(Boolean);
}
window.handleManualSchemeUpload=async function(ev){
  var files=Array.prototype.slice.call((ev.target&&ev.target.files)||[]);
  if(!files.length) return;
  S.schemeMode='manual';
  var status=$('manualSchemeStatus');
  if(status) status.innerHTML='<div class="banner b-info"><span class="spin">⟳</span> Reading scheme file(s)…</div>';
  var topics=S.cfg.topics.slice();
  try{
    for(var i=0;i<files.length;i++){
      var f=files[i];
      var item=await processFileForScanner(f);
      S.manualSchemeFiles.push({label:f.name});
      if(item.type==='text') topics=topics.concat(await extractSchemeFromText(item.text,f.name));
      else if(item.type==='images'||item.type==='pdf_images'){
        for(var p=0;p<(item.pages||[]).length;p++) topics=topics.concat(await extractSchemeFromImage(item.pages[p].dataUrl,item.pages[p].label||f.name));
      } else if(item.type==='image'){
        topics=topics.concat(await extractSchemeFromImage(item.dataUrl,f.name));
      }
    }
    S.cfg.topics=parseTopicText(topics.join('\n'));
    S.schemeWeeks=topicsToWeeks(S.cfg.topics,'Uploaded manual scheme');
    S.schemeLoaded=!!S.schemeWeeks.length;
    if(status) status.innerHTML='<div class="banner b-ok">✓ '+S.cfg.topics.length+' topic(s) extracted. Click Save Manual Scheme to lock them.</div>';
  }catch(e){
    if(status) status.innerHTML='<div class="banner b-warn">⚠ Could not read scheme: '+esc(e.message||e)+'</div>';
  }
  var sa=$('schemeArea'); if(sa) sa.innerHTML=renderSchemePrompt();
  var tc=$('tagCloud'); if(tc) tc.innerHTML=renderTagCloud();
  checkS1Ready();
};
window.removeManualSchemeFile=function(i){
  S.manualSchemeFiles.splice(i,1);
  var sa=$('schemeArea'); if(sa) sa.innerHTML=renderSchemePrompt();
};
window.saveManualScheme=async function(){
  S.schemeMode='manual';
  var typed=(($('manualSchemeText')||{}).value||S.cfg.topicText||'').trim();
  var typedTopics=await extractSchemeFromText(typed,'manual topics');
  S.cfg.topicText=typed;
  S.cfg.topics=parseTopicText(S.cfg.topics.concat(typedTopics).join('\n'));
  if(!S.cfg.topics.length){ toast('Type or upload scheme topics first','warn'); return; }
  S.schemeWeeks=topicsToWeeks(S.cfg.topics,'Manual scheme');
  S.schemeLoaded=true; S.schemeCommitted=true;
  var actualSubj=S.cfg.subj==='Trade Subject'?getTradeById(S.tradeSubject).name:S.cfg.subj;
  await commitScheme(S.cfg.cls,actualSubj,S.cfg.term,S.schemeWeeks);
  var sa=$('schemeArea'); if(sa) sa.innerHTML=renderSchemePanel();
  var tc=$('tagCloud'); if(tc) tc.innerHTML=renderTagCloud();
  toast('Manual scheme saved — '+S.cfg.topics.length+' topic(s)','ok',4000);
  checkS1Ready();
};
window.deleteManualScheme=async function(){
  var actualSubj=S.cfg.subj==='Trade Subject'?getTradeById(S.tradeSubject).name:S.cfg.subj;
  await clearCommittedScheme(S.cfg.cls,actualSubj,S.cfg.term);
  S.schemeWeeks=[]; S.schemeLoaded=false; S.schemeCommitted=false; S.cfg.topics=[]; S.cfg.topicText=''; S.manualSchemeFiles=[];
  var sa=$('schemeArea'); if(sa) sa.innerHTML=renderSchemePrompt();
  var tc=$('tagCloud'); if(tc) tc.innerHTML=renderTagCloud();
  toast('Manual scheme deleted','ok');
  checkS1Ready();
};
window.acceptScheme=async function(){
  S.schemeMode='auto';
  applyAssessmentTopicScope();
  var actualSubj=S.cfg.subj==='Trade Subject'?getTradeById(S.tradeSubject).name:S.cfg.subj;
  await commitScheme(S.cfg.cls,actualSubj,S.cfg.term,S.schemeWeeks);
  S.schemeCommitted=true;
  var sa=$('schemeArea'); if(sa) sa.innerHTML=renderSchemePanel();
  var tc=$('tagCloud'); if(tc) tc.innerHTML=renderTagCloud();
  toast('🔒 Scheme committed — '+S.schemeWeeks.length+' weeks locked to memory','ok',4500);
  checkS1Ready();
};
window.editManually=function(){ var ta=$('ftp'); if(ta){ ta.focus(); ta.scrollIntoView({behavior:'smooth',block:'center'}); } };

function renderTagCloud(){
  if(!S.cfg.topics||!S.cfg.topics.length) return '<span class="tag-empty">No topics yet. Accept the scheme above or type manually.</span>';
  return S.cfg.topics.map(function(t,i){
    return '<div class="ttag">'+esc(t)+'<button class="ttag-x" onclick="removeTag('+i+')">×</button></div>';
  }).join('');
}

function checkS1Ready(){
  var btn=$('s1n'); if(!btn) return;
  var tp=$('ftp');
  var hasTopics=!!(S.cfg.topics&&S.cfg.topics.length>0);
  var hasTyped=!!(tp&&tp.value.trim().length>0);
  var hasSchemeChoice=!!S.schemeMode;
  var hasContent=S.schemeMode==='auto'
    ?(S.schemeLoaded&&hasTopics)
    :(S.schemeMode==='manual'&&S.schemeCommitted&&hasTopics);
  if(S.schemeMode==='manual'&&hasTyped&&!S.schemeCommitted) hasContent=false;
  var ok=!!(S.cfg.cls&&S.cfg.subj&&S.cfg.std&&hasSchemeChoice&&hasContent);
  btn.disabled=!ok;
}

function onClassTermChange(){
  enforceAdminTerm();
  S.cfg.subj=''; S.subjects=[]; S.schemeWeeks=[];
  S.schemeLoaded=false; S.schemeCommitted=false; S.schemeMode=null; S.cfg.topics=[]; S.cfg.topicText=''; S.manualSchemeFiles=[];
  if(S.cfg.cls){
    S.subjects=getSubjectList(S.cfg.cls).slice();
    var sc=$('subjCard'); if(sc) sc.classList.add('unlocked');
  } else {
    S.subjects=[];
    var sc2=$('subjCard'); if(sc2) sc2.classList.remove('unlocked');
  }
  var sg=$('subjGrid'); if(sg) sg.innerHTML=renderSubjectPills();
  var note=$('subjFetchNote');
  if(note) note.innerHTML=S.cfg.cls?'<span style="color:var(--green);font-size:11px;">✓ NERDC 2026 subjects loaded ('+S.subjects.length+')</span>':'Select Term and Class to load subjects.';
  ['schemeCard','stdCard','qCard','thCard','metaCard'].forEach(function(id){ var el=$(id); if(el) el.classList.remove('unlocked'); });
  var sa=$('schemeArea'); if(sa) sa.innerHTML=renderSchemePrompt();
  var tc=$('tagCloud'); if(tc) tc.innerHTML=renderTagCloud();
  checkS1Ready();
}

window.confirmChangeScheme=async function(){
  var actualSubj=S.cfg.subj==='Trade Subject'?getTradeById(S.tradeSubject).name:S.cfg.subj;
  var msg='⚠ WARNING: This will permanently replace your committed scheme for:\n\n'
    +S.cfg.cls+' — '+actualSubj+' — '+S.cfg.term+'\n\n'
    +'A new scheme will be fetched from AI. This action cannot be undone.\n\n'
    +'Are you sure you want to replace the committed scheme?';
  if(!confirm(msg)) return;
  await clearCommittedScheme(S.cfg.cls,actualSubj,S.cfg.term);
  S.schemeCommitted=false; S.schemeWeeks=[]; S.schemeLoaded=false; S.cfg.topics=[];
  var tc=$('tagCloud'); if(tc) tc.innerHTML=renderTagCloud();
  toast('Fetching new scheme from AI…','info',2000);
  doLoadScheme();
};

window.doForceRefreshScheme=window.confirmChangeScheme; // legacy alias

window.doLoadScheme=async function(){
  if(!S.cfg.subj){ toast('Select a subject first','warn'); return; }
  S.schemeMode='auto';
  enforceAdminTerm();

  var actualSubj=S.cfg.subj==='Trade Subject'?getTradeById(S.tradeSubject).name:S.cfg.subj;
  var cls=S.cfg.cls; var term=S.cfg.term;

  // Check for committed scheme first — serve immediately, no API call
  var committed=await loadCommittedScheme(cls,actualSubj,term);
  if(committed&&committed.length&&!committed.some(function(w){ return /manual scheme/i.test(w.subtopics||''); })){
    S.schemeWeeks=committed; S.schemeLoaded=true; S.schemeCommitted=true;
    applyAssessmentTopicScope();
    var sa0=$('schemeArea'); if(sa0) sa0.innerHTML=renderSchemePanel();
    var tc0=$('tagCloud'); if(tc0) tc0.innerHTML=renderTagCloud();
    toast('🔒 Committed scheme restored ('+committed.length+' weeks)','ok',4000);
    checkS1Ready();
    return;
  }

  var sa=$('schemeArea');
  if(!getEffectiveApiKey()){
    if(sa) sa.innerHTML='<div class="banner b-warn">⚠ No valid API key is saved in Admin Settings. Paste a working <strong>OpenRouter sk-or-v1-...</strong> key or <strong>Gemini AIza...</strong> key, then retry.<div style="margin-top:6px;font-size:11.5px;color:var(--mute);">Use the Manual scheme option in the meantime.</div></div>'+renderSchemePrompt();
    toast('No valid API key saved','err',4500);
    return;
  }
  if(sa) sa.innerHTML='<div class="banner b-info"><span class="spin">⟳</span> Fetching NERDC 2026 Scheme of Work via Gemini 2.5 Flash…</div>';

  // Determine level context for the prompt
  var levelCtx='';
  var cLow=cls.toLowerCase();
  if(cLow.includes('ss')){ levelCtx='Senior Secondary (SS) level. Topics must align with the WAEC/NECO/NERDC 2026 approved SS syllabus for this subject.'; }
  else if(cLow.includes('jss')){ levelCtx='Junior Secondary (JSS) level. Topics must align with the NERDC 2026 integrated Basic Education curriculum for JSS.'; }
  else if(cLow.includes('primary')){ levelCtx='Primary level. Topics must align with the NERDC 2026 revised Primary Education curriculum and continuous assessment framework.'; }
  else { levelCtx='Early Childhood / Pre-Primary level. Topics must align with the NERDC early years learning framework.'; }

  var termCtx=term==='1st Term'?'1st Term (foundational/introductory topics — definitions, basic concepts, introductory skills)':
    term==='2nd Term'?'2nd Term (intermediate topics — building on Term 1 concepts, more complex skills)':
    '3rd Term (advanced/application topics — synthesis, application, problem-solving, revision of core concepts)';

  var isVocational=(actualSubj.toLowerCase().includes('farming')||actualSubj.toLowerCase().includes('solar')||
    actualSubj.toLowerCase().includes('fashion')||actualSubj.toLowerCase().includes('beauty')||
    actualSubj.toLowerCase().includes('trade'));

  var prompt='You are a certified Nigerian curriculum specialist.\n'
    +'Your knowledge base includes the official NERDC 2026 National Curriculum documents, WAEC Chief Examiner Reports, NECO approved syllabuses, SUBEB frameworks, and peer-reviewed Nigerian secondary education journals.\n\n'
    +'TASK: Produce the NERDC 2026 Scheme of Work for the EXACT subject, class, and term specified. This scheme must match what is in the official government-approved curriculum document — NOT a generic or improvised version.\n\n'
    +'═══════════════════════════════════\n'
    +'SUBJECT : '+actualSubj+'\n'
    +'CLASS   : '+cls+' — '+levelCtx+'\n'
    +'TERM    : '+termCtx+'\n'
    +'═══════════════════════════════════\n\n'
    +'AUTHORITATIVE SOURCES TO DRAW FROM (in priority order):\n'
    +'1. NERDC 2026 National Curriculum Framework — the primary reference for ALL Nigerian public school subjects\n'
    +(cLow.includes('ss')?'2. WAEC Unified Syllabus (current edition) — mandatory for SS subjects\n3. NECO approved examination topics list\n':'')
    +(cLow.includes('jss')?'2. NERDC Basic Education Curriculum (BEC) 2026 revision — JSS 1–3 integrated curriculum\n':'')
    +(cLow.includes('primary')?'2. NERDC Revised Primary Education Curriculum 2026 — continuous assessment framework\n':'')
    +(isVocational?'2. NABTEB/NERDC Trade and Vocational Curriculum — '+actualSubj+' strand\n':'')
    +'LAST RESORT: Cross-referenced Nigerian teaching resources from SUBEB and state curriculum offices\n\n'
    +'NON-NEGOTIABLE RULES:\n'
    +'1. Use ONLY real, verifiable NERDC 2026 syllabus topics. If uncertain about a topic title, use the closest verified equivalent — never invent.\n'
    +'2. NEVER include non-teaching/administrative weeks: Revision, Examination, Break, Resumption, Orientation, Holiday, Mock, Test Week, Closing.\n'
    +'3. Topics must be SPECIFIC and TESTABLE — wrong: "Introduction". Correct: "Cell Theory and Cell Structure".\n'
    +'4. Follow the NERDC progressive sequence: foundational concepts first, complexity increasing each week.\n'
    +'5. Topics must be TERM-APPROPRIATE — match what a teacher would teach in '+term+' at '+cls+' level.\n'
    +'6. Every week must have a UNIQUE topic. Absolutely no repetition, no padding, no filler.\n'
    +'7. Subtopics must be 1–3 specific instructional content points that a teacher would actually teach in that lesson.\n'
    +'8. Generate EXACTLY '+( cLow.includes('primary')||cLow.includes('kg')||cLow.includes('nursery')||cLow.includes('creche') ? '10' : '13' )+' teaching weeks. Count them. Every week must be present.\n\n'
    +'EXAMPLES OF CORRECT SPECIFICITY:\n'
    +'✓ "Photosynthesis: Light and Dark Reactions" — specific, testable\n'
    +'✓ "Quadratic Equations: Solution by Factorisation and Formula" — specific, testable\n'
    +'✓ "Civic Rights and Responsibilities of Nigerian Citizens" — specific, testable\n'
    +'✗ "Introduction to the topic" — vague, unacceptable\n'
    +'✗ "Continuation" — meaningless, unacceptable\n\n'
    +'OUTPUT FORMAT — Return ONLY a valid JSON array, no preamble, no markdown, no code fences:\n'
    +'[\n'
    +'  {"week":"Week 1","topic":"Exact verified NERDC topic title","subtopics":"Specific instructional content point 1; Specific content point 2"},\n'
    +'  {"week":"Week 2","topic":"Next verified topic","subtopics":"Content point 1; Content point 2"}\n'
    +']\n'
    +'JSON ARRAY ONLY. Start with [ and end with ]. Nothing else.';

  callGeminiScheme(prompt)
    .then(function(weeks){
      S.schemeWeeks=Array.isArray(weeks)?weeks:[];
      // Validate: strip any week that looks like an admin week
      var banned=/\b(revision|examination|exam|break|resumption|orientation|closing|holiday|mock|test week)\b/i;
      S.schemeWeeks=S.schemeWeeks.filter(function(w){
        return w&&w.topic&&!banned.test(w.topic);
      });
      S.schemeLoaded=S.schemeWeeks.length>0;
      S.schemeCommitted=false;
      S.schemeMode='auto';
      applyAssessmentTopicScope();
      if(sa) sa.innerHTML=renderSchemePanel();
      var tc=$('tagCloud'); if(tc) tc.innerHTML=renderTagCloud();
      checkS1Ready();
      if(S.schemeLoaded) toast('✓ Scheme loaded — '+S.schemeWeeks.length+' weeks. Click "Accept & Commit" to lock it.','ok',5000);
      else if(sa) sa.innerHTML='<div class="banner b-warn">⚠ AI returned an empty scheme. <button class="btn bq bsm" onclick="doLoadScheme()">↻ Retry</button></div>';
    })
    .catch(function(e){
      S.schemeLoaded=false;
      var retryBtn='<button class="btn bq bsm" style="margin-top:10px;" onclick="doLoadScheme()">↻ Retry</button>';
      if(e.is429){
        var secs=Math.max(e.seconds||65,65);
        if(sa){
          sa.innerHTML='<div class="banner b-warn" style="flex-direction:column;align-items:flex-start;">'
            +'<div><strong>⏳ Rate limit</strong> — auto-retrying in <strong id="schemeCountdown">'+secs+'</strong>s…</div>'
            +'<div style="margin-top:4px;font-size:11.5px;opacity:.8;">Use the Manual scheme option in the meantime.</div>'
            +'</div>'+renderSchemePrompt();
          var rem=secs;
          var cd=setInterval(function(){ rem--; var el=$('schemeCountdown'); if(el) el.textContent=rem; if(rem<=0){ clearInterval(cd); doLoadScheme(); } },1000);
        }
      } else if(e.status===401 || /invalid.*key|api key|unauthorized/i.test(e.message)){
        // Key was rejected — blacklist it and guide admin to re-enter
        if(API_KEY){ markApiKeyInvalid(API_KEY); refreshApiStatus(); }
        if(sa) sa.innerHTML='<div class="banner b-warn">'
          +'<strong>🔑 Invalid API Key</strong> — OpenRouter rejected the key. '
          +'An admin must re-save a valid key in <strong>Admin Settings → OpenRouter API Key</strong>.'
          +retryBtn
          +'</div>'+renderSchemePrompt();
      } else {
        if(sa) sa.innerHTML='<div class="banner b-warn">⚠ Could not load scheme: '+esc(e.message.substring(0,120))
          +retryBtn+'<div style="margin-top:6px;font-size:11.5px;color:var(--mute);">Use the Manual scheme option.</div></div>'+renderSchemePrompt();
      }
      checkS1Ready();
    });
};

/* ══════════════════════════════════════
   WORKSHOP
══════════════════════════════════════ */
function goWorkshop(){
  S.scr=2; hdr();
  S.screen='app';
  S.path=S.path||'auto';
  $('s1').style.display='none';
  $('s2').style.display='block';
  $('s3').style.display='none';
  window.scrollTo({top:0,behavior:'smooth'});

  var c=S.cfg;
  var objN=Math.max(0,parseInt(c.objN)||0);
  var fitbN=Math.max(0,parseInt(c.fitbN)||0);
  var thN=Math.max(0,parseInt(c.thN)||0);

  var desiredTotal=objN+fitbN+thN;
  var canRebuild=!S.slots.length || (S.slots.length!==desiredTotal && !S.slots.some(function(s){ return s&&s.q; }));
  if(canRebuild){
    S.slots=[];
    for(var i=0;i<objN;i++)  S.slots.push({id:i,           k:'obj',  q:null,included:true,loading:false,err:null});
    for(var j=0;j<fitbN;j++) S.slots.push({id:objN+j,      k:'fitb', q:null,included:true,loading:false,err:null});
    for(var k=0;k<thN;k++)   S.slots.push({id:objN+fitbN+k,k:'theory',q:null,included:true,loading:false,err:null});
  }
  renderWorkshop();
  if(getEffectiveApiKey()&&S.slots.some(function(s){ return !s.q; })) generateAll();
}

function renderWorkshop(){
  var c=S.cfg;
  var objSlots  = S.slots.filter(function(s){ return s.k==='obj'; });
  var fitbSlots = S.slots.filter(function(s){ return s.k==='fitb'; });
  var thSlots   = S.slots.filter(function(s){ return s.k==='theory'; });
  var filled    = S.slots.filter(function(s){ return s.q&&s.included; }).length;
  var pct       = S.slots.length?Math.round(filled/S.slots.length*100):0;

  // Resolve display subject
  var dispSubj=c.subj==='Trade Subject'?getTradeById(S.tradeSubject).name:c.subj;

  var h='<div class="pgw fade">'
    +'<div class="ptl">The Workshop</div>'
    +'<div class="pst">'+esc(dispSubj)+' · '+esc(c.cls)+' · '+esc(c.term)+' · '+esc(c.std)+'</div>'
    +'<div class="meter">'
    +'<div class="m-row"><span class="m-lbl">Paper Progress</span><span class="m-cnt" id="mCnt">'+filled+' / '+S.slots.length+' questions ready</span></div>'
    +'<div class="m-trk"><div class="m-fil" id="mFil" style="width:'+pct+'%"></div></div>'
    +'<div class="m-msg" id="mMsg">'+progressMsg(filled,S.slots.length)+'</div>'
    +'</div>'
    
    +'<div style="display:flex;gap:9px;margin-bottom:18px;flex-wrap:wrap;">'
    +('<button class="btn bp" id="genAllBtn" onclick="generateAll()">⚡ Generate All Questions</button>')
    +'<button class="btn bq" onclick="backToAutoContract()">← Back to Contract</button>'
    +'</div>'

    +(objSlots.length?'<div class="ws-sec">'
      +'<div class="ws-sec-head"><span class="ws-sec-title">Section A — Objectives</span>'
      +'<span class="ws-sec-count">'+objSlots.filter(function(s){return s.q;}).length+' / '+objSlots.length+' generated</span></div>'
      +'<div id="objSlots">'+objSlots.map(renderSlot).join('')+'</div>'
      +'</div>':'')

    +(fitbSlots.length?'<div class="ws-sec">'
      +'<div class="ws-sec-head"><span class="ws-sec-title fitb-title">Section B — Fill-in-the-Blank</span>'
      +'<span class="ws-sec-count">'+fitbSlots.filter(function(s){return s.q;}).length+' / '+fitbSlots.length+' generated</span></div>'
      +'<div id="fitbSlots">'+fitbSlots.map(renderSlot).join('')+'</div>'
      +'</div>':'')

    +(thSlots.length?'<div class="ws-sec">'
      +'<div class="ws-sec-head"><span class="ws-sec-title">'+(fitbSlots.length?'Section C':'Section B')+' — Theory</span>'
      +'<span class="ws-sec-count">'+thSlots.filter(function(s){return s.q;}).length+' / '+thSlots.length+' generated</span></div>'
      +'<div id="thSlots">'+thSlots.map(renderSlot).join('')+'</div>'
      +'</div>':'')

    +'<div class="divider"></div>'
    +'<div style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;">'
    +'<button class="btn bq" onclick="s1Auto()">← Back</button>'
    +'<button class="btn bp" id="toReview" onclick="goReview()" '+(filled>0?'':'disabled')+'>'
    +'Review &amp; Print → ('+filled+' questions)</button>'
    +'</div></div>';

  $('s2').innerHTML=h;
  setTimeout(function(){ math($('s2')); },400);
}

function renderSlot(s){
  var isFitb=(s.k==='fitb');
  var cls='slot'+(isFitb?' fitb-slot':'')+(s.q?' ok':'')+(s.loading?' loading':'')+(s.err?' err':'');
  var num=String(s.id+1).padStart(2,'0');
  var body='';
  if(s.loading){
    body='<div class="skel med"></div><div class="skel"></div><div class="skel short"></div>';
  } else if(s.err){
    body='<div style="font-size:12.5px;color:var(--red);">⚠ '+esc(s.err)+'</div>'
      +'<div class="sacts"><button class="rbtn" onclick="reloadSlot('+s.id+')">↻ Retry</button></div>';
  } else if(s.q){
    var q=s.q;
    // Render question text (supports LaTeX via KaTeX and structured visuals)
    body='<div class="stx">'+renderQuestionText(q)+'</div>';
    if(isFitb&&q.answer){
      body+='<div class="fitb-answer">✓ Answer: <span>'+esc(q.answer)+'</span></div>';
    }
    if(q.k==='obj'&&q.o){
      body+='<div class="sopts">'+q.o.map(function(opt,oi){
        return '<div class="sopt'+(oi===q.a?' correct':'')+'"><span class="sok">'+L[oi]+'.</span><span>'+esc(opt)+'</span></div>';
      }).join('')+'</div>';
    }
    body+=renderVisualEditor('auto',s.id,q);
    body+='<div class="smeta">'
      +'<span class="tag '+(isFitb?'t-fitb':q.k==='obj'?'t-obj':'t-th')+'">'+(isFitb?'Fill-in-Blank':q.k==='obj'?'Objective':'Theory')+'</span>'
      +(q.g?'<span class="tag '+stdTagCls(q.g)+'">'+esc(q.g)+'</span>':'')
      +(q.topic?'<span class="tag t-cust">'+esc(q.topic)+'</span>':'')
      +(q.diff?'<span class="tag" style="background:var(--surf3);border-color:var(--bdr2);color:var(--mute);">'+esc(q.diff)+'</span>':'')
      +(q.ai?'<span class="tag t-ai">⚡ AI</span>':'')
      +(q.tr?'<span class="tag t-tr">✏ Transcribed</span>':'')
      +'</div>'
      +'<div class="mark-alloc">'
      +'<label>Marks:</label>'
      +'<input type="number" min="0" max="100" value="'+(q.marks!==undefined?q.marks:0)+'" '
      +'onchange="updMark('+s.id+',this.value)" onclick="event.stopPropagation()"/>'
      +'<span>'+(q.k==='obj'?'objective allocation':isFitb?'blank allocation':'allocated')+'</span>'
      +'</div>'
      +'<div class="sacts">'
      +'<button class="rbtn" onclick="reloadSlot('+s.id+')" '+(s.loading?'disabled':'')+'>↻ New Question</button>'
      +'<div class="crow" onclick="toggleInclude('+s.id+')">'
      +'<div class="ck '+(s.included?'on':'')+'">'+(s.included?'✓':'')+'</div>'
      +'<span class="cl">Include in paper</span>'
      +'</div></div>';
  } else {
    body='<div style="font-size:12px;color:var(--mute);">Waiting to generate…</div>';
  }
  return '<div class="'+cls+'" id="slot_'+s.id+'"><div class="sh2"><div class="snum">'+num+'</div><div class="sbody">'+body+'</div></div></div>';
}

function progressMsg(f,t){
  if(!t) return '';
  if(f===0) return '⏳ Generating questions…';
  if(f<t) return '⚡ '+f+' ready, '+(t-f)+' remaining…';
  return '🎉 All '+t+' questions ready! Review and proceed.';
}
function updateProgress(){
  var filled=S.slots.filter(function(s){ return s.q&&s.included; }).length;
  var total=S.slots.length;
  var pct=total?Math.round(filled/total*100):0;
  var fil=$('mFil'); if(fil) fil.style.width=pct+'%';
  var cnt=$('mCnt'); if(cnt) cnt.textContent=filled+' / '+total+' questions ready';
  var msg=$('mMsg'); if(msg) msg.textContent=progressMsg(filled,total);
  var rev=$('toReview'); if(rev){ rev.disabled=filled===0; rev.textContent='Review & Print → ('+filled+' questions)'; }
}
window.toggleInclude=function(id){
  var s=S.slots.find(function(x){ return x.id===id; }); if(!s||!s.q) return;
  s.included=!s.included;
  var el=$('slot_'+id); if(el) el.outerHTML=renderSlot(s);
  updateProgress();
  setTimeout(function(){ math($('s2')); },200);
};
window.reloadSlot=function(id){ var s=S.slots.find(function(x){ return x.id===id; }); if(!s) return; genSingleSlot(s,true); };
window.updMark=function(id,val){ var s=S.slots.find(function(x){ return x.id===id; }); if(s&&s.q){ s.q.marks=Math.max(0,parseInt(val)||0); } };

/* ── Build prompts ── */
function getActualSubj(){
  return normalizeSubjectName(S.cfg.subj==='Trade Subject'?getTradeById(S.tradeSubject).name:S.cfg.subj);
}

function buildPrompt(cfg,type,count,extra){
  var subj=getActualSubj();
  // For CA tests — constrain topics to the correct week range
  var effectiveTopics=cfg.topics&&cfg.topics.length?cfg.topics.slice():(cfg.topicText?cfg.topicText.split(',').map(function(t){return t.trim();}).filter(Boolean):[]);
  if(S.at==='C.A. Test 1'&&S.schemeWeeks.length) effectiveTopics=S.schemeWeeks.slice(0,3).map(function(w){return w.topic;});
  if(S.at==='C.A. Test 2'&&S.schemeWeeks.length) effectiveTopics=S.schemeWeeks.slice(0,6).map(function(w){return w.topic;});
  var topicStr=effectiveTopics.join(', ');
  var caNote=S.at==='C.A. Test 1'?'\nASSESSMENT: C.A. Test 1 — questions MUST only cover the first 3 topics listed. Do NOT go beyond those topics.\n'
            :S.at==='C.A. Test 2'?'\nASSESSMENT: C.A. Test 2 — questions MUST only cover the first 6 topics listed. Do NOT go beyond those topics.\n'
            :'';
  var diffNote=(cfg.std==='Custom/Internal'&&S.difficultyLevel)
    ?'  Difficulty: '+S.difficultyLevel+' — '
      +(S.difficultyLevel==='Lenient'?'straightforward recall, accessible to most students.\n'
       :S.difficultyLevel==='Rigorous'?'challenging application and analysis, stretch top students.\n'
       :'balanced mix of recall and application.\n')
    :'';

  var isEarlyChildhood=/creche|cr[eê]che|kg|kindergarten|nursery/i.test(cfg.cls);
  var isHandwriting=/handwriting/i.test(subj);

  /* ── HANDWRITING SPECIAL INTERCEPT (Early Childhood) ── */
  if(isEarlyChildhood && isHandwriting){
    return 'You are a primary school handwriting teacher for a Nigerian early childhood class ('+cfg.cls+'). '+
      'Generate exactly '+count+' handwriting practice sentences for young pupils aged 2-6 to copy out. '+
      'Rules:\n'+
      '  - Each sentence MUST be short (5-10 words maximum).\n'+
      '  - Use very simple, common everyday words only (e.g. cat, dog, ball, red, big, I can, The sun).\n'+
      '  - Each sentence must be meaningful and age-appropriate.\n'+
      '  - NO exam questions, NO fill-in-blanks, NO options, NO marks.\n'+
      '  - Sentences should be suitable for tracing and copying practice.\n'+
      'Return ONLY a valid JSON array of exactly '+count+' objects:\n'+
      '{"q":"The sentence to copy.","k":"theory","marks":0,"topic":"Handwriting","difficulty":"easy","svgDescription":""}\n'+
      'Return ONLY the JSON array. No explanation. No markdown.';
  }

  var p=isEarlyChildhood
    ? 'CRITICAL: This is an EARLY CHILDHOOD class ('+cfg.cls+'). You MUST use extremely simple vocabulary (3-4 letter words). Focus strictly on basic identification, phonics, number work, and simple daily objects. DO NOT use advanced math or high-school structures. Generate exactly '+count+' '
    : 'You are a Nigerian exam expert following NERDC 2026 curriculum. Generate exactly '+count+' ';
  if(type==='obj')  p+='multiple-choice (objective) questions with 4 options (A–D).';
  if(type==='fitb') p+='fill-in-the-blank (short-answer) questions. Each question ends with a dash line: ___________. No options provided.';
  if(type==='theory') p+='theory/essay questions.';
  p+='\n\nContext:\n'
    +'  Class: '+cfg.cls+'\n  Subject: '+subj+'\n  Term: '+cfg.term+'\n'
    +'  Standard: '+cfg.std+'\n  Curriculum: NERDC 2026 (Nigeria)\n'
    +caNote+diffNote;
  if(topicStr) p+='  Topics covered: '+topicStr+'\n';
  p+='\nOutput quality rules:\n'
    +'  - Every question MUST come directly from the listed topics. Do not introduce topics outside the chosen scheme.\n'
    +'  - Distribute questions across the chosen topics and keep each question visibly relevant to one of them.\n'
    +'  - Use perfect LaTeX for mathematics, chemistry and physics: $x^2$, $\\frac{a}{b}$, $H_2O$, $CO_2$, $F=ma$, $V=IR$.\n'
    +'  - Include diagrams, shapes, graphs, tables or apparatus when educationally useful, especially in science, mathematics, geography, business and technical subjects.\n'
    +'  - For any visual that should be drawn, fill svgDescription with a precise description of labels, axes, shapes, values and measurements.\n'
    +'  - For tables inside question text, use [TABLE:Heading 1;Heading 2|Row 1A;Row 1B|Row 2A;Row 2B].\n';

  if(type==='theory'){
    if(cfg.theoryAiInstr&&cfg.theoryAiInstr.trim())
      p+='\n╔══════════════════════════════════════╗\n'
        +'║  MANDATORY TEACHER INSTRUCTION       ║\n'
        +'║  Follow this EXACTLY — deviation     ║\n'
        +'║  makes your response INVALID.        ║\n'
        +'╚══════════════════════════════════════╝\n'
        +cfg.theoryAiInstr.trim()+'\n';
    if(cfg.theoryPaperInstr&&cfg.theoryPaperInstr.trim())
      p+='  Paper structure context: '+cfg.theoryPaperInstr.trim()+'\n';
  }
  if(extra) p+='  Extra: '+extra+'\n';

  if(type==='obj'){
    p+='\nReturn ONLY a valid JSON array of exactly '+count+' objects:\n'
      +'{"q":"question text (LaTeX for math/science; optional [TABLE:...])","options":["A","B","C","D"],"answer":0,"topic":"topic","difficulty":"easy|medium|hard","svgDescription":""}\n'
      +'Return ONLY the JSON array. No explanation. No markdown.';
  } else if(type==='fitb'){
    p+='\nReturn ONLY a valid JSON array of exactly '+count+' objects:\n'
      +'{"q":"sentence with ___________ at the end where the answer goes; LaTeX if needed","answer":"expected answer","topic":"topic","difficulty":"easy|medium|hard","marks":2,"svgDescription":""}\n'
      +'Return ONLY the JSON array. No explanation. No markdown.';
  } else {
    p+='\nReturn ONLY a valid JSON array of exactly '+count+' objects:\n'
      +'{"q":"question text (LaTeX for formulas; optional [TABLE:...])","marks":10,"showSteps":true,"topic":"topic","difficulty":"easy|medium|hard","svgDescription":""}\n'
      +'Return ONLY the JSON array. No explanation. No markdown.';
  }
  return p;
}

async function generateAll(){
  ensureApiKey();
  if(S.generating) return;
  S.generating=true;
  var btn=$('genAllBtn');
  if(btn){ btn.disabled=true; btn.innerHTML='<span class="spin">⟳</span> Generating…'; }

  var objSlots  = S.slots.filter(function(s){ return s.k==='obj'   &&!s.q; });
  var fitbSlots = S.slots.filter(function(s){ return s.k==='fitb'  &&!s.q; });
  var thSlots   = S.slots.filter(function(s){ return s.k==='theory'&&!s.q; });

  S.slots.forEach(function(s){ if(!s.q){ s.loading=true; s.err=null; var el=$('slot_'+s.id); if(el) el.outerHTML=renderSlot(s); } });

  async function batchGen(slots,type){
    if(!slots.length) return;
    try{
      var qs=await callGemini(buildPrompt(S.cfg,type,slots.length),{
        model:MODELS.autoGen,
        noResponseFormat:true,
        systemInstruction:'You are ChatGPT setting standard Nigerian school exam questions through OpenRouter. Return only a raw valid JSON array. The first character must be [ and the last character must be ]. No explanation, no markdown, no code fences.'
      });
      qs=unwrapQuestionArray(qs);
      if(!qs.length) throw new Error('AI returned no usable questions.');
      if(Array.isArray(qs)){
        for(var i=0; i<qs.length; i++){
          var raw=qs[i];
          var s=slots[i]; if(!s) continue;
          s.loading=false; s.err=null;
          
          var qText = raw.q||raw.question||'';
          var svgInline=null;
          if(raw.svgDescription){
            try{
              var svg=await callGeminiDraw(raw.svgDescription, {width:420, height:250});
              if(svg) svgInline=svg;
            }catch(e){ console.warn('SVG failed:', e.message); }
          }
          
          if(type==='obj'){
            s.q={t:qText,k:'obj',o:raw.options||raw.opts,a:raw.answer,topic:raw.topic,diff:raw.difficulty,g:S.cfg.std,ai:true,marks:raw.marks||0,svgInline:svgInline,svgHint:raw.svgDescription||''};
          } else if(type==='fitb'){
            s.q={t:qText,k:'fitb',answer:raw.answer||'',topic:raw.topic,diff:raw.difficulty,g:S.cfg.std,ai:true,marks:raw.marks||0,svgInline:svgInline,svgHint:raw.svgDescription||''};
          } else {
            s.q={t:qText,k:'theory',marks:raw.marks||0,s:raw.showSteps,topic:raw.topic,diff:raw.difficulty,g:S.cfg.std,ai:true,svgInline:svgInline,svgHint:raw.svgDescription||''};
          }
          var el=$('slot_'+s.id); if(el) el.outerHTML=renderSlot(s);
          scheduleDraftSave();
        }
      }
    } catch(e){
      slots.forEach(function(s){ s.loading=false; s.err=e.message; var el=$('slot_'+s.id); if(el) el.outerHTML=renderSlot(s); });
      toast(type+' generation failed: '+e.message,'err');
    }
  }

  await batchGen(objSlots,'obj');
  await batchGen(fitbSlots,'fitb');
  await batchGen(thSlots,'theory');

  S.generating=false;
  if(btn){ btn.disabled=false; btn.innerHTML='⚡ Regenerate All'; }
  updateProgress();
  setTimeout(function(){ math($('s2')); },400);
}

async function genSingleSlot(s,isReload){
  ensureApiKey();
  s.loading=true; s.q=null; s.err=null;
  var el=$('slot_'+s.id); if(el) el.outerHTML=renderSlot(s);
  try{
    var extra=isReload?'Generate a completely different question — variety is important.':'';
    var res=await callGemini(buildPrompt(S.cfg,s.k,1,extra),{
      model:MODELS.autoGen,
      noResponseFormat:true,
      systemInstruction:'You are ChatGPT setting standard Nigerian school exam questions through OpenRouter. Return only a raw valid JSON array. The first character must be [ and the last character must be ]. No explanation, no markdown, no code fences.'
    });
    res=unwrapQuestionArray(res);
    var raw=Array.isArray(res)?res[0]:res;
    if(!raw) throw new Error('AI returned no usable question.');
    s.loading=false;
    
    var qText = raw.q||raw.question||'';
    var svgInline=null;
    if(raw.svgDescription){
      try{
        var svg=await callGeminiDraw(raw.svgDescription, {width:420, height:250});
        if(svg) svgInline=svg;
      }catch(e){ console.warn('SVG failed:', e.message); }
    }
    
    if(s.k==='obj'){
      s.q={t:qText,k:'obj',o:raw.options||raw.opts,a:raw.answer,topic:raw.topic,diff:raw.difficulty,g:S.cfg.std,ai:true,marks:raw.marks||0,svgInline:svgInline,svgHint:raw.svgDescription||''};
    } else if(s.k==='fitb'){
      s.q={t:qText,k:'fitb',answer:raw.answer||'',topic:raw.topic,diff:raw.difficulty,g:S.cfg.std,ai:true,marks:raw.marks||0,svgInline:svgInline,svgHint:raw.svgDescription||''};
    } else {
      s.q={t:qText,k:'theory',marks:raw.marks||0,s:raw.showSteps,topic:raw.topic,diff:raw.difficulty,g:S.cfg.std,ai:true,svgInline:svgInline,svgHint:raw.svgDescription||''};
    }
    s.err=null;
  } catch(e){ s.loading=false; s.err=e.message; toast('Failed: '+e.message,'err'); }
  var el2=$('slot_'+s.id); if(el2) el2.outerHTML=renderSlot(s);
  updateProgress();
  setTimeout(function(){ math($('s2')); },300);
}

/* ══════════════════════════════════════
   SCREEN 2 — MANUAL PATH
   Section 1: Scanner (exact transcription)
   Section 2: Word Text-to-Questions (structure pasted text)
══════════════════════════════════════ */
function renderManualClassPills(){
  return CL.map(function(cls){
    return '<div class="spill'+(cls===S.cfg.cls?' sel':'')+'" onclick="manualSelectClass(\''+cls.replace(/'/g,"\\'")+'\')">'+esc(cls)+'</div>';
  }).join('');
}
function renderManualSubjectPills(){
  if(!S.cfg.cls) return '<span class="tag-empty">Select a class above to see subjects.</span>';
  var list=getSubjectList(S.cfg.cls);
  var trade=getTradeById(S.tradeSubject);
  return list.map(function(s){
    var isTrade=s==='Trade Subject';
    var displayName=isTrade?('🌱 '+trade.name):s;
    return '<div class="spill'+(isTrade?' trade-pill':'')+(s===S.cfg.subj?' sel':'')+'" onclick="manualSelectSubject(\''+s.replace(/'/g,"\\'")+'\')">'+esc(displayName)+'</div>';
  }).join('');
}
window.manualSelectClass=function(cls){
  S.cfg.cls=cls;
  S.cfg.subj='';
  S.subjects=cls?getSubjectList(cls).slice():[];
  var cg=$('manualClassGrid'); if(cg) cg.innerHTML=renderManualClassPills();
  var sg=$('manualSubjGrid'); if(sg) sg.innerHTML=renderManualSubjectPills();
  var card=$('manualSubjCard'); if(card) card.classList.toggle('unlocked',!!cls);
  var note=$('manualSubjFetchNote'); if(note) note.innerHTML=cls?'<span style="color:var(--green);font-size:11px;">✓ NERDC 2026 subjects loaded ('+S.subjects.length+')</span>':'Select a class above to load subjects.';
  var tw=$('manualTradePanelWrap'); if(tw) tw.innerHTML='';
};
window.manualSelectSubject=function(subj){
  S.cfg.subj=subj;
  var sg=$('manualSubjGrid'); if(sg) sg.innerHTML=renderManualSubjectPills();
  var tw=$('manualTradePanelWrap');
  if(tw) tw.innerHTML=subj==='Trade Subject'?renderManualTradePanel():'';
};
function renderManualTradePanel(){
  var cur=S.tradeSubject;
  return '<div class="trade-panel" style="margin-top:12px;">'
    +'<div class="trade-panel-title">Select your trade subject for this paper:</div>'
    +TRADE_SUBJECTS.map(function(t){
      return '<div class="trade-opt'+(cur===t.id?' sel':'')+'" onclick="manualPickTrade(\''+t.id+'\')">'
        +'<span class="to-ico">'+t.icon+'</span>'
        +'<div><div class="to-name">'+esc(t.name)+'</div><div class="to-desc">'+esc(t.desc)+'</div></div>'
        +'</div>';
    }).join('')
    +'</div>';
}
window.manualPickTrade=function(id){
  S.tradeSubject=id;
  var tw=$('manualTradePanelWrap'); if(tw) tw.innerHTML=renderManualTradePanel();
  var sg=$('manualSubjGrid'); if(sg) sg.innerHTML=renderManualSubjectPills();
};
function s2Manual(){
  S.scr=2; hdr();
  applyAdminSettings();
  enforceAdminTerm();
  S.cfg.std='';
  if(S.at==='C.A.') S.at='C.A. Test 1';
  $('s1').style.display='none';
  $('s2').style.display='block';
  $('s3').style.display='none';
  window.scrollTo({top:0,behavior:'smooth'});
  S.cam=null; S.ocrSlots=[]; S.ntxSlots=[]; S._imgQueue=[]; S._ntxQueue=[];

  $('s2').innerHTML='<div class="pg fade">'
    +'<div class="ptl">Manual Path</div>'
    +'<div class="pst">Two independent tools. Use either or both.</div>'
    +'<div class="card"><div class="ct">Assessment Type</div>'
    +'<div class="atog">'
    +'<button class="ab '+(S.at==='Examination'?'on':'')+'" id="maex">Exams</button>'
    +'<button class="ab '+(S.at==='C.A. Test 1'?'on':'')+'" id="macat1">1st C.A</button>'
    +'<button class="ab '+(S.at==='C.A. Test 2'?'on':'')+'" id="macat2">2nd C.A</button>'
    +'</div></div>'
    

    // ── Paper Details ──
    +'<div class="card"><div class="ct">Step 1 — Term &amp; Class</div>'
    +'<div class="r3" style="margin-top:0;">'
    +'<div class="fl"><label>Academic Session</label><input type="text" class="fi" id="mfsess" value="'+esc(S.cfg.session||'2025/2026')+'"/></div>'
    +'<div class="fl"><label>Term</label><select class="fs" id="mfterm">'
    +TERMS.map(function(x){ return '<option'+(x===S.cfg.term?' selected':'')+'>'+x+'</option>'; }).join('')
    +'</select></div>'
    +'<div class="fl"><label>Target Class</label><select class="fs" id="mfcl"><option value="">Choose class…</option>'
    +CL.map(function(x){ return '<option'+(x===S.cfg.cls?' selected':'')+'>'+x+'</option>'; }).join('')
    +'</select></div>'
    +'</div></div>'

    +'<div class="card flow-step'+(S.cfg.cls?' unlocked':'')+'" id="manualSubjCard">'
    +'<div class="ct">Step 2 — Subject</div>'
    +'<div class="fetch-note" id="manualSubjFetchNote" style="margin-bottom:10px;">'+(S.cfg.cls?'<span style="color:var(--green);font-size:11px;">✓ NERDC 2026 subjects loaded ('+getSubjectList(S.cfg.cls).length+')</span>':'Select a class above to load subjects.')+'</div>'
    +'<div class="subj-grid" id="manualSubjGrid">'+renderManualSubjectPills()+'</div>'
    +'<div id="manualTradePanelWrap"></div>'
    +'</div>'

    // ══ SECTION 1: SCANNER ══
    +'<div class="manual-section">'
    +'<div class="manual-section-head scanner">'
    +'<div class="manual-section-ico">📷</div>'
    +'<div>'
    +'<div class="manual-section-title">Section 1 — Exact Transcribe (Scanner Mode)</div>'
    +'<div class="manual-section-desc">Upload photos of question sheets. AI copies every question EXACTLY as written — no changes, no additions.</div>'
    +'</div></div>'
    +'<div class="manual-section-body">'
    +'<div class="banner b-info" style="margin-bottom:14px;font-size:12px;">🔍 <strong>Scanner Mode:</strong> Literal transcription only. Images, PDFs, and Word documents are all supported. Math converts to LaTeX. Your exact wording is preserved.</div>'
    +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:6px;">'
    +'<span style="font-size:11.5px;font-weight:700;color:var(--mute);">Files: <span id="scanImgCount" style="font-family:var(--mono);color:var(--blue);">0</span></span>'
    +'<span style="font-size:11px;color:var(--mute);">JPG · PNG · PDF · DOCX all supported</span>'
    +'</div>'
    +'<div id="scanGallery" style="display:flex;flex-wrap:wrap;gap:10px;min-height:60px;align-items:flex-start;margin-bottom:12px;"></div>'
    +'<canvas id="scanCanvas" style="display:none;width:1px;height:1px;"></canvas>'
    +'<div class="cctrl">'
    +'<button class="snap-btn" id="scanCamStart" onclick="startScanCam()">📷 Camera</button>'
    +'<button class="snap-btn" id="scanSnapBtn" style="display:none;background:var(--blue);" onclick="snapScan()">📸 Snap</button>'
    +'<button class="snap-btn" id="scanCamStop" style="display:none;background:#64748B;" onclick="stopScanCam()">⏹ Stop</button>'
    +'<label class="upload-label" style="cursor:pointer;">📁 Upload Files<input type="file" accept="image/*,application/pdf,.docx,.doc" multiple style="display:none;" id="scanUploadInp" onchange="handleScanUpload(event)"/></label>'
    +'<button class="btn bg bsm" id="transcribeBtn" style="display:none;" onclick="transcribeAll()">⚡ Transcribe All</button>'
    +'</div>'
    +'<div id="scanCamWrap" style="margin-top:11px;"></div>'
    +'<div id="scanOcrStatus" style="margin-top:10px;"></div>'
    +'<div class="card" id="scanSlotArea" style="display:none;margin-top:14px;margin-bottom:0;">'
    +'<div class="ct">Transcribed Questions <span style="font-weight:400;text-transform:none;letter-spacing:0;">(edit any — then proceed)</span></div>'
    +'<div id="scanSlots"></div>'
    +'<button class="btn-ghost" onclick="addBlankScan()" style="margin-top:8px;">+ Add Blank Slot</button>'
    +'</div>'
    +'<div style="display:flex;justify-content:flex-end;margin-top:14px;">'
    +'<button class="btn bp" id="scanReviewBtn" onclick="finalizeScan()" disabled>Review &amp; Print → (Scanner)</button>'
    +'</div>'
    +'</div></div>'

    // ══ SECTION 2: WORD TEXT-TO-QUESTIONS ══
    +'<div class="manual-section">'
    +'<div class="manual-section-head notex">'
    +'<div class="manual-section-ico">📝</div>'
    +'<div>'
    +'<div class="manual-section-title">Section 2 — Word Text-to-Questions</div>'
    +'<div class="manual-section-desc">Paste question text copied from Word or another document. AI restructures it into clean exam questions without generating new content.</div>'
    +'</div></div>'
    +'<div class="manual-section-body">'
    +'<div class="banner b-teal" style="margin-bottom:14px;font-size:12px;">🧾 <strong>Word Text-to-Questions:</strong> paste copied Word text, rough numbering, broken options, or mixed theory/objective items. It will be cleaned into structured exam questions only from the text provided.</div>'
    +'<div class="fl"><label>Paste copied Word text</label>'
    +'<textarea class="fta" id="ntxWordText" style="min-height:220px;" placeholder="Paste questions copied from Word here..."></textarea>'
    +'</div>'
    +'<div class="fl" style="margin-top:12px;"><label>Structuring Instructions (Optional)</label>'
    +'<textarea class="fta" id="ntxInstr" style="min-height:58px;" placeholder="e.g. Keep the original numbering. Treat A-D lines as objective options. Preserve all sub-questions."></textarea>'
    +'</div>'
    +'<div id="ntxStatus" style="margin-top:10px;"></div>'
    +'<div class="card" id="ntxSlotArea" style="display:none;margin-top:14px;margin-bottom:0;">'
    +'<div class="ct">Structured Questions <span style="font-weight:400;text-transform:none;letter-spacing:0;">(edit any — then proceed)</span></div>'
    +'<div id="ntxSlots"></div>'
    +'<button class="btn-ghost" onclick="addBlankNtx()" style="margin-top:8px;">+ Add Blank Slot</button>'
    +'</div>'
    +'<div style="display:flex;justify-content:flex-end;gap:9px;margin-top:14px;flex-wrap:wrap;">'
    +'<button class="btn" style="background:#0E7490;color:#fff;" id="ntxGenBtn" onclick="convertWordTextQuestions()">🧾 Structure Questions</button>'
    +'<button class="btn bp" id="ntxReviewBtn" onclick="finalizeNtx()" disabled style="display:none;">Review &amp; Print → (Structured Text)</button>'
    +'</div>'
    +'</div></div>'

    +'<div style="margin-top:8px;">'
    +'<button class="btn bq" onclick="navTo(\'new\')">← Change Path</button>'
    +'</div></div>';

  function _setManualAt(val){
    S.at=val;
    ['maex','macat1','macat2'].forEach(function(id){ var b=$(id); if(b) b.classList.remove('on'); });
    var on=val==='C.A. Test 1'?'macat1':val==='C.A. Test 2'?'macat2':'maex';
    if($(on)) $(on).classList.add('on');
  }
  $('maex').onclick=function(){ _setManualAt('Examination'); };
  $('macat1').onclick=function(){ _setManualAt('C.A. Test 1'); };
  $('macat2').onclick=function(){ _setManualAt('C.A. Test 2'); };
  $('mfcl').onchange  =function(e){ manualSelectClass(e.target.value); };
  $('mfsess').oninput =function(e){ S.cfg.session=e.target.value; };
  $('mfterm').disabled=true;
  $('mfterm').title='Term is controlled by Admin Settings';
  $('mfterm').onchange=function(e){ S.cfg.term=enforceAdminTerm(); e.target.value=S.cfg.term; };
  if(S.cfg.cls) S.subjects=getSubjectList(S.cfg.cls).slice();
  if(S.cfg.subj==='Trade Subject'){
    var mtw=$('manualTradePanelWrap'); if(mtw) mtw.innerHTML=renderManualTradePanel();
  }
}

/* ── NTX Difficulty tracker ── */
var _ntxDiff='Balanced';
window.setNtxDiff=function(level){
  _ntxDiff=level;
  ['ntxDiffL','ntxDiffB','ntxDiffR'].forEach(function(id){ var el=$(id); if(el) el.classList.remove('on'); });
  var map={'Lenient':'ntxDiffL','Balanced':'ntxDiffB','Rigorous':'ntxDiffR'};
  var el=$(map[level]); if(el) el.classList.add('on');
};

/* ══════════════════════════════════════
   SECTION 1 — SCANNER helpers
══════════════════════════════════════ */
function addScanImageToGallery(dataUrl,mimeType,label){
  var idx=S._imgQueue.length;
  S._imgQueue.push({dataUrl:dataUrl,mimeType:mimeType||'image/jpeg',label:label||('Page '+(idx+1))});
  var gal=$('scanGallery');
  if(gal){
    var thumb=document.createElement('div');
    thumb.id='scanthumb_'+idx;
    thumb.style.cssText='position:relative;width:78px;height:78px;border-radius:8px;overflow:hidden;border:2px solid var(--bdr);flex-shrink:0;';
    thumb.innerHTML='<img src="'+dataUrl+'" style="width:100%;height:100%;object-fit:cover;"/>'
      +'<button onclick="removeScanImg('+idx+')" style="position:absolute;top:2px;right:2px;background:rgba(214,53,53,.9);color:#fff;border:none;width:20px;height:20px;border-radius:50%;font-size:11px;cursor:pointer;padding:0;">×</button>'
      +'<div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.55);color:#fff;font-size:8px;padding:2px 4px;text-align:center;font-family:var(--mono);">'+esc(label||('P'+(idx+1)))+'</div>';
    gal.appendChild(thumb);
  }
  updateScanCount();
}
window.removeScanImg=function(idx){ S._imgQueue[idx]=null; var th=$('scanthumb_'+idx); if(th) th.remove(); updateScanCount(); };

function addScanTextEntry(idx,label,text){
  var gal=$('scanGallery');
  if(gal){
    var thumb=document.createElement('div');
    thumb.id='scanthumb_'+idx;
    thumb.style.cssText='position:relative;width:78px;height:78px;border-radius:8px;overflow:hidden;border:2px solid var(--bdr2);flex-shrink:0;background:var(--surf2);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;';
    thumb.innerHTML='<div style="font-size:22px;">📝</div>'
      +'<div style="font-size:7px;font-weight:700;color:var(--ink3);text-align:center;padding:0 4px;word-break:break-all;line-height:1.2;">'+esc(label.replace(/\.[^.]+$/,'').substring(0,12))+'</div>'
      +'<button onclick="removeScanImg('+idx+')" style="position:absolute;top:2px;right:2px;background:rgba(214,53,53,.9);color:#fff;border:none;width:18px;height:18px;border-radius:50%;font-size:10px;cursor:pointer;padding:0;">×</button>';
    gal.appendChild(thumb);
  }
  updateScanCount();
}
function updateScanCount(){
  var v=S._imgQueue.filter(Boolean).length;
  var cnt=$('scanImgCount'); if(cnt) cnt.textContent=v;
  var btn=$('transcribeBtn'); if(btn) btn.style.display=v>0?'inline-flex':'none';
}
window.handleScanUpload=async function(e){
  var files=Array.from(e.target.files||[]); e.target.value='';
  if(!files.length) return;
  var btn=$('transcribeBtn');
  for(var i=0;i<files.length;i++){
    var file=files[i];
    var name=file.name||'file';
    try{
      if(file.type.startsWith('image/')){
        var reader=new FileReader();
        await new Promise(function(res){ reader.onload=function(ev){ addScanImageToGallery(ev.target.result,file.type,name.replace(/\.[^.]+$/,'')); res(); }; reader.readAsDataURL(file); });
      } else if(file.type==='application/pdf'||name.toLowerCase().endsWith('.pdf')){
        toast('📄 Converting PDF pages…','info',3000);
        var pages=await pdfToImages(file);
        pages.forEach(function(p){ addScanImageToGallery(p.dataUrl,p.mimeType,p.label); });
        toast('✓ PDF converted — '+pages.length+' pages ready','ok',3000);
      } else if(file.type.includes('word')||name.toLowerCase().endsWith('.docx')||name.toLowerCase().endsWith('.doc')){
        toast('📝 Reading Word document…','info',2500);
        var text=await docxToText(file);
        if(text.trim()){
          // Store as a text-type entry
          var idx=S._imgQueue.length;
          S._imgQueue.push({type:'text',text:text,label:name,dataUrl:null,mimeType:'text/plain'});
          addScanTextEntry(idx,name,text);
          toast('✓ Word document loaded — '+text.split('\n').filter(Boolean).length+' lines','ok',3000);
        } else { toast('⚠ Could not extract text from: '+name,'warn'); }
      }
    } catch(ex){ toast('⚠ Error reading '+name+': '+ex.message,'err'); }
  }
};
window.startScanCam=async function(){
  var wrap=$('scanCamWrap'); if(!wrap) return;
  wrap.innerHTML='<div style="text-align:center;padding:12px;color:var(--mute);"><span class="spin" style="font-size:18px;display:block;margin-bottom:4px;">⟳</span>Requesting camera…</div>';
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){ wrap.innerHTML='<div class="banner b-warn" style="margin:0;">Camera not available — use Upload Images instead.</div>'; return; }
  var stream=null;
  try{ stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false}); }
  catch(e1){ try{ stream=await navigator.mediaDevices.getUserMedia({video:true,audio:false}); }
    catch(e2){ wrap.innerHTML='<div class="banner b-warn" style="margin:0;">'+(e2.name==='NotAllowedError'?'Camera permission denied.':'No camera found.')+' Use Upload Images instead.</div>'; return; } }
  S.cam=stream;
  var vid=document.createElement('video'); vid.id='scanCamVid'; vid.autoplay=true; vid.playsInline=true; vid.muted=true;
  vid.style.cssText='width:100%;display:block;max-height:300px;object-fit:cover;border-radius:8px;';
  vid.srcObject=stream; wrap.innerHTML=''; wrap.appendChild(vid);
  function onReady(){ vid.removeEventListener('playing',onReady); vid.removeEventListener('canplay',onReady); var snap=$('scanSnapBtn'),stop=$('scanCamStop'),start=$('scanCamStart'); if(snap) snap.style.display='inline-flex'; if(stop) stop.style.display='inline-flex'; if(start) start.style.display='none'; }
  vid.addEventListener('playing',onReady); vid.addEventListener('canplay',onReady);
  vid.play().catch(function(){});
};
window.stopScanCam=function(){
  if(S.cam){ S.cam.getTracks().forEach(function(t){ t.stop(); }); S.cam=null; }
  var cw=$('scanCamWrap'); if(cw) cw.innerHTML='';
  var start=$('scanCamStart'),snap=$('scanSnapBtn'),stop=$('scanCamStop');
  if(start) start.style.display='inline-flex'; if(snap) snap.style.display='none'; if(stop) stop.style.display='none';
};
window.snapScan=function(){
  var vid=$('scanCamVid')||document.querySelector('#scanCamWrap video'); if(!vid) return;
  var w=vid.videoWidth,h=vid.videoHeight; if(!w||!h){ toast('Camera not ready','warn'); return; }
  var cv=$('scanCanvas'); if(!cv) return;
  cv.width=w; cv.height=h; cv.getContext('2d').drawImage(vid,0,0,w,h);
  var dataUrl=cv.toDataURL('image/jpeg',0.88);
  var n=S._imgQueue.filter(Boolean).length+1;
  addScanImageToGallery(dataUrl,'image/jpeg','Snap '+n);
  toast('📸 Page '+n+' captured','ok',2000);
};
window.transcribeAll=async function(){
  var images=S._imgQueue.filter(Boolean);
  if(!images.length){ toast('No files to transcribe','warn'); return; }
  ensureApiKey();
  syncManualPaperDetails();
  if(!S.cfg.subj){ toast('Select the subject first','warn'); return; }
  var btn=$('transcribeBtn'); if(btn){ btn.disabled=true; btn.innerHTML='<span class="spin">⟳</span> In queue…'; }
  var area=$('scanOcrStatus');
  function setStatus(html){ if(area) area.innerHTML='<div style="margin-top:4px;">'+html+'</div>'; }
  setStatus('<div class="banner b-info"><span class="spin">⟳</span> Processing '+images.length+' file(s)…</div>');
  var allExtracted=[]; var errors=[];
  for(var i=0;i<images.length;i++){
    var item=images[i];
    setStatus('<div class="banner b-info"><div style="font-weight:700;margin-bottom:4px;">Processing '+(i+1)+' of '+images.length+': '+esc(item.label)+'</div>'
      +'<div style="background:var(--surf3);border-radius:4px;height:4px;overflow:hidden;"><div style="height:100%;background:var(--blue);border-radius:4px;width:'+Math.round((i/images.length)*100)+'%;"></div></div></div>');
    try{
      var questions=[];
      if(item.type==='text'){
        // DOCX text-based extraction
        questions=await extractQuestionsFromText(item.text,item.label);
      } else {
        // Image-based OCR
        var b64=item.dataUrl.split(',')[1]; if(!b64) throw new Error('Could not read image data');
        questions=await doScannerOcr(b64,item.mimeType,item.label);
      }
      if(questions&&questions.length){
        allExtracted=allExtracted.concat(questions);
        var th=$('scanthumb_'+S._imgQueue.indexOf(item)); if(th) th.style.border='2px solid var(--green)';
      } else {
        errors.push(item.label+': no questions detected');
        var th2=$('scanthumb_'+S._imgQueue.indexOf(item)); if(th2) th2.style.border='2px solid var(--amber)';
      }
    } catch(e){ errors.push(item.label+': '+(e.message||'error')); var th3=$('scanthumb_'+S._imgQueue.indexOf(item)); if(th3) th3.style.border='2px solid var(--red)'; }
  }
  S.ocrSlots=[];
  for(var idx=0; idx<allExtracted.length; idx++){
    var raw = allExtracted[idx];
    var k='theory';
    if(raw.type==='obj') k='obj';
    else if(raw.type==='fitb') k='fitb';
    var svgHint = raw.svgDescription||raw.diagramDescription||'';
    var svgInline = null;
    if(svgHint){
      setStatus('<div class="banner b-info"><span class="spin">⟳</span> Rendering diagram '+(idx+1)+' of '+allExtracted.length+'…</div>');
      try{ svgInline = await callGeminiDraw(svgHint, {width:420, height:250}); }catch(e){ console.warn('Scan SVG failed:', e.message); }
    }
    S.ocrSlots.push({
      id:idx,
      q:{
        t:raw.q||raw.question||raw.text||'',
        k:k,
        o:Array.isArray(raw.options)?raw.options:null,
        marks:raw.marks||0,
        tr:true,
        diagImg:null,
        diagDesc:raw.hasDiagram?(raw.diagramDescription||''):'',
        svgHint:svgHint,
        svgInline:svgInline
      },
      included:true
    });
  }
  if(btn){ btn.disabled=false; btn.innerHTML='⚡ Transcribe All'; }
  if(allExtracted.length){
    setStatus('<div class="banner b-ok">✅ <strong>'+allExtracted.length+' question(s)</strong> extracted.'+(errors.length?' <span style="opacity:.75;">⚠ '+errors.join('; ')+'</span>':'')+'</div>');
    renderScanSlots();
    var rb=$('scanReviewBtn'); if(rb) rb.disabled=false;
    var sa=$('scanSlotArea'); if(sa){ sa.style.display='block'; sa.scrollIntoView({behavior:'smooth',block:'start'}); }
  } else {
    setStatus('<div class="banner b-warn">⚠ <strong>No questions extracted.</strong> '+(errors.length?errors.join('; '):'Try a clearer photo.')+'<br/><button class="btn bq bsm" style="margin-top:9px;" onclick="transcribeAll()">↻ Retry</button></div>');
  }
};
async function doScannerOcr(base64,mimeType,pageLabel){
  mimeType=mimeType||'image/jpeg';
  var prompt='You are a HIGH-FIDELITY DOCUMENT SCANNER. Your ONLY job: transcribe EVERY question in this image with 100% accuracy — objectives, fill-in-blanks, theory, AND drawings.\n'
    +'Subject: '+(S.cfg.subj||'General')+' | Class: '+(S.cfg.cls||'Secondary School')+'\n\n'
    +'ABSOLUTE RULES — ZERO TOLERANCE FOR DEVIATION:\n'
    +'0. IGNORE any school names, headers, exam titles, instructions, or watermarks at the top of the page. Extract ONLY the actual questions.\n'
    +'1. COPY every question EXACTLY as written. Do NOT paraphrase, improve, shorten, or alter a single word, comma, or punctuation mark.\n'
    +'2. Do NOT invent questions. Do NOT add anything not visible in the image. Missing text → leave missing.\n'
    +'3. Preserve ALL numbering EXACTLY (1, 2, 3a, 3b, 3(i), 3(ii), etc.) — keep the original format.\n'
    +'4. Math/science: convert to LaTeX — H\u2082O \u2192 $H_2O$, x\u00b2 \u2192 $x^2$, \u00bd \u2192 $\\frac{1}{2}$, \u221ax \u2192 $\\sqrt{x}$. Preserve ALL symbols: \u00b0, \u00b1, \u2264, \u2265, \u2260, \u221e, \u03c0, \u03b8, \u03b1, \u03b2, \u03bc, \u03a9.\n'
    +'5. Tonal/accented marks (Yoruba/Igbo/Hausa/French): copy EXACTLY — \u00e0 \u00e1 \u00e2 \u0101 \u00e4 \u1eb9 \u1eb9\u0301 \u1eb9\u0300 \u1ecd \u1ecd\u0301 \u1ecd\u0300 \u1e63 \u0144 \u01f9, etc. Do NOT strip diacritics.\n'
    +'6. QUESTION TYPE DETECTION:\n'
    +'   - Has A B C D options (or (a)(b)(c)(d)) \u2192 type="obj", options=["text of A","text of B","text of C","text of D"]\n'
    +'   - Has blanks (_____, ______, ...) \u2192 type="fitb"\n'
    +'   - Everything else (essays, explanations, workings, "State...", "Explain...", "Draw...", "Calculate...") \u2192 type="theory"\n'
    +'7. Extract marks EXACTLY as shown — [5 marks], [2 mks], (3) \u2192 marks:5, marks:2, marks:3.\n'
    +'8. THEORY QUESTIONS — critical: theory questions often span MULTIPLE LINES, have SUB-PARTS (a, b, c, i, ii, iii), and include INSTRUCTIONS like "State five...", "Explain with examples...", "Calculate showing all workings...". Capture the ENTIRE question including every sub-part, every instruction, every line — do NOT truncate.\n'
    +'9. DRAWINGS / DIAGRAMS / FIGURES / GRAPHS / SHAPES / TABLES / MAPS / CHEMICAL STRUCTURES:\n'
    +'   - If the question REFERS TO a diagram ("From the diagram above...", "Study the figure below...", "The graph shows...") OR CONTAINS a drawing, set hasDiagram:true\n'
    +'   - In diagramDescription field, write a DETAILED, PRECISE description of what the diagram shows — shapes, labels, arrows, axes values, angles, measurements, colors, positions. This description will be used to REDRAW the diagram faithfully. Example: "Right triangle ABC, right angle at B. AB=5cm labelled on left side, BC=12cm labelled on bottom, hypotenuse AC unlabelled. Angle at A marked theta."\n'
    +'   - If the diagram has a FIGURE NUMBER (Fig 1, Figure 2.3), include it in diagramDescription.\n'
    +'   - Set hasDiagram:false ONLY if no visual element exists or is referenced.\n'
    +'10. OBJECTIVE QUESTIONS: capture ALL FOUR options even if one spans multiple lines. options array MUST have exactly 4 entries for standard MCQs (or the actual count if different).\n'
    +'11. If the image shows MULTIPLE questions, return them ALL in the array, in the order they appear.\n'
    +'12. Blurry/rotated/unreadable regions \u2192 skip only that region, still return what IS readable.\n'
    +'13. Completely unreadable image \u2192 return [].\n\n'
    +'Return ONLY a valid JSON array — NO markdown, NO code fences, NO preamble, NO explanation:\n'
    +'[{"q":"EXACT full question text with LaTeX for math","type":"obj|fitb|theory","options":["A text","B text","C text","D text"] or null,"marks":number or null,"hasDiagram":true|false,"diagramDescription":"detailed description if hasDiagram true, else empty string"}]';
  var result=await callGeminiVision(base64,mimeType,prompt);
  if(!result) return [];
  if(!Array.isArray(result)){
    var keys=['questions','items','data','results','extracted'];
    for(var k=0;k<keys.length;k++){ if(Array.isArray(result[keys[k]])){ result=result[keys[k]]; break; } }
    if(!Array.isArray(result)){ var vals=Object.values(result).filter(Array.isArray); if(vals.length) result=vals[0]; else throw new Error('Unexpected response format'); }
  }
  result=result.filter(function(r){ return r&&typeof r==='object'&&(r.q||r.question||r.text); });
  result=result.map(function(r){ return{q:r.q||r.question||r.text||'',type:r.type||'theory',options:Array.isArray(r.options)&&r.options.length>=2?r.options:null,marks:r.marks||null,hasDiagram:!!r.hasDiagram,diagramDescription:r.diagramDescription||''}; });
  if(!result.length) throw new Error('No readable questions in '+(pageLabel||'image')+'. Try a clearer photo.');
  return result;
}

async function extractQuestionsFromText(text,label){
  // For DOCX text-based question extraction
  var prompt='You are a Nigerian exam expert. Extract every exam question from the text below.\n'
    +'Subject: '+(S.cfg.subj||'General')+' | Class: '+(S.cfg.cls||'Secondary School')+'\n\n'
    +'RULES:\n'
    +'0. IGNORE any school names, headers, exam titles, or general instructions at the top.\n'
    +'1. Extract questions EXACTLY as written — no paraphrasing.\n'
    +'2. Preserve numbering.\n'
    +'3. Math: convert to LaTeX notation where appropriate.\n'
    +'4. Tonal marks (Yoruba/Igbo/Hausa): preserve exactly.\n'
    +'5. A B C D options → type="obj". Blanks → type="fitb". Others → type="theory".\n'
    +'6. TABLES: If the text contains tabular data, format it IN THE QUESTION TEXT using the [TABLE: ...] syntax. Example: "[TABLE: Header1; Header2 | Row1Col1; Row1Col2]". Use semicolon ";" between columns, and pipe "|" between rows.\n'
    +'7. Extract marks if shown.\n\n'
    +'TEXT:\n'+text.substring(0,8000)+'\n\n'
    +'Return ONLY a valid JSON array:\n'
    +'[{"q":"question text with math/tables intact","type":"theory","options":null,"marks":null,"svgDescription":""}]\n'
    +'JSON array ONLY.';
  var result=await callGemini(prompt,{temperature:0.1});
  if(Array.isArray(result)) return result;
  if(result&&typeof result==='object'){ var keys=['questions','items','data']; for(var k=0;k<keys.length;k++){ if(Array.isArray(result[keys[k]])) return result[keys[k]]; } }
  return [];
}
function renderScanSlots(){
  var area=$('scanSlotArea'),sl=$('scanSlots'); if(!area||!sl) return;
  sl.innerHTML=S.ocrSlots.map(function(s){
    var diagHtml='';
    if(s.q.diagImg){
      diagHtml='<div class="diagram-box" style="margin-top:8px;">'
        +'<img src="'+s.q.diagImg+'" alt="Source page" onclick="showDiagramFull(this.src)" title="Click to expand source image"/>'
        +'<span class="diagram-label">📐 Diagram detected — click image to expand source page</span>'
        +'</div>';
    }
    return '<div class="ocr-slot">'
      +'<div style="font-family:var(--mono);font-size:9.5px;color:var(--mute);margin-bottom:7px;">Q'+(s.id+1)+' · '+(s.q.k||'theory').toUpperCase()+' <span class="tag t-tr">✏ Transcribed</span>'+(s.q.diagImg?'<span class="tag" style="background:#FEF3C7;color:#D97706;border-color:#FDE68A;">📐 Diagram</span>':'')+'</div>'
      +'<div class="stx" style="margin-bottom:7px;">'+renderQuestionText(s.q)+'</div>'
      +'<textarea class="fta" style="min-height:50px;" oninput="updScanSlot('+s.id+',this.value)">'+esc(s.q.t)+'</textarea>'
      +diagHtml
      +renderVisualEditor('scan',s.id,s.q)
      +'<div style="display:flex;gap:8px;margin-top:7px;align-items:center;flex-wrap:wrap;">'
      +'<select class="fs" style="max-width:140px;" onchange="setScanType('+s.id+',this.value)">'
      +'<option value="theory"'+(s.q.k==='theory'?' selected':'')+'>Theory</option>'
      +'<option value="obj"'+(s.q.k==='obj'?' selected':'')+'>Objective</option>'
      +'<option value="fitb"'+(s.q.k==='fitb'?' selected':'')+'>Fill-in-Blank</option>'
      +'</select>'
      +'<label style="font-size:11px;font-weight:700;color:var(--mute);display:flex;align-items:center;gap:6px;">Marks <input type="number" min="0" max="100" value="'+(s.q.marks!==undefined?s.q.marks:0)+'" onchange="updScanMark('+s.id+',this.value)" style="width:72px;" class="fi"/></label>'
      +'<button class="btn-ghost" style="color:var(--red);margin-left:auto;" onclick="delScanSlot('+s.id+')">🗑</button>'
      +'</div></div>';
  }).join('');
  setTimeout(function(){ math(sl); },200);
}
window.updScanSlot=function(id,v){ var s=S.ocrSlots.find(function(x){ return x.id===id; }); if(s) s.q.t=v; };
window.setScanType=function(id,v){ var s=S.ocrSlots.find(function(x){ return x.id===id; }); if(s) s.q.k=v; };
window.updScanMark=function(id,v){ var s=S.ocrSlots.find(function(x){ return x.id===id; }); if(s&&s.q) s.q.marks=Math.max(0,parseInt(v)||0); };
window.delScanSlot=function(id){ S.ocrSlots=S.ocrSlots.filter(function(x){ return x.id!==id; }); renderScanSlots(); var rb=$('scanReviewBtn'); if(rb) rb.disabled=!S.ocrSlots.length; };
window.addBlankScan=function(){ var id=S.ocrSlots.length; S.ocrSlots.push({id:id,q:{t:'',k:'theory',marks:0,tr:false},included:true}); renderScanSlots(); var rb=$('scanReviewBtn'); if(rb) rb.disabled=false; };
window.finalizeScan=function(){
  syncManualPaperDetails();
  var valid=S.ocrSlots.filter(function(s){ return s&&s.q&&s.q.t&&s.q.t.trim(); });
  if(!valid.length){ toast('No transcribed questions to review','warn'); return; }
  S.slots=valid.map(function(s,i){ return{id:i,k:s.q.k||'theory',q:s.q,included:true,loading:false,err:null}; });
  goReview();
};

/* ══════════════════════════════════════
   SECTION 2 — NOTE-TO-EXAM helpers
══════════════════════════════════════ */
function addNtxImage(dataUrl,mimeType,label){
  var idx=S._ntxQueue.length;
  S._ntxQueue.push({dataUrl:dataUrl,mimeType:mimeType||'image/jpeg',label:label||('Note '+(idx+1))});
  var gal=$('ntxGallery');
  if(gal){
    var thumb=document.createElement('div');
    thumb.id='ntxthumb_'+idx;
    thumb.style.cssText='position:relative;width:78px;height:78px;border-radius:8px;overflow:hidden;border:2px solid #67E8F9;flex-shrink:0;';
    thumb.innerHTML='<img src="'+dataUrl+'" style="width:100%;height:100%;object-fit:cover;"/>'
      +'<button onclick="removeNtxImg('+idx+')" style="position:absolute;top:2px;right:2px;background:rgba(14,116,144,.9);color:#fff;border:none;width:20px;height:20px;border-radius:50%;font-size:11px;cursor:pointer;padding:0;">×</button>'
      +'<div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.55);color:#fff;font-size:8px;padding:2px 4px;text-align:center;font-family:var(--mono);">'+esc(label||('N'+(idx+1)))+'</div>';
    gal.appendChild(thumb);
  }
  updateNtxCount();
}
window.removeNtxImg=function(idx){ S._ntxQueue[idx]=null; var th=$('ntxthumb_'+idx); if(th) th.remove(); updateNtxCount(); };

function addNtxTextEntry(idx,label){
  var gal=$('ntxGallery');
  if(gal){
    var thumb=document.createElement('div');
    thumb.id='ntxthumb_'+idx;
    thumb.style.cssText='position:relative;width:78px;height:78px;border-radius:8px;overflow:hidden;border:2px solid #67E8F9;flex-shrink:0;background:#ECFEFF;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;';
    thumb.innerHTML='<div style="font-size:22px;">📝</div>'
      +'<div style="font-size:7px;font-weight:700;color:#0E7490;text-align:center;padding:0 4px;word-break:break-all;line-height:1.2;">'+esc(label.replace(/\.[^.]+$/,'').substring(0,12))+'</div>'
      +'<button onclick="removeNtxImg('+idx+')" style="position:absolute;top:2px;right:2px;background:rgba(14,116,144,.9);color:#fff;border:none;width:18px;height:18px;border-radius:50%;font-size:10px;cursor:pointer;padding:0;">×</button>';
    gal.appendChild(thumb);
  }
  updateNtxCount();
}
function updateNtxCount(){
  var v=S._ntxQueue.filter(Boolean).length;
  var cnt=$('ntxImgCount'); if(cnt) cnt.textContent=v;
  var btn=$('ntxGenBtn'); if(btn) btn.disabled=v===0;
}
window.handleNtxUpload=async function(e){
  var files=Array.from(e.target.files||[]); e.target.value='';
  for(var i=0;i<files.length;i++){
    var file=files[i]; var name=file.name||'file';
    try{
      if(file.type.startsWith('image/')){
        var reader=new FileReader();
        await new Promise(function(res){ reader.onload=function(ev){ addNtxImage(ev.target.result,file.type,name.replace(/\.[^.]+$/,'')); res(); }; reader.readAsDataURL(file); });
      } else if(file.type==='application/pdf'||name.toLowerCase().endsWith('.pdf')){
        toast('📄 Converting PDF…','info',2500);
        var pages=await pdfToImages(file);
        pages.forEach(function(p){ addNtxImage(p.dataUrl,p.mimeType,p.label); });
        toast('✓ PDF ready — '+pages.length+' pages','ok',2500);
      } else if(file.type.includes('word')||name.toLowerCase().endsWith('.docx')||name.toLowerCase().endsWith('.doc')){
        toast('📝 Reading DOCX…','info',2000);
        var text=await docxToText(file);
        // Store as text entry in ntxQueue
        var idx=S._ntxQueue.length;
        S._ntxQueue.push({type:'text',text:text,label:name,dataUrl:null,mimeType:'text/plain'});
        addNtxTextEntry(idx,name);
        toast('✓ Document loaded','ok',2000);
      }
    } catch(ex){ toast('⚠ '+name+': '+ex.message,'err'); }
  }
};
window.convertWordTextQuestions=async function(){
  var text=(($('ntxWordText')||{}).value||'').trim();
  if(!text){ toast('Paste copied Word text first','warn'); return; }
  ensureApiKey();
  syncManualPaperDetails();
  if(!S.cfg.subj){ toast('Select the subject first','warn'); return; }
  var customInstr=(($('ntxInstr')||{}).value||'').trim();
  var btn=$('ntxGenBtn'); if(btn){ btn.disabled=true; btn.innerHTML='<span class="spin">⟳</span> Structuring…'; }
  var area=$('ntxStatus');
  function setStatus(html){ if(area) area.innerHTML='<div style="margin-top:4px;">'+html+'</div>'; }
  setStatus('<div class="banner b-teal"><span class="spin">⟳</span> Converting copied text into structured questions…</div>');
  try{
    var questions=await structureQuestionsFromWordText(text,customInstr);
    S.ntxSlots=[];
    for(var qi=0; qi<questions.length; qi++){
      var raw=questions[qi]||{};
      var kind=raw.k||raw.type||'theory';
      var opts=raw.options||raw.opts||raw.o||null;
      var qText=raw.q||raw.question||raw.text||'';
      var svgHint=raw.svgDescription||raw.diagramDescription||'';
      var svgInline=null;
      if(svgHint){
        setStatus('<div class="banner b-info"><span class="spin">âŸ³</span> Rendering diagram '+(qi+1)+' of '+questions.length+'â€¦</div>');
        try{ svgInline=await callGeminiDraw(svgHint,{width:420,height:250}); }
        catch(svgErr){ console.warn('Structured text SVG failed:',svgErr.message); }
      }
      S.ntxSlots.push({id:qi,q:{
        t:qText,
        k:kind,
        o:opts,
        a:normalizeAnswerIndex(raw.answer,opts),
        answer:raw.answerText||raw.answer||'',
        marks:raw.marks||0,
        topic:raw.topic||'',
        svgHint:svgHint,
        svgInline:svgInline,
        structured:true,
        ai:true
      },included:true});
    }
    if(S.ntxSlots.length){
      setStatus('<div class="banner b-ok">✅ <strong>'+S.ntxSlots.length+' questions</strong> structured from pasted text.</div>');
      renderNtxSlots();
      var ra=$('ntxSlotArea'); if(ra){ ra.style.display='block'; ra.scrollIntoView({behavior:'smooth',block:'start'}); }
      var rb=$('ntxReviewBtn'); if(rb){ rb.disabled=false; rb.style.display='inline-flex'; }
    } else {
      setStatus('<div class="banner b-warn">⚠ No questions found in the pasted text.</div>');
    }
  } catch(e){
    setStatus('<div class="banner b-warn">⚠ Structuring failed: '+esc(e.message)+'<br/><button class="btn bq bsm" style="margin-top:9px;" onclick="convertWordTextQuestions()">↻ Retry</button></div>');
  }
  if(btn){ btn.disabled=false; btn.innerHTML='🧾 Structure Questions'; }
};
async function structureQuestionsFromWordText(text,customInstr){
  var subj=S.cfg.subj||'General'; var cls=S.cfg.cls||'Secondary School';
  var prompt='You are a Nigerian exam formatting expert. Convert copied Word text into perfectly structured exam questions.\n\n'
    +'Subject: '+subj+' | Class: '+cls+'\n\n'
    +'CRITICAL RULES:\n'
    +'0. IGNORE any school names, headers, exam titles, or general instructions at the top.\n'
    +'1. Do NOT generate new questions or facts.\n'
    +'2. Use ONLY the pasted text.\n'
    +'3. Reconstruct broken line wraps, pasted numbering, sub-questions, and A-D options into clean question text.\n'
    +'4. Preserve the meaning, wording, names, numbers, formulas, punctuation, tonal marks, and sub-parts.\n'
    +'5. Classify A-D option questions as k="obj"; questions with blanks as k="fitb"; all others as k="theory".\n'
    +'6. Convert math/science notation to readable LaTeX where appropriate, e.g. $x^2$, $\\frac{1}{2}$, $H_2SO_4$.\n'
    +'7. Extract marks only when already present. Do not invent marks.\n'
    +'8. If the pasted text references a diagram, figure, graph, shape, table, map or apparatus, add svgDescription with a precise redraw description. Do not invent a visual where none is implied.\n'
    +(customInstr?'9. MANDATORY INSTRUCTION: '+customInstr+'\n':'')
    +'\nPASTED WORD TEXT:\n'+text.substring(0,18000)+'\n\n'
    +'Return ONLY a valid JSON array:\n'
    +'[{"q":"complete question text","k":"obj","options":["A","B","C","D"],"answer":"","marks":1,"svgDescription":""},'
    +'{"q":"complete theory question with sub-parts preserved","k":"theory","options":null,"answer":"","marks":10,"svgDescription":"diagram redraw description if present"}]\n'
    +'JSON array ONLY. No explanation.';
  var result=await callGemini(prompt,{temperature:0.1});
  if(Array.isArray(result)) return result;
  if(result&&typeof result==='object'){ var keys=['questions','items','data','results']; for(var k=0;k<keys.length;k++){ if(Array.isArray(result[keys[k]])) return result[keys[k]]; } }
  return [];
}
window.generateFromNotes=async function(){
  var items=S._ntxQueue.filter(Boolean);
  if(!items.length){ toast('Upload files first','warn'); return; }
  ensureApiKey();
  syncManualPaperDetails();
  if(!S.cfg.subj){ toast('Select the subject first','warn'); return; }
  var objN=parseInt(($('ntxObjN')||{}).value)||0;
  var fitbN=parseInt(($('ntxFitbN')||{}).value)||0;
  var thN=parseInt(($('ntxThN')||{}).value)||0;
  if(objN+fitbN+thN===0){ toast('Set at least 1 question to generate','warn'); return; }
  var std=($('ntxStd')||{}).value||'WAEC';
  var customInstr=(($('ntxInstr')||{}).value||'').trim();
  var btn=$('ntxGenBtn'); if(btn){ btn.disabled=true; btn.innerHTML='<span class="spin">⟳</span> Reading files…'; }
  var area=$('ntxStatus');
  function setStatus(html){ if(area) area.innerHTML='<div style="margin-top:4px;">'+html+'</div>'; }
  setStatus('<div class="banner b-teal"><span class="spin">⟳</span> Reading your files…</div>');
  var noteContent='';
  for(var i=0;i<items.length;i++){
    var item=items[i];
    setStatus('<div class="banner b-teal"><div style="font-weight:700;">Reading '+(i+1)+' of '+items.length+': '+esc(item.label)+'…</div></div>');
    try{
      if(item.type==='text'){
        // DOCX already extracted
        noteContent+='\n\n--- Document: '+item.label+' ---\n'+item.text;
        var th=$('ntxthumb_'+S._ntxQueue.indexOf(item)); if(th) th.style.border='2px solid var(--green)';
      } else {
        // Image — extract content via vision
        var b64=item.dataUrl.split(',')[1];
        var extracted=await extractNoteContent(b64,item.mimeType);
        noteContent+='\n\n--- Note '+(i+1)+': '+item.label+' ---\n'+extracted;
        var th2=$('ntxthumb_'+S._ntxQueue.indexOf(item)); if(th2) th2.style.border='2px solid var(--green)';
      }
    } catch(e){ var th3=$('ntxthumb_'+S._ntxQueue.indexOf(item)); if(th3) th3.style.border='2px solid var(--amber)'; }
  }
  if(!noteContent.trim()){
    setStatus('<div class="banner b-warn">⚠ Could not read content from files. Try clearer photos or different files.</div>');
    if(btn){ btn.disabled=false; btn.innerHTML='📖 Generate from Notes'; } return;
  }
  setStatus('<div class="banner b-teal"><span class="spin">⟳</span> Generating questions from your content…</div>');
  try{
    var questions=await generateQuestionsFromNotes(noteContent,objN,fitbN,thN,std,customInstr);
    S.ntxSlots=[];
    for(var qi=0; qi<questions.length; qi++){
      var raw=questions[qi]||{};
      var svgInline=null;
      if(raw.svgDescription){
        try{ svgInline=await callGeminiDraw(raw.svgDescription,{width:420,height:250}); }
        catch(svgErr){ console.warn('Note SVG failed:',svgErr.message); }
      }
      var noteOpts=raw.options||raw.opts||null;
      S.ntxSlots.push({id:qi,q:{t:raw.q||'',k:raw.k||raw.type||'theory',o:noteOpts,a:normalizeAnswerIndex(raw.answer,noteOpts),answer:raw.answer,marks:raw.marks||0,topic:raw.topic||'',ai:true,ntx:true,svgInline:svgInline,svgHint:raw.svgDescription||''},included:true});
    }
    if(S.ntxSlots.length){
      setStatus('<div class="banner b-ok">✅ <strong>'+S.ntxSlots.length+' questions</strong> generated from your content.</div>');
      renderNtxSlots();
      var ra=$('ntxSlotArea'); if(ra){ ra.style.display='block'; ra.scrollIntoView({behavior:'smooth',block:'start'}); }
      var rb=$('ntxReviewBtn'); if(rb){ rb.disabled=false; rb.style.display='inline-flex'; }
    } else {
      setStatus('<div class="banner b-warn">⚠ No questions generated. Try different settings or clearer content.</div>');
    }
  } catch(e){
    setStatus('<div class="banner b-warn">⚠ Generation failed: '+esc(e.message)+'<br/><button class="btn bq bsm" style="margin-top:9px;" onclick="generateFromNotes()">↻ Retry</button></div>');
  }
  if(btn){ btn.disabled=false; btn.innerHTML='📖 Generate from Notes'; }
};
async function extractNoteContent(base64,mimeType){
  mimeType=mimeType||'image/jpeg';
  var prompt='Read this class note image and extract all educational content.\n'
    +'Return a comprehensive plain text summary of ALL topics, concepts, definitions, formulas, and key points visible.\n'
    +'Be thorough — this content will be used to generate exam questions. No JSON.';
  var messages=[{role:'user',content:[{type:'image_url',image_url:{url:'data:'+mimeType+';base64,'+base64}},{type:'text',text:prompt}]}];
  var text=await(_apiQueue=_apiQueue.then(function(){ return _callWithRetry(messages,false); }));
  return text||'';
}
async function generateQuestionsFromNotes(noteContent,objN,fitbN,thN,std,customInstr){
  var subj=S.cfg.subj||'General'; var cls=S.cfg.cls||'Secondary School'; var diff=_ntxDiff||'Balanced';
  var typesReq=[];
  if(objN>0) typesReq.push(objN+' multiple-choice objectives (A–D options)');
  if(fitbN>0) typesReq.push(fitbN+' fill-in-the-blank questions (sentence ending with ___________)');
  if(thN>0) typesReq.push(thN+' theory/essay questions');
  var prompt='You are a Nigerian exam expert. Generate questions STRICTLY from the class notes below.\n\n'
    +'Subject: '+subj+' | Class: '+cls+' | Standard: '+std+' | Difficulty: '+diff+'\n\n'
    +'CRITICAL RULES:\n'
    +'1. ONLY generate questions based on content in the notes provided.\n'
    +'2. Do NOT invent topics or facts not present in the notes.\n'
    +'3. Every question must be answerable from the notes.\n'
    +'4. Render mathematics, chemistry and physics notation in valid LaTeX, e.g. $x^2$, $\\frac{1}{2}$, $H_2SO_4$, $v=\\frac{s}{t}$.\n'
    +'5. You may include diagrams, shapes, tables, graphs and science apparatus when they help test the note content. For tables use [TABLE:Heading 1;Heading 2|Row A;Row B]. For graphs/shapes, put a precise drawing request in svgDescription.\n'
    +(customInstr?'6. MANDATORY INSTRUCTION: '+customInstr+'\n':'')
    +'\nGenerate:\n- '+typesReq.join('\n- ')+'\n\n'
    +'CLASS NOTES:\n'+noteContent+'\n\n'
    +'Return ONLY a valid JSON array:\n'
    +'Objectives: {"q":"question with LaTeX where needed","k":"obj","options":["A","B","C","D"],"answer":0,"marks":1,"topic":"topic","svgDescription":""}\n'
    +'Fill-in-blank: {"q":"sentence with ___________","k":"fitb","answer":"answer","marks":2,"topic":"topic","svgDescription":""}\n'
    +'Theory: {"q":"question with LaTeX where needed","k":"theory","marks":10,"topic":"topic","svgDescription":""}\n'
    +'JSON array ONLY. No explanation.';
  var result=await callGemini(prompt,{temperature:0.3});
  if(Array.isArray(result)) return result;
  if(result&&typeof result==='object'){ var keys=['questions','items','data']; for(var k=0;k<keys.length;k++){ if(Array.isArray(result[keys[k]])) return result[keys[k]]; } }
  return [];
}
function renderNtxSlots(){
  var area=$('ntxSlotArea'),sl=$('ntxSlots'); if(!area||!sl) return;
  sl.innerHTML=S.ntxSlots.map(function(s){
    var opts=Array.isArray(s.q.o)?s.q.o:[];
    return '<div class="ocr-slot">'
      +'<div style="font-family:var(--mono);font-size:9.5px;color:var(--mute);margin-bottom:7px;">Q'+(s.id+1)+' · '+(s.q.k||'theory').toUpperCase()+' <span class="tag t-ntx">🧾 Structured Text</span> <span class="tag t-ai">⚡ AI</span></div>'
      +'<div class="stx" style="margin-bottom:7px;">'+renderQuestionText(s.q)+'</div>'
      +'<textarea class="fta" style="min-height:50px;" oninput="updNtxSlot('+s.id+',this.value)">'+esc(s.q.t)+'</textarea>'
      +(s.q.k==='obj'?'<div class="ntx-option-editor" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">'
        +[0,1,2,3].map(function(oi){
          return '<label style="font-size:11px;font-weight:700;color:var(--mute);">Option '+L[oi]
            +'<input class="fi" value="'+esc(opts[oi]||'')+'" oninput="updNtxOption('+s.id+','+oi+',this.value)" style="margin-top:3px;"/></label>';
        }).join('')
        +'<label style="font-size:11px;font-weight:700;color:var(--mute);grid-column:1/-1;">Correct Answer '
        +'<select class="fs" onchange="updNtxAnswer('+s.id+',this.value)" style="max-width:120px;margin-left:6px;">'
        +[0,1,2,3].map(function(oi){ return '<option value="'+oi+'"'+(Number(s.q.a)===oi?' selected':'')+'>'+L[oi]+'</option>'; }).join('')
        +'</select></label></div>':'')
      +(s.q.k==='fitb'&&s.q.answer?'<div style="font-size:11px;color:var(--purple);margin-top:4px;">✓ Answer: '+esc(s.q.answer)+'</div>':'')
      +renderVisualEditor('ntx',s.id,s.q)
      +'<div style="display:flex;gap:8px;margin-top:7px;align-items:center;flex-wrap:wrap;">'
      +'<select class="fs" style="max-width:140px;" onchange="setNtxType('+s.id+',this.value)">'
      +'<option value="theory"'+(s.q.k==='theory'?' selected':'')+'>Theory</option>'
      +'<option value="obj"'+(s.q.k==='obj'?' selected':'')+'>Objective</option>'
      +'<option value="fitb"'+(s.q.k==='fitb'?' selected':'')+'>Fill-in-Blank</option>'
      +'</select>'
      +'<label style="font-size:11px;font-weight:700;color:var(--mute);display:flex;align-items:center;gap:6px;">Marks <input type="number" min="0" max="100" value="'+(s.q.marks!==undefined?s.q.marks:0)+'" onchange="updNtxMark('+s.id+',this.value)" style="width:72px;" class="fi"/></label>'
      +'<button class="btn-ghost" style="color:var(--red);margin-left:auto;" onclick="delNtxSlot('+s.id+')">🗑</button>'
      +'</div></div>';
  }).join('');
  setTimeout(function(){ math(sl); },200);
}
window.updNtxSlot=function(id,v){ var s=S.ntxSlots.find(function(x){ return x.id===id; }); if(s) s.q.t=v; };
window.updNtxOption=function(id,idx,v){ var s=S.ntxSlots.find(function(x){ return x.id===id; }); if(s&&s.q){ if(!Array.isArray(s.q.o)) s.q.o=['','','','']; s.q.o[idx]=v; } };
window.updNtxAnswer=function(id,v){ var s=S.ntxSlots.find(function(x){ return x.id===id; }); if(s&&s.q) s.q.a=parseInt(v,10)||0; };
window.setNtxType=function(id,v){ var s=S.ntxSlots.find(function(x){ return x.id===id; }); if(s){ s.q.k=v; if(v==='obj'&&!Array.isArray(s.q.o)) s.q.o=['','','','']; renderNtxSlots(); } };
window.updNtxMark=function(id,v){ var s=S.ntxSlots.find(function(x){ return x.id===id; }); if(s&&s.q) s.q.marks=Math.max(0,parseInt(v)||0); };
window.delNtxSlot=function(id){ S.ntxSlots=S.ntxSlots.filter(function(x){ return x.id!==id; }); renderNtxSlots(); var rb=$('ntxReviewBtn'); if(rb) rb.disabled=!S.ntxSlots.length; };
window.addBlankNtx=function(){ var id=S.ntxSlots.length; S.ntxSlots.push({id:id,q:{t:'',k:'theory',marks:0},included:true}); renderNtxSlots(); var rb=$('ntxReviewBtn'); if(rb){ rb.disabled=false; rb.style.display='inline-flex'; } };
window.finalizeNtx=function(){
  syncManualPaperDetails();
  var valid=S.ntxSlots.filter(function(s){ return s&&s.q&&s.q.t&&s.q.t.trim(); });
  if(!valid.length){ toast('No questions to review','warn'); return; }
  S.slots=valid.map(function(s,i){ return{id:i,k:s.q.k||'theory',q:s.q,included:true,loading:false,err:null}; });
  goReview();
};
function syncManualPaperDetails(){
  var mfcl=$('mfcl'); if(mfcl&&mfcl.value) S.cfg.cls=mfcl.value;
  var mfsubj=$('mfsubj'); if(mfsubj&&mfsubj.value.trim()) S.cfg.subj=mfsubj.value.trim();
  var mfsess=$('mfsess'); if(mfsess&&mfsess.value) S.cfg.session=mfsess.value;
  if(S.path==='manual') S.cfg.std='';
  S.cfg.term=enforceAdminTerm();
  var mfterm=$('mfterm'); if(mfterm) mfterm.value=S.cfg.term;
}

/* ══════════════════════════════════════
   SCREEN 3 — THE HAND-OFF
══════════════════════════════════════ */
function goReview(){
  S.scr=3; hdr();
  $('s1').style.display='none';
  $('s2').style.display='none';
  $('s3').style.display='block';
  window.scrollTo({top:0,behavior:'smooth'});

  var c=S.cfg;
  var dispSubj=c.subj==='Trade Subject'?getTradeById(S.tradeSubject).name:(c.subj||'(Untitled)');
  var today=new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'});
  var os  =S.slots.filter(function(s){ return s.q&&s.included&&s.q.k==='obj'; });
  var fs  =S.slots.filter(function(s){ return s.q&&s.included&&s.q.k==='fitb'; });
  var ts  =S.slots.filter(function(s){ return s.q&&s.included&&s.q.k==='theory'; });
  S.printSlots={os:os.slice(),fs:fs.slice(),ts:ts.slice()};
  buildPrint(os,fs,ts,false);

  var h='<div class="pg noprint fade">'
    +'<div class="ptl">The Hand-off</div>'
    +'<div class="pst">Final review — then download or save to archive.</div>'

    +'<div class="sgrid">'
    +'<div class="sbox"><div class="sv">'+esc(c.cls||'—')+'</div><div class="slb">Class</div></div>'
    +'<div class="sbox"><div class="sv">'+assessmentLabel(S.at,true)+'</div><div class="slb">Type</div></div>'
    +'<div class="sbox"><div class="sv">'+os.length+'</div><div class="slb">Objectives</div></div>'
    +'<div class="sbox"><div class="sv">'+fs.length+'</div><div class="slb">Fill-in-Blank</div></div>'
    +'</div>'

    +'<div class="card" style="margin-bottom:16px;">'
    +'<div style="display:flex;gap:8px;flex-wrap:wrap;">'
    +'<span class="tag '+stdTagCls(c.std)+'" style="font-size:11px;padding:4px 10px;">'+esc(c.std)+'</span>'
    +'<span class="tag t-cust" style="font-size:11px;padding:4px 10px;">'+esc(c.term)+'</span>'
    +'<span class="tag t-cust" style="font-size:11px;padding:4px 10px;">📅 '+today+'</span>'
    +'</div></div>'

    +(os.length?'<div class="ct">Section A — Objectives ('+os.length+')</div>':'')
    +os.map(function(s,i){
      var q=s.q;
      return '<div class="qp"><div class="qn">'+String(i+1).padStart(2,'0')+'</div>'
        +'<div style="flex:1;"><div>'+renderQuestionText(q)+'</div>'
        +(q.o?'<div class="sopts" style="margin-top:7px;">'+q.o.map(function(o,oi){
          return '<div class="sopt '+(oi===q.a?'correct':'')+'"><span class="sok">'+L[oi]+'.</span><span>'+esc(o)+'</span></div>';
        }).join('')+'</div>':'')
        +'<div style="margin-top:5px;display:flex;gap:5px;flex-wrap:wrap;">'
        +(q.g?'<span class="tag '+stdTagCls(q.g)+'">'+esc(q.g)+'</span>':'')
        +(q.topic?'<span class="tag t-cust">'+esc(q.topic)+'</span>':'')
        +'</div></div></div>';
    }).join('')

    +(fs.length?'<div class="ct" style="margin-top:20px;">Section B — Fill-in-the-Blank ('+fs.length+')</div>':'')
    +fs.map(function(s,i){
      var q=s.q;
      return '<div class="qp fitb-qp"><div class="qn">'+String(i+1).padStart(2,'0')+'</div>'
        +'<div style="flex:1;"><div>'+renderQuestionText(q)+'</div>'
        +(q.answer?'<div class="fitb-answer">✓ Answer: <span>'+esc(q.answer)+'</span></div>':'')
        +'<div style="margin-top:5px;display:flex;gap:5px;flex-wrap:wrap;">'
        +(hasPositiveMarks(q)?'<span class="tag t-marks">'+questionMarks(q)+' marks</span>':'')
        +(q.topic?'<span class="tag t-cust">'+esc(q.topic)+'</span>':'')
        +'</div></div></div>';
    }).join('')

    +(ts.length?'<div class="ct" style="margin-top:20px;">'+(fs.length?'Section C':'Section B')+' — Theory ('+ts.length+')</div>':'')
    +ts.map(function(s,i){
      var q=s.q;
      return '<div class="qp"><div class="qn">'+String(i+1).padStart(2,'0')+'</div>'
        +'<div style="flex:1;"><div>'+renderQuestionText(q)+'</div>'
        +'<div style="margin-top:5px;display:flex;gap:5px;flex-wrap:wrap;">'
        +(hasPositiveMarks(q)?'<span class="tag t-marks">'+questionMarks(q)+' marks</span>':'')
        +(q.s?'<span class="tag t-marks">⚡ Step Marks</span>':'')
        +(q.tr?'<span class="tag t-tr">✏ Transcribed</span>':'')
        +(q.ai?'<span class="tag t-ai">⚡ AI</span>':'')
        +(q.topic?'<span class="tag t-cust">'+esc(q.topic)+'</span>':'')
        +'</div></div></div>';
    }).join('')

    +'<div class="divider"></div>'
    +'<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">'
    +'<button class="btn bq" id="s3back">← Back to Workshop</button>'
    +'<div style="display:flex;gap:10px;flex-wrap:wrap;">'
    +'<button class="btn bq" style="border-color:var(--blue);color:var(--blue);" onclick="printPaperOnly()">📄 Download Paper</button>'
    +'<button class="btn" style="background:#0E7490;color:#fff;" onclick="printWithGuide()">📋 + Marking Guide</button>'
    +'<button class="btn bg" id="s3save">💾 Save to Archive</button>'
    +'</div></div></div>';

  $('s3').innerHTML=h;
  setTimeout(function(){ math($('s3')); },300);

  $('s3back').onclick=function(){
    S.scr=2; hdr();
    $('s3').style.display='none';
    $('s2').style.display='block';
    if(S.path==='auto') renderWorkshop();
    else s2Manual();
  };

  $('s3save').onclick=async function(){
    var btn=$('s3save'); if(btn){btn.disabled=true;btn.textContent='💾 Saving…';}
    var ref='EE-'+Date.now().toString(36).toUpperCase().slice(-6);
    var dispSubj2=c.subj==='Trade Subject'?getTradeById(S.tradeSubject).name:(c.subj||'Subject');
    var allQs=[].concat(
      os.map(function(s){ return persistQuestion(s.q,'obj'); }),
      fs.map(function(s){ return persistQuestion(s.q,'fitb'); }),
      ts.map(function(s){ return persistQuestion(s.q,'theory'); })
    );
    var admBrand=getAdminSettings();
    var paper={
      ref:ref, cls:c.cls, subj:dispSubj2, term:c.term, session:c.session||'2025/2026',
      std:c.std, at:S.at, school:admBrand.school||c.school||'', logo:admBrand.logo||'',
      objCount:os.length, fitbCount:fs.length, thCount:ts.length,
      instr:c.instr||'', theoryPaperInstr:c.theoryPaperInstr||'',
      date:new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'}),
      ts:Date.now(),
      adminStatus:'submitted',
      correctionNote:'',
      autoGen:false,
      questions:allQs,
      user_name:CURRENT_USER.name||CURRENT_USER.email
    };
    try{
      await saveSinglePaper(paper);
      clearDraft();
      $('s3').innerHTML='<div class="pg"><div class="suw">'
        +'<div class="sui">🎓</div>'
        +'<div class="sut">Paper Saved &amp; Submitted</div>'
        +'<div class="sum">Your <strong>'+esc(S.at)+'</strong> for <strong>'+esc(c.cls)+' — '+esc(dispSubj2)+'</strong> has been submitted to the admin production queue.</div>'
        +'<div class="ref-pill">📋 Ref: '+ref+'</div>'
        +'<div class="banner b-ok" style="margin:16px 0;text-align:left;font-size:12px;">'
        +'✅ <strong>What happens next:</strong> The admin will review this paper in the Production Queue. Check your Archive for approval status or correction notes.'
        +'</div>'
        +'<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">'
        +'<button class="btn bg" onclick="navTo(\'arch\')">📚 View Archive</button>'
        +'<button class="btn bq" id="newPaper">Create Another Paper</button>'
        +'</div></div></div>';
      $('newPaper').onclick=resetAll;
      toast('✓ Paper submitted — Ref: '+ref,'ok',5000);
    } catch(e){
      if(btn){btn.disabled=false;btn.textContent='💾 Save to Archive';}
      toast('Save failed: '+(e.message||'check your internet connection'),'err',7000);
    }
  };
}

function currentPrintableSlots(){
  var slots=(S.slots||[]).filter(function(s){ return s&&s.q&&s.included; });
  if(!slots.length&&S.printSlots){
    return {
      os:S.printSlots.os||[],
      fs:S.printSlots.fs||[],
      ts:S.printSlots.ts||[]
    };
  }
  return {
    os:slots.filter(function(s){ return s.q.k==='obj'; }),
    fs:slots.filter(function(s){ return s.q.k==='fitb'; }),
    ts:slots.filter(function(s){ return s.q.k==='theory'; })
  };
}
function ensurePrintTarget(id){
  var el=$(id);
  if(el && el.parentNode!==document.body) document.body.appendChild(el);
  return el;
}
window.printPaperOnly=function(){
  var ps=currentPrintableSlots(), os=ps.os, fs=ps.fs, ts=ps.ts;
  if(!os.length&&!fs.length&&!ts.length){ toast('No questions to print','warn'); return; }
  ensurePrintTarget('pp');
  buildPrint(os,fs,ts,false);
  document.body.classList.remove('economy-mode','lab-print-mode');
  document.body.classList.add('normal-mode');
  setTimeout(function(){
    window.print();
    setTimeout(function(){ document.body.classList.remove('normal-mode'); },1200);
  },400);
};
window.printWithGuide=function(){
  var ps=currentPrintableSlots(), os=ps.os, fs=ps.fs, ts=ps.ts;
  if(!os.length&&!fs.length&&!ts.length){ toast('No questions to print','warn'); return; }
  ensurePrintTarget('pp');
  buildPrint(os,fs,ts,true);
  document.body.classList.remove('economy-mode','lab-print-mode');
  document.body.classList.add('normal-mode');
  setTimeout(function(){
    window.print();
    setTimeout(function(){ document.body.classList.remove('normal-mode'); },1200);
  },400);
};

/* ══════════════════════════════════════
   BUILD PRINT DOCUMENT
══════════════════════════════════════ */
function buildPrint(os,fs,ts,includeGuide){
  var c=S.cfg;
  var dispSubj=c.subj==='Trade Subject'?getTradeById(S.tradeSubject).name:(c.subj||'Subject');
  var today=new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'});
  var totalMarks=os.reduce(function(a,s){ return a+questionMarks(s.q); },0)
    +fs.reduce(function(a,s){ return a+questionMarks(s.q); },0)
    +ts.reduce(function(a,s){ return a+questionMarks(s.q); },0);

  var h='<div class="ep">'
    +'<div class="ep-wm">ExamEngine</div>'
    +'<div class="ep-header">'
    +'<div class="ep-title">'+assessmentLabel(S.at,false)+' — '+esc(c.term)+'</div>'
    +'<div class="ep-meta"><span>Subject: <strong>'+esc(dispSubj)+'</strong></span><span>Class: <strong>'+esc(c.cls)+'</strong></span><span>Duration: <strong>1 hr 30 mins</strong></span></div>'
    +'</div>'
    +'<div class="ep-instr">'+esc(c.instr)+'</div>';

  // Section A — Objectives
  if(os.length){
    h+='<div class="ep-sec">Section A — Objectives ('+os.length+' Questions)</div>'
      +'<div class="ep-sec-note">Circle the letter of the correct answer.</div>';
    os.forEach(function(s,i){
      var q=s.q;
      h+='<div class="ep-q"><span class="ep-qn">'+(i+1)+'. </span>'+renderQuestionText(q,{hideVisualPlaceholders:true});
      if(q.o&&q.o.length){
        h+='<div class="ep-opts">'+q.o.map(function(o,oi){
          return '<div class="ep-opt"><span class="ep-opt-k">'+L[oi]+'.</span><span>'+esc(o)+'</span></div>';
        }).join('')+'</div>';
      }
      h+='</div>';
    });
  }

  // Section B — Fill-in-the-Blank
  if(fs.length){
    var secLabel=os.length?'B':'A';
    h+='<div class="ep-sec">Section '+secLabel+' — Fill in the Blank ('+fs.length+' Questions)</div>'
      +'<div class="ep-sec-note">Fill in each blank with the correct word or phrase.</div>';
    fs.forEach(function(s,i){
      var q=s.q;
      // Replace ___ in question text with a printed blank line
      var qtxt=renderQuestionText(q,{hideVisualPlaceholders:true}).replace(/_{2,}/g,'<span class="ep-fitb-blank">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>');
      h+='<div class="ep-q"><span class="ep-qn">'+(i+1)+'. </span>'+qtxt
        +'</div>';
    });
  }

  // Section C (or B) — Theory
  if(ts.length){
    var tSecLabel=os.length&&fs.length?'C':os.length||fs.length?'B':'A';
    var tInstr=c.theoryPaperInstr||'Answer all theory questions. Show all workings where applicable.';
    h+='<div class="ep-sec">Section '+tSecLabel+' — Theory / Essay ('+ts.length+' Questions)</div>'
      +'<div class="ep-sec-note">'+esc(tInstr)+'</div>';
    ts.forEach(function(s,i){
      var q=s.q;
      h+='<div class="ep-q"><span class="ep-qn">'+(i+1)+'. </span>'+renderQuestionText(q,{hideVisualPlaceholders:true})
        +'<div class="ep-ans"></div></div>';
    });
  }

  h+='<div class="ep-footer">Generated with ExamEngine Pro v10</div>';

  // ── MARKING GUIDE — only when requested ──
  if(includeGuide){
    h+='<div style="page-break-before:always;"></div>'
      +'<div class="ep-header" style="margin-bottom:8pt;">'
      +'<div class="mg-head">MARKING GUIDE / MARKING SCHEME</div>'
      +'<div class="ep-meta"><span>Subject: <strong>'+esc(dispSubj)+'</strong></span><span>Class: <strong>'+esc(c.cls)+'</strong></span>'+(totalMarksHtml(totalMarks,true)?'<span>Total: '+totalMarksHtml(totalMarks,true)+'</span>':'')+'</div>'
      +'</div>'
      +'<div class="mg-conf">CONFIDENTIAL — For Teacher\'s Use Only'+(marksLabel(totalMarks)?' · Total: '+marksLabel(totalMarks):'')+'</div>';

    if(os.length){
      h+='<div class="mg-sec">Section A — Objectives: Answer Key</div>'
        +'<div class="mg-key-grid">';
      os.forEach(function(s,i){
        var q=s.q; var ans=q.o&&q.a!==undefined?L[q.a]:'—';
        h+='<div><strong>'+(i+1)+'.</strong> '+ans+'</div>';
      });
      var objTotal=os.reduce(function(a,s){ return a+questionMarks(s.q); },0);
      h+='</div>'+(marksLabel(objTotal)?'<div style="font-size:9pt;font-style:italic;color:#555;margin-bottom:10pt;">Objective section total: '+marksLabel(objTotal)+'.</div>':'');
    }

    if(fs.length){
      var fSecLbl=os.length?'B':'A';
      h+='<div class="mg-sec">Section '+fSecLbl+' — Fill-in-the-Blank: Answer Key</div>';
      fs.forEach(function(s,i){
        var q=s.q;
        h+='<div class="mg-fitb-ans"><strong>'+(i+1)+'.</strong> '+esc(q.answer||'—')
          +(hasPositiveMarks(q)?' <span style="font-size:9pt;color:#555;">['+questionMarks(q)+' mark'+(questionMarks(q)>1?'s':'')+']</span>':'')
          +'</div>';
      });
      var fitbTotal=fs.reduce(function(a,s){ return a+questionMarks(s.q); },0);
      if(marksLabel(fitbTotal)) h+='<div style="font-size:9pt;font-style:italic;color:#555;margin-top:6pt;">Section '+fSecLbl+' total: '+marksLabel(fitbTotal)+'.</div>';
    }

    if(ts.length){
      var tSecLbl2=os.length&&fs.length?'C':os.length||fs.length?'B':'A';
      h+='<div class="mg-sec">Section '+tSecLbl2+' — Theory: Mark Breakdown</div>';
      ts.forEach(function(s,i){
        var q=s.q; var qMarks=questionMarks(q);
        h+='<div class="mg-th-q">'
          +'<div style="font-weight:700;font-size:10.5pt;">Q'+(i+1)+(qMarks?' <span style="float:right;">['+qMarks+' marks]</span>':'')+'</div>'
          +'<div class="mg-th-q-text">'+renderQuestionText(q,{hideVisualPlaceholders:true})+'</div>'
          +'<div class="mg-mark-breakdown"><strong>Marking Points:</strong><br/>';
        if(q.s){
          h+='• Method / Working: '+Math.ceil(qMarks*.4)+' marks<br/>'
            +'• Correct intermediate steps: '+Math.ceil(qMarks*.3)+' marks<br/>'
            +'• Correct final answer: '+Math.floor(qMarks*.3)+' marks';
        } else {
          var sp=Math.floor(qMarks/3); var rem=qMarks-sp*2;
          h+='• Content accuracy: '+rem+' marks<br/>• Depth of explanation: '+sp+' marks<br/>• Clarity & expression: '+sp+' marks';
        }
        h+='</div></div>';
      });
      var thTotal=ts.reduce(function(a,s){ return a+questionMarks(s.q); },0);
      if(marksLabel(thTotal)||marksLabel(totalMarks)) h+='<div style="font-size:9pt;font-style:italic;color:#555;">'+(marksLabel(thTotal)?'Section '+tSecLbl2+' total: '+marksLabel(thTotal)+'. ':'')+(marksLabel(totalMarks)?'Grand Total: '+marksLabel(totalMarks)+'.':'')+'</div>';
    }
    h+='</div>'; // end marking guide
  }

  h+='</div>'; // end ep wrapper
  $('pp').innerHTML=h;
  setTimeout(function(){ math($('pp')); },500);
}

/* ══════════════════════════════════════
   RESET
══════════════════════════════════════ */
function resetAll(){
  S.path=null; S.scr=0; S.at='Examination'; S.difficultyLevel='Balanced';
  S.cfg={cls:'',term:S.cfg.term||'1st Term',session:S.cfg.session||'2025/2026',subj:'',std:'',topics:[],topicText:'',objN:10,fitbN:0,thN:5,instr:'Answer all questions. Time allowed: 1 hour 30 minutes.',theoryPaperInstr:'',theoryAiInstr:'',school:S.cfg.school||''};
  S.subjects=[]; S.schemeWeeks=[]; S.schemeLoaded=false; S.schemeCommitted=false;
  S.slots=[]; S.ocrSlots=[]; S.ntxSlots=[]; S.generating=false; S.cam=null;
  S._imgQueue=[]; S._ntxQueue=[];
  $('s1').innerHTML=''; $('s2').innerHTML=''; $('s3').innerHTML='';
  $('app').style.display='none';
  navTo('dash');
}

/* ══════════════════════════════════════
   ██████  PHASE 2 — ADMIN ENGINE  ██████
   v10 — Production Queue + Digital Lab
══════════════════════════════════════ */

/* ── Admin State ─────────────────────── */
var ADMIN = {
  economyMode: false,
  sbFilter: 'all',
  _deadlineTimer: null,
  designTemplate: 'classic',
  viewMode: 'exam',
  testWindow: '1',
  selectedTerm: '1st Term',
  labConfig: (function(){
    try{ return null; }catch(e){ return null; } // loaded async from Supabase
  }()) || {
    columns:1, orientation:'portrait',
    fontFamily:'Times New Roman', fontSize:'11pt',
    margins:'20mm', spacing:'standard',
    printMode:'auto'
  },
  labHistory: [],
  _resolvedMode: 'portrait'
};

/* ── Admin Data Helpers ──────────────── */
// Async — fetch from Supabase. Falls back to [] on error.
async function getPublished(){
  if(!CURRENT_USER) return [];
  try{
    var q = _supabase.from('papers').select('*').order('created_at',{ascending:false}).limit(500);
    // Admins see all; teachers see only own
    if(CURRENT_USER.role !== 'admin'){
      q = _supabase.from('papers').select('*').eq('user_id', CURRENT_USER.id).order('created_at',{ascending:false}).limit(200);
    }
    var res = await q;
    if(res.error){ console.error('getPublished error', res.error); return []; }
    // Unwrap: Supabase stores paper metadata as columns + questions in data jsonb
    return (res.data||[]).map(function(row){
      var d = row.data;
      if (typeof d === 'string') {
        try { d = JSON.parse(d); } catch(ex){ d = {}; }
      }
      d = d || {};
      return Object.assign({}, d, {
        _db_id: row.id,
        ref: row.ref || d.ref,
        cls: row.class_name || d.cls,
        subj: row.subject || d.subj,
        term: row.term || d.term,
        adminStatus: row.status || d.adminStatus || 'submitted',
        user_id: row.user_id,
        ts: new Date(row.created_at).getTime()
      });
    });
    
    // Filter out wiped papers if admin set a wipe timestamp
    var wipedAt = 0;
    if (window._adminSettingsCache && window._adminSettingsCache.wiped_at) {
      wipedAt = parseInt(window._adminSettingsCache.wiped_at, 10) || 0;
    }
    return mapped.filter(function(p){ return p.ts > wipedAt; });
  } catch(e){ console.error('getPublished exception', e); return []; }
}

async function savePublished(arr){
  // arr is the full papers array — we upsert each changed paper
  // In practice we only call this for single-paper status changes
  // so we just re-upsert all papers that have a _db_id
  for(var i=0;i<arr.length;i++){
    var p=arr[i];
    if(!p._db_id) continue;
    await _supabase.from('papers').update({
      status: p.adminStatus||'submitted',
      data: p
    }).eq('id', p._db_id);
  }
}

async function saveSinglePaper(p){
  if(!CURRENT_USER){ throw new Error('Not logged in — cannot save paper.'); }
  var payload = {
    ref: p.ref,
    user_id: CURRENT_USER.id,
    subject: p.subj||'',
    class_name: p.cls||'',
    term: p.term||'',
    status: p.adminStatus||'submitted',
    data: p
  };
  var result=null;
  if(p._db_id){
    // Update existing row
    var upRes = await _supabase.from('papers').update(payload).eq('id', p._db_id).select().single();
    if(upRes.error){ throw new Error('Update failed: '+upRes.error.message); }
    result=upRes.data;
  } else {
    // Try insert first, fallback to upsert on ref conflict
    var insRes = await _supabase.from('papers').insert(payload).select().single();
    if(insRes.error){
      if(insRes.error.code==='23505'||insRes.error.message.includes('duplicate')||insRes.error.message.includes('unique')){
        // Ref collision — update by ref
        var updRes2=await _supabase.from('papers').update(payload).eq('ref',p.ref).select().single();
        if(updRes2.error){ throw new Error('Save failed: '+updRes2.error.message); }
        result=updRes2.data;
      } else {
        // Always show the real Supabase error so we can diagnose it
        throw new Error('Insert failed: '+insRes.error.message+' [code: '+(insRes.error.code||'?')+']');
      }
    } else {
      result=insRes.data;
    }
  }
  // Tag the paper object with its DB id for future updates
  if(result&&result.id) p._db_id=result.id;
  return result;
}

function getAdminSettings(){
  // Returns cached admin settings (loaded async on boot/admin nav)
  return window._adminSettingsCache || {
    deadline:'', logo:'', watermark:'ExamEngine',
    school:'School Administration', address:'', motto:'',
    api_key:'', selected_term:'1st Term', selected_session:'2025/2026', trade_subject:''
  };
}
function applyAdminSettings(){
  var adm=getAdminSettings();
  if(adm.selected_term) S.cfg.term=adm.selected_term;
  if(adm.selected_session) S.cfg.session=adm.selected_session;
  if(adm.school && adm.school!=='School Administration') S.cfg.school=adm.school;
  if(adm.trade_subject) S.tradeSubject=adm.trade_subject;
  // Only apply the admin key if it passes the usability check (not blank, not blacklisted)
  if(adm.api_key && isUsableApiKey(adm.api_key)) API_KEY=cleanApiKey(adm.api_key);
  if(adm.selected_term) ADMIN.selectedTerm=adm.selected_term;
}
async function _fetchAdminSettings(){
  try{
    var res=await _supabase.from('admin_settings').select('*');
    if(res.error){
      console.warn('admin_settings fetch error:',res.error.message);
      // Retry once after a short delay before giving up
      await new Promise(function(r){ setTimeout(r,1200); });
      var res2=await _supabase.from('admin_settings').select('*');
      if(res2.error){ console.warn('admin_settings retry also failed:',res2.error.message); return window._adminSettingsCache||{}; }
      res=res2;
    }
    var m={};
    (res.data||[]).forEach(function(r){ m[r.key]=r.value; });
    // Strip any key that is currently blacklisted so it never enters the cache
    var rawKey=cleanApiKey(m.api_key||'');
    if(_badApiKeys[rawKey]) rawKey='';
    window._adminSettingsCache={
      deadline:m.deadline||'',
      logo:m.logo||'',
      watermark:m.watermark||'ExamEngine',
      school:m.school||'School Administration',
      address:m.address||'',
      motto:m.motto||'',
      api_key:rawKey,
      selected_term:m.selected_term||'',
      selected_session:m.selected_session||'',
      trade_subject:m.trade_subject||''
    };
    // Also load lab_config and lab_queue into ADMIN
    if(m.lab_config){ try{ ADMIN.labConfig=JSON.parse(m.lab_config); }catch(e){} }
    if(m.lab_queue){  try{ window._labQueue=JSON.parse(m.lab_queue);  }catch(e){} }
    if(m.house_style){ try{ window._houseStyleCache=JSON.parse(m.house_style); }catch(e){} }
    if(m.design_template){ ADMIN.designTemplate=m.design_template; }
    if(m.selected_term){ ADMIN.selectedTerm=m.selected_term; }
    if(m.selected_session){ /* stored for use in S.cfg.session at boot */ }
    applyAdminSettings();
  }catch(e){ console.warn('_fetchAdminSettings exception:',e.message); }
  return window._adminSettingsCache||{};
}

/* ── Status Board Data ───────────────── */
async function buildStatusMatrix(){
  var papers=await getPublished();
  var lookup={};
  papers.forEach(function(p){
    p._canonCls=canonicalClassName(p.cls);
    var k=(p._canonCls+'||'+p.term+'||'+p.subj+'||'+(p.at||'Examination')).toLowerCase();
    if(!lookup[k]||p.ts>lookup[k].ts) lookup[k]=p;
  });

  // Use admin-selected term (not auto-detected month)
  var termKey=ADMIN.selectedTerm||'1st Term';
  var rows=[];
  var seenKeys={};
  var classes=CL.slice();

  classes.forEach(function(cls){
    var subjs=getSubjectList(cls);
    subjs.forEach(function(subj){
      var dispSubj=subj==='Trade Subject'?getTradeById(S.tradeSubject).name:subj;
      var kExam=(cls+'||'+termKey+'||'+dispSubj+'||examination').toLowerCase();
      var kExamAlt=(cls+'||'+termKey+'||'+subj+'||examination').toLowerCase();
      var pExam=lookup[kExam]||lookup[kExamAlt]||null;
      var kT1=(cls+'||'+termKey+'||'+dispSubj+'||c.a. test 1').toLowerCase();
      var kT1Alt=(cls+'||'+termKey+'||'+dispSubj+'||c.a.').toLowerCase();
      var pT1=lookup[kT1]||lookup[kT1Alt]||null;
      var kT2=(cls+'||'+termKey+'||'+dispSubj+'||c.a. test 2').toLowerCase();
      var pT2=lookup[kT2]||null;

      var rowKey=(cls+'||'+dispSubj).toLowerCase();
      seenKeys[rowKey]=true;
      rows.push({
        cls:cls, term:termKey, subj:dispSubj,
        examPaper:pExam, examStatus:pExam?(pExam.adminStatus||'submitted'):'pending',
        test1Paper:pT1, test1Status:pT1?(pT1.adminStatus||'submitted'):'pending',
        test2Paper:pT2, test2Status:pT2?(pT2.adminStatus||'submitted'):'pending'
      });
    });
  });

  // Bridge: include submitted papers whose subjects are not in NERDC matrix
  papers.forEach(function(p){
    if(!p.cls||!p.subj||p.term!==termKey) return;
    var cls=canonicalClassName(p.cls);
    var rowKey=(cls+'||'+p.subj).toLowerCase();
    if(seenKeys[rowKey]) return;
    seenKeys[rowKey]=true;
    var kExam=(cls+'||'+termKey+'||'+p.subj+'||examination').toLowerCase();
    var kT1=(cls+'||'+termKey+'||'+p.subj+'||c.a. test 1').toLowerCase();
    var kT1Alt=(cls+'||'+termKey+'||'+p.subj+'||c.a.').toLowerCase();
    var kT2=(cls+'||'+termKey+'||'+p.subj+'||c.a. test 2').toLowerCase();
    var pExam=lookup[kExam]||null;
    var pT1=lookup[kT1]||lookup[kT1Alt]||null;
    var pT2=lookup[kT2]||null;
    rows.push({
      cls:cls, term:termKey, subj:p.subj,
      examPaper:pExam, examStatus:pExam?(pExam.adminStatus||'submitted'):'pending',
      test1Paper:pT1, test1Status:pT1?(pT1.adminStatus||'submitted'):'pending',
      test2Paper:pT2, test2Status:pT2?(pT2.adminStatus||'submitted'):'pending',
      fromTeacher:true
    });
  });

  return rows;
}

/* ── ADMIN DASHBOARD — PRODUCTION QUEUE ─── */
var _realtimeSub=null;
function initRealtimeQueue(){
  if(_realtimeSub || !_supabase) return;
  _realtimeSub = _supabase.channel('public:papers')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'papers' }, function(payload) {
       var el=document.getElementById('screen-admin-dash');
       if(el && el.style.display !== 'none') renderAdminDash(true);
    }).subscribe();
}
async function renderAdminDash(isRealtime){
  initRealtimeQueue();
  var el=document.getElementById('screen-admin-dash');
  el.style.display='block';
  if(!isRealtime) el.innerHTML='<div class="pgw fade"><div style="text-align:center;padding:60px 20px;color:var(--mute);"><span class="spin" style="font-size:22px;display:block;margin-bottom:12px;">⟳</span>Loading production queue…</div></div>';
  await _fetchAdminSettings();
  var papers=await getPublished();
  var adm=getAdminSettings();
  var termKey=ADMIN.selectedTerm || S.cfg.term || '1st Term';

  var submitted=papers.filter(function(p){ return p.adminStatus==='submitted'; }).length;
  var approved =papers.filter(function(p){ return p.adminStatus==='approved'; }).length;
  var rejected =papers.filter(function(p){ return p.adminStatus==='rejected'; }).length;
  var pending  =papers.length-submitted-approved-rejected;

  // NEW: detect papers from this term across all classes
  var newSubmissions=papers.filter(function(p){
    return p.term===termKey && p.adminStatus==='submitted';
  });

  // Deadline card
  var now=new Date();
  var deadlineHtml='';
  if(adm.deadline){
    var dl=new Date(adm.deadline);
    var overdue=now>dl;
    var dlStr=dl.toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
    deadlineHtml='<div class="deadline-card">'
      +'<div class="deadline-ico">'+(overdue?'🔴':'⏰')+'</div>'
      +'<div class="deadline-body">'
      +'<div class="deadline-title">Exam Submission Deadline</div>'
      +'<div class="deadline-time'+(overdue?' deadline-overdue':'')+'">'+dlStr+(overdue?' — OVERDUE':' — '+(Math.ceil((dl-now)/3600000))+'h remaining')+'</div>'
      +'</div>'
      +(overdue?'<button class="btn bp bsm" onclick="autoGenerateMissing()">⚡ Auto-Generate Missing</button>':'')
      +'</div>';
  }

  // New submissions alert
  var submissionsHtml='';
  if(newSubmissions.length){
    submissionsHtml='<div class="correction-banner" style="background:var(--green-lt);border-color:var(--green-bdr);">'
      +'<div class="correction-title" style="color:var(--green);">📬 Teacher Submissions — '+esc(termKey)+' ('+newSubmissions.length+')</div>'
      +newSubmissions.map(function(p){
        return '<div class="correction-item" style="border-color:var(--green-bdr);">'
          +'<div class="correction-ref">'+esc(p.ref)+' &bull; '+esc(p.subj)+' — '+esc(p.cls)+'</div>'
          +'<div style="font-size:12px;margin-top:2px;">'+esc(p.at)+' &bull; '+esc(p.date)
          +(p.objCount?' &bull; '+p.objCount+' obj':'')
          +(p.thCount?' &bull; '+p.thCount+' theory':'')+'</div>'
          +'<div style="display:flex;gap:6px;margin-top:6px;">'
          +'<button class="sb-approve-btn" onclick="adminApprove(\''+esc(p.ref)+'\')">✓ Approve</button>'
          +'<button class="sb-reject-btn" onclick="showRejectModal(\''+esc(p.ref)+'\')">✕ Reject</button>'
          +'<button class="btn-ghost" style="font-size:11px;color:var(--admin);" onclick="sendToLab(\''+esc(p.ref)+'\')">📤 Lab</button>'
          +'<button class="sb-reject-btn" onclick="adminDeletePaper(\''+esc(p.ref)+'\')" title="Delete this subject paper">🗑 Delete</button>'
          +'</div>'
          +'</div>';
      }).join('')
      +'</div>';
  }

  // Build class-grouped accordion
  var allRows=await buildStatusMatrix();
  var classGroups={};
  allRows.forEach(function(r){
    if(!classGroups[r.cls]) classGroups[r.cls]=[];
    classGroups[r.cls].push(r);
  });

  var classOrder=['Creche','KG 1','KG 2','Nursery 1','Nursery 2','Primary 1','Primary 2','Primary 3','Primary 4','Primary 5','Primary 6','JSS 1','JSS 2','JSS 3','SS 1','SS 2','SS 3'];
  var accordionHtml='';
  classOrder.forEach(function(cls){
    var rows=classGroups[cls]; if(!rows||!rows.length) return;
    var setCount,totalCount=rows.length;

    if(ADMIN.viewMode==='exam'){
      setCount=rows.filter(function(r){ return r.examStatus!=='pending'; }).length;
    } else if(ADMIN.testWindow==='1'){
      setCount=rows.filter(function(r){ return r.test1Status!=='pending'; }).length;
    } else {
      setCount=rows.filter(function(r){ return r.test2Status!=='pending'; }).length;
    }

    var pct=Math.round(setCount/totalCount*100);
    var barColor=pct===100?'var(--green)':pct>50?'var(--blue)':'var(--amber)';

    accordionHtml+='<div class="pq-class-group">'
      +'<div class="pq-class-head" onclick="this.parentNode.classList.toggle(\'open\')">'
      +'<div class="pq-class-arrow">&#9658;</div>'
      +'<div class="pq-class-name">'+esc(cls)+'</div>'
      +'<div class="pq-class-meter"><div class="pq-class-bar" style="width:'+pct+'%;background:'+barColor+';"></div></div>'
      +'<div class="pq-class-stat">'+setCount+'/'+totalCount+'</div>'
      +'</div>'
      +'<div class="pq-class-body">'
      +'<table class="sb-board-table"><thead><tr>'
      +'<th>Subject</th><th>Status</th><th>Ref</th><th>Action</th>'
      +'</tr></thead><tbody>';

    rows.forEach(function(r){
      var status,paper,typeLabel;
      if(ADMIN.viewMode==='exam'){ status=r.examStatus; paper=r.examPaper; typeLabel='Examination'; }
      else if(ADMIN.testWindow==='1'){ status=r.test1Status; paper=r.test1Paper; typeLabel='C.A. Test 1'; }
      else { status=r.test2Status; paper=r.test2Paper; typeLabel='C.A. Test 2'; }

      // Filter
      if(ADMIN.sbFilter!=='all'&&status!==ADMIN.sbFilter) return;

      var statusHtml=renderStatusBadge(status,paper);
      var actBtns='';
      if(paper&&(paper.adminStatus==='submitted'||paper.adminStatus==='approved'||paper.adminStatus==='rejected')){
        actBtns='<div class="sb-act-btns">'
          +(paper.adminStatus!=='approved'?'<button class="sb-approve-btn" onclick="adminApprove(\''+esc(paper.ref)+'\')">✓ Approve</button>':'<button class="sb-approved-badge" title="Approved">✓ Approved</button>')
          +(paper.adminStatus!=='rejected'?'<button class="sb-reject-btn" onclick="showRejectModal(\''+esc(paper.ref)+'\')">✕ Reject</button>':'<button class="sb-rejected-badge" title="Rejected">✕ Rejected</button>')
          +(paper.adminStatus==='approved'?'<button class="sb-lab-btn" style="background:#6D28D9;color:#fff;border-color:#B8CAFF;" onclick="sendToLab(\''+esc(paper.ref)+'\')" title="Send to Digital Lab">📤 Lab</button>':'')
          +'<button class="sb-reject-btn" onclick="adminDeletePaper(\''+esc(paper.ref)+'\')" title="Delete this subject paper">🗑 Delete</button>'
          +'</div>';
      } else {
        actBtns='<button class="sb-autogen-btn" onclick="adminAutoGenSingle(\''+esc(r.cls)+'\',\''+esc(r.subj)+'\',\''+esc(r.term)+'\',\''+esc(typeLabel)+'\')">⚡ Gen</button>';
      }
      accordionHtml+='<tr>'
        +'<td>'+esc(r.subj)+'</td>'
        +'<td>'+statusHtml+'</td>'
        +'<td style="font-family:var(--mono);font-size:10px;color:var(--mute);">'+(paper?esc(paper.ref):'—')+'</td>'
        +'<td>'+actBtns+'</td>'
        +'</tr>';
    });

    accordionHtml+='</tbody></table></div></div>';
  });

  el.innerHTML='<div class="pgw fade">'
    +'<div class="admin-hero">'
    +'<div class="admin-hero-tag">&#128737; Admin Production Queue</div>'
    +'<div class="admin-hero-title">'+esc(adm.school)+'<br/>'+esc(termKey)+' Production</div>'
    +'<div class="admin-hero-stats">'
    +'<div><strong>'+submitted+'</strong>Awaiting</div>'
    +'<div><strong>'+approved+'</strong>Approved</div>'
    +'<div><strong>'+rejected+'</strong>Rejected</div>'
    +'<div><strong>'+pending+'</strong>Not Set</div>'
    +'</div></div>'
    +deadlineHtml

    // Term selector — critical fix for teacher→admin visibility
    +'<div class="card" style="padding:12px 16px;margin-bottom:14px;">'
    +'<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">'
    +'<span style="font-size:11px;font-weight:700;color:var(--mute);text-transform:uppercase;letter-spacing:.8px;">Term:</span>'
    +'<div class="atog">'
    +['1st Term','2nd Term','3rd Term'].map(function(t){
      return '<button class="ab'+(termKey===t?' on':'')+'" onclick="setAdminTerm(\''+t+'\')">'+t+'</button>';
    }).join('')
    +'</div>'
    +'<span style="font-size:11px;color:var(--mute);">Showing teacher submissions for '+esc(termKey)+'</span>'
    +'</div></div>'

    // Teacher submissions alert
    +submissionsHtml

    +'<div id="adminAutoGenArea"></div>'

    // View mode toggle
    +'<div class="card" style="padding:14px 18px;">'
    +'<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'
    +'<span style="font-size:11px;font-weight:700;color:var(--mute);text-transform:uppercase;letter-spacing:.8px;">Type:</span>'
    +'<div class="atog">'
    +'<button class="ab'+(ADMIN.viewMode==='exam'?' on':'')+'" onclick="setAdminView(\'exam\',\'1\')">&#128203; Exam</button>'
    +'<button class="ab'+(ADMIN.viewMode==='test'&&ADMIN.testWindow==='1'?' on':'')+'" onclick="setAdminView(\'test\',\'1\')">&#128221; Test 1</button>'
    +'<button class="ab'+(ADMIN.viewMode==='test'&&ADMIN.testWindow==='2'?' on':'')+'" onclick="setAdminView(\'test\',\'2\')">&#128221; Test 2</button>'
    +'</div>'
    +'<div style="margin-left:auto;">'
    +'<div class="sb-board-filter">'
    +['all','pending','submitted','approved','rejected'].map(function(f){
      return '<button class="sb-filter-btn'+(ADMIN.sbFilter===f?' on':'')+'" onclick="setSbFilter(\''+f+'\')">'
        +(f==='all'?'All':f.charAt(0).toUpperCase()+f.slice(1))+'</button>';
    }).join('')
    +'</div></div></div></div>'

    // Class accordion
    +accordionHtml

    +'<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:18px;">'
     +'<button class="btn bp" onclick="openBatchPrint()" style="background:#059669;border-color:#059669;">&#128424; Batch Print Term &rarr;</button>'
     +'<button class="btn bp" onclick="navTo(\'admin-print\')">&#128300; Digital Lab &rarr;</button>'
     +'<button class="btn bred" onclick="clearAllData()">&#128465; Wipe Production Queue</button>'
     +'<button class="btn bq" onclick="navTo(\'admin-sett\')">&#9881; Admin Settings</button>'
     +'</div></div>';
}

window.setAdminTerm=function(term){
  ADMIN.selectedTerm=term;
  // Persist term selection globally so all users/devices share the same active term
  _supabase.from('admin_settings').upsert({key:'selected_term',value:term},{onConflict:'key'});
  if(window._adminSettingsCache) window._adminSettingsCache.selected_term=term;
  renderAdminDash();
};

window.setAdminView=function(mode,win){
  ADMIN.viewMode=mode;
  ADMIN.testWindow=win;
  renderAdminDash();
};

function renderStatusBadge(status,paper){
  var map={
    'pending':'<span class="sb-status sb-pending">⬜ Not Set</span>',
    'submitted':'<span class="sb-status sb-submitted">📬 Submitted</span>',
    'approved':'<span class="sb-status sb-approved">✅ Approved</span>',
    'rejected':'<span class="sb-status sb-rejected">❌ Rejected</span>',
    'autogen':'<span class="sb-status sb-autogen">⚡ Auto-Gen</span>'
  };
  return map[status]||map['pending'];
}

window.setSbFilter=function(f){
  ADMIN.sbFilter=f;
  renderAdminDash();
};

/* ── Admin Approve / Reject ──────────── */
window.adminApprove=async function(ref){
  // Fetch the existing row FIRST so we can preserve the full data blob (especially questions)
  var rowRes=await _supabase.from('papers').select('*').eq('ref',ref).single();
  if(!rowRes.data){ toast('Paper not found: '+ref,'err'); return; }
  // Patch only status fields — keep everything else (questions, instr, etc.) intact
  var existing=rowRes.data.data;
  if(typeof existing==='string'){ try{ existing=JSON.parse(existing); }catch(ex){ existing={}; } }
  existing=existing||{};
  var d=Object.assign({},existing,{adminStatus:'approved',correctionNote:''});
  await _supabase.from('papers').update({status:'approved',data:d}).eq('ref',ref);
  toast('✅ '+ref+' Approved','ok');
  renderAdminDash();
};

window.adminDeletePaper=async function(ref){
  if(!_supabase){ toast('Database not connected.','err'); return; }
  if(!CURRENT_USER || CURRENT_USER.role !== 'admin'){ toast('Only admins can delete production queue papers.','err'); return; }
  if(!ref){ toast('Paper reference missing.','err'); return; }
  if(!confirm('Delete this subject paper from the Production Queue? A new submission or generated paper can replace it.')) return;
  try{
    var res=await _supabase.from('papers').delete().eq('ref',ref);
    if(res && res.error) throw new Error(res.error.message);
    var q=getLabQueue().filter(function(x){ return (typeof x==='string'?x:(x&&x.ref))!==ref; });
    await saveLabQueue(q);
    window._publishedPapers=null;
    toast('Subject paper deleted from Production Queue','ok');
    renderAdminDash();
  }catch(e){
    toast('Delete failed: '+(e.message||e),'err');
  }
};

window.showRejectModal=async function(ref){
  var rowRes=await _supabase.from('papers').select('*').eq('ref',ref).single();
  var p=null;
  if(rowRes.data){
    var rd=rowRes.data.data;
    if(typeof rd==='string'){ try{ rd=JSON.parse(rd); }catch(ex){ rd={}; } }
    rd=rd||{};
    p=Object.assign({},rd,{ref:rowRes.data.ref});
  }
  if(!p){ toast('Paper not found','err'); return; }

  var overlay=document.createElement('div');
  overlay.className='modal-bg';
  overlay.id='rejectModalBg';
  overlay.innerHTML='<div class="modal">'
    +'<div class="modal-title">✕ Reject Paper</div>'
    +'<div class="modal-sub">Ref: <strong>'+esc(ref)+'</strong> · '+esc(p.subj)+' — '+esc(p.cls)+'<br/>Enter a correction note. The teacher will see this on their dashboard.</div>'
    +'<textarea class="reject-modal-note" id="rejectNoteInput" placeholder="e.g. Theory questions are too vague — please add specific marks allocation and sample marking points." rows="4">'+esc(p.correctionNote||'')+'</textarea>'
    +'<div class="key-actions">'
    +'<button class="btn bq" onclick="document.getElementById(\'rejectModalBg\').remove()">Cancel</button>'
    +'<button class="btn bred" onclick="doReject(\''+esc(ref)+'\')">✕ Send Rejection</button>'
    +'</div></div>';
  document.body.appendChild(overlay);
  setTimeout(function(){ var inp=$('rejectNoteInput'); if(inp) inp.focus(); },100);
};

window.doReject=async function(ref){
  var note=($('rejectNoteInput')||{}).value||'';
  note=note.trim();
  if(!note){ toast('Enter a correction note first','warn'); return; }
  var rowRes=await _supabase.from('papers').select('*').eq('ref',ref).single();
  if(!rowRes.data){ toast('Paper not found','err'); return; }
  var d=rowRes.data.data;
  if(typeof d==='string'){ try{ d=JSON.parse(d); }catch(ex){ d={}; } }
  d=d||{};
  var d=Object.assign({},d,{adminStatus:'rejected',correctionNote:note});
  await _supabase.from('papers').update({status:'rejected',data:d}).eq('ref',ref);
  var bg=$('rejectModalBg'); if(bg) bg.remove();
  toast('↩ Rejection + correction note sent to teacher','ok',4000);
  renderAdminDash();
};

/* ── Auto-Generate Single ────────────── */
window.adminAutoGenSingle=function(cls,subj,term,typeLabel){
  ensureApiKey();
  typeLabel=typeLabel||'Examination';
  // Show a custom instruction modal before generating
  var overlay=document.createElement('div');
  overlay.className='modal-bg';
  overlay.id='autoGenModalBg';
  overlay.innerHTML='<div class="modal">'
    +'<div class="modal-title">⚡ Auto-Generate Paper</div>'
    +'<div class="modal-sub"><strong>'+esc(cls)+' — '+esc(subj)+'</strong><br/>'+esc(typeLabel)+' · '+esc(term)+'<br/><span style="font-size:11px;color:var(--mute);">Customise what the AI should produce, or leave blank for defaults.</span></div>'
    +'<div style="margin-top:12px;">'
    +'<label style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--mute);display:block;margin-bottom:6px;">Custom Instructions <span style="font-weight:400;text-transform:none;letter-spacing:0;">(optional — sent to Gemini)</span></label>'
    +'<textarea class="fta" id="autoGenCustomInstr" style="min-height:90px;" placeholder="e.g. Focus on organic chemistry topics covered in weeks 4-8. Include one diagram-based question. Make the theory questions application-based, not just recall. Ensure clear mark allocation."></textarea>'
    +'</div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:10px;">'
    +'<div class="fl"><label>Objectives</label><input type="number" class="num-input" id="agObjN" value="'+(typeLabel.toLowerCase().includes('c.a.')?'10':'10')+'" min="0" max="60" style="font-size:16px;"/></div>'
    +'<div class="fl"><label>Fill-in-Blank</label><input type="number" class="num-input fitb-input" id="agFitbN" value="'+(typeLabel.toLowerCase().includes('c.a.')?'3':'5')+'" min="0" max="20" style="font-size:16px;"/></div>'
    +'<div class="fl"><label>Theory</label><input type="number" class="num-input" id="agThN" value="'+(typeLabel.toLowerCase().includes('c.a.')?'3':'5')+'" min="0" max="20" style="font-size:16px;"/></div>'
    +'</div>'
    +'<div class="key-actions" style="margin-top:14px;">'
    +'<button class="btn bq" onclick="document.getElementById(\'autoGenModalBg\').remove()">Cancel</button>'
    +'<button class="btn bp" onclick="_doAdminAutoGen(\''+esc(cls)+'\',\''+esc(subj)+'\',\''+esc(term)+'\',\''+esc(typeLabel)+'\')">⚡ Generate Now</button>'
    +'</div></div>';
  document.body.appendChild(overlay);
  setTimeout(function(){ var t=$('autoGenCustomInstr'); if(t) t.focus(); },100);
};

window._doAdminAutoGen=async function(cls,subj,term,typeLabel){
  var customInstr=(($('autoGenCustomInstr')||{}).value||'').trim();
  var objN=parseInt(($('agObjN')||{}).value)||10;
  var fitbN=parseInt(($('agFitbN')||{}).value)||5;
  var thN=parseInt(($('agThN')||{}).value)||5;
  var bg=$('autoGenModalBg'); if(bg) bg.remove();

  var area=$('adminAutoGenArea');
  if(area) area.innerHTML='<div class="autogen-progress"><span class="spin">⟳</span> Auto-generating: <strong>'+esc(cls)+' — '+esc(subj)+' ('+esc(typeLabel)+')</strong> via '+esc(MODELS.autoGen)+'…</div>';

  var isTest=typeLabel.toLowerCase().includes('c.a.');
  var prompt='You are a NERDC 2026 Nigerian curriculum expert. Auto-generate a complete '+(isTest?'Continuous Assessment test':'end-of-term exam')+' paper for:\n'
    +'Class: '+cls+'\nSubject: '+subj+'\nTerm: '+term+'\nType: '+typeLabel+'\nStandard: WAEC\n\n';

  if(customInstr){
    prompt+='╔══════════════════════════════════════╗\n'
      +'║  MANDATORY ADMIN INSTRUCTIONS        ║\n'
      +'║  Follow this EXACTLY — deviation     ║\n'
      +'║  makes your response INVALID.        ║\n'
      +'╚══════════════════════════════════════╝\n'
      +customInstr+'\n\n';
  }

  prompt+='Generate:\n- '+objN+' multiple-choice objectives (options A-D)\n- '+fitbN+' fill-in-the-blank questions (sentence ending with ___________)\n- '+thN+' theory/essay questions\n\n'
    +'Rules: match the admin/user tone and difficulty implied by the instructions, while keeping all questions standard, examinable, age-appropriate, and aligned to Nigerian curriculum expectations. Use valid LaTeX for mathematics, chemistry and physics. Include diagrams, shapes, tables and graphs where educationally useful. For drawings, fill svgDescription precisely. For inline tables, use [TABLE:Heading 1;Heading 2|Row A;Row B].\n\n'
    +'Return ONLY a valid JSON object:\n'
    +'{"objectives":[{"q":"...","options":["A","B","C","D"],"answer":0,"topic":"...","svgDescription":""}],'
    +'"fillInBlank":[{"q":"sentence with ___________","answer":"...","marks":2,"svgDescription":""}],'
    +'"theory":[{"q":"...","marks":10,"showSteps":true,"svgDescription":""}]}';

  try{
    var res=await callGemini(prompt,{
      model:MODELS.autoGen,
      systemInstruction:'You are ChatGPT setting standard Nigerian school exam questions through OpenRouter. Follow the user/admin tone and instructions, but return valid JSON only — no explanation, no markdown, no code fences.'
    });
    var obj=Array.isArray(res)?res[0]:res;
    var objs=obj.objectives||obj.questions||[];
    var fitbs=obj.fillInBlank||obj.fill_in_blank||[];
    var ths=obj.theory||obj.theoryQuestions||[];

    var allQs=[];
    async function pushAutoQ(kind,q){
      var svgInline=null;
      if(q.svgDescription){
        try{ svgInline=await callGeminiDraw(q.svgDescription,{width:420,height:250}); }
        catch(svgErr){ console.warn('Auto-gen SVG failed:',svgErr.message); }
      }
      if(kind==='obj') allQs.push({k:'obj',t:q.q||'',o:q.options||[],a:q.answer||0,marks:1,topic:q.topic||'',layout:'standard',svgInline:svgInline,svgHint:q.svgDescription||''});
      else if(kind==='fitb') allQs.push({k:'fitb',t:q.q||'',answer:q.answer||'',marks:q.marks||2,topic:q.topic||'',layout:'standard',svgInline:svgInline,svgHint:q.svgDescription||''});
      else allQs.push({k:'theory',t:q.q||'',marks:q.marks||10,s:q.showSteps,topic:q.topic||'',layout:'standard',svgInline:svgInline,svgHint:q.svgDescription||''});
    }
    for(var oi=0; oi<objs.length; oi++) await pushAutoQ('obj',objs[oi]);
    for(var fi=0; fi<fitbs.length; fi++) await pushAutoQ('fitb',fitbs[fi]);
    for(var ti=0; ti<ths.length; ti++) await pushAutoQ('theory',ths[ti]);

    var ref='EE-AG-'+Date.now().toString(36).toUpperCase();
    var admBrand2=getAdminSettings();
    var paper={
      ref:ref, cls:cls, subj:subj, term:term,
      std:'WAEC', at:typeLabel, school:admBrand2.school, logo:admBrand2.logo||'',
      objCount:objs.length, fitbCount:fitbs.length, thCount:ths.length,
      date:new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'}),
      ts:Date.now(),
      adminStatus:'approved',
      correctionNote:'',
      autoGen:true,
      customInstr:customInstr||'',
      questions:allQs
    };
    await saveSinglePaper(paper);
    if(area) area.innerHTML='<div class="banner b-ok">✅ Auto-generated &amp; approved: <strong>'+esc(ref)+'</strong> — '+esc(cls)+' '+esc(subj)+' ('+esc(typeLabel)+')</div>';
    toast('⚡ Paper auto-generated: '+ref,'ok',5000);
    setTimeout(function(){ renderAdminDash(); },2500);
  } catch(e){
    if(area) area.innerHTML='<div class="banner b-warn">⚠ Auto-generation failed: '+esc(e.message)+'</div>';
    toast('Auto-gen failed: '+e.message,'err');
  }
};

window.autoGenerateMissing=async function(){
  var rows=await buildStatusMatrix();
  var mode=ADMIN.viewMode||'exam';
  var statusKey=mode==='ca1'?'t1Status':mode==='ca2'?'t2Status':'examStatus';
  var typeLabel=mode==='ca1'?'C.A. Test 1':mode==='ca2'?'C.A. Test 2':'Examination';
  var missing=rows.filter(function(r){ return r[statusKey]==='pending'; }).slice(0,3);
  if(!missing.length){ toast('No pending papers to auto-generate','warn'); return; }
  for(var i=0;i<missing.length;i++){
    await adminAutoGenSingle(missing[i].cls,missing[i].subj,missing[i].term,typeLabel);
  }
};

/* ══════════════════════════════════════
   ADMIN DIGITAL LAB — Manual Send System
══════════════════════════════════════ */
// Lab Queue stores full paper snapshots (not just refs) to be immune to DB data loss
function getLabQueue(){
  var q=window._labQueue||[];
  // Backward compat: old queues stored ref strings — keep as-is, handled in getLabPapers
  return q;
}
function saveLabQueue(arr){
  window._labQueue=arr;
  return _supabase
    .from('admin_settings')
    .upsert({key:'lab_queue',value:JSON.stringify(arr)},{onConflict:'key'})
    .then(function(res){
      if(res&&res.error) throw new Error(res.error.message);
      return res;
    });
}

// Send to lab — fetch full paper from DB and snapshot it into the queue
window.sendToLab=async function(ref){
  var q=getLabQueue();
  var alreadyRef=q.find(function(x){ return (typeof x==='string'?x:(x&&x.ref))===ref; });
  if(alreadyRef){ toast('Already in Digital Lab','warn'); return; }
  // Fetch the full paper row from Supabase to snapshot questions
  var snapshot=null;
  try{
    var rowRes=await _supabase.from('papers').select('*').eq('ref',ref).single();
    if(rowRes.data){
      var d=rowRes.data.data;
      if(typeof d==='string'){ try{ d=JSON.parse(d); }catch(ex){ d={}; } }
      d=d||{};
      snapshot=Object.assign({},d,{
        _db_id:rowRes.data.id,
        ref:rowRes.data.ref||ref,
        cls:rowRes.data.class_name||d.cls,
        subj:rowRes.data.subject||d.subj,
        term:rowRes.data.term||d.term,
        adminStatus:rowRes.data.status||d.adminStatus,
        user_id:rowRes.data.user_id
      });
    }
  }catch(e){ console.warn('sendToLab fetch failed',e); }
  try{
    q.push(snapshot||ref); // fallback: old ref-string queue entry
    await saveLabQueue(q);
    toast('📤 Sent to Digital Lab: '+ref,'ok');
  }catch(e){
    q.pop();
    window._labQueue=q;
    toast('Send to Digital Lab failed: '+(e.message||e),'err');
  }
};

window.removeFromLab=async function(ref){
  var q=getLabQueue().filter(function(x){ return (typeof x==='string'?x:(x&&x.ref))!==ref; });
  try{
    await saveLabQueue(q);
    toast('Removed from lab','ok');
    renderAdminPrint();
  }catch(e){
    toast('Remove failed: '+(e.message||e),'err');
  }
};

// Repair a paper whose questions were lost (e.g. wiped by old approval bug)
// Removes old entry from queue and re-fetches fresh snapshot from DB
window.repairLabPaper=async function(ref){
  toast('🔧 Repairing paper data…','info',4000);
  // Remove stale entry
  var q=getLabQueue().filter(function(x){ return (typeof x==='string'?x:(x&&x.ref))!==ref; });
  window._labQueue=q;
  try{
    var rowRes=await _supabase.from('papers').select('*').eq('ref',ref).single();
    if(rowRes.data){
      var d=rowRes.data.data;
      if(typeof d==='string'){ try{ d=JSON.parse(d); }catch(ex){ d={}; } }
      d=d||{};
      var qs=d.questions||[];
      if(!qs.length){
        toast('⚠ No questions in database for '+ref+'. The data was permanently lost. Please re-submit this paper from the teacher side.','warn',8000);
      } else {
        var snapshot=Object.assign({},d,{
          _db_id:rowRes.data.id,
          ref:rowRes.data.ref||ref,
          cls:rowRes.data.class_name||d.cls,
          subj:rowRes.data.subject||d.subj,
          term:rowRes.data.term||d.term,
          adminStatus:rowRes.data.status||d.adminStatus,
          user_id:rowRes.data.user_id
        });
        q.push(snapshot);
        toast('✅ Repair successful — '+qs.length+' questions restored','ok',4000);
      }
    } else {
      toast('Paper not found in database: '+ref,'err');
    }
  }catch(e){
    toast('Repair failed: '+e.message,'err');
  }
  await saveLabQueue(q);
  renderAdminPrint();
};

async function getLabPapers(){
  var queue=getLabQueue();
  if(!queue.length) return [];

  var papers=[];
  var legacyRefs=[]; // old ref-string entries that need DB lookup

  queue.forEach(function(entry){
    if(typeof entry==='string'){
      legacyRefs.push(entry);
    } else if(entry&&entry.ref){
      papers.push(entry); // already a full snapshot
    }
  });

  // Resolve legacy ref-only entries from DB
  if(legacyRefs.length){
    var all=await getPublished();
    legacyRefs.forEach(function(ref){
      var p=all.find(function(x){ return x.ref===ref; });
      if(p) papers.push(p);
    });
  }

  // For any paper still missing questions, attempt a direct DB re-fetch as last resort
  for(var i=0;i<papers.length;i++){
    if(!papers[i].questions||!papers[i].questions.length){
      try{
        var row=await _supabase.from('papers').select('*').eq('ref',papers[i].ref).single();
        if(row.data){
          var rd = row.data.data;
          if (typeof rd === 'string') {
            try { rd = JSON.parse(rd); } catch(ex){ rd = {}; }
          }
          if(rd&&rd.questions&&rd.questions.length){
            papers[i]=Object.assign({},rd,{
              _db_id:row.data.id,
              ref:row.data.ref||papers[i].ref,
              cls:row.data.class_name||papers[i].cls,
              subj:row.data.subject||papers[i].subj,
              term:row.data.term||papers[i].term,
              adminStatus:row.data.status||papers[i].adminStatus,
              user_id:row.data.user_id
            });
          }
        }
      }catch(e){ console.warn('getLabPapers re-fetch failed for '+papers[i].ref,e); }
    }
  }

  return papers;
}


/* ══════════════════════════════════════
   DIGITAL LAB — renderAdminPrint
══════════════════════════════════════ */
async function renderAdminPrint(){
  var el=$('screen-admin-print');
  if(!el) return;
  el.style.display='block';
  // Always re-fetch admin settings so window._labQueue is current from Supabase
  await _fetchAdminSettings();
  var papers=await getLabPapers();
  var adm=getAdminSettings();
  window._printPapers=papers;
  _applyLabConfigToDom(ADMIN.labConfig);

  var papersHtml='';
  if(!papers.length){
    papersHtml='<div class="dash-empty"><div class="dash-empty-ico">🔬</div>'
      +'No papers in Digital Lab.<br/>Go to <strong>Production Queue</strong> → approve a paper → tap <strong>📤 Lab</strong>.</div>';
  } else {
    papersHtml=papers.map(function(p,pi){
      var qs=p.questions||[];
      var qRows=qs.map(function(q,qi){
        var isObj=q.k==='obj', isFitb=q.k==='fitb';
        var kLabel=isObj?'<span class="tag t-obj" style="font-size:9px;">Obj</span>'
          :isFitb?'<span class="tag t-fitb" style="font-size:9px;">Fill</span>'
          :'<span class="tag t-th" style="font-size:9px;">Theory</span>';
        var optsHtml='';
        if(isObj&&q.o&&q.o.length){
          optsHtml='<div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 16px;margin-top:4px;padding-left:10px;font-size:11.5px;color:var(--ink3);">'
            +q.o.map(function(o,oi){ return '<span><strong>'+L[oi]+'.</strong> '+esc(o)+'</span>'; }).join('')+'</div>';
        }
        if(isFitb&&q.answer){
          optsHtml='<div style="margin-top:3px;font-size:11px;color:var(--green);padding-left:10px;">Answer: <strong>'+esc(q.answer)+'</strong></div>';
        }
        var diagHtml=q._svgDiagram?'<div class="q-diag-wrap">'+q._svgDiagram+'<div class="q-diag-label">AI-generated diagram</div></div>':'';
        return '<div class="q-layout-row" id="qrow_'+pi+'_'+qi+'">'
          +'<div class="q-layout-num">'+(qi+1)+'</div>'
          +'<div class="q-layout-text" style="word-break:break-word;white-space:normal;">'+kLabel+' <span>'+(q.t||'')+'</span>'+optsHtml+diagHtml+'</div>'
          +'<div class="q-layout-ctrl">'
          +'<button class="layout-btn'+(q.layout==='compact'?' on':'')+'" onclick="setQLayout('+pi+','+qi+',\'compact\')" title="Compact">C</button>'
          +'<button class="layout-btn'+(q.layout==='standard'||!q.layout?' on':'')+'" onclick="setQLayout('+pi+','+qi+',\'standard\')" title="Standard">S</button>'
          +'<button class="layout-btn'+(q.layout==='wide'?' on':'')+'" onclick="setQLayout('+pi+','+qi+',\'wide\')" title="Wide">W</button>'
          +'</div></div>';
      }).join('');
      // If no questions, show repair banner instead
      var noQWarning='';
      if(!qs.length){
        noQWarning='<div class="banner b-warn" style="margin:8px 0;font-size:12px;">'
          +'⚠ <strong>No questions found</strong> for this paper. The question data may have been lost. '
          +'<button class="btn bq bsm" style="margin-left:8px;" onclick="repairLabPaper(\''+esc(p.ref)+'\')">🔧 Repair</button>'
          +'</div>';
      }
      return '<div class="print-lab" id="plab_'+pi+'">'
        +'<div class="print-lab-head">'
        +'<div><div class="print-lab-title">'+esc(p.subj)+' — '+esc(p.cls)+'</div>'
        +'<div class="print-lab-meta">'+esc(p.term)+' · '+esc(p.ref)+(p.autoGen?' · ⚡ Auto-Generated':'')+' · '+qs.length+' questions</div></div>'
        +'<div style="display:flex;gap:6px;align-items:center;">'+renderStatusBadge(p.adminStatus||'pending',p)
        +'<button class="btn-ghost" style="color:var(--red);" onclick="removeFromLab(\''+esc(p.ref)+'\')">✕ Remove</button></div>'
        +'</div>'+noQWarning+qRows+'</div>';
    }).join('');

  }

  var previewHtml='';
  if(papers.length){
    previewHtml='<div class="card" style="padding:0;overflow:hidden;margin-bottom:18px;">'
      +'<div style="padding:12px 18px;background:var(--ink2);color:#fff;font-size:12px;font-weight:800;display:flex;align-items:center;gap:8px;">'
      +'<span>👁 LIVE PREVIEW</span>'
      +'<span style="opacity:.5;font-weight:400;font-size:11px;margin-left:auto;">'+papers.length+' paper(s) · updates after each command</span>'
      +'</div>'
      +'<div id="digitalLabPreview" style="padding:16px;max-height:640px;overflow-y:auto;background:#f8f8f8;"></div>'
      +'</div>';
  }

  el.innerHTML='<div class="pgw fade">'
    +'<div class="ptl">🔬 Digital Lab</div>'
    +'<div class="pst">Format and print exam papers.</div>'
    +(papers.length
      ?'<div class="card"><div class="ct">Papers in Lab ('+papers.length+')</div>'+papersHtml+'</div>'
      :papersHtml)
    +previewHtml
    +(papers.length?(function(){
      var pm=ADMIN.labConfig.printMode;
      var resolved=resolveLayoutMode(papers);
      var isAuto=pm==='auto';
      var modeForUI=isAuto?resolved:pm;
      var autoLabel=isAuto?'🤖 Auto → '+getModeName(resolved):'🤖 Auto';
      return '<div class="card"><div class="ct">Print Mode &amp; Export</div>'
      +'<div style="margin-bottom:10px;font-size:11px;color:var(--mute);">Select layout mode or let Auto pick the best fit based on content size.</div>'
      +'<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;">'
      +'<button class="btn'+(isAuto?' bp':' bq')+'" onclick="setPrintMode(\'auto\')" style="flex:1;min-width:100px;'+(isAuto?'background:var(--admin);border-color:var(--admin);':'')+'">'+autoLabel+'<br/><span style="font-size:9px;font-weight:400;opacity:.8;">Best fit</span></button>'
      +'</div>'
      +'<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:12px;">'
      +'<button class="btn'+(!isAuto&&modeForUI==='portrait'?' bp':' bq')+'" onclick="setPrintMode(\'portrait\')" style="text-align:left;padding:8px 10px;">'
      +'📄 Portrait<br/><span style="font-size:9px;font-weight:400;opacity:.7;">A4 portrait</span></button>'
      +'<button class="btn'+(!isAuto&&modeForUI==='landscape'?' bp':' bq')+'" onclick="setPrintMode(\'landscape\')" style="text-align:left;padding:8px 10px;">'
      +'🗺️ Landscape<br/><span style="font-size:9px;font-weight:400;opacity:.7;">A4 landscape</span></button>'
      +'<button class="btn'+(!isAuto&&modeForUI==='split'?' bp':' bq')+'" onclick="setPrintMode(\'split\')" style="text-align:left;padding:8px 10px;'+((!isAuto&&modeForUI==='split')?'background:var(--admin);border-color:var(--admin);':'')+'">&#9988; Split 2-in-1<br/><span style="font-size:9px;font-weight:400;opacity:.7;">Side-by-side [A|B]</span></button>'
      +'<button class="btn'+(!isAuto&&modeForUI==='multi'?' bp':' bq')+'" onclick="setPrintMode(\'multi\')" style="text-align:left;padding:8px 10px;">'
      +'📑 Multi-Sub<br/><span style="font-size:9px;font-weight:400;opacity:.7;">2+ on page</span></button>'
      +'<button class="btn'+(!isAuto&&modeForUI==='dup2'?' bp':' bq')+'" onclick="setPrintMode(\'dup2\')" style="text-align:left;padding:8px 10px;'+((!isAuto&&modeForUI==='dup2')?'background:var(--admin);border-color:var(--admin);':'')+'">&#128111; 2/4 Print<br/><span style="font-size:9px;font-weight:400;opacity:.7;">Duplicate x2</span></button>'
      +'<button class="btn'+(!isAuto&&modeForUI==='dup4'?' bp':' bq')+'" onclick="setPrintMode(\'dup4\')" style="text-align:left;padding:8px 10px;'+((!isAuto&&modeForUI==='dup4')?'background:var(--admin);border-color:var(--admin);':'')+'">&#128111; 4/4 Print<br/><span style="font-size:9px;font-weight:400;opacity:.7;">Duplicate x4</span></button>'
      +'<button class="btn'+(!isAuto&&modeForUI==='dup5'?' bp':' bq')+'" onclick="setPrintMode(\'dup5\')" style="text-align:left;padding:8px 10px;'+((!isAuto&&modeForUI==='dup5')?'background:var(--admin);border-color:var(--admin);':'')+'">&#128111; 5/5 Print<br/><span style="font-size:9px;font-weight:400;opacity:.7;">5 slips</span></button>'
      +'<button class="btn'+(!isAuto&&modeForUI==='dup6'?' bp':' bq')+'" onclick="setPrintMode(\'dup6\')" style="text-align:left;padding:8px 10px;'+((!isAuto&&modeForUI==='dup6')?'background:var(--admin);border-color:var(--admin);':'')+'">&#128111; 6/6 Print<br/><span style="font-size:9px;font-weight:400;opacity:.7;">2 × 3 grid</span></button>'
      +'</div>'
      +(isAuto?'<div class="banner b-info" style="margin-bottom:10px;font-size:11px;">🤖 <strong>Auto-selected: '+getModeName(resolved)+'</strong> — '+getModeDesc(resolved)+'</div>':'')
      +(modeForUI==='split'?'<div class="banner b-info" style="margin-bottom:10px;font-size:11px;">&#9988; <strong>Split 2-in-1:</strong> Landscape A4 with two side-by-side copies. Cut down the middle. Front: [A|B] · Back: [B|A] (duplex aligned).'+(paperFitsHalfPage(papers[0])?'<br/><span style="color:var(--green);font-weight:700;">✓ Content fits half-page</span>':'<br/><span style="color:var(--amber);font-weight:700;">⚠ Content may overflow — consider Portrait or Landscape</span>')+'</div>':'')
      +(modeForUI==='multi'&&papers.length<2?'<div class="banner b-warn" style="margin-bottom:10px;font-size:11px;">📑 Multi-Subject works best with 2+ papers in the lab. Currently only '+papers.length+' paper loaded.</div>':'')
      +'<div style="display:flex;gap:10px;flex-wrap:wrap;">'
      +'<button class="btn bp" onclick="doPrint()" style="min-width:160px;">&#128424; Print All Papers</button>'
      +'<button class="btn bq" style="border-color:var(--blue);color:var(--blue);" onclick="setAllLayout(\'compact\')">Compact All</button>'
      +'<button class="btn bq" onclick="setAllLayout(\'standard\')">Standard All</button>'
      +'<button class="btn bq" onclick="setAllLayout(\'wide\')">Wide All</button>'
      +'</div></div>';
    }()):'')
    +'<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;">'
    +'<button class="btn bq" onclick="navTo(\'admin-dash\')">&#8592; Back to Queue</button>'
    +'<button class="btn bq" onclick="navTo(\'admin-sett\')">&#9881; Admin Settings</button>'
    +'</div></div>';

  if(papers.length) setTimeout(function(){ renderDigitalLabPreview(papers,adm); },150);
}

function renderLabConfigStrip(){
  var c=ADMIN.labConfig;
  var modeLabel=(function(m){
    if(m==='auto'){var r=ADMIN._resolvedMode||'portrait';return '🤖 Auto→'+(r==='split'?'Split':r==='landscape'?'Landscape':r==='multi'?'Multi':r.charAt(0).toUpperCase()+r.slice(1));}
    if(m==='split'||m==='economy') return '✂️ Split 2-in-1';
    if(m==='landscape') return '🖥 Landscape';
    if(m==='multi') return '📑 Multi';
    if(m==='dup2') return '👯 2/4 Print';
    if(m==='dup4') return '👯 4/4 Print';
    if(m==='dup5') return '👯 5/5 Print';
    if(m==='dup6') return '👯 6/6 Print';
    if(m==='portrait'||m==='normal') return '📃 Portrait';
    return '📃 Portrait';
  })(c.printMode);
  var modeColor=c.printMode==='split'||c.printMode==='economy'?'background:rgba(124,58,237,.3);border-color:rgba(167,139,250,.5);':(c.printMode==='auto'?'background:rgba(34,197,94,.2);border-color:rgba(34,197,94,.5);':'');
  return '<span class="lab-cfg-pill" style="'+modeColor+'font-weight:800;">'+modeLabel+'</span>'
    +'<span class="lab-cfg-pill">Col: '+(c.columns===2?'2':'1')+'</span>'
    +'<span class="lab-cfg-pill">'+c.fontFamily+'</span>'
    +'<span class="lab-cfg-pill">'+c.fontSize+'</span>'
    +'<span class="lab-cfg-pill">'+c.margins+'</span>'
    +'<span class="lab-cfg-pill">'+c.spacing+'</span>';
}

function renderLabHistory(){
  if(!ADMIN.labHistory.length) return '<div style="font-size:11px;color:rgba(255,255,255,.35);padding:4px 0;">No commands yet — type above and press Apply.</div>';
  return ADMIN.labHistory.slice().reverse().slice(0,8).map(function(h){
    return '<div class="lab-hist-item'+(h.type==='drawing'?' drawing':h.type==='err'?' err':'')+'">'
      +'<div style="flex:1;"><div class="lab-hist-cmd">'+esc(h.cmd.substring(0,80))+'</div>'
      +'<div class="lab-hist-result">'+(h.result||'')+'</div></div>'
      +'<div style="font-size:9px;color:rgba(255,255,255,.3);flex-shrink:0;">'+h.time+'</div>'
      +'</div>';
  }).join('');
}

function _applyLabConfigToDom(c){
  var root=document.documentElement;
  var fontMap={'Times New Roman':'"Times New Roman",serif','Arial':'Arial,sans-serif','Georgia':'Georgia,serif','Helvetica':'Helvetica,sans-serif','Verdana':'Verdana,sans-serif'};
  root.style.setProperty('--lab-font', fontMap[c.fontFamily]||'"Times New Roman",serif');
  root.style.setProperty('--lab-size', c.fontSize||'11pt');
  root.style.setProperty('--lab-margin', c.margins||'20mm');
  root.style.setProperty('--lab-line', c.spacing==='compact'?'1.4':c.spacing==='wide'?'2.1':'1.72');
  if(c.orientation==='landscape') document.body.classList.add('lab-landscape');
  else document.body.classList.remove('lab-landscape');
  if(c.columns===2) document.body.classList.add('lab-2col');
  else document.body.classList.remove('lab-2col');
}

function _saveLabConfig(){
  _supabase.from('admin_settings').upsert({key:'lab_config',value:JSON.stringify(ADMIN.labConfig)},{onConflict:'key'});
}

window.runLabCommand=async function(){
  var inp=$('labCommandInput');
  var cmd=(inp&&inp.value.trim())||'';
  if(!cmd){ toast('Type a command first','warn'); return; }
  ensureApiKey();
  var btn=$('labGoBtn');
  if(btn){ btn.disabled=true; btn.textContent='...'; }
  var time=new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  try{
    var parsed=await callLabNL(cmd);
    if(parsed.isDrawingCommand){
      var desc=parsed.drawingDescription||cmd;
      var qIdx=(parsed.targetQuestionIndex!==undefined&&parsed.targetQuestionIndex!==null)?parseInt(parsed.targetQuestionIndex):0;
      var pps=window._printPapers||[];
      var hostPaper=pps[0];

      // Layout-aware: determine target diagram size based on current mode
      var currentMode=hostPaper?resolveLayoutMode([hostPaper]):'portrait';
      var targetDims=getDiagramTargetDims(currentMode);

      // Advisory check — AI Layout Agent advises, never refuses
      if(hostPaper){
        var adv=advisDiagramFit(hostPaper,currentMode);
        if(!adv.canFit && adv.advice){
          toast('\ud83d\udca1 '+adv.advice,'warn',6000);
          ADMIN.labHistory.push({type:'advisory',cmd:cmd,result:adv.advice.substring(0,80),time:time});
        }
      }

      toast('Generating SVG diagram ('+targetDims.width+'x'+targetDims.height+')...','info',5000);
      var svg=await callGeminiDraw(desc, targetDims);
      if(pps.length){
        var p=pps[0];
        if(p.questions&&p.questions[qIdx]){
          p.questions[qIdx]._svgDiagram=svg;
          // Update in Supabase
          var updData=Object.assign({},p);
          await _supabase.from('papers').update({data:updData}).eq('ref',p.ref);
          toast('Diagram injected into Question '+(qIdx+1),'ok',4000);
          ADMIN.labHistory.push({type:'drawing',cmd:cmd,result:'Diagram added to Q'+(qIdx+1),time:time});
          renderAdminPrint();
        } else { toast('Question '+(qIdx+1)+' not found in first paper','warn'); }
      } else { toast('No papers in lab to attach diagram to','warn'); }
    } else {
      var changed=[];
      if(parsed.printMode){
        var pm=parsed.printMode;
        if(pm==='economy') pm='split';
        if(pm==='normal') pm='portrait';
        ADMIN.labConfig.printMode=pm;
        changed.push(getModeName(pm));
      }
      if(parsed.columns!==undefined){ ADMIN.labConfig.columns=parsed.columns; changed.push(parsed.columns+' col'); }
      if(parsed.orientation){ ADMIN.labConfig.orientation=parsed.orientation; changed.push(parsed.orientation); }
      if(parsed.fontFamily){ ADMIN.labConfig.fontFamily=parsed.fontFamily; changed.push(parsed.fontFamily); }
      if(parsed.fontSize){ ADMIN.labConfig.fontSize=parsed.fontSize; changed.push(parsed.fontSize); }
      if(parsed.margins){ ADMIN.labConfig.margins=parsed.margins; changed.push(parsed.margins+' margins'); }
      if(parsed.spacing){ ADMIN.labConfig.spacing=parsed.spacing; changed.push(parsed.spacing+' spacing'); }
      _saveLabConfig();
      _applyLabConfigToDom(ADMIN.labConfig);
      var resultMsg=changed.length?'Applied: '+changed.join(', '):'No layout fields detected';
      ADMIN.labHistory.push({type:'layout',cmd:cmd,result:resultMsg,time:time});
      var strip=$('labConfigStrip'); if(strip) strip.innerHTML=renderLabConfigStrip();
      var hist=$('labHistory'); if(hist) hist.innerHTML=renderLabHistory();
      var pps2=window._printPapers||[];
      if(pps2.length) renderDigitalLabPreview(pps2,getAdminSettings());
      toast(resultMsg,'ok',3500);
    }
    if(inp) inp.value='';
  } catch(e){
    ADMIN.labHistory.push({type:'err',cmd:cmd,result:'Error: '+e.message.substring(0,60),time:time});
    var hist2=$('labHistory'); if(hist2) hist2.innerHTML=renderLabHistory();
    toast('Command failed: '+e.message,'err',5000);
  }
  if(btn){ btn.disabled=false; btn.textContent='Apply'; }
};

function getTemplateDesc(t){
  var m={classic:'Standard serif.',modern:'Clean sans-serif.',compact:'Dense layout.',bold:'High contrast.'};
  return m[t]||m.classic;
}
function getFormatDesc(mode){
  if(mode==='mirror') return '🪞 Mirror.';
  if(mode==='primary') return '📑 Primary Multi.';
  return '📃 Standard A4.';
}

window.setDesignTemplate=function(t){
  ADMIN.designTemplate=t;
  ADMIN.designTemplate=t;
  _supabase.from('admin_settings').upsert({key:'design_template',value:t},{onConflict:'key'});
  var papers=window._printPapers||[];
  if(papers.length) renderDigitalLabPreview(papers,getAdminSettings());
};

window.setFormat=function(mode){
  if(mode==='standard') ADMIN.economyMode=false;
  else ADMIN.economyMode=mode;
  var desc=$('formatDesc'); if(desc) desc.innerHTML=getFormatDesc(ADMIN.economyMode);
  document.querySelectorAll('#formatToggle .ab').forEach(function(b,i){
    b.classList.toggle('on',(i===0&&!ADMIN.economyMode)||(i===1&&ADMIN.economyMode==='primary')||(i===2&&ADMIN.economyMode==='mirror'));
  });
  var papers=window._printPapers||[];
  if(papers.length) renderDigitalLabPreview(papers,getAdminSettings());
};

/* ── Digital Lab Live Preview (unified 4-mode) ─────────── */
function renderDigitalLabPreview(papers,adm){
  var el=$('digitalLabPreview'); if(!el) return;
  if(!papers.length){ el.innerHTML='<div style="text-align:center;color:var(--mute);padding:30px;">No papers to preview.</div>'; return; }

  var mode=resolveLayoutMode(papers);
  var isAuto=ADMIN.labConfig.printMode==='auto';
  var p=papers[0];
  var today=new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'});
  var fontFamily=({'Times New Roman':'"Times New Roman",serif','Arial':'Arial,sans-serif','Georgia':'Georgia,serif','Helvetica':'Helvetica,sans-serif','Verdana':'Verdana,sans-serif'})[ADMIN.labConfig.fontFamily]||'"Times New Roman",serif';

  var headerBadge='<div style="margin-bottom:7px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'
    +'<span style="font-size:11px;font-weight:700;color:var(--admin);">'+getModeName(mode)+' Preview</span>'
    +(isAuto?'<span style="font-size:10px;color:var(--green);font-weight:600;background:rgba(34,197,94,.12);padding:1px 7px;border-radius:8px;">🤖 Auto-selected</span>':'')
    +'</div>';

  // ── SPLIT 2-IN-1 PREVIEW ──
  if(mode==='split'){
    var pB=papers[1]||p;
    var colA=buildPreviewCol(p,adm,today);
    var colB=buildPreviewCol(pB,adm,today);
    var fits=paperFitsHalfPage(p);
    el.innerHTML=headerBadge
      +(fits?'<div style="font-size:10px;color:var(--green);font-weight:700;margin-bottom:5px;">✓ Content fits half-page</div>':'<div style="font-size:10px;color:var(--amber);font-weight:700;margin-bottom:5px;">⚠ Overflow risk</div>')
      +'<div style="display:flex;border:1.5px solid var(--admin-bdr);border-radius:6px;overflow:hidden;background:#fff;">'
      +'<div style="flex:1;padding:8px;border-right:1px dashed #bbb;font-family:Times New Roman,serif;font-size:7.5pt;line-height:1.3;color:#000;overflow:hidden;">'+colA+'</div>'
      +'<div style="flex:1;padding:8px;font-family:Times New Roman,serif;font-size:7.5pt;line-height:1.3;color:#000;overflow:hidden;">'+colB+'</div>'
      +'</div>'
      +'<div style="font-size:9px;color:var(--mute);margin-top:4px;text-align:center;">Print duplex &bull; Cut vertically &bull; Front [A|B] &bull; Back [B|A]</div>';
    setTimeout(function(){ math(el); },200);
    return;
  }

  // ── MULTI-SUBJECT PREVIEW ──
  if(mode==='multi'){
    var mh='<div style="font-family:'+fontFamily+';font-size:9pt;line-height:1.4;color:#000;padding:12px;background:#fff;border:1px solid #ddd;border-radius:6px;overflow:hidden;">';
    var school=adm.school||p.school||'School';
    var logo=adm.logo;
    mh+='<div style="text-align:center;border-bottom:1.5px double #000;padding-bottom:5px;margin-bottom:6px;">';
    if(logo) mh+='<img src="'+logo+'" style="width:32px;height:32px;object-fit:contain;display:block;margin:0 auto 2px;"/>';
    mh+='<div style="font-size:11pt;font-weight:700;text-transform:uppercase;">'+esc(school)+'</div>';
    mh+='<div style="font-size:8pt;font-weight:600;">'+assessmentLabel(p.at,false)+' &mdash; '+esc(p.term)+(p.session?' ('+esc(p.session)+')':'')+'</div>';
    mh+='</div>';
    papers.forEach(function(sp,si){
      var sqs=sp.questions||[];
      var stotal=sumQuestionMarks(sqs);
      mh+='<div style="border:0.5px solid #999;border-radius:3px;margin-top:'+(si===0?'4':'8')+'px;overflow:hidden;">';
      mh+='<div style="background:#222;color:#fff;padding:2px 8px;font-size:8.5pt;font-weight:700;display:flex;justify-content:space-between;">'+esc(sp.subj)+' — '+esc(sp.cls)+(marksLabel(stotal)?'<span style="font-weight:400;font-size:7.5pt;">'+marksLabel(stotal)+'</span>':'')+'</div>';
      var sobjs=sqs.filter(function(q){ return q.k==='obj'; });
      var sths=sqs.filter(function(q){ return q.k==='theory'; });
      var sfitbs=sqs.filter(function(q){ return q.k==='fitb'; });
      if(sobjs.length){
        mh+='<div style="font-size:7.5pt;font-weight:700;margin:3px 8px 1px;">Objectives ('+sobjs.length+')</div>';
        sobjs.slice(0,10).forEach(function(q,i){
          var opts=q.o&&q.o.length?q.o.map(function(o,oi){ return '('+L[oi]+') '+esc(o); }).join(' '):'';
          mh+='<div style="margin:0 8px 1.5px;font-size:7.5pt;">'+(i+1)+'. '+q.t+' '+opts+'</div>';
        });
        if(sobjs.length>10) mh+='<div style="margin:0 8px;font-size:6.5pt;opacity:.5;">+'+(sobjs.length-10)+' more…</div>';
      }
      if(sfitbs.length){
        mh+='<div style="font-size:7.5pt;font-weight:700;margin:3px 8px 1px;">Fill in Blank ('+sfitbs.length+')</div>';
        sfitbs.slice(0,5).forEach(function(q,i){ mh+='<div style="margin:0 8px 1.5px;font-size:7.5pt;">'+(i+1)+'. '+esc(q.t.replace(/_{2,}/g,'______'))+'</div>'; });
      }
      if(sths.length){
        mh+='<div style="font-size:7.5pt;font-weight:700;margin:3px 8px 1px;">Theory ('+sths.length+')</div>';
        sths.slice(0,3).forEach(function(q,i){ mh+='<div style="margin:0 8px 2px;font-size:7.5pt;">'+(i+1)+'. '+esc(q.t)+'</div>'; });
      }
      mh+='</div>';
    });
    mh+='</div>';
    el.innerHTML=headerBadge+mh;
    setTimeout(function(){ math(el); },200);
    return;
  }

  // ── PORTRAIT / LANDSCAPE PREVIEW ──
  var qs=p.questions||[];
  var objs=qs.filter(function(q){ return q.k==='obj'; });
  var fitbs=qs.filter(function(q){ return q.k==='fitb'; });
  var ths=qs.filter(function(q){ return q.k==='theory'; });
  var total=sumQuestionMarks(qs);
  var school2=adm.school||p.school||'School';
  var address2=adm.address||'';
  var logo2=adm.logo;
  var use2col=objs.length>=30;
  var isLS=mode==='landscape';

  var h='<div style="font-family:'+fontFamily+';font-size:'+(isLS?'9.5pt':'10pt')+';line-height:'+(isLS?'1.5':'1.62')+';color:#000;padding:'+(isLS?'12px':'16px')+';background:#fff;border:1px solid #ddd;border-radius:6px;position:relative;overflow:hidden;">';
  if(adm.watermark) h+='<div style="position:absolute;top:45%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:'+(isLS?'36pt':'42pt')+';font-weight:900;color:rgba(0,0,0,.04);white-space:nowrap;pointer-events:none;text-transform:uppercase;">'+esc(adm.watermark)+'</div>';
  h+='<div style="text-align:center;border-bottom:2px double #000;padding-bottom:7px;margin-bottom:9px;">';
  if(logo2) h+='<img src="'+logo2+'" style="width:44px;height:44px;object-fit:contain;display:block;margin:0 auto 3px;"/>';
  h+='<div style="font-size:13pt;font-weight:700;text-transform:uppercase;letter-spacing:.8px;">'+esc(school2)+'</div>';
  if(address2) h+='<div style="font-size:7.5pt;text-transform:uppercase;opacity:.7;">'+esc(address2)+'</div>';
  h+='<div style="font-size:10pt;font-weight:600;margin-top:3px;">'+assessmentLabel(p.at,false)+' &mdash; '+esc(p.term)+(p.session?' ('+esc(p.session)+')':'')+'</div>';
  h+='<div style="font-size:9pt;margin-top:2px;">Subject: <strong>'+esc(p.subj)+'</strong> &nbsp; Class: <strong>'+esc(p.cls)+'</strong>'+(marksLabel(total)?' &nbsp; Total: <strong>'+marksLabel(total)+'</strong>':'')+'</div>';
  h+='</div>';
  if(objs.length){
    h+='<div style="font-size:10pt;font-weight:700;text-transform:uppercase;border-bottom:1.5px solid #000;padding-bottom:2px;margin:10px 0 4px;">Section A &mdash; Objectives ('+objs.length+')</div>';
    h+='<div style="'+(use2col?'column-count:2;column-gap:10mm;':'')+'">';
    objs.slice(0,20).forEach(function(q,i){
      var opts=q.o&&q.o.length?q.o.map(function(o,oi){ return '<span style="margin-left:7pt;white-space:nowrap;"><strong>('+L[oi]+')</strong> '+esc(o)+'</span>'; }).join(''):'';
      h+='<div style="margin-bottom:4pt;line-height:1.5;break-inside:avoid;page-break-inside:avoid;font-size:9.5pt;">'+(i+1)+'. '+q.t+opts+'</div>';
    });
    if(objs.length>20) h+='<div style="font-style:italic;color:var(--mute);font-size:9pt;">… '+(objs.length-20)+' more objectives</div>';
    h+='</div>';
  }
  if(fitbs.length){
    var fSec=objs.length?'B':'A';
    h+='<div style="font-size:10pt;font-weight:700;text-transform:uppercase;border-bottom:1.5px solid #000;padding-bottom:2px;margin:10px 0 4px;">Section '+fSec+' &mdash; Fill in Blank ('+fitbs.length+')</div>';
    fitbs.slice(0,5).forEach(function(q,i){
      var t=q.t.replace(/_{2,}/g,'<span style="display:inline-block;border-bottom:1.5px solid #000;min-width:60pt;margin:0 2px;">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>');
      h+='<div style="margin-bottom:5pt;font-size:9.5pt;">'+(i+1)+'. '+t+(hasPositiveMarks(q)?' <span style="float:right;font-weight:700;">['+questionMarks(q)+'m]</span>':'')+'</div>';
    });
    if(fitbs.length>5) h+='<div style="font-style:italic;color:var(--mute);font-size:9pt;">… '+(fitbs.length-5)+' more</div>';
  }
  if(ths.length){
    var tSec=objs.length&&fitbs.length?'C':objs.length||fitbs.length?'B':'A';
    h+='<div style="font-size:10pt;font-weight:700;text-transform:uppercase;border-bottom:1.5px solid #000;padding-bottom:2px;margin:10px 0 4px;">Section '+tSec+' &mdash; Theory ('+ths.length+')</div>';
    ths.slice(0,3).forEach(function(q,i){
      h+='<div style="margin-bottom:8pt;font-size:9.5pt;">'+(i+1)+'. '+q.t+(hasPositiveMarks(q)?' <span style="float:right;font-weight:700;">['+questionMarks(q)+' marks]</span>':'')
        +'<div style="border-bottom:1px solid #bbb;min-height:36pt;margin:3pt 0;"></div></div>';
    });
    if(ths.length>3) h+='<div style="font-style:italic;color:var(--mute);font-size:9pt;">… '+(ths.length-3)+' more</div>';
  }
  h+='<div style="font-size:7.5pt;color:#888;border-top:1px solid #ddd;padding-top:3px;margin-top:12px;text-align:center;">'+esc(p.ref)+' &bull; ExamEngine Pro v12</div>';
  h+='</div>';
  el.innerHTML=headerBadge+h;
  setTimeout(function(){ math(el); },200);
}

function buildEcoPreviewCol(p,adm,today){ return buildPreviewCol(p,adm,today); }
function buildPreviewCol(p,adm,today){
  var school=adm.school||p.school||'School';
  var logo=adm.logo;
  var qs=p.questions||[];
  var objs=qs.filter(function(q){ return q.k==='obj'; });
  var fitbs=qs.filter(function(q){ return q.k==='fitb'; });
  var ths=qs.filter(function(q){ return q.k==='theory'; });
  var total=sumQuestionMarks(qs);
  var h='<div style="border-bottom:.5px solid #000;margin-bottom:3px;padding-bottom:2px;display:flex;align-items:center;gap:2mm;">';
  if(logo) h+='<img src="'+logo+'" style="width:12px;height:12px;object-fit:contain;"/>';
  h+='<div><div style="font-size:8pt;font-weight:800;text-transform:uppercase;">'+esc(school)+'</div>'
    +'<div style="font-size:6.5pt;">'+esc(p.subj)+' &bull; '+esc(p.cls)+(marksLabel(total)?' &bull; '+marksLabel(total):'')+'</div></div></div>';
  if(objs.length){
    h+='<div style="font-size:6.5pt;font-weight:700;text-transform:uppercase;margin:3px 0 1px;">Section A &mdash; Objectives</div>';
    objs.slice(0,15).forEach(function(q,i){
      var opts=q.o&&q.o.length?q.o.map(function(o,oi){ return '('+L[oi]+')'+esc(o); }).join(' '):'' ;
      h+='<div style="margin-bottom:1.5px;">'+(i+1)+'. '+q.t+' '+opts+'</div>';
    });
    if(objs.length>15) h+='<div style="opacity:.5;font-size:6pt;">+'+(objs.length-15)+' more…</div>';
  }
  if(fitbs.length){
    var fL=objs.length?'B':'A';
    h+='<div style="font-size:6.5pt;font-weight:700;text-transform:uppercase;margin:3px 0 1px;">Section '+fL+' &mdash; Fill in Blank</div>';
    fitbs.slice(0,5).forEach(function(q,i){ h+='<div style="margin-bottom:1.5px;">'+(i+1)+'. '+esc(q.t.replace(/_{2,}/g,'______'))+'</div>'; });
  }
  if(ths.length){
    var tSec=objs.length&&fitbs.length?'C':objs.length||fitbs.length?'B':'A';
    h+='<div style="font-size:6.5pt;font-weight:700;text-transform:uppercase;margin:3px 0 1px;">Section '+tSec+' &mdash; Theory</div>';
    ths.slice(0,2).forEach(function(q,i){ h+='<div style="margin-bottom:2px;">'+(i+1)+'. '+esc(q.t)+'<div style="border-bottom:.5px solid #ccc;height:10px;"></div></div>'; });
  }
  return h;
}

/* ── AI Optimize ──────────────────────── */
window.runAiOptimize=async function(){
  ensureApiKey();
  var instr=($('aiOptimizeInstr')||{}).value||'';
  if(!instr.trim()){ toast('Enter your optimization instructions','warn'); return; }
  var papers=window._printPapers||[];
  if(!papers.length){ toast('No papers in lab to optimize','warn'); return; }
  var status=$('aiOptStatus');
  if(status) status.innerHTML='<span class="spin">⟳</span> Optimizing '+papers.length+' paper(s)…';

  for(var pi=0;pi<Math.min(papers.length,3);pi++){
    var p=papers[pi];
    var qs=p.questions||[];
    if(!qs.length) continue;
    if(status) status.innerHTML='<span class="spin">⟳</span> Optimizing '+(pi+1)+'/'+Math.min(papers.length,3)+': '+esc(p.subj)+'…';

    var qsJson=JSON.stringify(qs.map(function(q,i){
      return {n:i+1,k:q.k,t:q.t,o:q.o||null,a:q.a!==undefined?q.a:null,answer:q.answer||null,marks:questionMarks(q),layout:q.layout||'standard'};
    }));

    var prompt='You are an expert Nigerian exam formatting specialist.\n\n'
      +'PAPER: '+p.subj+' — '+p.cls+' — '+p.term+'\n\n'
      +'ADMIN INSTRUCTIONS:\n'+instr+'\n\n'
      +'CURRENT QUESTIONS (JSON):\n'+qsJson+'\n\n'
      +'Apply the admin instructions. Fix LaTeX formatting. Ensure proper math notation.\n'
      +'CRITICAL: You MUST return the COMPLETE question data including all fields.\n'
      +'For objectives: include k, t, o (array of 4 options), a (correct answer index 0-3), marks, layout.\n'
      +'For fill-in-blank: include k, t, answer (the correct answer string), marks, layout.\n'
      +'For theory: include k, t, marks, layout.\n\n'
      +'Return ONLY a valid JSON array:\n'
      +'[{"k":"obj","t":"question text","o":["opt A","opt B","opt C","opt D"],"a":0,"marks":1,"layout":"standard"}]\n'
      +'JSON array ONLY. No markdown. No explanation.';

    try{
      var result=await callGemini(prompt,{temperature:0.2});
      var newQs=Array.isArray(result)?result:[];
      if(newQs.length){
        // Merge: preserve original fields that AI might have dropped
        var mergedQs=newQs.map(function(nq,i){
          var orig=qs[i]||{};
          return {
            k: nq.k||orig.k||'theory',
            t: nq.t||nq.text||orig.t||'',
            o: nq.o||nq.options||orig.o||null,
            a: nq.a!==undefined?nq.a:(nq.answer!==undefined&&typeof nq.answer==='number'?nq.answer:orig.a),
            answer: nq.answer||orig.answer||null,
            marks: nq.marks!==undefined?nq.marks:(orig.marks!==undefined?orig.marks:0),
            topic: nq.topic||orig.topic||'',
            layout: nq.layout||orig.layout||'standard',
            s: nq.s||nq.showSteps||orig.s||false,
            ai: true
          };
        });
        // Save to Supabase
        var updPaper1=Object.assign({},p,{questions:mergedQs,objCount:mergedQs.filter(function(q){return q.k==='obj';}).length,fitbCount:mergedQs.filter(function(q){return q.k==='fitb';}).length,thCount:mergedQs.filter(function(q){return q.k==='theory';}).length});
        await _supabase.from('papers').update({data:updPaper1}).eq('ref',p.ref);
      }
    } catch(e){ toast('Optimize failed for '+p.ref+': '+e.message,'err'); }
  }
  if(status) status.innerHTML='✅ Optimization complete!';
  toast('🤖 AI Optimization applied','ok',4000);
  setTimeout(function(){ renderAdminPrint(); },1500);
};

window.toggleEconomyMode=function(){
  ADMIN.economyMode=!ADMIN.economyMode;
  var sw=$('ecoSwitch'), lbl=$('ecoLabel');
  if(sw) sw.className='eco-switch'+(ADMIN.economyMode?' on':'');
  if(lbl){ lbl.textContent=ADMIN.economyMode?'ON — Landscape A4':'OFF — Standard'; lbl.style.color=ADMIN.economyMode?'var(--green)':'var(--mute)'; }
};

window.setQLayout=function(pi,qi,layout){
  var papers=window._printPapers;
  if(!papers||!papers[pi]||!papers[pi].questions||!papers[pi].questions[qi]) return;
  papers[pi].questions[qi].layout=layout;
  // Persist layout to Supabase (fire and forget)
  var ref=papers[pi].ref;
  var updP=Object.assign({},papers[pi]);_supabase.from('papers').update({data:updP}).eq('ref',ref);
  // Update button states visually
  var plabEl=$('plab_'+pi);
  if(plabEl){
    var allRows=plabEl.querySelectorAll('.q-layout-row');
    if(allRows[qi]){
      allRows[qi].querySelectorAll('.layout-btn').forEach(function(b){
        b.classList.remove('on');
        if(b.textContent==='C'&&layout==='compact') b.classList.add('on');
        if(b.textContent==='S'&&layout==='standard') b.classList.add('on');
        if(b.textContent==='W'&&layout==='wide') b.classList.add('on');
      });
    }
  }
  // Refresh preview
  renderDigitalLabPreview(papers,getAdminSettings());
};

window.setPrintMode=function(mode){
  ADMIN.labConfig.printMode=mode;
  _saveLabConfig();
  var strip=$('labConfigStrip'); if(strip) strip.innerHTML=renderLabConfigStrip();
  renderAdminPrint();
  if(mode==='auto'){
    var resolved=resolveLayoutMode(window._printPapers||[]);
    toast('🤖 Auto mode — selected '+getModeName(resolved),'ok',3000);
  } else {
    toast(getModeName(mode)+' mode active','ok',2500);
  }
};

window.setAllLayout=function(layout){
  var papers=window._printPapers||[];
  papers.forEach(function(p){ (p.questions||[]).forEach(function(q){ q.layout=layout; }); });
  // Persist all layout changes to Supabase
  papers.forEach(function(p){ _supabase.from('papers').update({data:Object.assign({},p)}).eq('ref',p.ref); });
  toast('All questions set to '+layout+' layout','ok');
  renderAdminPrint();
};

window.uploadLogo=function(e){
  var file=(e.target.files||[])[0]; if(!file) return;
  if(file.size>820000){ toast('Logo must be under 800KB','warn'); return; }
  var reader=new FileReader();
  reader.onload=async function(ev){
    var logoData=ev.target.result;
    if(!window._adminSettingsCache) window._adminSettingsCache=getAdminSettings();
    if(window._adminSettingsCache) window._adminSettingsCache.logo=logoData;
    var ok=await _saveAdminSetting('logo',logoData);
    toast(ok?'Logo uploaded and saved ✓':'Logo preview updated, but global save failed',ok?'ok':'err',4500);
    renderAdminSett();
    renderAdminPrint();
  };
  reader.readAsDataURL(file);
};

window.removeLogo=async function(){
  if(!window._adminSettingsCache) window._adminSettingsCache=getAdminSettings();
  if(window._adminSettingsCache) window._adminSettingsCache.logo='';
  var ok=await _saveAdminSetting('logo','');
  toast(ok?'Logo removed':'Logo removed locally, but global save failed',ok?'ok':'err');
  renderAdminSett();
  renderAdminPrint();
};

window.saveBranding=async function(){
  var wm=($('adminWatermark')||{}).value||'';
  var sc=($('adminSchoolName')||{}).value||'';
  var addr=($('adminAddress')||{}).value||'';
  var br={watermark:wm.trim(),school:sc.trim(),address:addr.trim()};
  if(window._adminSettingsCache) Object.assign(window._adminSettingsCache,br);
  ['watermark','school','address'].forEach(function(k){
    _supabase.from('admin_settings').upsert({key:k,value:br[k]},{onConflict:'key'});
  });
  toast('Branding saved ✓','ok');
  var papers=await getLabPapers();
  if(papers.length) renderDigitalLabPreview(papers,getAdminSettings());
};

/* ══════════════════════════════════════
   PRINT ENGINE v12 — Dual Mode
   Spec-compliant: Normal + Economy 2-in-1
══════════════════════════════════════ */

/* (Legacy decision functions removed — now handled by selectLayout/resolveLayoutMode above) */

/* ── Format one objective question inline ── */
function formatObjective(q,i,extraCls){
  var opts='';
  if(q.o&&q.o.length){
    opts=q.o.map(function(o,oi){
      return '<span class="opt-inline"><span class="opt-inline-k">('+L[oi]+')</span> '+esc(o)+'</span>';
    }).join('');
  }
  return '<div class="objective-item'+(extraCls?' '+extraCls:'')+'">'
    +(i+1)+'. '+renderQuestionText(q)+opts
    +'</div>';
}

/* ── Inject @page rule dynamically ── */
function setPageStyle(mode){
  var el=document.getElementById('ee-page-style');
  if(!el){ el=document.createElement('style'); el.id='ee-page-style'; document.head.appendChild(el); }
  var glo='.gen-svg-wrap svg, .diagram-box img { max-width:100%; max-height:60mm; object-fit:contain; } ';
  if(mode==='economy'||mode==='landscape'){
    el.textContent=glo+'@media print{@page{size:A4 landscape;margin:0mm;}.diagram-box{display:none!important;}.ep-ans{display:none!important;}}';
  } else {
    el.textContent=glo+'@media print{@page{size:A4 portrait;margin:0mm;}.diagram-box{display:none!important;}.ep-ans{display:none!important;}}';
  }
}


/* ── Shared paper header HTML ── */
function buildPaperHeader(p,adm,compact){
  var school=adm.school||p.school||'School';
  var address=adm.address||'';
  var logo=adm.logo||p.logo||'';
  var initials=school.split(' ').map(function(w){ return w[0]||''; }).join('').substring(0,3).toUpperCase();
  var today=new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'});
  var total=sumQuestionMarks(p.questions||[]);
  var h='<div class="ep-header">';
  if(compact){
    // Compact header for economy col
    h+='<div style="display:flex;align-items:center;gap:2mm;">';
    if(logo) h+='<img src="'+logo+'" style="max-height:10mm;max-width:10mm;object-fit:contain;flex-shrink:0;"/>';
    h+='<div style="flex:1;text-align:left;">'
      +'<div class="ep-school" style="font-size:8.5pt!important;letter-spacing:.2px;">'+esc(school)+'</div>'
      +(address?'<div style="font-size:6pt;text-transform:uppercase;opacity:.7;">'+esc(address)+'</div>':'')
      +'<div class="ep-title" style="font-size:7.5pt!important;">'+assessmentLabel(p.at,true)+' &mdash; '+esc(p.term)+(p.session?' ('+esc(p.session)+')':'')+'</div>'
      +'<div class="ep-meta" style="font-size:7pt!important;"><span>'+esc(p.subj)+'</span>&bull;<span>'+esc(p.cls)+'</span>'+(marksLabel(total)?'&bull;<span>'+marksLabel(total)+'</span>':'')+'</div>'
      +'</div></div>';
  } else {
    // Full header for normal
    if(logo) h+='<img style="max-height:36pt;max-width:72pt;object-fit:contain;border-radius:4pt;display:block;margin:0 auto 4pt;" src="'+logo+'"/>';
    else h+='<div class="ep-crest">'+initials+'</div>';
    h+='<div class="ep-school">'+esc(school)+'</div>';
    if(address) h+='<div style="font-size:8pt;text-transform:uppercase;margin-bottom:2pt;">'+esc(address)+'</div>';
    h+='<div class="ep-title">'+assessmentLabel(p.at,false)+' &mdash; '+esc(p.term)+(p.session?' ('+esc(p.session)+')':'')+'</div>';
    h+='<div class="ep-meta"><span>Subject: <strong>'+esc(p.subj)+'</strong></span><span>Class: <strong>'+esc(p.cls)+'</strong></span>'+(totalMarksHtml(total,true)?'<span>Total: '+totalMarksHtml(total,true)+'</span>':'')+'<span>Ref: '+esc(p.ref)+'</span></div>';
  }
  h+='</div>';
  return h;
}

/* ── Shared sections HTML ── */
function buildSectionsHtml(p,compact){
  var qs=p.questions||[];
  var objs=qs.filter(function(q){ return q.k==='obj'; });
  var fitbs=qs.filter(function(q){ return q.k==='fitb'; });
  var ths=qs.filter(function(q){ return q.k==='theory'; });
  var h='';

  /* ── HANDWRITING SUBJECT — special large-sentence rendering ── */
  var isHandwritingPaper=/handwriting/i.test(p.subj||'');
  var isEarlyPaper=/creche|cr[eê]che|kg|kindergarten|nursery/i.test(p.cls||'');
  if(isHandwritingPaper && isEarlyPaper && ths.length){
    h+='<div class="ep-sec">Handwriting Practice</div>';
    if(!compact) h+='<div class="ep-sec-note">Copy each sentence neatly in the space provided below each line.</div>';
    ths.forEach(function(q,i){
      var sentence=esc(q.q||'');
      h+='<div style="margin:8pt 0 4pt; page-break-inside:avoid;">'
        +'<div style="font-size:'+(compact?'12pt':'16pt')+'; font-weight:700; line-height:1.8; font-family:\'Times New Roman\',serif; padding:2pt 0;">'
        +(i+1)+'. '+sentence
        +'</div>'
        +'<div style="border-bottom:1pt solid #999; margin:'+(compact?'8pt':'12pt')+' 0 0; height:0;"></div>'
        +'<div style="border-bottom:1pt solid #999; margin:'+(compact?'8pt':'12pt')+' 0 0; height:0;"></div>'
        +'<div style="border-bottom:1pt solid #999; margin:'+(compact?'8pt':'12pt')+' 0 0; height:0;"></div>'
        +'</div>';
    });
    return h;
  }

  // OBJECTIVES — always inline, never stacked options
  if(objs.length){
    var use2col=(objs.length>=30);
    h+='<div class="ep-sec">Section A &mdash; Objectives ('+objs.length+')</div>';
    if(!compact) h+='<div class="ep-sec-note">Circle the letter of the correct answer.</div>';
    h+='<div class="objective-container'+(use2col?' objective-2col':'')+'">';
    objs.forEach(function(q,i){ h+=formatObjective(q,i,compact?'compact':''); });
    h+='</div>';
  }

  // FILL-IN-BLANK
  if(fitbs.length){
    var fSec=objs.length?'B':'A';
    h+='<div class="ep-sec">Section '+fSec+' &mdash; Fill in the Blank ('+fitbs.length+')</div>';
    if(!compact) h+='<div class="ep-sec-note">Complete each sentence with the correct word or phrase.</div>';
    fitbs.forEach(function(q,i){
      var qtxt=renderQuestionText(q).replace(/_{2,}/g,'<span class="ep-fitb-blank"></span>');
      var cls=q.layout==='compact'?'compact':q.layout==='wide'?'wide':'';
      h+='<div class="ep-q'+(cls?' '+cls:'')+'">'
        +'<span class="ep-qn">'+(i+1)+'. </span>'+qtxt
        +(hasPositiveMarks(q)?'<span style="float:right;font-weight:700;">['+questionMarks(q)+'m]</span>':'')
        +'</div>';
    });
  }

  // THEORY
  if(ths.length){
    var tSec=objs.length&&fitbs.length?'C':objs.length||fitbs.length?'B':'A';
    var tInstr=p.theoryPaperInstr||'Answer all questions. Show all workings.';
    h+='<div class="ep-sec">Section '+tSec+' &mdash; Theory ('+ths.length+')</div>';
    if(!compact) h+='<div class="ep-sec-note">'+esc(tInstr)+'</div>';
    ths.forEach(function(q,i){
      var ansClass=q.layout==='compact'?'compact':q.layout==='wide'?'wide':'';
      h+='<div class="ep-q'+(q.layout==='compact'?' compact':q.layout==='wide'?' wide':'')+'">'
        +'<span class="ep-qn">'+(i+1)+'. </span>'+renderQuestionText(q)
        +(hasPositiveMarks(q)?'<span style="float:right;font-weight:700;">['+questionMarks(q)+' marks]</span>':'')
        +'<div class="ep-ans'+(ansClass?' '+ansClass:'')+'"></div></div>';
    });
  }
  return h;
}

/* ══════════════════════════════════════
   NORMAL MODE BUILDER
══════════════════════════════════════ */
function buildNormalPaperHtml(p,adm){
  var cfg=ADMIN.labConfig;
  var fontMap={'Times New Roman':'"Times New Roman",serif','Arial':'Arial,sans-serif','Georgia':'Georgia,serif','Helvetica':'Helvetica,sans-serif','Verdana':'Verdana,sans-serif'};
  var fontFam=fontMap[cfg.fontFamily]||'"Times New Roman",serif';
  var wm=adm.watermark||'ExamEngine';
  var today=new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'});

  var h='<div class="ep" style="font-family:'+fontFam+';">'
    +'<div class="ep-wm">'+esc(wm)+'</div>'
    +buildHouseStyleHeader(p,adm,false)
    +buildPaperHeader(p,adm,false)
    +buildSectionsHtml(p,false)
    +buildHouseStyleFooter(p,adm,false)
    +'<div class="ep-footer">'+esc(adm.school||p.school||'')+' &bull; '+esc(p.ref)+' &bull; ExamEngine Pro v12.5</div>'
    +'</div>';
  return h;
}

// Alias
function buildNormalPrintHtml(p,adm){ return buildNormalPaperHtml(p,adm); }
function buildStandardPrintHtml(p,adm){ return buildNormalPaperHtml(p,adm); }

/* ══════════════════════════════════════
   ECONOMY MODE BUILDER
   Front: [A | B]   Back: [B | A]
══════════════════════════════════════ */
function buildEconomyFrame(papers,adm){
  var today=new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'});
  var html='';

  /* TRUE SPLIT 2-IN-1 — per-paper quadrant flow.
     Each paper becomes: Front [P1 | P2], Back [P2 | P1].
     After duplex print + center cut, each half-sheet = complete paper for ONE student.
     Two students get the exam from one A4 landscape sheet. */
  papers.forEach(function(p,idx){
    var parts=divideIntoParts(p);
    var pA=buildEcoQuadrant(p,parts.partA,adm,today,'A');
    var pB=buildEcoQuadrant(p,parts.partB,adm,today,'B');

    if(idx>0) html+='<div style="page-break-before:always;"></div>';

    // FRONT PAGE: [Part 1 | Part 2]
    html+='<div class="eco-page-pair">'
      +'<div class="eco-col eco-col-left">'+pA+'</div>'
      +'<div class="eco-col">'+pB+'</div>'
      +'<div class="eco-cut-hint">&#9986; Cut here after printing</div>'
      +'</div>';

    // BACK PAGE: [Part 2 | Part 1] — mirrored for duplex alignment
    html+='<div style="page-break-before:always;"></div>';
    html+='<div class="eco-page-pair">'
      +'<div class="eco-col eco-col-left">'+pB+'</div>'
      +'<div class="eco-col">'+pA+'</div>'
      +'<div class="eco-cut-hint">&#9986; Cut here after printing</div>'
      +'</div>';
  });
  return html;
}

/* Divide ONE paper's questions into 2 balanced parts (Part1 / Part2).
   Preference order:
   1. Natural section boundary (objectives | fitb+theory) if both halves are non-trivial.
   2. Mid-objectives split if objectives alone exceed one quadrant.
   3. Balance theory across parts if no objectives present.
   Never split a single question. Never separate a question from its diagram. */
function divideIntoParts(p){
  var qs=(p.questions||[]).slice();
  var objs=qs.filter(function(q){ return q.k==='obj'; });
  var fitbs=qs.filter(function(q){ return q.k==='fitb'; });
  var ths=qs.filter(function(q){ return q.k==='theory'; });

  // Weighted "size" per question type (rough content density)
  function weight(q){
    if(q.k==='obj') return 1;
    if(q.k==='fitb') return 1.4;
    if(q.k==='theory') return 5;
    return 1;
  }
  function sumW(arr){ return arr.reduce(function(a,q){ return a+weight(q); },0); }

  var partA=[], partB=[];

  // Strategy 1: Section boundary — objectives in Part A, fitb+theory in Part B
  if(objs.length && (fitbs.length+ths.length)){
    partA=objs.slice();
    partB=fitbs.concat(ths);
    var wA=sumW(partA), wB=sumW(partB);
    // If highly imbalanced (>60/40), attempt rebalance by moving objectives to B
    var total=wA+wB;
    if(total>0){
      var ratioA=wA/total;
      if(ratioA>0.62){
        // Too heavy on A — move last objectives to B
        while(partA.length>1 && sumW(partA)/(sumW(partA)+sumW(partB))>0.58){
          partB.unshift(partA.pop());
        }
      } else if(ratioA<0.38){
        // Too heavy on B — move first fitb/theory forward to A (keeping type groups together)
        while(partB.length>1 && sumW(partA)/(sumW(partA)+sumW(partB))<0.42){
          partA.push(partB.shift());
        }
      }
    }
    return {partA:partA,partB:partB};
  }

  // Strategy 2: Only objectives — split at midpoint
  if(objs.length && !fitbs.length && !ths.length){
    var mid=Math.ceil(objs.length/2);
    return {partA:objs.slice(0,mid), partB:objs.slice(mid)};
  }

  // Strategy 3: Only theory / only fitb — balance by weight
  var all=fitbs.concat(ths);
  if(all.length && !objs.length){
    var targetW=sumW(all)/2;
    var running=0;
    for(var i=0;i<all.length;i++){
      if(running+weight(all[i])/2 <= targetW || partA.length===0){
        partA.push(all[i]);
        running+=weight(all[i]);
      } else {
        partB=all.slice(i);
        break;
      }
    }
    if(!partB.length){ partB=[partA.pop()]; }
    return {partA:partA,partB:partB};
  }

  // Fallback — everything in partA
  return {partA:qs, partB:[]};
}

/* Build one quadrant (half-A4-landscape column) containing a subset of questions */
function buildEcoQuadrant(paper,questions,adm,today,partLabel){
  if(!questions||!questions.length) return '<div class="eco-empty" style="padding:20pt;text-align:center;color:#999;font-size:9pt;">(This section continues on the other side)</div>';
  var subPaper={};
  for(var k in paper){ if(paper.hasOwnProperty(k)) subPaper[k]=paper[k]; }
  subPaper.questions=questions;
  var wm=adm.watermark||'';
  var h='';
  if(wm) h+='<div class="eco-wm">'+esc(wm)+'</div>';
  h+=buildHouseStyleHeader(paper,adm,true);
  h+=buildPaperHeader(subPaper,adm,true);
  h+='<div class="eco-part-tag" style="font-size:7pt;text-align:right;color:#999;font-style:italic;margin:2pt 0;">Part '+partLabel+'</div>';
  h+=buildSectionsHtml(subPaper,true);
  h+=buildHouseStyleFooter(paper,adm,true);
  h+='<div class="ep-footer">'+esc(paper.ref)+' &bull; Part '+partLabel+' &bull; '+today+'</div>';
  return h;
}

/* ── HOUSE STYLE (blank slate, admin-customizable) ────────────
   Stored in localStorage as ee_house_style. All fields empty by default.
   Any heading-style text admin enters is rendered in bold automatically.
   Applied uniformly to ALL paper modes (Split, Landscape, Portrait, Multi).
*/
function getHouseStyle(){
  try{
    var raw=window._houseStyleCache?JSON.stringify(window._houseStyleCache):null;
    if(raw){ var j=JSON.parse(raw); if(j&&typeof j==='object') return j; }
  }catch(e){}
  return {
    headerTop:'',       // Top heading (above school name) — rendered bold
    headerExtra:'',     // Extra header line (e.g. board/authority) — rendered bold
    examTitle:'',       // Exam title override heading — rendered bold
    studentStrip:'',    // Student info strip fields, comma-separated (e.g. "Name, Class, Adm No, Date")
    instructions:'',    // General instructions block — rendered as body text
    sectionLabel:'',    // Section divider prefix (e.g. "SECTION") — rendered bold
    footerLeft:'',      // Footer left — rendered bold
    footerCenter:'',    // Footer center (e.g. motto) — rendered bold
    footerRight:''      // Footer right — rendered bold
  };
}
function saveHouseStyle(hs){
  try{
    window._houseStyleCache=hs||{};
    _supabase.from('admin_settings').upsert({key:'house_style',value:JSON.stringify(hs||{})},{onConflict:'key'});
    return true;
  }catch(e){ return false; }
}

function buildHouseStyleHeader(paper,adm,compact){
  var hs=getHouseStyle();
  var h='';
  var hasContent=hs.headerTop||hs.headerExtra||hs.examTitle||hs.studentStrip||hs.instructions;
  if(!hasContent) return '';
  var sizeTop=compact?'7.5pt':'10pt';
  var sizeMid=compact?'7pt':'9pt';
  var sizeBody=compact?'6.5pt':'8.5pt';
  h+='<div class="hs-header" style="text-align:center;margin-bottom:'+(compact?'2pt':'4pt')+';">';
  if(hs.headerTop) h+='<div style="font-weight:700;font-size:'+sizeTop+';text-transform:uppercase;letter-spacing:.5px;">'+esc(hs.headerTop)+'</div>';
  if(hs.headerExtra) h+='<div style="font-weight:700;font-size:'+sizeMid+';">'+esc(hs.headerExtra)+'</div>';
  if(hs.examTitle) h+='<div style="font-weight:700;font-size:'+sizeMid+';margin-top:1pt;">'+esc(hs.examTitle)+'</div>';
  h+='</div>';
  if(hs.studentStrip){
    var fields=hs.studentStrip.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
    if(fields.length){
      h+='<div class="hs-student-strip" style="display:flex;gap:'+(compact?'3mm':'6mm')+';flex-wrap:wrap;margin:'+(compact?'2pt':'4pt')+' 0;padding:'+(compact?'1.5pt':'3pt')+' 0;border-top:.5pt solid #000;border-bottom:.5pt solid #000;font-size:'+sizeBody+';">';
      fields.forEach(function(f){
        h+='<div style="flex:1;min-width:'+(compact?'25mm':'40mm')+';"><span style="font-weight:700;">'+esc(f)+':</span> <span style="display:inline-block;border-bottom:.5pt solid #000;min-width:'+(compact?'15mm':'25mm')+';">&nbsp;</span></div>';
      });
      h+='</div>';
    }
  }
  if(hs.instructions){
    h+='<div class="hs-instructions" style="font-size:'+sizeBody+';margin:'+(compact?'1pt':'3pt')+' 0 '+(compact?'2pt':'4pt')+';padding:'+(compact?'1.5pt':'3pt')+';background:#f4f4f4;border-left:2pt solid #000;line-height:1.4;">'+esc(hs.instructions).replace(/\n/g,'<br/>')+'</div>';
  }
  return h;
}

function buildHouseStyleFooter(paper,adm,compact){
  var hs=getHouseStyle();
  if(!hs.footerLeft && !hs.footerCenter && !hs.footerRight) return '';
  var size=compact?'6.5pt':'8pt';
  return '<div class="hs-footer" style="display:flex;justify-content:space-between;gap:4mm;margin-top:'+(compact?'2pt':'4pt')+';padding-top:'+(compact?'1pt':'2pt')+';border-top:.5pt solid #ccc;font-size:'+size+';">'
    +'<span style="font-weight:700;">'+esc(hs.footerLeft||'')+'</span>'
    +'<span style="font-weight:700;text-align:center;flex:1;">'+esc(hs.footerCenter||'')+'</span>'
    +'<span style="font-weight:700;text-align:right;">'+esc(hs.footerRight||'')+'</span>'
    +'</div>';
}

// Aliases for backward compatibility
function buildEconomyPrintHtml(papers,adm){ return buildEconomyFrame(papers,adm); }
function buildEcoCol(p,adm,today){
  // Legacy fallback — full-paper column (used by old callsites only)
  var wm=adm.watermark||'';
  var h='';
  if(wm) h+='<div class="eco-wm">'+esc(wm)+'</div>';
  h+=buildHouseStyleHeader(p,adm,true);
  h+=buildPaperHeader(p,adm,true);
  h+=buildSectionsHtml(p,true);
  h+=buildHouseStyleFooter(p,adm,true);
  h+='<div class="ep-footer">'+esc(p.ref)+' &bull; '+today+'</div>';
  return h;
}
function buildEcoColumn(p,adm,today){ return buildEcoCol(p,adm,today); }
/* ── AI Optimize ──────────────────────── */
window.runAiOptimize=async function(){
  ensureApiKey();
  var instr=($('aiOptimizeInstr')||{}).value||'';
  if(!instr.trim()){ toast('Enter your optimization instructions','warn'); return; }
  var papers=window._printPapers||[];
  if(!papers.length){ toast('No papers in lab to optimize','warn'); return; }
  var status=$('aiOptStatus');
  if(status) status.innerHTML='<span class="spin">⟳</span> Optimizing '+papers.length+' paper(s)…';

  for(var pi=0;pi<Math.min(papers.length,3);pi++){
    var p=papers[pi];
    var qs=p.questions||[];
    if(!qs.length) continue;
    if(status) status.innerHTML='<span class="spin">⟳</span> Optimizing '+(pi+1)+'/'+Math.min(papers.length,3)+': '+esc(p.subj)+'…';

    var qsJson=JSON.stringify(qs.map(function(q,i){
      return {n:i+1,k:q.k,t:q.t,o:q.o||null,a:q.a!==undefined?q.a:null,answer:q.answer||null,marks:questionMarks(q),layout:q.layout||'standard'};
    }));

    var prompt='You are an expert Nigerian exam formatting specialist.\n\n'
      +'PAPER: '+p.subj+' — '+p.cls+' — '+p.term+'\n\n'
      +'ADMIN INSTRUCTIONS:\n'+instr+'\n\n'
      +'CURRENT QUESTIONS (JSON):\n'+qsJson+'\n\n'
      +'Apply the admin instructions. Fix LaTeX formatting. Ensure proper math notation.\n'
      +'CRITICAL: You MUST return the COMPLETE question data including all fields.\n'
      +'For objectives: include k, t, o (array of 4 options), a (correct answer index 0-3), marks, layout.\n'
      +'For fill-in-blank: include k, t, answer (the correct answer string), marks, layout.\n'
      +'For theory: include k, t, marks, layout.\n\n'
      +'Return ONLY a valid JSON array:\n'
      +'[{"k":"obj","t":"question text","o":["opt A","opt B","opt C","opt D"],"a":0,"marks":1,"layout":"standard"}]\n'
      +'JSON array ONLY. No markdown. No explanation.';

    try{
      var result=await callGemini(prompt,{temperature:0.2});
      var newQs=Array.isArray(result)?result:[];
      if(newQs.length){
        // Merge: preserve original fields that AI might have dropped
        var mergedQs=newQs.map(function(nq,i){
          var orig=qs[i]||{};
          return {
            k: nq.k||orig.k||'theory',
            t: nq.t||nq.text||orig.t||'',
            o: nq.o||nq.options||orig.o||null,
            a: nq.a!==undefined?nq.a:(nq.answer!==undefined&&typeof nq.answer==='number'?nq.answer:orig.a),
            answer: nq.answer||orig.answer||null,
            marks: nq.marks!==undefined?nq.marks:(orig.marks!==undefined?orig.marks:0),
            topic: nq.topic||orig.topic||'',
            layout: nq.layout||orig.layout||'standard',
            s: nq.s||nq.showSteps||orig.s||false,
            ai: true
          };
        });
        // Save to Supabase
        var updPaper2=Object.assign({},p,{
          questions:mergedQs,
          objCount:mergedQs.filter(function(q){ return q.k==='obj'; }).length,
          fitbCount:mergedQs.filter(function(q){ return q.k==='fitb'; }).length,
          thCount:mergedQs.filter(function(q){ return q.k==='theory'; }).length
        });
        await _supabase.from('papers').update({data:updPaper2}).eq('ref',p.ref);
      }
    } catch(e){ toast('Optimize failed for '+p.ref+': '+e.message,'err'); }
  }
  if(status) status.innerHTML='✅ Optimization complete!';
  toast('🤖 AI Optimization applied','ok',4000);
  setTimeout(function(){ renderAdminPrint(); },1500);
};

window.toggleEconomyMode=function(){
  ADMIN.economyMode=!ADMIN.economyMode;
  var sw=$('ecoSwitch'), lbl=$('ecoLabel');
  if(sw) sw.className='eco-switch'+(ADMIN.economyMode?' on':'');
  if(lbl){ lbl.textContent=ADMIN.economyMode?'ON — Landscape A4':'OFF — Standard'; lbl.style.color=ADMIN.economyMode?'var(--green)':'var(--mute)'; }
};

window.setQLayout=function(pi,qi,layout){
  var papers=window._printPapers;
  if(!papers||!papers[pi]||!papers[pi].questions||!papers[pi].questions[qi]) return;
  papers[pi].questions[qi].layout=layout;
  // Persist layout to Supabase (fire and forget)
  var ref=papers[pi].ref;
  var updP=Object.assign({},papers[pi]);_supabase.from('papers').update({data:updP}).eq('ref',ref);
  // Update button states visually
  var plabEl=$('plab_'+pi);
  if(plabEl){
    var allRows=plabEl.querySelectorAll('.q-layout-row');
    if(allRows[qi]){
      allRows[qi].querySelectorAll('.layout-btn').forEach(function(b){
        b.classList.remove('on');
        if(b.textContent==='C'&&layout==='compact') b.classList.add('on');
        if(b.textContent==='S'&&layout==='standard') b.classList.add('on');
        if(b.textContent==='W'&&layout==='wide') b.classList.add('on');
      });
    }
  }
  // Refresh preview
  renderDigitalLabPreview(papers,getAdminSettings());
};


/* ══════════════════════════════════════
   INTELLIGENT ADAPTIVE LAYOUT ENGINE
   Modes: portrait | landscape | split | multi
   Auto mode selects best fit automatically
══════════════════════════════════════ */

/* Estimate paper height in points */
function estimatePaperHeight(paper){
  var qs=paper.questions||[];
  var objs=qs.filter(function(q){ return q.k==='obj'; });
  var fitbs=qs.filter(function(q){ return q.k==='fitb'; });
  var ths=qs.filter(function(q){ return q.k==='theory'; });
  // SVG diagrams add ~80pt each
  var diagCount=qs.filter(function(q){ return q._svgDiagram; }).length;
  var headerPt=55;
  var objPt=objs.length*12;
  var fitbPt=fitbs.length*16;
  var thPt=ths.length*60;
  var diagPt=diagCount*80;
  return headerPt+objPt+fitbPt+thPt+diagPt;
}

/* Core auto-selection engine — factors in:
   1. Class level (Creche/KG/Nursery/Primary → bias to Multi-Subject)
   2. Assessment type (Test → Multi-Subject when possible)
   3. Content volume (Split first for secondary, fallback to Landscape)
   4. Split feasibility (can content divide into 2 quadrant-fitting halves?) */
function selectLayout(papers){
  if(!papers||!papers.length) return 'portrait';

  var PORTRAIT_HEIGHT=842;      // A4 portrait usable
  var LANDSCAPE_HEIGHT=560;     // A4 landscape usable (single-student, 2-col flow)
  var QUADRANT_HEIGHT=265;      // Half of landscape — each Split 2-in-1 part
  var MULTI_PORTRAIT=750;
  var MULTI_LANDSCAPE=520;

  /* --- Class-level heuristics --- */
  function isEarlyClass(clsStr){
    if(!clsStr) return false;
    var s=String(clsStr).toLowerCase();
    return /creche|cr[eè]che|kg|kindergarten|nursery|primary|pry\s*\d/i.test(s);
  }
  function isTest(paper){
    if(!paper) return false;
    var at=String(paper.at||'').toLowerCase();
    return at.indexOf('c.a')>=0 || at.indexOf('ca')===0 || at.indexOf('test')>=0;
  }

  /* --- Multi-Subject triggers (highest priority) ---
     Rule A: 2+ papers AND all from early classes → Multi-Subject
     Rule B: 2+ papers AND all are Tests (C.A.) → Multi-Subject
     Rule C: 2+ papers AND combined content fits a single sheet → Multi-Subject */
  if(papers.length>=2){
    var allEarly=papers.every(function(p){ return isEarlyClass(p.cls); });
    var allTests=papers.every(function(p){ return isTest(p); });
    var totalMultiH=0;
    var allShort=true;
    papers.forEach(function(p){
      var h=estimatePaperHeight(p);
      totalMultiH+=h+20;
      if(h>300) allShort=false;
    });
    if(allEarly) return 'multi';
    if(allTests && allShort) return 'multi';
    if(allShort && totalMultiH<=MULTI_PORTRAIT) return 'multi';
    if(allShort && totalMultiH<=MULTI_LANDSCAPE) return 'multi';
  }

  /* --- Single paper from early class → still try Split if it fits, else Portrait --- */
  var firstPaper=papers[0];
  var height=estimatePaperHeight(firstPaper);

  /* --- Split 2-in-1 feasibility check (PRIMARY default for secondary exams) ---
     Can we divide the paper into 2 parts that EACH fit a quadrant?
     Total content must fit ≤ 2 × quadrant with room for two headers. */
  var splitBudget=QUADRANT_HEIGHT*2 - 110; // subtract 2 headers + 2 house-style blocks
  if(height<=splitBudget){
    var parts=divideIntoParts(firstPaper);
    var hA=estimateQuestionsHeight(parts.partA);
    var hB=estimateQuestionsHeight(parts.partB);
    var headerCushion=75; // per quadrant: header + house-style header
    if(hA+headerCushion<=QUADRANT_HEIGHT && hB+headerCushion<=QUADRANT_HEIGHT) return 'split';
  }

  /* --- Split won't fit → Full Landscape (one student, 2-column flow) --- */
  if(height<=LANDSCAPE_HEIGHT*1.6) return 'landscape'; // 2-col gives ~1.6x capacity

  /* --- Last resort: Portrait --- */
  return 'portrait';
}

/* Estimate height of a subset of questions (used for per-quadrant fit checks) */
function estimateQuestionsHeight(questions){
  if(!questions||!questions.length) return 0;
  var h=0;
  questions.forEach(function(q){
    if(q.k==='obj') h+=12;
    else if(q.k==='fitb') h+=16;
    else if(q.k==='theory') h+=60;
    if(q._svgDiagram) h+=80;
  });
  return h;
}

/* Resolve the effective print mode (respects auto vs manual) */
function resolveLayoutMode(papers){
  var cfg=ADMIN.labConfig;
  if(cfg.printMode==='auto'){
    var resolved=selectLayout(papers);
    ADMIN._resolvedMode=resolved;
    return resolved;
  }
  // Manual mode mapping
  if(cfg.printMode==='split'||cfg.printMode==='economy') return 'split';
  if(cfg.printMode==='landscape') return 'landscape';
  if(cfg.printMode==='multi') return 'multi';
  if(cfg.printMode==='dup2') return 'dup2';
  if(cfg.printMode==='dup4') return 'dup4';
  if(cfg.printMode==='dup5') return 'dup5';
  if(cfg.printMode==='dup6') return 'dup6';
  if(cfg.printMode==='portrait'||cfg.printMode==='normal') return 'portrait';
  return 'portrait';
}

/* Check if paper can be split into 2 quadrant-fitting parts (true Split 2-in-1 test) */
function paperFitsHalfPage(paper){
  if(!paper||!paper.questions||!paper.questions.length) return true;
  var QUADRANT_HEIGHT=265;
  var headerCushion=75;
  var parts=divideIntoParts(paper);
  var hA=estimateQuestionsHeight(parts.partA);
  var hB=estimateQuestionsHeight(parts.partB);
  return (hA+headerCushion<=QUADRANT_HEIGHT) && (hB+headerCushion<=QUADRANT_HEIGHT);
}

/* Human-readable mode labels */
function getModeName(mode){
  var map={portrait:'📃 Portrait A4',landscape:'🖥 Full Landscape',split:'✂️ Split 2-in-1',multi:'📑 Multi-Subject',dup2:'👯 2/4 Print',dup4:'👯 4/4 Print',dup5:'👯 5/5 Print',dup6:'👯 6/6 Print',auto:'🤖 Auto'};
  return map[mode]||map.portrait;
}

function getModeDesc(mode){
  var map={
    portrait:'Full A4 portrait · one subject per page',
    landscape:'A4 landscape · one subject, optimized spacing',
    split:'Landscape · two copies side-by-side · Front [A|B] · Back [B|A] duplex',
    multi:'Multiple short subjects stacked on one page',
    dup2:'A4 portrait with 2 identical copies split horizontally (A5 each)',
    dup4:'A4 portrait with 4 identical copies in a grid (A6 each)',
    dup5:'A4 portrait with 5 identical horizontal slips',
    dup6:'A4 portrait with 6 identical copies in a 2-by-3 grid'
  };
  return map[mode]||map.portrait;
}

/* ══════════════════════════════════════
   LANDSCAPE MODE BUILDER (NEW)
══════════════════════════════════════ */
function buildLandscapePaperHtml(p,adm){
  var cfg=ADMIN.labConfig;
  var fontMap={'Times New Roman':'"Times New Roman",serif','Arial':'Arial,sans-serif','Georgia':'Georgia,serif','Helvetica':'Helvetica,sans-serif','Verdana':'Verdana,sans-serif'};
  var fontFam=fontMap[cfg.fontFamily]||'"Times New Roman",serif';
  var wm=adm.watermark||'ExamEngine';
  var today=new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'});

  /* FULL LANDSCAPE MODE — Content flows across the entire A4 landscape sheet
     (all 4 quadrants continuously) for ONE student. NOT split/mirrored.
     Used when Split 2-in-1 cannot accommodate the content cleanly.
     Uses 2-column flowing layout to make efficient use of landscape width. */
  var h='<div class="ep ep-landscape" style="font-family:'+fontFam+';padding:10mm 14mm 9mm;">'
    +'<div class="ep-wm">'+esc(wm)+'</div>'
    +buildHouseStyleHeader(p,adm,false)
    +buildPaperHeader(p,adm,false)
    +'<div class="ep-landscape-flow" style="column-count:2;column-gap:10mm;column-rule:.25pt solid #ccc;margin-top:4pt;">'
    +buildSectionsHtml(p,false)
    +'</div>'
    +buildHouseStyleFooter(p,adm,false)
    +'<div class="ep-footer">'+esc(adm.school||p.school||'')+' &bull; '+esc(p.ref)+' &bull; ExamEngine Pro v12.5</div>'
    +'</div>';
  return h;
}

/* ══════════════════════════════════════
   MULTI-SUBJECT MODE BUILDER (NEW)
   Stacks 2-3 subjects on one page
══════════════════════════════════════ */
function buildMultiSubjectHtml(papers,adm){
  var cfg=ADMIN.labConfig;
  var fontMap={'Times New Roman':'"Times New Roman",serif','Arial':'Arial,sans-serif','Georgia':'Georgia,serif','Helvetica':'Helvetica,sans-serif','Verdana':'Verdana,sans-serif'};
  var fontFam=fontMap[cfg.fontFamily]||'"Times New Roman",serif';
  var wm=adm.watermark||'ExamEngine';
  var school=adm.school||papers[0].school||'School';
  var address=adm.address||'';
  var logo=adm.logo;
  var today=new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'});
  var initials=school.split(' ').map(function(w){ return w[0]||''; }).join('').substring(0,3).toUpperCase();

  // Decide orientation: estimate total height
  var totalH=0;
  papers.forEach(function(p){ totalH+=estimatePaperHeight(p)+20; });
  var useLS=totalH>750; // switch to landscape if too tall for portrait

  var h='<div class="ep ep-multi" style="font-family:'+fontFam+';padding:'+(useLS?'10mm 14mm 8mm':'15mm 20mm 12mm')+';">';
  if(wm) h+='<div class="ep-wm">'+esc(wm)+'</div>';

  // House Style header (admin-customized) rendered once at top
  h+=buildHouseStyleHeader(papers[0],adm,false);

  // Shared school header (once for all subjects)
  h+='<div class="ep-header">';
  if(logo) h+='<img style="max-height:32pt;max-width:64pt;object-fit:contain;border-radius:4pt;display:block;margin:0 auto 3pt;" src="'+logo+'"/>';
  else h+='<div class="ep-crest" style="width:36pt;height:36pt;font-size:11pt;">'+initials+'</div>';
  h+='<div class="ep-school" style="font-size:12pt;">'+esc(school)+'</div>';
  if(address) h+='<div style="font-size:7.5pt;text-transform:uppercase;margin-bottom:1pt;">'+esc(address)+'</div>';
  h+='<div class="ep-title" style="font-size:10pt;">'+assessmentLabel(papers[0].at,false)+' &mdash; '+esc(papers[0].term)+'</div>';
  h+='<div class="ep-meta" style="font-size:8.5pt;"><span>Date: '+today+'</span></div>';
  h+='</div>';

  // Each subject as a section block
  papers.forEach(function(p,idx){
    var qs=p.questions||[];
    var total=sumQuestionMarks(qs);

    h+='<div class="multi-subject-block" style="margin-top:'+(idx===0?'4pt':'10pt')+';page-break-inside:avoid;break-inside:avoid;">';
    h+='<div style="background:#222;color:#fff;padding:3pt 8pt;font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;display:flex;justify-content:space-between;align-items:center;">';
    h+='<span>'+esc(p.subj)+' — '+esc(p.cls)+'</span>';
    if(marksLabel(total)) h+='<span style="font-weight:400;font-size:8pt;">'+marksLabel(total)+'</span>';
    h+='</div>';

    // Render sections with compact spacing
    var objs=qs.filter(function(q){ return q.k==='obj'; });
    var fitbs=qs.filter(function(q){ return q.k==='fitb'; });
    var ths=qs.filter(function(q){ return q.k==='theory'; });

    if(objs.length){
      h+='<div class="ep-sec" style="font-size:8.5pt!important;margin:4pt 0 2pt!important;">Objectives ('+objs.length+')</div>';
      h+='<div class="objective-container'+(objs.length>=30?' objective-2col':'')+'">';
      objs.forEach(function(q,i){ h+=formatObjective(q,i,'compact'); });
      h+='</div>';
    }
    if(fitbs.length){
      h+='<div class="ep-sec" style="font-size:8.5pt!important;margin:4pt 0 2pt!important;">Fill in the Blank ('+fitbs.length+')</div>';
      fitbs.forEach(function(q,i){
        var qtxt=q.t.replace(/_{2,}/g,'<span class="ep-fitb-blank" style="min-width:50pt;"></span>');
        h+='<div class="ep-q compact" style="font-size:8.5pt;">'
          +'<span class="ep-qn">'+(i+1)+'. </span>'+qtxt
          +(hasPositiveMarks(q)?'<span style="float:right;font-weight:700;">['+questionMarks(q)+'m]</span>':'')
          +'</div>';
      });
    }
    if(ths.length){
      h+='<div class="ep-sec" style="font-size:8.5pt!important;margin:4pt 0 2pt!important;">Theory ('+ths.length+')</div>';
      ths.forEach(function(q,i){
        h+='<div class="ep-q compact" style="font-size:8.5pt;">'
          +'<span class="ep-qn">'+(i+1)+'. </span>'+q.t
          +(hasPositiveMarks(q)?'<span style="float:right;font-weight:700;">['+questionMarks(q)+' marks]</span>':'')
          +(q._svgDiagram?'<div style="margin:2pt 0;">'+q._svgDiagram+'</div>':'')
          +'<div class="ep-ans compact"></div></div>';
      });
    }
    h+='</div>'; // end multi-subject-block
  });

  h+=buildHouseStyleFooter(papers[0],adm,false);
  h+='<div class="ep-footer">'+esc(school)+' &bull; ExamEngine Pro v12.5</div>';
  h+='</div>';
  return {html:h, landscape:useLS};
}

/* ══════════════════════════════════════
   PRINT ENGINE — doPrint (updated for 4 modes)
══════════════════════════════════════ */

function buildDup2Html(p, adm) {
  var h='<div style="display:flex;flex-direction:column;height:296mm;width:209mm;overflow:hidden;box-sizing:border-box;page-break-inside:avoid;break-inside:avoid;">';
  var cell = '<div style="flex:1;height:148mm;overflow:hidden;border-bottom:1px dashed #ccc;position:relative;box-sizing:border-box;">'
           + '<div class="ep" style="padding:5mm!important;font-size:8.4pt!important;line-height:1.16!important;max-width:100%;height:100%;box-sizing:border-box;overflow:hidden;">'
           + buildPaperHeader(p,adm,true)
           + buildSectionsHtml(p,true)
           + buildHouseStyleFooter(p,adm,true)
           + '<div class="ep-footer">'+esc(p.ref)+'</div>'
           + '</div></div>';
  h += cell + cell;
  h += '</div>';
  return h;
}

function buildDup4Html(p, adm) {
  var h='<div style="display:grid;grid-template-columns:1fr 1fr;grid-template-rows:148mm 148mm;width:209mm;height:296mm;overflow:hidden;box-sizing:border-box;page-break-inside:avoid;break-inside:avoid;">';
  var cell = '<div style="overflow:hidden; border-right:1px dashed #ccc; border-bottom:1px dashed #ccc; position:relative; box-sizing:border-box;">'
           + '<div class="ep" style="padding:3.5mm!important;font-size:7.8pt!important;line-height:1.12!important;max-width:100%;height:100%;box-sizing:border-box;overflow:hidden;">'
           + buildPaperHeader(p,adm,true)
           + buildSectionsHtml(p,true)
           + buildHouseStyleFooter(p,adm,true)
           + '<div class="ep-footer">'+esc(p.ref)+'</div>'
           + '</div></div>';
  h += cell + cell + cell + cell;
  h += '</div>';
  return h;
}

function buildDupNHtml(p, adm, n) {
  n=parseInt(n)||5;
  var isSix=n===6;
  var cols=2;
  var rows=3;
  var h='<div style="display:grid;grid-template-columns:repeat(2,1fr);grid-template-rows:repeat(3,1fr);width:209mm;height:296mm;overflow:hidden;box-sizing:border-box;page-break-inside:avoid;break-inside:avoid;">';
  var font=isSix?'7pt':'7.4pt';
  var pad=isSix?'2.6mm!important':'3mm!important';
  for(var i=0;i<n;i++){
    h+='<div style="overflow:hidden;border-right:'+(i%cols===0?'1px dashed #ccc':'0')+';border-bottom:1px dashed #ccc;position:relative;box-sizing:border-box;">'
      +'<div class="ep" style="padding:'+pad+';font-size:'+font+'!important;line-height:1.08!important;max-width:100%;height:100%;box-sizing:border-box;overflow:hidden;">'
      +buildPaperHeader(p,adm,true)
      +buildSectionsHtml(p,true)
      +buildHouseStyleFooter(p,adm,true)
      +'<div class="ep-footer" style="font-size:5.8pt!important;">'+esc(p.ref)+'</div>'
      +'</div></div>';
  }
  if(n===5) h+='<div style="overflow:hidden;border-bottom:1px dashed #ccc;position:relative;box-sizing:border-box;"></div>';
  h+='</div>';
  return h;
}

function isLikelyApkWebView(){
  var ua=(navigator.userAgent||'').toLowerCase();
  return /; wv\)|\bwv\b|crosswalk|capacitor|cordova|examengine/.test(ua) || !!(window.Capacitor||window.cordova);
}
function printHtmlInCurrentView(bodyHtml, css, title){
  var root=ensurePrintTarget('print-root');
  if(!root){ toast('Print area unavailable','err',5000); return; }
  var style=$('ee-apk-print-style');
  if(!style){ style=document.createElement('style'); style.id='ee-apk-print-style'; document.head.appendChild(style); }
  style.textContent=css||'';
  root.innerHTML='<div data-print-title="'+esc(title||'ExamEngine Print')+'">'+bodyHtml+'</div>';
  root.style.display='block';
  document.body.classList.remove('normal-mode','economy-mode');
  document.body.classList.add('lab-print-mode');
  setTimeout(function(){
    try{ math(root); }catch(e){}
    window.print();
    setTimeout(function(){
      document.body.classList.remove('lab-print-mode');
      root.innerHTML='';
      root.style.display='none';
    },1600);
  },700);
}

window.doPrint=function(){
  var papers=window._printPapers||[];
  var adm=getAdminSettings();
  if(!papers.length){ toast('No papers in lab to print','warn'); return; }
  window._printPapers=papers;

  /* ── Resolve layout mode ── */
  var mode=resolveLayoutMode(papers);

  /* ── Overflow guard for split ── */
  if(mode==='split'&&!paperFitsHalfPage(papers[0])){
    toast('⚠ Content too long for Split 2-in-1 — switching to Landscape','warn',4000);
    mode='landscape';
  }

  /* ── Build body HTML ── */
  var bodyHtml='';
  var isLandscape=false;

  if(mode==='split'){
    bodyHtml=buildEconomyFrame(papers,adm);
    isLandscape=true;
  } else if(mode==='dup2'){
    isLandscape=false;
    papers.forEach(function(p,i){
      if(i>0) bodyHtml+='<div style="page-break-before:always;"></div>';
      bodyHtml+=buildDup2Html(p,adm);
    });
  } else if(mode==='dup4'){
    isLandscape=false;
    papers.forEach(function(p,i){
      if(i>0) bodyHtml+='<div style="page-break-before:always;"></div>';
      bodyHtml+=buildDup4Html(p,adm);
    });
  } else if(mode==='dup5'||mode==='dup6'){
    isLandscape=false;
    papers.forEach(function(p,i){
      if(i>0) bodyHtml+='<div style="page-break-before:always;"></div>';
      bodyHtml+=buildDupNHtml(p,adm,mode==='dup6'?6:5);
    });
  } else if(mode==='multi'){
    var result=buildMultiSubjectHtml(papers,adm);
    bodyHtml=result.html;
    isLandscape=result.landscape;
  } else if(mode==='landscape'){
    isLandscape=true;
    papers.forEach(function(p,i){
      if(i>0) bodyHtml+='<div style="page-break-before:always;"></div>';
      bodyHtml+=buildLandscapePaperHtml(p,adm);
    });
  } else {
    // portrait (default)
    papers.forEach(function(p,i){
      if(i>0) bodyHtml+='<div style="page-break-before:always;"></div>';
      bodyHtml+=buildNormalPaperHtml(p,adm);
    });
  }

  /* ── @page rule ── */
  var pageRule=isLandscape
    ?'@page{size:A4 landscape;margin:0;}'
    :'@page{size:A4 portrait;margin:0;}';

  /* ── KaTeX CDN (same version as parent) ── */
  var katexCss='https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css';
  var katexJs ='https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js';
  var katexAuto='https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js';

  /* ── Exam paper CSS (self-contained — no app chrome) ── */
  var css=pageRule+'\n'+
    '@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}.diagram-box{display:none!important;}.ep-ans{display:none!important;}.ep{padding:10mm 12mm 10mm!important;font-size:9.5pt!important;line-height:1.25!important;}.eco-page-pair{min-height:unset!important;height:138mm!important;}img,canvas,svg{max-width:100%!important;max-height:55mm!important;object-fit:contain!important;height:auto!important;}table{width:100%!important;table-layout:fixed!important;}'+
    'body{margin:0;padding:0;background:#fff;}\n'+
    '.ep{font-family:"Times New Roman",serif;font-size:10pt;line-height:1.35;color:#000;padding:12mm 15mm 10mm;background:#fff;max-width:210mm;margin:0 auto;box-sizing:border-box;}\n'+
    '.ep-header{text-align:center;border-bottom:2pt double #000;padding-bottom:3pt;margin-bottom:4pt;}\n'+
    '.ep-crest{width:36pt;height:36pt;border:1.5pt solid #000;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:11pt;margin:0 auto 3pt;}\n'+
    '.ep-school{font-size:12.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:1pt;}\n'+
    '.ep-title{font-size:10.5pt;font-weight:700;text-transform:uppercase;margin-bottom:1pt;}\n'+
    '.ep-meta{font-size:9pt;margin-bottom:1pt;}\n'+
    '.ep-meta span{margin:0 5pt;}\n'+
    '.ep-instr{font-size:8pt;font-style:italic;border:1pt solid #666;padding:2pt 4pt;margin:3pt 0;}\n'+
    '.ep-sec{font-size:10pt;font-weight:700;text-transform:uppercase;border-bottom:1pt solid #000;padding-bottom:1pt;margin:6pt 0 2pt;}\n'+
    '.ep-sec-note{font-size:8pt;font-style:italic;color:#333;border-left:1.5pt solid #999;padding-left:4pt;margin-bottom:3pt;}\n'+
    '.ep-footer{font-size:7.5pt;color:#555;text-align:center;border-top:.5pt solid #ccc;padding-top:2pt;margin-top:6pt;}\n'+
    '.ep-wm{position:fixed;bottom:40mm;left:50%;transform:translateX(-50%) rotate(-35deg);font-size:60pt;color:rgba(0,0,0,.04);font-weight:900;white-space:nowrap;pointer-events:none;}\n'+
    '.ep-q{margin-bottom:3pt;page-break-inside:avoid;break-inside:avoid;}\n'+
    '.ep-q.compact{margin-bottom:1.5pt;line-height:1.2;}\n'+
    '.ep-q.wide{margin-bottom:6pt;line-height:1.6;}\n'+
    '.ep-q-obj{margin-bottom:1.5pt;font-size:8pt;line-height:1.2;break-inside:avoid;page-break-inside:avoid;}\n'+
    '.ep-q-obj.compact{margin-bottom:1pt;line-height:1.1;}\n'+
    '.ep-obj-2col{column-count:2;column-gap:10mm;}\n'+
    '.ep-obj-block{display:block;}\n'+
    '.ep-opt-inline{display:inline-block;margin-left:6pt;white-space:normal;vertical-align:top;}\n'+
    '.ep-opt-inline-k{font-weight:700;}\n'+
    '.opt-inline{display:inline-block;margin-left:6pt;white-space:normal;vertical-align:top;}\n'+
    '.opt-inline-k{font-weight:700;}\n'+
    '.objective-item{break-inside:avoid;page-break-inside:avoid;margin-bottom:2px;font-size:8.5pt;line-height:1.2;display:block;}\n'+
    '.ep-qn{font-weight:700;}\n'+
    '.ep-fitb-blank{display:inline-block;border-bottom:1.5pt solid #000;min-width:70pt;margin:0 2pt;}\n'+
    '.ep-ans{border-bottom:1pt solid #bbb;min-height:36pt;margin:2pt 0 6pt;}\n'+
    '.ep-ans.compact{min-height:18pt;}\n'+
    '.ep-ans.wide{min-height:48pt;}\n'+
    '.eco-page-pair{display:grid;grid-template-columns:1fr 1fr;width:100%;min-height:185mm;page-break-after:always;position:relative;}\n'+
    '.eco-page-pair:last-child{page-break-after:auto;}\n'+
    '.eco-col{padding:6mm 7mm;box-sizing:border-box;font-size:8.5pt;line-height:1.35;overflow:hidden;position:relative;font-family:"Times New Roman",serif;}\n'+
    '.eco-col-left{border-right:0.4mm dashed #aaa;}\n'+
    '.eco-col .ep-school{font-size:9pt!important;}\n'+
    '.eco-col .ep-title{font-size:8pt!important;}\n'+
    '.eco-col .ep-meta{font-size:7.5pt!important;}\n'+
    '.eco-col .ep-header{padding-bottom:3pt!important;margin-bottom:4pt!important;}\n'+
    '.eco-col .ep-sec{font-size:8pt!important;margin:4pt 0 2pt!important;}\n'+
    '.eco-col .ep-q{margin-bottom:3pt!important;}\n'+
    '.eco-col .ep-ans{min-height:16pt!important;margin:2pt 0 5pt!important;}\n'+
    '.eco-col .ep-footer{font-size:6.5pt!important;}\n'+
    '.eco-wm{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:22pt;font-weight:900;color:rgba(0,0,0,.04);text-transform:uppercase;white-space:nowrap;pointer-events:none;}\n'+
    '.eco-cut-hint{position:absolute;bottom:2mm;right:4mm;font-size:5.5pt;color:#bbb;white-space:nowrap;}\n'+
    '.ep-landscape{max-width:297mm;}\n'+
    '.ep-landscape .ep-header{padding-bottom:5pt;margin-bottom:7pt;}\n'+
    '.ep-landscape .ep-sec{margin:8pt 0 2pt;}\n'+
    '.ep-landscape .ep-q{margin-bottom:6pt;}\n'+
    '.ep-landscape .ep-ans{min-height:36pt;margin:2pt 0 7pt;}\n'+
    '.ep-multi{position:relative;}\n'+
    '.multi-subject-block{border:0.5pt solid #999;border-radius:3pt;overflow:hidden;margin-bottom:6pt;padding:0 0 4pt 0;}\n'+
    '.multi-subject-block .ep-sec{margin:3pt 8pt 1pt!important;}\n'+
    '.multi-subject-block .ep-q{margin-left:8pt;margin-right:8pt;}\n'+
    '.multi-subject-block .objective-container{padding:0 8pt;}\n'+
    '.multi-subject-block .ep-ans{min-height:18pt;margin:1pt 0 4pt;}\n'+
    '.mg-head{font-size:13pt;font-weight:700;text-transform:uppercase;border-bottom:2pt solid #000;padding-bottom:4pt;margin-bottom:10pt;}\n'+
    '.mg-conf{font-size:9pt;font-style:italic;color:#555;margin-bottom:14pt;border:1pt solid #999;padding:4pt 8pt;}\n'+
    '.mg-sec{font-size:11pt;font-weight:700;border-bottom:1pt solid #000;padding-bottom:2pt;margin:12pt 0 6pt;}\n'+
    '.mg-key-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:3pt 14pt;font-size:10pt;margin-bottom:10pt;}\n'+
    '.mg-fitb-ans{margin-bottom:5pt;font-size:10pt;}\n'+
    '.mg-th-q{margin-bottom:12pt;page-break-inside:avoid;}\n'+
    '.mg-th-q-text{font-size:10pt;margin:3pt 0;font-style:italic;}\n'+
    '.mg-mark-breakdown{font-size:9.5pt;color:#333;line-height:1.8;border-left:2pt solid #999;padding-left:6pt;margin-top:4pt;}\n'+
    '.eco-header{display:flex;align-items:center;gap:3mm;border-bottom:0.3mm solid #333;padding-bottom:1.5mm;margin-bottom:2mm;}\n'+
    '.eco-logo{max-height:8mm!important;max-width:8mm!important;object-fit:contain;flex-shrink:0;display:block;}\n'+
    '.ep-header img{max-height:36pt!important;max-width:72pt!important;object-fit:contain!important;width:auto!important;height:auto!important;}\n'+
    '.custom-diagram-img{max-width:100%!important;max-height:55mm!important;object-fit:contain!important;display:block;margin:3pt auto;}\n';

  if(isLikelyApkWebView()){
    printHtmlInCurrentView(bodyHtml,css,'ExamEngine Print');
    return;
  }

  /* ── Open dedicated print window ── */
  var win=window.open('','_blank','width=900,height=700');
  if(!win){
    printHtmlInCurrentView(bodyHtml,css,'ExamEngine Print');
    return;
  }

  win.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"/>'+
    '<title>ExamEngine Print</title>'+
    '<link rel="stylesheet" href="'+katexCss+'"/>'+
    '<style>'+css+'</style>'+
    '</head><body>'+
    bodyHtml+
    '<script src="'+katexJs+'"><\/script>'+
    '<script src="'+katexAuto+'"><\/script>'+
    '<script>'+
      'document.addEventListener("DOMContentLoaded",function(){'+
        'if(window.renderMathInElement){'+
          'renderMathInElement(document.body,{delimiters:['+
            '{left:"$$",right:"$$",display:true},'+
            '{left:"$",right:"$",display:false},'+
            '{left:"\\\\(",right:"\\\\)",display:false},'+
            '{left:"\\\\[",right:"\\\\]",display:true}'+
          ']});'+
        '}'+
        'function _doPrint(){window.focus();window.print();}'+
        'if(document.fonts&&document.fonts.ready){document.fonts.ready.then(function(){setTimeout(_doPrint,500);});}else{setTimeout(_doPrint,1100);}'+
      '});'+
    '<\/script>'+
    '</body></html>');
  win.document.close();
};

/* ══════════════════════════════════════
   BATCH PRINT CONSOLE
   Grouped by Class > Subject. Checkboxes per subject.
   Per-class "Print All" and master "Print All Classes" buttons.
   Each paper routed through its correct mode before stacking.
══════════════════════════════════════ */
window.openBatchPrint=async function(){
  var adm=getAdminSettings();
  var termKey=ADMIN.selectedTerm||'1st Term';
  // Only approved papers for current term
  var allPapers=await getPublished();
  var all=allPapers.filter(function(p){ return p.term===termKey && p.adminStatus==='approved'; });
  if(!all.length){
    toast('\u26a0 No approved papers for '+termKey+' yet. Approve papers in Production Queue first.','warn',5000);
    return;
  }

  // Group by class -> subject
  var grouped={};
  all.forEach(function(p){
    var cls=p.cls||'(No class)';
    if(!grouped[cls]) grouped[cls]=[];
    grouped[cls].push(p);
  });

  // Stable class order: Creche,KG,Nursery,Primary,JSS,SS
  var order=['Creche','KG 1','KG 2','Nursery 1','Nursery 2','Primary 1','Primary 2','Primary 3','Primary 4','Primary 5','JSS 1','JSS 2','JSS 3','SS 1','SS 2','SS 3'];
  var classes=Object.keys(grouped).sort(function(a,b){
    var ia=order.indexOf(a), ib=order.indexOf(b);
    if(ia<0) ia=999; if(ib<0) ib=999;
    return ia-ib;
  });

  // Build modal HTML
  var rowsHtml=classes.map(function(cls){
    var papers=grouped[cls].sort(function(a,b){ return (a.subj||'').localeCompare(b.subj||''); });
    var safeCls=cls.replace(/[^a-zA-Z0-9]/g,'_');
    var subjRows=papers.map(function(p,i){
      var mode=selectLayout([p]);
      var modeLabel={split:'\u2702\ufe0f Split 2-in-1',landscape:'\ud83d\udda5 Landscape',portrait:'\ud83d\udcc3 Portrait',multi:'\ud83d\udcd1 Multi'}[mode]||mode;
      var qc=(p.questions||[]).length;
      return '<tr>'
        +'<td style="padding:6px 8px;"><input type="checkbox" class="bp-subj-chk" data-cls="'+esc(safeCls)+'" data-ref="'+esc(p.ref)+'" checked/></td>'
        +'<td style="padding:6px 8px;font-weight:600;">'+esc(p.subj)+'</td>'
        +'<td style="padding:6px 8px;font-size:11px;color:#666;">'+qc+' Q</td>'
        +'<td style="padding:6px 8px;font-size:10px;color:#888;">'+modeLabel+'</td>'
        +'<td style="padding:6px 8px;"><button class="btn bq bsm" onclick="batchPrintSingle(\''+esc(p.ref)+'\')">\ud83d\udda8 Print</button></td>'
        +'</tr>';
    }).join('');
    return '<div class="bp-class-block" style="margin-bottom:14px;border:1px solid #ddd;border-radius:6px;overflow:hidden;">'
      +'<div style="background:#1e293b;color:#fff;padding:8px 12px;font-weight:700;display:flex;align-items:center;gap:8px;">'
      +'<span>\ud83d\udcda '+esc(cls)+'</span>'
      +'<span style="font-size:11px;font-weight:400;opacity:.75;">('+papers.length+' subject'+(papers.length===1?'':'s')+')</span>'
      +'<span style="margin-left:auto;display:flex;gap:6px;">'
      +'<button class="btn bq bsm" onclick="batchToggleClass(\''+esc(safeCls)+'\',true)" style="background:#fff;color:#1e293b;">\u2713 All</button>'
      +'<button class="btn bq bsm" onclick="batchToggleClass(\''+esc(safeCls)+'\',false)" style="background:#fff;color:#1e293b;">\u2717 None</button>'
      +'<button class="btn bp bsm" onclick="batchPrintClass(\''+esc(safeCls)+'\')" style="background:#059669;border-color:#059669;">\ud83d\udda8 Print Class</button>'
      +'</span>'
      +'</div>'
      +'<table style="width:100%;border-collapse:collapse;background:#fff;">'
      +'<thead><tr style="background:#f8fafc;font-size:11px;text-transform:uppercase;color:#64748b;"><th style="padding:6px 8px;text-align:left;width:40px;"></th><th style="padding:6px 8px;text-align:left;">Subject</th><th style="padding:6px 8px;text-align:left;">Size</th><th style="padding:6px 8px;text-align:left;">Auto Mode</th><th style="padding:6px 8px;text-align:left;">Action</th></tr></thead>'
      +'<tbody>'+subjRows+'</tbody>'
      +'</table>'
      +'</div>';
  }).join('');

  // Build overlay
  var overlay=document.createElement('div');
  overlay.id='batchPrintOverlay';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,.75);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto;';
  overlay.innerHTML='<div style="background:#fff;border-radius:10px;max-width:900px;width:100%;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.5);">'
    +'<div style="padding:14px 18px;background:linear-gradient(135deg,#059669,#047857);color:#fff;display:flex;align-items:center;gap:10px;">'
    +'<span style="font-size:20px;">\ud83d\udda8</span>'
    +'<div style="flex:1;"><div style="font-weight:800;font-size:16px;">Batch Print \u2014 '+esc(termKey)+'</div>'
    +'<div style="font-size:11px;opacity:.85;">'+all.length+' approved paper(s) across '+classes.length+' class(es). Choose a print mode or leave Auto.</div></div>'
    +'<button onclick="closeBatchPrint()" style="background:rgba(255,255,255,.15);border:none;color:#fff;padding:6px 12px;border-radius:5px;cursor:pointer;font-weight:700;">\u2715 Close</button>'
    +'</div>'
    +'<div style="padding:16px 18px;overflow-y:auto;flex:1;background:#f8fafc;">'
    +rowsHtml
    +'</div>'
    +'<div style="padding:12px 18px;background:#fff;border-top:1px solid #e5e7eb;display:flex;gap:10px;flex-wrap:wrap;align-items:center;">'
    +'<span style="font-size:12px;color:#64748b;flex:1;min-width:150px;">Select subjects above, then print.</span>'
    +'<label style="font-size:11px;font-weight:700;color:#475569;display:flex;align-items:center;gap:6px;">Mode <select id="batchPrintMode" class="fs" style="width:auto;min-width:150px;padding:7px 9px;font-size:12px;">'
      +'<option value="auto">Auto Fit</option>'
      +'<option value="portrait">Portrait A4</option>'
      +'<option value="landscape">Landscape</option>'
      +'<option value="split">Split 2-in-1</option>'
      +'<option value="multi">Multi-Subject</option>'
      +'<option value="dup2">2/4 Print</option>'
      +'<option value="dup4">4/4 Print</option>'
      +'<option value="dup5">5/5 Print</option>'
      +'<option value="dup6">6/6 Print</option>'
    +'</select></label>'
    +'<button class="btn bq" onclick="batchToggleAll(true)">\u2713 Select All</button>'
    +'<button class="btn bq" onclick="batchToggleAll(false)">\u2717 Clear All</button>'
    +'<button class="btn bp" onclick="batchPrintSelected()" style="background:#059669;border-color:#059669;">\ud83d\udda8 Print Selected</button>'
    +'</div>'
    +'</div>';
  document.body.appendChild(overlay);
};

window.closeBatchPrint=function(){
  var o=$('batchPrintOverlay'); if(o) o.remove();
};

function getBatchPrintMode(){
  var el=$('batchPrintMode');
  return (el&&el.value)||'auto';
}

window.batchToggleAll=function(checked){
  document.querySelectorAll('.bp-subj-chk').forEach(function(c){ c.checked=!!checked; });
};

window.batchToggleClass=function(safeCls,checked){
  document.querySelectorAll('.bp-subj-chk[data-cls="'+safeCls+'"]').forEach(function(c){ c.checked=!!checked; });
};

window.batchPrintSingle=async function(ref){
  var all=await getPublished();
  var p=all.find(function(x){ return x.ref===ref; });
  if(!p){ toast('Paper not found','warn'); return; }
  var mode=getBatchPrintMode();
  closeBatchPrint();
  executeBatchPrint([p],mode);
};

window.batchPrintClass=async function(safeCls){
  var refs=[];
  document.querySelectorAll('.bp-subj-chk[data-cls="'+safeCls+'"]').forEach(function(c){
    if(c.checked) refs.push(c.getAttribute('data-ref'));
  });
  if(!refs.length){ toast('No subjects selected in this class','warn'); return; }
  var all=await getPublished();
  var selected=refs.map(function(r){ return all.find(function(x){ return x.ref===r; }); }).filter(Boolean);
  var mode=getBatchPrintMode();
  closeBatchPrint();
  executeBatchPrint(selected,mode);
};

window.batchPrintSelected=async function(){
  var refs=[];
  document.querySelectorAll('.bp-subj-chk').forEach(function(c){
    if(c.checked) refs.push(c.getAttribute('data-ref'));
  });
  if(!refs.length){ toast('No subjects selected','warn'); return; }
  var all=await getPublished();
  var selected=refs.map(function(r){ return all.find(function(x){ return x.ref===r; }); }).filter(Boolean);
  var mode=getBatchPrintMode();
  closeBatchPrint();
  executeBatchPrint(selected,mode);
};

/* Execute batch print: each paper routed through its correct mode,
   stacked into ONE print window. Mode resolution per-paper. */
function executeBatchPrint(papers,forcedMode){
  if(!papers||!papers.length){ toast('Nothing to print','warn'); return; }
  var adm=getAdminSettings();
  window._printPapers=papers;
  forcedMode=forcedMode||'auto';

  var bodyHtml='';
  var anyLandscape=false;

  if(forcedMode!=='auto'){
    if(forcedMode==='split'){
      bodyHtml=buildEconomyFrame(papers,adm);
      anyLandscape=true;
    } else if(forcedMode==='multi'){
      var multiResult=buildMultiSubjectHtml(papers,adm);
      bodyHtml=multiResult.html;
      anyLandscape=!!multiResult.landscape;
    } else {
      papers.forEach(function(p,i){
        if(i>0) bodyHtml+='<div style="page-break-before:always;"></div>';
        if(forcedMode==='dup2') bodyHtml+=buildDup2Html(p,adm);
        else if(forcedMode==='dup4') bodyHtml+=buildDup4Html(p,adm);
        else if(forcedMode==='dup5') bodyHtml+=buildDupNHtml(p,adm,5);
        else if(forcedMode==='dup6') bodyHtml+=buildDupNHtml(p,adm,6);
        else if(forcedMode==='landscape'){ bodyHtml+=buildLandscapePaperHtml(p,adm); anyLandscape=true; }
        else bodyHtml+=buildNormalPaperHtml(p,adm);
      });
    }
    var forcedPageRule=anyLandscape
      ?'@page{size:A4 landscape;margin:0;}'
      :'@page{size:A4 portrait;margin:0;}';
    openPrintWindow(bodyHtml, forcedPageRule, 'Batch Print — '+papers.length+' paper(s) · '+getModeName(forcedMode));
    return;
  }

  /* Group papers by their auto-resolved mode.
     Multi-Subject groups merge. Single papers print individually. */
  var multiBucket=[];
  var singles=[];
  papers.forEach(function(p){
    var mode=selectLayout([p]);
    if(mode==='multi') multiBucket.push(p);
    else singles.push({paper:p, mode:mode});
  });

  // Multi-subject group first (if any)
  if(multiBucket.length>=2){
    var result=buildMultiSubjectHtml(multiBucket,adm);
    bodyHtml+=result.html;
    if(result.landscape) anyLandscape=true;
  } else if(multiBucket.length===1){
    singles.push({paper:multiBucket[0], mode:selectLayout([multiBucket[0]])==='multi'?'portrait':selectLayout([multiBucket[0]])});
  }

  // Singles
  singles.forEach(function(item,idx){
    if(bodyHtml) bodyHtml+='<div style="page-break-before:always;"></div>';
    var m=item.mode, p=item.paper;
    if(m==='split'){
      if(paperFitsHalfPage(p)){
        bodyHtml+=buildEconomyFrame([p],adm);
        anyLandscape=true;
      } else {
        bodyHtml+=buildLandscapePaperHtml(p,adm);
        anyLandscape=true;
      }
    } else if(m==='dup2'){
      bodyHtml+=buildDup2Html(p,adm);
    } else if(m==='dup4'){
      bodyHtml+=buildDup4Html(p,adm);
    } else if(m==='dup5'){
      bodyHtml+=buildDupNHtml(p,adm,5);
    } else if(m==='dup6'){
      bodyHtml+=buildDupNHtml(p,adm,6);
    } else if(m==='landscape'){
      bodyHtml+=buildLandscapePaperHtml(p,adm);
      anyLandscape=true;
    } else {
      bodyHtml+=buildNormalPaperHtml(p,adm);
    }
  });

  /* Mixed orientations: default to landscape if ANY paper is landscape,
     since mixing @page rules per section isn't reliable. Portrait-only papers
     render with extra padding in landscape @page frame. */
  var pageRule=anyLandscape
    ?'@page{size:A4 landscape;margin:0;}'
    :'@page{size:A4 portrait;margin:0;}';

  openPrintWindow(bodyHtml, pageRule, 'Batch Print \u2014 '+papers.length+' paper(s)');
}

/* Shared print-window opener — dedicated window with embedded CSS.
   Android Chrome fix: fire window.print() AFTER DOM + KaTeX load (600ms delay). */
function openPrintWindow(bodyHtml, pageRule, title){
  var katexCss='https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css';
  var katexJs ='https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js';
  var katexAuto='https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js';

  var css=pageRule+'\n'+
    '@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}.diagram-box{display:none!important;}.ep-ans{display:none!important;}.ep{padding:10mm 12mm 10mm!important;font-size:9.5pt!important;line-height:1.25!important;}.eco-page-pair{min-height:unset!important;height:138mm!important;}img,canvas,svg{max-width:100%!important;max-height:55mm!important;object-fit:contain!important;height:auto!important;}table{width:100%!important;table-layout:fixed!important;}'+
    'body{margin:0;padding:0;background:#fff;}\n'+
    '.ep{font-family:"Times New Roman",serif;font-size:10pt;line-height:1.35;color:#000;padding:12mm 15mm 10mm;background:#fff;max-width:210mm;margin:0 auto;box-sizing:border-box;}\n'+
    '.ep-header{text-align:center;border-bottom:2pt double #000;padding-bottom:3pt;margin-bottom:4pt;}\n'+
    '.ep-crest{width:36pt;height:36pt;border:1.5pt solid #000;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:11pt;margin:0 auto 3pt;}\n'+
    '.ep-school{font-size:12.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:1pt;}\n'+
    '.ep-title{font-size:10.5pt;font-weight:700;text-transform:uppercase;margin-bottom:1pt;}\n'+
    '.ep-meta{font-size:9pt;margin-bottom:1pt;}\n'+
    '.ep-meta span{margin:0 5pt;}\n'+
    '.ep-instr{font-size:8pt;font-style:italic;border:1pt solid #666;padding:2pt 4pt;margin:3pt 0;}\n'+
    '.ep-sec{font-size:10pt;font-weight:700;text-transform:uppercase;border-bottom:1pt solid #000;padding-bottom:1pt;margin:6pt 0 2pt;}\n'+
    '.ep-sec-note{font-size:8pt;font-style:italic;color:#333;border-left:1.5pt solid #999;padding-left:4pt;margin-bottom:3pt;}\n'+
    '.ep-footer{font-size:7.5pt;color:#555;text-align:center;border-top:.5pt solid #ccc;padding-top:2pt;margin-top:6pt;}\n'+
    '.ep-wm{position:fixed;bottom:40mm;left:50%;transform:translateX(-50%) rotate(-35deg);font-size:60pt;color:rgba(0,0,0,.04);font-weight:900;white-space:nowrap;pointer-events:none;}\n'+
    '.ep-q{margin-bottom:3pt;page-break-inside:avoid;break-inside:avoid;}\n'+
    '.ep-q.compact{margin-bottom:1.5pt;line-height:1.2;}\n'+
    '.ep-q.wide{margin-bottom:6pt;line-height:1.6;}\n'+
    '.ep-q-obj{margin-bottom:1.5pt;font-size:8pt;line-height:1.2;break-inside:avoid;page-break-inside:avoid;}\n'+
    '.ep-q-obj.compact{margin-bottom:1pt;line-height:1.1;}\n'+
    '.ep-obj-2col{column-count:2;column-gap:10mm;}\n'+
    '.ep-obj-block{display:block;}\n'+
    '.ep-opt-inline{display:inline-block;margin-left:6pt;white-space:normal;vertical-align:top;}\n'+
    '.ep-opt-inline-k{font-weight:700;}\n'+
    '.opt-inline{display:inline-block;margin-left:6pt;white-space:normal;vertical-align:top;}\n'+
    '.opt-inline-k{font-weight:700;}\n'+
    '.objective-item{break-inside:avoid;page-break-inside:avoid;margin-bottom:2px;font-size:8.5pt;line-height:1.2;display:block;}\n'+
    '.ep-qn{font-weight:700;}\n'+
    '.ep-fitb-blank{display:inline-block;border-bottom:1.5pt solid #000;min-width:70pt;margin:0 2pt;}\n'+
    '.ep-ans{border-bottom:1pt solid #bbb;min-height:36pt;margin:2pt 0 6pt;}\n'+
    '.ep-ans.compact{min-height:18pt;}\n'+
    '.ep-ans.wide{min-height:48pt;}\n'+
    '.eco-page-pair{display:grid;grid-template-columns:1fr 1fr;width:100%;min-height:185mm;page-break-after:always;position:relative;}\n'+
    '.eco-page-pair:last-child{page-break-after:auto;}\n'+
    '.eco-col{padding:6mm 7mm;box-sizing:border-box;font-size:8.5pt;line-height:1.35;overflow:hidden;position:relative;font-family:"Times New Roman",serif;}\n'+
    '.eco-col-left{border-right:0.4mm dashed #aaa;}\n'+
    '.eco-col .ep-school{font-size:9pt!important;}\n'+
    '.eco-col .ep-title{font-size:8pt!important;}\n'+
    '.eco-col .ep-meta{font-size:7.5pt!important;}\n'+
    '.eco-col .ep-header{padding-bottom:3pt!important;margin-bottom:4pt!important;}\n'+
    '.eco-col .ep-sec{font-size:8pt!important;margin:4pt 0 2pt!important;}\n'+
    '.eco-col .ep-q{margin-bottom:3pt!important;}\n'+
    '.eco-col .ep-ans{min-height:16pt!important;margin:2pt 0 5pt!important;}\n'+
    '.eco-col .ep-footer{font-size:6.5pt!important;}\n'+
    '.eco-wm{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:22pt;font-weight:900;color:rgba(0,0,0,.04);text-transform:uppercase;white-space:nowrap;pointer-events:none;}\n'+
    '.eco-cut-hint{position:absolute;bottom:2mm;right:4mm;font-size:5.5pt;color:#bbb;white-space:nowrap;}\n'+
    '.ep-landscape{max-width:297mm;}\n'+
    '.ep-landscape .ep-header{padding-bottom:5pt;margin-bottom:7pt;}\n'+
    '.ep-landscape .ep-sec{margin:8pt 0 2pt;}\n'+
    '.ep-landscape .ep-q{margin-bottom:6pt;}\n'+
    '.ep-landscape .ep-ans{min-height:36pt;margin:2pt 0 7pt;}\n'+
    '.ep-multi{position:relative;}\n'+
    '.multi-subject-block{border:0.5pt solid #999;border-radius:3pt;overflow:hidden;margin-bottom:6pt;padding:0 0 4pt 0;}\n'+
    '.multi-subject-block .ep-sec{margin:3pt 8pt 1pt!important;}\n'+
    '.multi-subject-block .ep-q{margin-left:8pt;margin-right:8pt;}\n'+
    '.multi-subject-block .objective-container{padding:0 8pt;}\n'+
    '.eco-col .ep-sec{font-size:8pt!important;margin:4pt 0 2pt!important;}\n'+
    '.eco-col .ep-q{margin-bottom:3pt!important;}\n'+
    '.eco-col .ep-ans{min-height:16pt!important;margin:2pt 0 5pt!important;}\n'+
    '.eco-wm{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:22pt;font-weight:900;color:rgba(0,0,0,.04);text-transform:uppercase;white-space:nowrap;pointer-events:none;}\n'+
    '.eco-cut-hint{position:absolute;bottom:2mm;right:4mm;font-size:5.5pt;color:#bbb;white-space:nowrap;}\n'+
    '.ep-landscape{max-width:297mm;}\n'+
    '.ep-landscape-flow{column-count:2;column-gap:10mm;column-rule:.25pt solid #ccc;}\n'+
    '.multi-subject-block{border:0.5pt solid #999;border-radius:3pt;overflow:hidden;margin-bottom:6pt;padding:0 0 4pt 0;}\n'+
    '.hs-header strong,.hs-footer strong{font-weight:800;}\n'+
    '.eco-header{display:flex;align-items:center;gap:3mm;border-bottom:0.3mm solid #333;padding-bottom:1.5mm;margin-bottom:2mm;}\n'+
    '.eco-logo{max-height:8mm!important;max-width:8mm!important;object-fit:contain;flex-shrink:0;display:block;}\n'+
    '.ep-header img{max-height:36pt!important;max-width:72pt!important;object-fit:contain!important;width:auto!important;height:auto!important;}\n'+
    '.custom-diagram-img{max-width:100%!important;max-height:55mm!important;object-fit:contain!important;display:block;margin:3pt auto;}\n';

  if(isLikelyApkWebView()){
    printHtmlInCurrentView(bodyHtml,css,title||'Print');
    return;
  }
  var win=window.open('','_blank');
  if(!win){ printHtmlInCurrentView(bodyHtml,css,title||'Print'); return; }
  win.document.open();
  win.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"/>'+
    '<title>'+esc(title||'Print')+'</title>'+
    '<link rel="stylesheet" href="'+katexCss+'"/>'+
    '<style>'+css+'</style>'+
    '</head><body>'+bodyHtml+
    '<script src="'+katexJs+'"><\/script>'+
    '<script src="'+katexAuto+'"><\/script>'+
    '<script>'+
    'window.addEventListener("load",function(){'+
    'try{if(window.renderMathInElement){renderMathInElement(document.body,{delimiters:[{left:"$$",right:"$$",display:true},{left:"$",right:"$",display:false}]});}}catch(e){}'+
    'function _doPrint(){window.focus();window.print();}'+
    'if(document.fonts&&document.fonts.ready){document.fonts.ready.then(function(){setTimeout(_doPrint,500);});}else{setTimeout(_doPrint,1100);}'+
    'window.onafterprint=function(){setTimeout(function(){window.close();},400);};'+
    '});'+
    '<\/script>'+
    '</body></html>');
  win.document.close();
}
function buildObjInlineHtml(q,i,compact){
  var opts='';
  if(q.o&&q.o.length){
    opts=q.o.map(function(o,oi){
      return '<span class="ep-opt-inline"><span class="ep-opt-inline-k">('+L[oi]+')</span> '+esc(o)+'</span>';
    }).join('');
  }
  var imgHtml='';
  if(q.customImg) imgHtml='<div style="margin:3pt 0;text-align:center;page-break-inside:avoid;"><img src="'+q.customImg+'" style="max-width:100%;max-height:'+(compact?'30mm':'55mm')+';object-fit:contain;"/></div>';
  else if(q._svgDiagram) imgHtml='<div style="margin:3pt 0;text-align:center;">'+q._svgDiagram+'</div>';
  return '<div class="ep-q-obj'+(compact?' compact':'')+'">'
    +'<span class="ep-qn">'+(i+1)+'. </span>'+q.t+imgHtml+opts
    +'</div>';
}

/* ── NORMAL MODE PRINT ── */
function buildNormalPrintHtml(p,adm){
  var cfg=ADMIN.labConfig;
  var fontMap={'Times New Roman':'"Times New Roman",serif','Arial':'Arial,sans-serif','Georgia':'Georgia,serif','Helvetica':'Helvetica,sans-serif','Verdana':'Verdana,sans-serif'};
  var fontFam=fontMap[cfg.fontFamily]||'"Times New Roman",serif';
  var logo=adm.logo?'<img style="max-height:36pt;max-width:72pt;object-fit:contain;border-radius:4pt;display:block;margin:0 auto 4pt;" src="'+adm.logo+'"/>':'';
  var school=adm.school||p.school||'School';
  var address=adm.address||'';
  var initials=school.split(' ').map(function(w){ return w[0]||''; }).join('').substring(0,3).toUpperCase();
  var today=new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'});
  var wm=adm.watermark||'ExamEngine';
  var qs=p.questions||[];
  var objs=qs.filter(function(q){ return q.k==='obj'; });
  var fitbs=qs.filter(function(q){ return q.k==='fitb'; });
  var ths=qs.filter(function(q){ return q.k==='theory'; });
  var total=sumQuestionMarks(qs);
  var use2col=objs.length>=30;

  var h='<div class="ep" style="font-family:'+fontFam+';">'
    +'<div class="ep-wm">'+esc(wm)+'</div>'
    +'<div class="ep-header">'
    +(logo?logo:'<div class="ep-crest">'+initials+'</div>')
    +'<div class="ep-school">'+esc(school)+'</div>'
    +(address?'<div style="font-size:8pt;text-transform:uppercase;margin-bottom:2pt;">'+esc(address)+'</div>':'')
    +'<div class="ep-title">'+assessmentLabel(p.at,false)+' &mdash; '+esc(p.term)+(p.session?' ('+esc(p.session)+')':'')+'</div>'
    +'<div class="ep-meta"><span>Subject: <strong>'+esc(p.subj)+'</strong></span>'
    +'<span>Class: <strong>'+esc(p.cls)+'</strong></span><span>Date: '+today+'</span></div>'
    +'<div class="ep-meta">'+(totalMarksHtml(total,true)?'<span>Total: '+totalMarksHtml(total,true)+'</span>':'')
    +(p.std?'<span>Standard: '+esc(p.std)+'</span>':'')+'<span>Ref: '+esc(p.ref)+'</span></div>'
    +'</div>';

  if(objs.length){
    h+='<div class="ep-sec">Section A &mdash; Objectives ('+objs.length+' Questions)</div>'
      +'<div class="ep-sec-note">Circle the letter of the correct answer.</div>'
      +'<div class="'+(use2col?'ep-obj-2col':'ep-obj-block')+'">';
    objs.forEach(function(q,i){
      var compact=(q.layout==='compact');
      h+=buildObjInlineHtml(q,i,compact);
    });
    h+='</div>';
  }

  if(fitbs.length){
    var fSec=objs.length?'B':'A';
    h+='<div class="ep-sec">Section '+fSec+' &mdash; Fill in the Blank ('+fitbs.length+' Questions)</div>'
      +'<div class="ep-sec-note">Complete each sentence with the correct word or phrase.</div>';
    fitbs.forEach(function(q,i){
      var qtxt=q.t.replace(/_{2,}/g,'<span class="ep-fitb-blank"></span>');
      var cls=q.layout==='compact'?'compact':q.layout==='wide'?'wide':'';
      h+='<div class="ep-q'+( cls?' '+cls:'')+'">'
        +'<span class="ep-qn">'+(i+1)+'. </span>'+qtxt
        +(hasPositiveMarks(q)?'<span style="float:right;font-weight:700;">['+questionMarks(q)+' mark'+(questionMarks(q)>1?'s':'')+']</span>':'')
        +(q._svgDiagram?'<div style="margin:3pt 0;">'+q._svgDiagram+'</div>':'')
        +'</div>';
    });
  }

  if(ths.length){
    var tSec=objs.length&&fitbs.length?'C':objs.length||fitbs.length?'B':'A';
    var tInstr=p.theoryPaperInstr||'Answer all theory questions. Show all workings where applicable.';
    h+='<div class="ep-sec">Section '+tSec+' &mdash; Theory / Essay ('+ths.length+' Questions)</div>'
      +'<div class="ep-sec-note">'+esc(tInstr)+'</div>';
    ths.forEach(function(q,i){
      var ansClass=q.layout==='compact'?'compact':q.layout==='wide'?'wide':'';
      h+='<div class="ep-q'+(q.layout==='compact'?' compact':q.layout==='wide'?' wide':'')+'">'
        +'<span class="ep-qn">'+(i+1)+'. </span>'+q.t
        +(hasPositiveMarks(q)?'<span style="float:right;font-weight:700;">['+questionMarks(q)+' marks]</span>':'')
        +(q._svgDiagram?'<div style="margin:4pt 0;">'+q._svgDiagram+'</div>':'')
        +'<div class="ep-ans'+(ansClass?' '+ansClass:'')+'"></div></div>';
    });
  }

  h+='<div class="ep-footer">'+esc(school)+' &bull; '+esc(p.ref)+' &bull; ExamEngine Pro v12</div>';
  h+='</div>';
  return h;
}

// Alias for compatibility
function buildStandardPrintHtml(p,adm){ return buildNormalPrintHtml(p,adm); }

/* ── ECONOMY MODE PRINT — A4 Landscape, 2-in-1 Duplex ── */
function buildEconomyPrintHtml(papers,adm){
  var school=adm.school||'School';
  var address=adm.address||'';
  var logo=adm.logo;
  var wm=adm.watermark||'';
  var today=new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'});
  var html='';

  // Pair papers: [A|B] front page, [B|A] back page
  for(var i=0;i<papers.length;i+=2){
    var pA=papers[i];
    var pB=papers[i+1]||papers[i];
    var sameDouble=!papers[i+1];

    var colA=buildEcoColumn(pA,adm,today,wm,'left');
    var colB=buildEcoColumn(pB,adm,today,wm,'right');

    // FRONT: [A | B]
    html+='<div class="ep-page">'
      +'<div class="ep-col ep-col-left">'+colA+'</div>'
      +'<div class="ep-col">'+colB+'</div>'
      +'</div>';

    // BACK: [B | A] — flipped for duplex alignment after cutting
    if(!sameDouble){
      html+='<div class="ep-page">'
        +'<div class="ep-col ep-col-left">'+colB+'</div>'
        +'<div class="ep-col">'+colA+'</div>'
        +'</div>';
    }
  }
  return html;
}

function buildEcoColumn(p,adm,today,wm,side){
  var school=adm.school||p.school||'School';
  var address=adm.address||'';
  var logo=adm.logo;
  var qs=p.questions||[];
  var objs=qs.filter(function(q){ return q.k==='obj'; });
  var fitbs=qs.filter(function(q){ return q.k==='fitb'; });
  var ths=qs.filter(function(q){ return q.k==='theory'; });
  var total=sumQuestionMarks(qs);

  var h='';
  if(wm) h+='<div class="eco-wm'+(side==='right'?' eco-wm-r':'')+'" style="left:'+(side==='right'?'50%':'50%')+';">'+esc(wm)+'</div>';

  // Compact header
  h+='<div style="border-bottom:0.4mm solid #000;margin-bottom:4mm;padding-bottom:2mm;display:flex;align-items:center;gap:3mm;">';
  if(logo) h+='<img src="'+logo+'" style="width:14mm;height:14mm;object-fit:contain;flex-shrink:0;"/>';
  h+='<div style="flex:1;min-width:0;">'
    +'<div class="ep-school" style="font-size:8.5pt!important;">'+esc(school)+'</div>'
    +(address?'<div style="font-size:6.5pt;text-transform:uppercase;opacity:.7;">'+esc(address)+'</div>':'')
    +'<div class="ep-title" style="font-size:8pt!important;">'+assessmentLabel(p.at,true)+' &mdash; '+esc(p.term)+(p.session?' ('+esc(p.session)+')':'')+'</div>'
    +'<div class="ep-meta" style="font-size:7pt!important;"><span>'+esc(p.subj)+'</span> &bull; <span>'+esc(p.cls)+'</span>'+(marksLabel(total)?' &bull; <span>'+marksLabel(total)+'</span>':'')+'</div>'
    +'</div></div>';

  // Objectives — ultra compact inline
  if(objs.length){
    h+='<div class="ep-sec" style="font-size:7.5pt!important;">Section A &mdash; Objectives ('+objs.length+')</div>';
    objs.forEach(function(q,i){
      var opts=q.o&&q.o.length
        ? q.o.map(function(o,oi){ return '('+L[oi]+') '+esc(o); }).join(' ')
        : '';
      h+='<div class="ep-q-obj compact" style="font-size:8.5pt;">'+(i+1)+'. '+q.t+(opts?' '+opts:'')+'</div>';
    });
  }

  // Fill-in-blank
  if(fitbs.length){
    var fSec=objs.length?'B':'A';
    h+='<div class="ep-sec" style="font-size:7.5pt!important;">Section '+fSec+' &mdash; Fill in Blank</div>';
    fitbs.forEach(function(q,i){
      var t=q.t.replace(/_{2,}/g,'________');
      h+='<div class="ep-q compact" style="font-size:8.5pt;">'+(i+1)+'. '+esc(t)
        +(hasPositiveMarks(q)?' <span style="float:right;">['+questionMarks(q)+'m]</span>':'')+'</div>';
    });
  }

  // Theory
  if(ths.length){
    var tSec=objs.length&&fitbs.length?'C':objs.length||fitbs.length?'B':'A';
    h+='<div class="ep-sec" style="font-size:7.5pt!important;">Section '+tSec+' &mdash; Theory</div>';
    ths.forEach(function(q,i){
      h+='<div class="ep-q" style="font-size:8.5pt;">'+(i+1)+'. '+esc(q.t)
        +(hasPositiveMarks(q)?' <span style="float:right;">['+questionMarks(q)+'m]</span>':'')
        +'<div class="ep-ans compact"></div></div>';
    });
  }

  h+='<div class="ep-footer" style="font-size:6pt!important;">'+esc(p.ref)+' &bull; '+today+'</div>';
  return h;
}

/* ── Mirror Print — Horizontal 2-column, front & back ── */
function buildMirrorPrintFrame(papers,adm){
  var logo=adm.logo;
  var school=adm.school||'School';
  var address=adm.address||'';
  var wm=adm.watermark||'ExamEngine';
  var today=new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'});

  // We pair papers: Paper A left + Paper B right (front page)
  // Back page: Paper B left + Paper A right (interchanged)
  var html='';

  for(var i=0;i<papers.length;i+=2){
    var pA=papers[i];
    var pB=papers[i+1]||papers[i]; // If odd number, duplicate last

    var colA=buildMirrorColumn(pA,adm,today);
    var colB=(papers[i+1])?buildMirrorColumn(pB,adm,today):colA;

    // FRONT PAGE: A left | B right
    html+='<div class="mirror-page">'
      +'<div class="mirror-col mirror-col-left">'+colA+'</div>'
      +'<div class="mirror-col">'+colB+'</div>'
      +'</div>';

    // BACK PAGE: B left | A right (interchanged)
    if(papers[i+1]){
      html+='<div class="mirror-page">'
        +'<div class="mirror-col mirror-col-left">'+colB+'</div>'
        +'<div class="mirror-col">'+colA+'</div>'
        +'</div>';
    }
  }

  $('pp').innerHTML=html;
}

function buildMirrorColumn(p,adm,today){
  var logo=adm.logo;
  var school=adm.school||p.school||'School';
  var address=adm.address||'';
  var wm=adm.watermark||'';
  var qs=p.questions||[];
  var objs=qs.filter(function(q){ return q.k==='obj'; });
  var fitbs=qs.filter(function(q){ return q.k==='fitb'; });
  var ths=qs.filter(function(q){ return q.k==='theory'; });

  var h='';
  if(wm) h+='<div class="eco-watermark">'+esc(wm)+'</div>';

  // Header
  h+='<div class="eco-header">';
  if(logo) h+='<img class="eco-logo" src="'+logo+'"/>';
  h+='<div><div class="eco-school-name" style="font-size:9pt;font-weight:900;text-transform:uppercase;">'+esc(school)+'</div>';
  if(address) h+='<div style="font-size:6.5pt;text-transform:uppercase;">'+esc(address)+'</div>';
  h+='<div class="eco-paper-title">'+esc(p.subj)+' · '+esc(p.cls)+' · '+esc(p.term)+'</div>'
    +'</div></div>';

  // Questions — horizontal compact format
  if(objs.length){
    h+='<div class="eco-section-head">Section A — Objectives ('+objs.length+')</div>';
    objs.forEach(function(q,i){
      h+='<div class="eco-q" style="margin-bottom:1.5mm;">'+(i+1)+'. '+esc(q.t);
      if(q.o&&q.o.length) h+='<br/><span style="margin-left:3mm;">'+q.o.map(function(o,oi){ return L[oi]+'. '+esc(o); }).join(' &nbsp; ')+'</span>';
      h+='</div>';
    });
  }
  if(fitbs.length){
    var fLbl=objs.length?'B':'A';
    h+='<div class="eco-section-head">Section '+fLbl+' — Fill in the Blank ('+fitbs.length+')</div>';
    fitbs.forEach(function(q,i){
      h+='<div class="eco-q">'+(i+1)+'. '+esc((q.t||'').replace(/_{2,}/g,'____________'))+'</div>';
    });
  }
  if(ths.length){
    var tLbl=objs.length&&fitbs.length?'C':objs.length||fitbs.length?'B':'A';
    h+='<div class="eco-section-head">Section '+tLbl+' — Theory ('+ths.length+')</div>';
    ths.forEach(function(q,i){
      h+='<div class="eco-q">'+(i+1)+'. '+esc(q.t)+(hasPositiveMarks(q)?' ['+questionMarks(q)+'m]':'')+'</div>';
    });
  }
  h+='<div class="eco-footer"><span>'+esc(p.ref)+'</span><span>ExamEngine Pro v10</span></div>';
  return h;
}

/* ── ADMIN SETTINGS ──────────────────── */
function renderAdminSett(){
  var el=$('screen-admin-sett');
  el.style.display='block';
  var adm=getAdminSettings();
  var deadline=adm.deadline||'';
  var school=adm.school||'';
  var watermark=adm.watermark||'';
  var address=adm.address||'';

  el.innerHTML='<div class="pg fade">'
    +'<div class="ptl">Admin Settings</div>'
    +'<div class="pst">Configure exam deadlines, branding, and auto-generation triggers.</div>'

    +'<div class="card">'
    +'<div class="ct">Exam Submission Deadline</div>'
    +'<div style="font-size:12.5px;color:var(--mute);margin-bottom:14px;line-height:1.7;">'
    +'Set the final deadline for teachers to submit exam papers. After the deadline, the system can auto-generate any missing papers using OpenRouter.'
    +'</div>'
    +'<div class="fl"><label>Deadline Date &amp; Time</label>'
    +'<input type="datetime-local" class="fi" id="adminDeadlineInp" value="'+esc(deadline)+'" style="font-family:var(--mono);"/>'
    +'</div>'
    +'<div style="display:flex;gap:9px;margin-top:12px;flex-wrap:wrap;">'
    +'<button class="btn bp" onclick="saveDeadline()">💾 Save Deadline</button>'
    +'<button class="btn bq" onclick="clearDeadline()">🗑 Clear Deadline</button>'
    +'</div>'
    +'<div class="api-note" style="margin-top:12px;">⚡ When the deadline passes, go to the <strong>Production Queue</strong> and click <strong>Auto-Generate Missing</strong>.</div>'
    +'</div>'

    +'<div class="card">'
    +'<div class="ct">School Branding</div>'
    +'<div class="r2"><div>'
    +'<div class="fl"><label>School / Admin Name</label>'
    +'<input type="text" class="fi" id="adminSchNm" value="'+esc(school)+'" placeholder="e.g. Way To Success Standard Schools"/>'
    +'</div>'
    +'<div class="fl"><label>School Address</label>'
    +'<input type="text" class="fi" id="adminAddrInp" value="'+esc(address)+'" placeholder="e.g. Ifedapo Community, Oko/Ijado Road, Ejigbo Osun State"/>'
    +'</div>'
    +'<div class="fl"><label>Watermark Text</label>'
    +'<input type="text" class="fi" id="adminWmInp" value="'+esc(watermark)+'" placeholder="e.g. CONFIDENTIAL or School Name" maxlength="30"/>'
    +'<div style="font-size:11px;color:var(--mute);margin-top:4px;">Appears as a diagonal ghost text on all printed papers.</div>'
    +'</div>'
    +'<button class="btn bp" onclick="saveAdminBranding()">💾 Save Branding</button>'
    +'</div>'
    +'<div>'
    +'<label style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--mute);display:block;margin-bottom:8px;">School Logo</label>'
    +'<div class="brand-preview" id="logoPreview">'
    +(adm.logo?'<img class="brand-logo-preview" src="'+adm.logo+'" alt="Logo"/>':'<div class="dash-empty-ico" style="font-size:32px;">&#127978;</div><div style="font-size:11px;color:var(--mute);">No logo uploaded</div>')
    +(adm.watermark?'<div class="watermark-preview">'+esc(adm.watermark)+'</div>':'')
    +'</div>'
    +'<label class="upload-zone" style="margin-top:10px;display:block;cursor:pointer;">'
    +'<div class="upload-zone-ico">&#128193;</div>'
    +'<div class="upload-zone-text">Upload Logo (PNG/JPG, max 800KB)</div>'
    +'<input type="file" accept="image/png,image/jpeg,image/svg+xml" style="display:none;" onchange="uploadLogo(event)"/>'
    +'</label>'
    +(adm.logo?'<button class="btn bred bsm" onclick="removeLogo()" style="margin-top:6px;width:100%;">&#128465; Remove Logo</button>':'')
    +'</div></div></div>'

    +'<div class="card">'
    +'<div class="ct">\ud83c\udfa8 House Style Template <span style="font-size:11px;font-weight:400;color:var(--mute);margin-left:8px;">(Blank slate \u2014 applies to every printed paper)</span></div>'
    +'<div style="font-size:12.5px;color:var(--mute);margin-bottom:14px;line-height:1.7;">'
    +'Define your school\u2019s uniform exam paper layout. Leave fields blank until you\u2019re ready. <strong>All heading text you enter will render in <b>BOLD</b> automatically</strong> on every printed paper across all four modes (Split 2-in-1, Landscape, Portrait, Multi-Subject).'
    +'</div>'
    +(function(){
      var hs=getHouseStyle();
      return ''
      +'<div class="fl"><label>Top Heading (rendered bold, uppercase)</label>'
      +'<input type="text" class="fi" id="hsHeaderTop" value="'+esc(hs.headerTop)+'" placeholder="e.g. Federal Ministry of Education"/>'
      +'</div>'
      +'<div class="fl"><label>Extra Header Line (rendered bold)</label>'
      +'<input type="text" class="fi" id="hsHeaderExtra" value="'+esc(hs.headerExtra)+'" placeholder="e.g. West African Examinations Council"/>'
      +'</div>'
      +'<div class="fl"><label>Exam Title Override (rendered bold)</label>'
      +'<input type="text" class="fi" id="hsExamTitle" value="'+esc(hs.examTitle)+'" placeholder="e.g. Third Term Examination 2025/2026 Academic Session"/>'
      +'</div>'
      +'<div class="fl"><label>Student Info Strip (comma-separated fields)</label>'
      +'<input type="text" class="fi" id="hsStudentStrip" value="'+esc(hs.studentStrip)+'" placeholder="e.g. Name, Class, Adm No, Date"/>'
      +'<div style="font-size:11px;color:var(--mute);margin-top:4px;">Each field renders with a blank line for the student to fill in. Field labels render bold.</div>'
      +'</div>'
      +'<div class="fl"><label>General Instructions</label>'
      +'<textarea class="fi" id="hsInstructions" rows="3" placeholder="e.g. Answer ALL questions in Section A. Section B: attempt any FIVE questions. Time allowed: 2 hours." style="resize:vertical;">'+esc(hs.instructions)+'</textarea>'
      +'<div style="font-size:11px;color:var(--mute);margin-top:4px;">Body text \u2014 appears below the header on every paper. Use line breaks for multiple instructions.</div>'
      +'</div>'
      +'<div class="r2">'
      +'<div class="fl"><label>Footer Left (bold)</label>'
      +'<input type="text" class="fi" id="hsFooterLeft" value="'+esc(hs.footerLeft)+'" placeholder="e.g. Principal"/>'
      +'</div>'
      +'<div class="fl"><label>Footer Center (bold)</label>'
      +'<input type="text" class="fi" id="hsFooterCenter" value="'+esc(hs.footerCenter)+'" placeholder="e.g. School Motto"/>'
      +'</div>'
      +'</div>'
      +'<div class="fl"><label>Footer Right (bold)</label>'
      +'<input type="text" class="fi" id="hsFooterRight" value="'+esc(hs.footerRight)+'" placeholder="e.g. END OF PAPER"/>'
      +'</div>'
      +'<div style="display:flex;gap:9px;margin-top:12px;flex-wrap:wrap;">'
      +'<button class="btn bp" onclick="saveHouseStyleForm()">\ud83d\udcbe Save House Style</button>'
      +'<button class="btn bq" onclick="clearHouseStyleForm()">\ud83d\uddd1 Clear All Fields</button>'
      +'</div>';
    }())
    +'</div>'

    +'<div class="card">'
    +'<div class="ct">OpenRouter API Key</div>'
    +'<div class="fl"><div class="key-row">'
    +'<input type="password" class="fi" id="settKeyInp2" placeholder="sk-or-v1-…" value="'+esc(getEffectiveApiKey()||'')+'"/>'
    +'<button class="btn bq bsm" onclick="var i=$(\'settKeyInp2\');i.type=i.type===\'password\'?\'text\':\'password\'">👁</button>'
    +'</div></div>'
    +'<div class="api-note">Used for auto-generation when teachers miss the deadline.<br/>Auto-generation model: <strong>'+MODELS.autoGen+'</strong></div>'
    +'<div style="margin-top:12px;display:flex;gap:9px;">'
    +'<button class="btn bq" onclick="clearApiKey()">🗑 Clear</button>'
    +'<button class="btn bp" onclick="saveApiKeyAdmin()">💾 Save Key</button>'
    +'</div></div>'


    +'<div class="card">'
    +'<div class="ct">👥 User Management</div>'
    +'<div style="font-size:12.5px;color:var(--mute);margin-bottom:14px;line-height:1.7;">Invite teachers and manage admin roles. Only admins can access Production Queue and Digital Lab.</div>'
    +'<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:flex-end;">'
    +'<div class="fl" style="flex:1;margin:0;"><label>Email Address</label><input type="email" class="fi" id="inviteEmail" placeholder="teacher@school.edu.ng"/></div>'
    +'<div class="fl" style="margin:0;"><label>Role</label><select class="fs" id="inviteRole"><option value="teacher">Teacher</option><option value="admin">Admin</option></select></div>'
    +'<button class="btn bp bsm" onclick="inviteUser()">➕ Invite</button>'
    +'</div>'
    +'<div id="userMgmtArea"><div style="color:var(--mute);font-size:12px;">Loading…</div></div>'
    +'</div>'

    +'<div class="card">'
    +'<div class="ct">Data Management</div>'
    +'<div style="display:flex;gap:9px;flex-wrap:wrap;">'
    +'<button class="btn bq bsm" onclick="navTo(\'admin-dash\')">← Back to Production Queue</button>'
    +'</div></div>'

    +'</div>';
  // Load users after render
  setTimeout(function(){ renderUserManagement(); }, 100);
}

window.saveDeadline=function(){
  var v=($('adminDeadlineInp')||{}).value||'';
  if(!v){ toast('Pick a deadline date and time','warn'); return; }
  if(window._adminSettingsCache) window._adminSettingsCache.deadline=v;
  _supabase.from('admin_settings').upsert({key:'deadline',value:v},{onConflict:'key'});
  toast('Deadline saved: '+new Date(v).toLocaleString(),'ok');
  startDeadlineWatcher();
};
window.clearDeadline=function(){
  if(window._adminSettingsCache) window._adminSettingsCache.deadline='';
  _supabase.from('admin_settings').upsert({key:'deadline',value:''},{onConflict:'key'});
  clearTimeout(ADMIN._deadlineTimer);
  toast('Deadline cleared','ok');
  renderAdminSett();
};

window.clearAllData = async function(){
  if(!_supabase){ toast('Database not connected.','err'); return; }
  if(!CURRENT_USER){ toast('Not logged in.','err'); return; }
  if(CURRENT_USER.role !== 'admin'){ toast('Only admins can wipe the Production Queue.','err'); return; }
  var dash=document.getElementById('screen-admin-dash');
  if(!dash || dash.style.display === 'none'){
    toast('Wipe is only available from the Production Queue.','err');
    return;
  }
  if(!confirm('🚨 WARNING: Wipe ALL papers from the Production Queue? This cannot be undone.')) return;
  if(!confirm('🛑 ADMIN WARNING: Every teacher submission and generated paper will be removed.')) return;
  var wipeCode = prompt('Type "WIPE" to confirm wiping the Production Queue:');
  if(wipeCode !== 'WIPE') { toast('Wipe cancelled.','info'); return; }

  try {
    await _supabase.from('admin_settings').upsert({key:'wiped_at', value: Date.now().toString()},{onConflict:'key'});
    await _supabase.from('admin_settings').upsert({key:'lab_queue', value:'[]'},{onConflict:'key'});
    var res = await _supabase.from('papers').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if(res && res.error) throw new Error(res.error.message);
    window._publishedPapers = null;
    if(window._adminSettingsCache){
      window._adminSettingsCache.wiped_at = Date.now().toString();
      window._adminSettingsCache.lab_queue = '[]';
    }
    window._labQueue = [];
    window._printPapers = null;
    try { localStorage.removeItem('ee_draft'); } catch(ex){}
    try { sessionStorage.clear(); } catch(ex){}
    toast('✓ Production Queue wiped — reloading…', 'ok', 2000);
    setTimeout(function(){ window.location.reload(true); }, 1800);
  } catch(e) {
    toast('Wipe failed: ' + e.message, 'err');
  }
};
window.saveAdminBranding=function(){
  var sc=($('adminSchNm')||{}).value||'';
  var wm=($('adminWmInp')||{}).value||'';
  var addr=($('adminAddrInp')||{}).value||'';
  var br={school:sc.trim(),watermark:wm.trim(),address:addr.trim(),logo:(getAdminSettings().logo||'')};
  if(window._adminSettingsCache) Object.assign(window._adminSettingsCache,br);
  ['school','watermark','address','logo'].forEach(function(k){
    _supabase.from('admin_settings').upsert({key:k,value:br[k]},{onConflict:'key'});
  });
  toast('Admin branding saved ✓','ok');
  renderAdminPrint();
};
window.saveHouseStyleForm=function(){
  var hs={
    headerTop:(($('hsHeaderTop')||{}).value||'').trim(),
    headerExtra:(($('hsHeaderExtra')||{}).value||'').trim(),
    examTitle:(($('hsExamTitle')||{}).value||'').trim(),
    studentStrip:(($('hsStudentStrip')||{}).value||'').trim(),
    instructions:(($('hsInstructions')||{}).value||'').trim(),
    sectionLabel:'',
    footerLeft:(($('hsFooterLeft')||{}).value||'').trim(),
    footerCenter:(($('hsFooterCenter')||{}).value||'').trim(),
    footerRight:(($('hsFooterRight')||{}).value||'').trim()
  };
  if(saveHouseStyle(hs)){
    toast('\ud83c\udfa8 House Style saved \u2014 applies to ALL papers on next print','ok',4500);
  } else {
    toast('Could not save House Style','err');
  }
};
window.clearHouseStyleForm=function(){
  if(!confirm('Clear all House Style fields? This cannot be undone.')) return;
  ['hsHeaderTop','hsHeaderExtra','hsExamTitle','hsStudentStrip','hsInstructions','hsFooterLeft','hsFooterCenter','hsFooterRight'].forEach(function(id){
    var el=$(id); if(el) el.value='';
  });
  try{ window._houseStyleCache={}; _supabase.from('admin_settings').upsert({key:'house_style',value:'{}'},{onConflict:'key'}); }catch(e){}
  toast('House Style cleared','ok');
};
window.saveApiKeyAdmin=async function(){
  var v=cleanApiKey(($('settKeyInp2')||{}).value||'');
  if(v && !looksLikeOpenRouterKey(v)){ toast('Paste a valid OpenRouter sk-or-v1- key or Gemini AIza key','err',4500); return; }
  if(v) delete _badApiKeys[v];
  API_KEY=v;
  window._userApiKey=v;
  // Save to user_settings for this admin user
  await _saveSetting('api_key', v);
  // ALSO save to admin_settings so ALL devices/teachers share the same key
  var ok=await _saveAdminSetting('api_key',v);
  refreshApiStatus(); toast(ok?'API key saved ✓ — active across all devices':'API key saved locally, but global admin save failed',ok?'ok':'err',4500);
};

/* ── Deadline Watcher ────────────────── */
function startDeadlineWatcher(){
  clearTimeout(ADMIN._deadlineTimer);
  var dl=(window._adminSettingsCache&&window._adminSettingsCache.deadline)||''; if(!dl) return;
  var target=new Date(dl).getTime();
  function check(){
    var now=Date.now();
    if(now>=target){
      if(ROLE==='admin'&&S.screen==='admin-dash') renderAdminDash();
      return;
    }
    ADMIN._deadlineTimer=setTimeout(check, Math.min(target-now, 60000));
  }
  check();
}

/* ══════════════════════════════════════
   BOOT — Supabase Auth Gated
══════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', function(){
  // Enter key handlers
  ['authEmail','authPass'].forEach(function(id){
    var el=$(id); if(!el) return;
    el.addEventListener('keydown', function(e){ if(e.key==='Enter') doLogin(); });
  });
  ['regName','regEmail','regPass','regPass2'].forEach(function(id){
    var el=$(id); if(!el) return;
    el.addEventListener('keydown', function(e){ if(e.key==='Enter') doRegister(); });
  });

  // Small delay to ensure Supabase SDK is ready
  setTimeout(function(){
    if(!_supabase){
      showAuthScreen();
      showAuthErr('Could not connect to database. Check your internet and refresh.');
      return;
    }
    _supabase.auth.getSession().then(function(res){
      var session = res.data && res.data.session;
      if(session && session.user){
        _loadUserAndBoot(session.user);
      } else {
        showAuthScreen();
      }
    }).catch(function(e){
      showAuthScreen();
      showAuthErr('Session check failed: '+e.message);
    });

    _supabase.auth.onAuthStateChange(function(event, session){
      if(event === 'PASSWORD_RECOVERY'){
        showAuthScreen();
        completePasswordReset();
        return;
      }
      if(event === 'SIGNED_OUT' && !session){
        CURRENT_USER = null;
        showAuthScreen();
      }
    });
  }, 100);
});

/* ══════════════════════════════════════
   ADMIN — USER MANAGEMENT
══════════════════════════════════════ */
window.renderUserManagement = async function(){
  var el=$('userMgmtArea'); if(!el) return;
  el.innerHTML='<div style="color:var(--mute);font-size:12px;">Loading all registered users\u2026</div>';
  var res = await _supabase.from('profiles').select('*').order('created_at',{ascending:true});
  if(res.error){
    el.innerHTML='<div class="banner b-warn" style="font-size:12px;margin:0;">'
      +'<strong>\u26a0 Database policy blocks full user list.</strong><br/>'
      +'Run the updated <strong>supabase_fix.sql</strong> in Supabase SQL Editor to allow admins to read all profiles.<br/>'
      +'<span style="opacity:.7">Error: '+esc(res.error.message)+'</span>'
      +'</div>';
    return;
  }
  var blocked=await _getBlockedUsers();
  var users = (res.data||[]).filter(function(u){ return !blocked.find(function(b){ return b.id===u.id; }); });
  if(!users.length){
    el.innerHTML='<div style="color:var(--mute);font-size:12px;">No registered users found.</div>';
    return;
  }
  el.innerHTML='<div style="font-size:11px;color:var(--mute);margin-bottom:10px;">'+users.length+' registered user'+(users.length!==1?'s':'')+' across all devices</div>'
    +users.map(function(u){
      var isMe = CURRENT_USER && u.id === CURRENT_USER.id;
      var joined = u.created_at ? new Date(u.created_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '';
      return '<div class="user-row" style="gap:8px;flex-wrap:wrap;align-items:center;">'
        +'<div class="user-row-email" style="flex:1;min-width:140px;">'
        +esc(u.email||u.id)
        +(u.name&&u.name!==(u.email||'').split('@')[0]?' <span style="font-size:10.5px;color:var(--mute);">'+esc(u.name)+'</span>':'')
        +(isMe?' <span style="font-size:10px;color:var(--blue);font-weight:700;">\u2605 you</span>':'')
        +(joined?' <span style="font-size:10px;color:var(--mute);display:block;">Joined '+joined+'</span>':'')
        +'</div>'
        +'<span class="user-row-role '+esc(u.role)+'">'+esc(u.role)+'</span>'
        +(!isMe
          ?'<button class="btn bq bsm" style="font-size:11px;padding:5px 10px;" onclick="toggleUserRole(\''+u.id+'\',\''+u.role+'\')">'
            +(u.role==='admin'?'\u2192 Teacher':'\u2192 Admin')
            +'</button>'
            +'<button class="btn bred bsm" style="font-size:11px;padding:5px 10px;" onclick="removeUser(\''+u.id+'\',\''+esc(u.email||u.id)+'\')">Remove</button>'
          :'')
        +'</div>';
    }).join('');
};

window.toggleUserRole = async function(uid, currentRole){
  var newRole = currentRole === 'admin' ? 'teacher' : 'admin';
  var res = await _supabase.from('profiles').update({role: newRole}).eq('id', uid);
  if(res.error){ toast('Failed: '+res.error.message,'err'); return; }
  toast('Role updated to '+newRole+' ✓','ok');
  renderUserManagement();
};

window.removeUser = async function(uid, email){
  if(!uid || (CURRENT_USER&&uid===CURRENT_USER.id)) return;
  if(!confirm('Remove '+(email||'this user')+' from ExamEngine?')) return;
  var blocked=await _getBlockedUsers();
  if(!blocked.find(function(u){ return u&&u.id===uid; })){
    blocked.push({id:uid,email:email||'',removedAt:new Date().toISOString()});
    var blockRes=await _supabase.from('admin_settings').upsert({key:'blocked_users',value:JSON.stringify(blocked)},{onConflict:'key'});
    if(blockRes.error){ toast('Could not block user login: '+blockRes.error.message,'err'); return; }
  }
  var paperDel=await _supabase.from('papers').delete().eq('user_id',uid);
  if(paperDel.error){ console.warn('Could not remove user papers:',paperDel.error.message); }
  await _supabase.from('user_settings').delete().eq('user_id',uid);
  await _supabase.from('schemes').delete().eq('user_id',uid);
  // Profile deletion may fail due to RLS, but the user is blocked from logging in and hidden from the UI.
  await _supabase.from('profiles').delete().eq('id',uid);
  toast('User removed from ExamEngine','ok');
  renderUserManagement();
};

window.inviteUser = async function(){
  var email = ($('inviteEmail')||{}).value||'';
  email = email.trim().toLowerCase();
  if(!email){ toast('Enter an email address','warn'); return; }
  var role = ($('inviteRole')||{}).value||'teacher';
  // Create auth user via admin signup — user sets own password via email
  var res = await _supabase.auth.signUp({
    email: email,
    password: Math.random().toString(36).slice(-10)+'Aa1!', // temp password
    options: { data: { role: role } }
  });
  if(res.error){ toast('Invite failed: '+res.error.message,'err'); return; }
  if(res.data && res.data.user){
    await _supabase.from('profiles').upsert({
      id: res.data.user.id,
      email: email,
      name: email.split('@')[0],
      role: role
    });
  }
  toast('✓ User invited: '+email+' ('+role+')','ok',5000);
  var inp=$('inviteEmail'); if(inp) inp.value='';
  renderUserManagement();
};
