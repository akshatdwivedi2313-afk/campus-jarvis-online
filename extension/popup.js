'use strict';
const result=document.getElementById('result');
document.getElementById('extract').addEventListener('click',async()=>{
 try{
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  const url=new URL(tab.url);
  if(url.origin!=='https://sp.srmist.edu.in')throw Error('Open the official sp.srmist.edu.in portal first.');
  const output=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{
   if (location.origin !== 'https://sp.srmist.edu.in') return null;
   const clean=s=>(s||'').replace(/\s+/g,' ').trim();
   const tables=Array.from(document.querySelectorAll('table'));
   const attendance=[],marks=[];
   for(const table of tables){
    const rows=Array.from(table.querySelectorAll('tr')).map(row=>Array.from(row.querySelectorAll('th,td')).map(cell=>clean(cell.innerText)));
    for (const [i, headers] of rows.entries()) {
     const head = headers.map(value => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
     const col = pattern => head.findIndex(value => pattern.test(value));
     const nameIdx = col(/^(?:course description|subject description|description|course title|subject title|course name|subject name|subject|course)$/);
     const codeIdx = col(/^(?:(?:course|subject) )?code$/);
     const attendedIdx = col(/^(?:att hours|attended(?: hours| classes)?|present hours|hours attended|classes attended)$/);
     const heldIdx = col(/^(?:max hours|conducted(?: hours| classes)?|total hours|held|hours conducted|classes held|total classes)$/);
     const assessmentIdx = col(/^(?:assessment(?: name)?|test(?: name)?|exam(?: name)?)$/);
     const scoreIdx = col(/^(?:marks obtained|obtained marks|score|scored marks)$/);
     const maxIdx = col(/^(?:max(?:imum)? marks|total marks|out of)$/);
     const markColumns = head.map((value, index) => ({value, index})).filter(({value}) =>
      /^(?:mark max|marks max|marks|total|(?:ct|ca|test|quiz|assignment|internal|assessment|lab test)(?: \d+)?)(?: \d+(?: \d+)?)?$/.test(value));
     const hasAttendance = attendedIdx >= 0 && heldIdx >= 0;
     const hasSplitMarks = scoreIdx >= 0 && maxIdx >= 0;
     if (nameIdx < 0 || (!hasAttendance && !hasSplitMarks && !markColumns.length)) continue;

     const number = value => /^\d+(?:\.\d+)?$/.test(value || '') ? Number(value) : NaN;
     for (const cells of rows.slice(i + 1)) {
      const name = clean(cells[nameIdx]);
      if (!name || /^(total|grand total)$/i.test(name) || name.length > 120) continue;
      const code = codeIdx >= 0 ? clean(cells[codeIdx]).slice(0, 40) : '';
      if (hasAttendance) {
       const held = number(cells[heldIdx]), attended = number(cells[attendedIdx]);
       if (Number.isSafeInteger(held) && held > 0 && Number.isSafeInteger(attended) && attended <= held) {
        attendance.push({name, code, held, attended});
       }
      }
      const assessment = clean(cells[assessmentIdx]).slice(0, 120);
      const rowMarks = [];
      const addMark = (label, score, maximum) => {
       if (Number.isFinite(score) && Number.isFinite(maximum) && maximum > 0 && score <= maximum) {
        rowMarks.push({name, code, assessment: label, score, maximum});
       }
      };
      if (hasSplitMarks) addMark(assessment, number(cells[scoreIdx]), number(cells[maxIdx]));
      else {
       for (const {value, index} of markColumns) {
        const pair = (cells[index] || '').match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
        if (pair) addMark(assessment || (/^marks?(?: max)?$/.test(value) ? '' : headers[index]), Number(pair[1]), Number(pair[2]));
       }
      }
      const assessments = rowMarks.filter(row => !/^total(?:\b|$)/i.test(row.assessment));
      marks.push(...(assessments.length ? assessments : rowMarks));
     }
     break;
    }
   }
   return {schema:'campus-jarvis-srm-v1',source:'SRM portal manually viewed page',exportedAt:new Date().toISOString(),attendance,marks};
  }});
  const data=output[0].result;
  if (!data || (!data.attendance.length && !data.marks.length))throw Error('No supported table found. Open Attendance Details or Internal Mark Details first.');
  const json=JSON.stringify(data,null,2);
  const dataUrl='data:application/json;charset=utf-8,'+encodeURIComponent(json);
  await chrome.scripting.executeScript({target:{tabId:tab.id},func:(url)=>{const a=document.createElement('a');a.href=url;a.download='srm-jarvis-'+new Date().toISOString().slice(0,10)+'.json';document.body.append(a);a.click();a.remove();},args:[dataUrl]});
  result.textContent=`Exported ${data.attendance.length} attendance rows and ${data.marks.length} marks rows. Open JARVIS → SRM Portal → Import JSON.`;
 }catch(e){result.textContent=e.message;}
});
