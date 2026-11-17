(() => {
'use strict';
let csrf = document.body.dataset.csrf;
let loggedIn = document.body.dataset.loggedIn === 'true';
let voiceEnabled = false, recognizing = false, speaking = false, processing = false, speechMuted = false, awaitingCommand = false;
let recognizer = null, history = [], voiceChoices = [];
let restartTimer = null, commandTimer = null, restartCount = 0, recognitionGeneration = 0;
let lastWake = 0, voiceFatal = false;
let utteranceGeneration = 0;
const el = id => document.getElementById(id);
const api = async (url, options = {}) => {
  const method = options.method || 'GET';
  const response = await fetch(url, {credentials:'same-origin', ...options,headers:{'Content-Type':'application/json', ...(method!=='GET'?{'X-Jarvis-CSRF':csrf}:{}),...(options.headers||{})}});
  const json = await response.json().catch(()=>({error:'Unexpected response from server'}));
  if (!response.ok) throw Error(json.error||`HTTP ${response.status}`);
  return json;
};
const err = (e) => alert(e.message||String(e));
function showApp(){ el('loginScreen').hidden=true;el('appScreen').hidden=false; status(); refreshVoiceList(); drawTasks(); }
el('loginForm').addEventListener('submit', async event=>{event.preventDefault(); try {let result=await api('/api/login',{method:'POST',body:JSON.stringify({password:el('password').value})});csrf=result.csrf;loggedIn=true;el('password').value='';showApp();}catch(e){el('loginError').textContent=e.message;}});
el('logoutBtn').onclick = async()=>{stopVoice();try{await api('/api/logout',{method:'POST'});location.reload();}catch(e){err(e);}};
document.querySelectorAll('.nav').forEach(btn=>btn.onclick=()=>{document.querySelectorAll('.nav').forEach(b=>{ b.classList.toggle('active',b===btn); if(b===btn)b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current'); });document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.id===btn.dataset.tab));if(btn.dataset.tab==='mail') loadMail();});
const addBubble=(text,kind)=>{let d=document.createElement('div');d.className='bubble '+kind;d.textContent=text;el('messages').appendChild(d);el('messages').scrollTop=el('messages').scrollHeight;return d;};
async function status(){try{let s=await api('/api/status');el('systemStatus').textContent=s.ai_configured?'AI ONLINE':'AI NOT CONFIGURED';el('aiMode').textContent=s.ai_configured?'CLOUD AI · '+s.model:'SETUP REQUIRED';el('settingsAI').textContent=s.ai_configured?`Connected to cloud AI (${s.model}). Ollama is not required.`:'Set GEMINI_API_KEY in hosting settings.';el('gmailState').textContent=s.gmail_connected?'Google account connected (read-only).':s.gmail_configured?'Not connected. Click CONNECT GOOGLE GMAIL.':'Set Google OAuth credentials and COLLEGE_GMAIL_EMAIL in hosting settings first.';}catch(e){el('systemStatus').textContent='SESSION EXPIRED';}}
async function sendMessage(text){ if(processing)return;let message=text.trim();if(!message)return;const campusAnswer=window.JarvisCampus?.answer(message);if(campusAnswer!==null&&campusAnswer!==undefined){addBubble(message,'user');addBubble(campusAnswer,'bot');el('promptInput').value='';speak(campusAnswer);return;}const portalAnswer=window.JarvisSRM?.answer(message);if(portalAnswer!==null&&portalAnswer!==undefined){addBubble(message,'user');addBubble(portalAnswer,'bot');el('promptInput').value='';speak(portalAnswer);return;}processing=true; addBubble(message,'user');let thinking=addBubble('Processing your request…','bot');el('promptInput').value='';try{let result=await api('/api/chat',{method:'POST',body:JSON.stringify({message,history})});thinking.textContent=result.reply;history.push({role:'user',text:message},{role:'model',text:result.reply});history=history.slice(-8);speak(result.reply);}catch(e){thinking.textContent=e.message;}finally{processing=false;if(!speaking)scheduleListening(300);}}
el('chatForm').onsubmit=e=>{e.preventDefault();sendMessage(el('promptInput').value);};
function refreshVoiceList(){if(!('speechSynthesis' in window))return;voiceChoices=speechSynthesis.getVoices();let select=el('voiceSelect'),saved=localStorage.getItem('jarvis_voice')||'';select.replaceChildren();let list=[...voiceChoices].sort((a,b)=>(b.lang==='en-GB')-(a.lang==='en-GB'));list.forEach(v=>{let o=document.createElement('option');o.value=v.name;o.textContent=`${v.name} (${v.lang})`;select.appendChild(o);});let preferred=list.find(v=>v.name===saved)||list.find(v=>v.lang==='en-GB')||list.find(v=>v.lang.startsWith('en'));if(preferred)select.value=preferred.name;}
if('speechSynthesis' in window){speechSynthesis.onvoiceschanged=refreshVoiceList;refreshVoiceList();}
el('voiceSelect').onchange=()=>localStorage.setItem('jarvis_voice',el('voiceSelect').value);
function speak(text) {
  if (speechMuted || !('speechSynthesis' in window)) return;
  const generation = ++utteranceGeneration;
  speaking = true;
  if (recognizing) recognizer.abort();
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.slice(0, 1100));
  utterance.lang = 'en-GB';
  utterance.rate = Number(el('rateSlider').value);
  utterance.pitch = .93;
  const voice = voiceChoices.find(option => option.name === el('voiceSelect').value);
  if (voice) utterance.voice = voice;
  const resume = () => {
    if (generation !== utteranceGeneration) return;
    speaking = false;
    scheduleListening(300);
  };
  utterance.onend = resume;
  utterance.onerror = resume;
  speechSynthesis.speak(utterance);
}
el('voiceTest').onclick=()=>speak('Good evening. Campus JARVIS online and ready to assist you.');
el('muteBtn').onclick=()=>{speechMuted=!speechMuted;el('muteBtn').textContent=speechMuted?'🔇 SPEECH OFF':'🔊 SPEECH ON';if(speechMuted&&window.speechSynthesis){utteranceGeneration++;speechSynthesis.cancel();speaking=false;scheduleListening(200);}};
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
function setVoiceStatus(message, title) {
  el('voiceState').textContent = message;
  if (title) el('orbTitle').textContent = title;
}
function clearVoiceTimers() {
  if (restartTimer) clearTimeout(restartTimer);
  if (commandTimer) clearTimeout(commandTimer);
  restartTimer = null; commandTimer = null;
}
function scheduleListening(delay = 450) {
  if (!voiceEnabled || voiceFatal || speaking || processing || recognizing || restartTimer) return;
  restartTimer = setTimeout(() => {
    restartTimer = null;
    startListening();
  }, delay);
}
function startListening() {
    if (!voiceEnabled || voiceFatal || speaking || processing || recognizing || !recognizer) return;
    try { recognizer.start(); }
    catch (e) {
      if (e.name !== 'InvalidStateError') {
        restartCount = Math.min(restartCount + 1, 7);
        setVoiceStatus('RECONNECTING MICROPHONE…');
        scheduleListening(Math.min(8000, 500 * Math.pow(2, restartCount)));
      } else scheduleListening(800);
    }
}
function stopVoice() {
  el('voiceToggle').setAttribute('aria-pressed', 'false');
  voiceEnabled = false; awaitingCommand = false; voiceFatal = false;
  recognitionGeneration++;
  clearVoiceTimers();
  if (recognizer) { try { recognizer.abort(); } catch (_) {} }
  recognizing = false;
  el('voiceToggle').textContent = '🎙 ENABLE HEY JARVIS';
  setVoiceStatus('VOICE MODE DISABLED', 'AWAITING ACTIVATION');
}
function awaitNextCommand() {
  awaitingCommand = true;
  if (commandTimer) clearTimeout(commandTimer);
  commandTimer = setTimeout(() => {
    awaitingCommand = false;
    commandTimer = null;
    if (voiceEnabled) setVoiceStatus('LISTENING FOR JARVIS', 'WAKE WORD STANDBY');
  }, 14000);
}
function getWakeCommand(heard) {
  // Require the wake phrase at the START: don't activate for general mentions of Jarvis.
  // Narrow alternate spellings cover common transcription errors, not generic words.
  const match = heard.match(/^\s*(?:(?:hey|hi|okay|ok)\s+)?(?:jarvis|jarviss|jarviz|jervis)\b[\s,.:!?-]*(.*)$/i);
  return match ? match[1].trim() : null;
}
function activateVoice() {
  if (!SpeechRecognition) {
    alert('Your browser does not support speech recognition here. Try Microsoft Edge or Chrome on Windows.');
    return;
  }
  voiceEnabled = true; voiceFatal = false; awaitingCommand = false;
  restartCount = 0; lastWake = 0;
  const generation = ++recognitionGeneration;
  clearVoiceTimers();
  recognizer = new SpeechRecognition();
  recognizer.continuous = true;
  recognizer.interimResults = false;
  recognizer.maxAlternatives = 3;
  recognizer.lang = 'en-IN';
  recognizer.onstart = () => {
    if (generation !== recognitionGeneration) return;
    recognizing = true;
    setVoiceStatus('LISTENING FOR JARVIS', awaitingCommand ? 'LISTENING TO YOUR COMMAND' : 'WAKE WORD STANDBY');
  };
  recognizer.onend = () => {
    if (generation !== recognitionGeneration) return;
    recognizing = false;
    if (voiceEnabled && !speaking && !processing && !voiceFatal) {
      setVoiceStatus('RECONNECTING MICROPHONE…');
      scheduleListening(restartCount ? Math.min(8000, 500 * Math.pow(2, restartCount)) : 400);
    }
  };
  recognizer.onerror = event => {
    if (generation !== recognitionGeneration) return;
    const error = event.error || 'unknown';
    if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(error)) {
      voiceFatal = true;
      stopVoice();
      alert('Microphone permission or audio input is unavailable. Check browser microphone permissions and Windows microphone settings.');
    } else if (error === 'network') {
      restartCount = Math.min(restartCount + 1, 7);
      setVoiceStatus('SPEECH SERVICE OFFLINE — RETRYING');
      // onend will run afterward; restarting is deliberately delayed.
    }
  };
  recognizer.onresult = event => {
    if (!voiceEnabled || speaking || processing || generation !== recognitionGeneration) return;
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (!event.results[i].isFinal) continue;
      const alternatives = Array.from(event.results[i]).map(a => (a.transcript || '').trim()).filter(Boolean);
      if (!alternatives.length) continue;
      restartCount = 0;
      const matched = alternatives.map(getWakeCommand).find(x => x !== null);
      if (matched !== undefined) {
        if (Date.now() - lastWake < 900) continue;
        lastWake = Date.now();
        if (matched) {
          awaitingCommand = false;
          if (commandTimer) clearTimeout(commandTimer);
          commandTimer = null;
          handleVoiceCommand(matched);
          return;
        } else {
          awaitNextCommand();
          setVoiceStatus('WAKE WORD DETECTED', 'YES, I AM LISTENING');

        }
      } else if (awaitingCommand) {
        awaitingCommand = false;
        if (commandTimer) clearTimeout(commandTimer);
        commandTimer = null;
        handleVoiceCommand(alternatives[0]);
        return;
      }
    }
  };
  el('voiceToggle').setAttribute('aria-pressed', 'true');
  el('voiceToggle').textContent = '■ STOP LISTENING';
  setVoiceStatus('STARTING MICROPHONE…', 'WAKE WORD STANDBY');
  startListening();
}
function handleVoiceCommand(command){let lc=command.toLowerCase();const ca=window.JarvisCampus?.answer(command);if(ca!==null&&ca!==undefined){addBubble(command,'user');addBubble(ca,'bot');speak(ca);return;}if(window.JarvisSRM?.isPortalQuery(lc)){const answer=window.JarvisSRM.answer(command);addBubble(command,'user');addBubble(answer,'bot');speak(answer);return;}if(/\b(mail|email|inbox|notice|unread)\b/.test(lc)){document.querySelector('[data-tab="mail"]').click();let q=lc.includes('unread')?'is:unread':lc.includes('important')||lc.includes('notice')?'exam OR assignment OR deadline OR placement':'';el('mailQuery').value=q;loadMail(q,true);return;}sendMessage(command);}
el('voiceToggle').onclick=()=>voiceEnabled?stopVoice():activateVoice();
el('connectMail').onclick=()=>{window.location.href='/auth/google';};
el('refreshMail').onclick=()=>loadMail();
el('mailSearch').onsubmit=e=>{e.preventDefault();loadMail(el('mailQuery').value);};
el('disconnectMail').onclick=async()=>{if(!confirm('Disconnect your college Gmail from this JARVIS website?'))return;try{await api('/api/mail/disconnect',{method:'POST'});status();el('mailItems').replaceChildren();el('mailDetail').hidden=true;}catch(e){err(e);}};
async function loadMail(query='',announce=false){let output=el('mailItems');output.textContent='Loading inbox…';el('mailDetail').hidden=true;try{const data=await api('/api/mail?q='+encodeURIComponent(query));output.replaceChildren();if(!data.messages.length)output.textContent='No messages found.';let priority=data.messages.filter(m=>m.important);data.messages.sort((a,b)=>Number(b.important)-Number(a.important));for(const m of data.messages){let div=document.createElement('div');div.className='mail-item';let meta=document.createElement('div');meta.className='mail-meta';let from=document.createElement('span');from.textContent=m.from;let date=document.createElement('span');date.textContent=m.date;meta.append(from,date);let title=document.createElement('strong');title.textContent=m.subject+(m.unread?' ●':'');if(m.important){let tag=document.createElement('span');tag.className='important';tag.textContent='POTENTIALLY IMPORTANT';title.append(tag);}let snippet=document.createElement('p');snippet.textContent=m.snippet;div.append(meta,title,snippet);div.onclick=()=>readMail(m.id);output.append(div);}if(announce)speak(`I found ${data.count} recent emails. ${priority.length} may contain important college updates.`);}catch(e){output.textContent=e.message;if(announce)speak(e.message);}}
async function readMail(id){let box=el('mailDetail');box.hidden=false;box.textContent='Reading message…';try{let data=await api('/api/mail/'+encodeURIComponent(id)),m=data.message;box.replaceChildren();let h=document.createElement('h3');h.textContent=m.subject;let by=document.createElement('p');by.textContent=m.from+' · '+m.date;let body=document.createElement('div');body.className='mailbody';body.textContent=m.body;let button=document.createElement('button');button.className='subtle';button.textContent='🔊 READ ALOUD';button.onclick=()=>speak(m.subject+'. '+m.body.slice(0,850));box.append(h,by,body,button);box.scrollIntoView({behavior:'smooth',block:'nearest'});}catch(e){box.textContent=e.message;}}
let tasks=[];try{tasks=JSON.parse(localStorage.getItem('jarvis_tasks')||'[]');if(!Array.isArray(tasks))tasks=[];}catch(_){tasks=[];}
function drawTasks(){let out=el('taskList');out.replaceChildren();if(!tasks.length){let p=document.createElement('p');p.className='muted';p.textContent='No tasks yet. Add your first study goal.';out.append(p);}tasks.forEach((task,i)=>{let row=document.createElement('div');row.className='task'+(task.done?' done':'');let cb=document.createElement('input');cb.type='checkbox';cb.checked=!!task.done;cb.onchange=()=>{tasks[i].done=cb.checked;saveTasks();};let text=document.createElement('span');text.textContent=task.text;let date=document.createElement('small');date.textContent=task.date||'';let del=document.createElement('button');del.className='subtle';del.textContent='×';del.onclick=()=>{tasks.splice(i,1);saveTasks();};row.append(cb,text,date,del);out.append(row);});}
function saveTasks(){localStorage.setItem('jarvis_tasks',JSON.stringify(tasks));drawTasks();}
el('taskForm').onsubmit=e=>{e.preventDefault();tasks.push({text:el('taskText').value.trim(),date:el('taskDate').value,done:false});el('taskText').value='';el('taskDate').value='';saveTasks();};
if(loggedIn)showApp();
})();
