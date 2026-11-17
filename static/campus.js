(()=>{
'use strict';
const $=id=>document.getElementById(id);
const read=(key,fallback)=>{try{const value=JSON.parse(localStorage.getItem(key));return Array.isArray(value)?value:fallback}catch{return fallback}};
const save=(key,val)=>localStorage.setItem(key,JSON.stringify(val));
const MARKS='jarvis_srm_marks_v1', NOTES='jarvis_campus_notes_v1', DECK='jarvis_flashcards_v1';
const validName = row => typeof row?.name === 'string' && row.name.trim().length > 0 && row.name.length <= 120;
const validMarks = row => validName(row) && Number.isFinite(row.score) &&
  Number.isFinite(row.maximum) && row.maximum > 0 && row.score >= 0 && row.score <= row.maximum;
let marks=read(MARKS,[]).filter(validMarks), notes=read(NOTES,[]).filter(n=>typeof n?.text==='string'),
  cards=read(DECK,[]).filter(c=>typeof c?.question==='string' && typeof c?.answer==='string');
const appendText=(parent,tag,text,cls='')=>{let e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;parent.append(e);return e;};
function renderMarks(){const target=$('srmMarksList');if(!target)return;target.replaceChildren();const valid=marks.filter(m=>m.maximum>0);if(!valid.length){appendText(target,'p','No internal marks imported yet. Use the SRM browser extension while viewing your marks page, then import the file.','muted');return;}const total=valid.reduce((s,m)=>s+m.score,0),max=valid.reduce((s,m)=>s+m.maximum,0);appendText(target,'h3',`Visible internal marks: ${total.toFixed(1)} / ${max.toFixed(1)} (${(100*total/max).toFixed(1)}%)`);for(const m of valid){const row=document.createElement('div');row.className='campus-list-row';appendText(row,'strong',[m.name,m.code,m.assessment].filter(Boolean).join(' · '));appendText(row,'span',`${m.score} / ${m.maximum} • ${(100*m.score/m.maximum).toFixed(1)}%`);target.append(row);}}
function mergeRows(previous, incoming, assessment = false) {
  const normalize = value => String(value || '').trim().toLowerCase();
  const identity = row => normalize(row.code || row.name) + '|' + (assessment ? normalize(row.assessment) : '');
  const rows = new Map(previous.map(row => [identity(row), row]));
  for (const row of incoming) {
    for (const [key, old] of rows) {
      if (!old.code && row.code && normalize(old.name) === normalize(row.name) &&
          (!assessment || !old.assessment || normalize(old.assessment) === normalize(row.assessment))) rows.delete(key);
    }
    rows.set(identity(row), row);
  }
  return [...rows.values()];
}

async function importSRM(file) {
  if (!file || file.size > 1000000) throw Error('Select a JSON file up to 1 MB.');
  let json;
  try { json = JSON.parse(await file.text()); }
  catch { throw Error('Select a valid JSON file.'); }
  if (json?.schema !== 'campus-jarvis-srm-v1') throw Error('Use an export from the JARVIS SRM extension.');
  const attendance = Array.isArray(json.attendance) ? json.attendance : [];
  const incoming = Array.isArray(json.marks) ? json.marks : [];
  const validAttendance = row => validName(row) && Number.isSafeInteger(row.attended) &&
    Number.isSafeInteger(row.held) && row.held > 0 && row.attended >= 0 && row.attended <= row.held;
  const label = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
  const cleanAttendance = attendance.filter(validAttendance).map(row => ({
    name: row.name.trim(), code: label(row.code, 40), attended: row.attended, held: row.held
  }));
  const cleanMarks = incoming.filter(validMarks).map(row => ({
    name: row.name.trim(), code: label(row.code, 40), assessment: label(row.assessment, 120),
    score: row.score, maximum: row.maximum
  }));
  if (!cleanAttendance.length && !cleanMarks.length) throw Error('No valid attendance or marks rows found.');
  if (cleanAttendance.length) {
    const key = 'campus_jarvis_srm_attendance_v1';
    save(key, mergeRows(read(key, []).filter(validAttendance), cleanAttendance));
    window.dispatchEvent(new Event('jarvis-srm-imported'));
  }
  if (cleanMarks.length) {
    const updated = mergeRows(marks, cleanMarks, true);
    save(MARKS, updated);
    marks = updated;
    renderMarks();
  }
  const skipped = attendance.length + incoming.length - cleanAttendance.length - cleanMarks.length;
  $('importResult').textContent = `Processed ${cleanAttendance.length} attendance rows and ${cleanMarks.length} marks rows.` +
    (skipped ? ` Skipped ${skipped} invalid rows.` : '') + ' Saved in this browser.';
}
$('srmImport').addEventListener('change',async e=>{try{await importSRM(e.target.files?.[0]);}catch(err){$('importResult').textContent=err.message;}finally{e.target.value='';}});
$('clearMarks').onclick=()=>{if(confirm('Delete locally imported internal marks?')){marks=[];localStorage.removeItem(MARKS);renderMarks();}};
function renderNotes(){const area=$('quickNotes');area.replaceChildren();notes.forEach((n,i)=>{const row=document.createElement('div');row.className='campus-list-row';appendText(row,'span',n.text);const b=appendText(row,'button','×','subtle');b.setAttribute('aria-label','Remove note');b.onclick=()=>{notes.splice(i,1);save(NOTES,notes);renderNotes();};area.append(row);});}
$('quickNoteForm').onsubmit=e=>{e.preventDefault();const text=$('quickNoteInput').value.trim();if(!text)return;notes.push({text:text.slice(0,240)});notes=notes.slice(-60);save(NOTES,notes);$('quickNoteInput').value='';renderNotes();};
function renderCards(){const list=$('flashList');list.replaceChildren();for(const [i,c] of cards.entries()){const row=document.createElement('div');row.className='campus-list-row';appendText(row,'span',c.question);const b=appendText(row,'button','Remove','subtle');b.onclick=()=>{cards.splice(i,1);save(DECK,cards);renderCards();};list.append(row);} }
$('flashForm').onsubmit=e=>{e.preventDefault();const question=$('flashQ').value.trim(),answer=$('flashA').value.trim();if(!question||!answer)return;cards.push({question:question.slice(0,160),answer:answer.slice(0,300)});cards=cards.slice(-80);save(DECK,cards);$('flashForm').reset();renderCards();};
let currentCard;
$('flashTest').onclick = () => {
  const candidates = cards.filter(card => card !== currentCard);
  const deck = candidates.length ? candidates : cards;
  currentCard = deck[Math.floor(Math.random() * deck.length)];
  $('flashOutput').textContent = currentCard ? 'Question: ' + currentCard.question : 'Add a flashcard first.';
};
$('flashReveal').onclick = () => {
  $('flashOutput').textContent = cards.includes(currentCard) ? 'Answer: ' + currentCard.answer : 'Pick a card first.';
};
const prompts=['Explain one topic to yourself in 60 seconds.','Spend 10 minutes reviewing your weakest subject.','Try five practice questions without checking notes.','Write three questions about your next class.','Take a short screen break and stretch.','Summarize today’s lecture in five lines.'];
$('challengeBtn').onclick=()=>{$('challengeText').textContent=prompts[Math.floor(Math.random()*prompts.length)];};
const focusKey = 'jarvis_focus_v1';
const duration = 25 * 60;
const savedFocus = read(focusKey, []);
let remaining = Number.isInteger(savedFocus[0]) && savedFocus[0] >= 0 && savedFocus[0] <= duration ? savedFocus[0] : duration;
let endAt = Number.isFinite(savedFocus[1]) && savedFocus[1] <= Date.now() + duration * 1000 ? savedFocus[1] : 0;
let interval;
const fmt = seconds => `${String(Math.floor(seconds / 60)).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}`;
function showClock() {
  if (endAt) {
    remaining = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
    if (!remaining) {
      endAt = 0;
      clearInterval(interval);
      save(focusKey, [remaining, endAt]);
    }
  }
  $('focusClock').textContent = fmt(remaining);
  $('focusState').textContent = endAt ? 'Focus session active' :
    remaining === 0 ? 'Focus session complete!' : remaining === duration ? 'Ready' : 'Paused';
  $('focusStart').disabled = Boolean(endAt);
  $('focusPause').disabled = !endAt;
}
function updateClock() {
  clearInterval(interval);
  if (endAt) interval = setInterval(showClock, 400);
  save(focusKey, [remaining, endAt]);
  showClock();
}
$('focusStart').onclick = () => {
  if (endAt) return;
  if (!remaining) remaining = duration;
  endAt = Date.now() + remaining * 1000;
  updateClock();
};
$('focusPause').onclick = () => {
  showClock();
  endAt = 0;
  updateClock();
};
$('focusReset').onclick = () => {
  endAt = 0;
  remaining = duration;
  updateClock();
};
if (endAt) interval = setInterval(showClock, 400);
document.addEventListener('visibilitychange', showClock);
function answer(query){const text=query.toLowerCase();if(/\b(quiz|flashcard|revision challenge|focus timer|pomodoro|study mode|entertainment|music|break time)\b/.test(text)){document.querySelector('[data-tab="campus"]')?.click();if(/focus|pomodoro|study mode/.test(text))return 'Campus focus timer is ready in the Campus Hub. Start a 25-minute study session there.';if(/quiz|flashcard/.test(text))return 'Open the Campus Hub flashcard trainer. Add questions and answers, then test yourself.';return 'I opened your Campus Hub with study, entertainment, and focus tools.';}
if(/\b(marks?|internal|test score|score in|grades?)\b/.test(text)&&!/\b(?:email|mail)\b/.test(text)){document.querySelector('[data-tab="srm"]')?.click();if(!marks.length)return 'Internal marks are not imported yet. Use the SRM importer extension on your Internal Mark Details page, then import the JSON file.';const matches=marks.filter(m=>text.includes(m.name.toLowerCase())|| (m.name.toLowerCase().includes('programming')&&text.includes('programming'))||(m.name.toLowerCase().includes('calculus')&&text.includes('math'))||(m.name.toLowerCase().includes('chemistry')&&text.includes('chemistry')));if(matches.length)return matches.map(m=>`${m.name}${m.assessment ? " (" + m.assessment + ")" : ""}: ${m.score} out of ${m.maximum}.`).join(" ");const weakest=[...marks].sort((a,b)=>a.score/a.maximum-b.score/b.maximum)[0];return `I have internal marks for ${marks.length} marks records. The lowest percentage in the imported snapshot is ${weakest.name}, ${Math.round(weakest.score/weakest.maximum*100)} percent. Check the SRM tab for all marks.`;}
return null;}
window.JarvisCampus={answer};renderMarks();renderNotes();renderCards();showClock();
})();
