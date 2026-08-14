const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, 'public');
const dataPath = path.join(__dirname, 'quiz-data.json');

const questions = [
  ['Hair Care', 'Как се нарича новата най-висока серия уреди Philips за грижа за косата?', ['Philips Aqua SenseIQ','Philips MoistureCare Pro','Philips StyleSense Elite','Philips HydroGlow Premium'], 0],
  ['Hair Care', 'Какъв процент от естествената влага на косата запазва Philips Aqua SenseIQ?', ['85%','90%','95%','99,9%'], 3],
  ['Lumea', 'До колко години гладка кожа могат да очакват потребителите от новата Lumea Серия 9900 Pro?', ['До 2 години','До 3 години','До 5 години','До 6 месеца'], 2],
  ['Lumea', 'До какъв процент намаляване на окосмяването могат да очакват потребителите след само 2 сесии?', ['50%','65%','80%','90%'], 2],
  ['Sonicare', 'Каква допълнителна информация получават потребителите с новата четка Sonicare DiamondClean 9900 Prestige?', ['Насоки в реално време за почистването на различните участъци в устата','Информация за натиска в реално време','Персонализирани насоки за по-добро миене','Всичко отгоре'], 3],
  ['Sonicare', 'Колко режима на работа има Sonicare DiamondClean 9900 Prestige?', ['5 режима и 3 интензитета','6 режима и 3 интензитета','8 режима и 3 интензитета','10 режима и 3 интензитета'], 2],
  ['Grooming', 'До каква дължина бръсне електрическата самобръсначка Philips i9000 Prestige Ultra благодарение на системата Lift&Cut?', ['0,08 mm','-0,02 mm','-0,08 mm','0 mm'], 2],
  ['Grooming', 'Колко режима на работа има електрическата самобръсначка Philips i9000 Prestige Ultra?', ['3 режима','4 режима','5 режима','1 режим'], 2],
  ['Hair Care', 'Какво е основното предимство на технологията SenseIQ при уредите Philips за грижа за косата?', ['Измерва и адаптира температурата спрямо нуждите на косата','Увеличава максимално температурата за по-бързо оформяне','Работи само с предварително избран режим','Използва един и същ температурен профил за всички типове коса'], 0],
  ['Lumea', 'Какво помага на потребителите да изберат подходяща настройка при използване на Philips Lumea?', ['Автоматично разпознаване на дължината на косъма','Сензор за тена на кожата и препоръка за интензитет','Измерване на влажността на кожата','Разпознаване на цвета на дрехите'], 1]
].map(([category, text, answers, correct], id) => ({ id, category, text, answers, correct }));

// Created quizzes are persisted in Upstash.  The small REST wrapper avoids a
// runtime dependency and works in Vercel serverless functions.
const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
async function redis(...command) {
  if (!redisUrl || !redisToken) throw Error('Live quiz storage is not configured.');
  const response = await fetch(redisUrl, {method:'POST', headers:{Authorization:`Bearer ${redisToken}`,'Content-Type':'application/json'}, body:JSON.stringify(command)});
  const result = await response.json();
  if (!response.ok || result.error) throw Error(result.error || 'Live quiz storage is unavailable.');
  return result.result;
}
const redisGet = async key => { const value = await redis('GET', key); return value ? JSON.parse(value) : null; };
const redisSet = (key, value) => redis('SET', key, JSON.stringify(value));
const createdKey = id => `philips-quiz:created:${id}`;
const codeKey = code => `philips-quiz:code:${code}`;
const ownerKey = owner => `philips-quiz:owner:${owner}`;
const createdQuestions = s => s.quiz.questions.map((q,id)=>({id,category:s.quiz.category||'General',text:q.text,answers:q.answers,correct:Number(q.correct)||0}));
async function saveCreated(s) { await redisSet(createdKey(s.id), s); }
async function getCreated(id) { const s = await redisGet(createdKey(id)); if (s) s.custom=true; return s; }

function newSession(id) { return { id, state: 'lobby', question: 0, startedAt: null, resultsStartedAt: null, players: {} }; }
function loadSessions() {
  try {
    const saved = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    return Object.fromEntries([1,2,3].map(id => [id, saved[id] || newSession(id)]));
  } catch (_) { return Object.fromEntries([1,2,3].map(id => [id, newSession(id)])); }
}
let sessions = loadSessions();
function saveSessions() {
  if (process.env.VERCEL) return;
  fs.writeFileSync(dataPath, JSON.stringify(sessions, null, 2), 'utf8');
}
async function advanceIfNeeded(s) {
  const quizQuestions = s.custom ? createdQuestions(s) : questions;
  const now = Date.now(); let changed = false;
  if (s.state === 'question' && !s.startedAt) { s.startedAt = now; changed = true; }
  if (s.state === 'question' && now - s.startedAt >= 20000) {
    s.state = 'results'; s.resultsStartedAt = now; changed = true;
  }
  if (s.state === 'results' && !s.resultsStartedAt) { s.resultsStartedAt = now; changed = true; }
  if (s.state === 'results' && now - s.resultsStartedAt >= 7000) {
    if (s.question < quizQuestions.length - 1) {
      s.question += 1; s.state = 'question'; s.startedAt = now; s.resultsStartedAt = null;
    } else { s.state = 'finished'; }
    changed = true;
  }
  if (changed) s.custom ? await saveCreated(s) : saveSessions();
}
function leaderBoard(s) { return Object.values(s.players).map(({id,name,score}) => ({id,name,score})).sort((a,b) => b.score - a.score || a.name.localeCompare(b.name, 'bg')); }
function publicState(s, playerId) {
  const quizQuestions = s.custom ? createdQuestions(s) : questions;
  const q = quizQuestions[s.question];
  const answer = playerId && s.players[playerId] ? s.players[playerId].answers[s.question] : null;
  return {
    id:s.id, custom:!!s.custom, code:s.custom?s.code:null, title:s.custom?s.quiz.name:`Session ${s.id}`, status:s.status || (s.state==='lobby'?'Active':s.state==='question'?'Live':s.state==='finished'?'Finished':'Active'), state:s.state, question:s.question, total:quizQuestions.length, startedAt:s.startedAt, resultsStartedAt:s.resultsStartedAt,
    questionData: s.state === 'question' ? redactQuestion(q) : null,
    reveal: s.state === 'results' || s.state === 'finished' ? {category:q.category, text:q.text, correctAnswer:q.answers[q.correct]} : null,
    myAnswer: answer || null, players: leaderBoard(s), answered: Object.values(s.players).filter(p => p.answers[s.question] !== undefined).length
  };
}
function redactQuestion(q) { return { id:q.id, category:q.category, text:q.text, answers:q.answers }; }
function json(res, value, code=200) { res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(value)); }
function body(req) { return new Promise((resolve,reject) => { let d=''; req.on('data', c => d += c); req.on('end', () => { try {resolve(d ? JSON.parse(d) : {});} catch(e){reject(e);} }); }); }

async function api(req, res, pathname) {
  // Quiz maker records: a shared index per creator plus a 6-digit lookup key.
  if (pathname === '/api/quizzes' && req.method === 'GET') {
    const owner = new URL(req.url, `http://${req.headers.host}`).searchParams.get('owner');
    const ids = owner ? (await redisGet(ownerKey(owner)) || []) : [];
    const items = (await Promise.all(ids.map(getCreated))).filter(Boolean).map(s => ({...s.quiz,id:s.id,code:s.code,status:s.status,createdAt:s.quiz.createdAt}));
    return json(res, items);
  }
  if (pathname === '/api/quizzes' && req.method === 'POST') {
    const quiz = await body(req); const owner=String(quiz.owner||'').slice(0,80);
    if (!owner || !quiz.name || !Array.isArray(quiz.questions) || !quiz.questions.length) return json(res,{error:'Quiz information is incomplete.'},400);
    let code; do { code=String(Math.floor(100000+Math.random()*900000)); } while (await redis('EXISTS',codeKey(code)));
    const id=`q_${Math.random().toString(36).slice(2,11)}`;
    const s={id,custom:true,code,status:'Draft',state:'lobby',question:0,startedAt:null,resultsStartedAt:null,players:{},owner,quiz:{...quiz,createdAt:quiz.createdAt||new Date().toISOString()}};
    await saveCreated(s); await redisSet(codeKey(code),id); const ids=await redisGet(ownerKey(owner))||[]; await redisSet(ownerKey(owner),[id,...ids]);
    return json(res,{...s.quiz,id,code,status:s.status});
  }
  const codeMatch = pathname.match(/^\/api\/quizzes\/code\/(\d{6})$/);
  if (codeMatch && req.method === 'GET') { const id=await redisGet(codeKey(codeMatch[1])); const s=id&&await getCreated(id); if(!s)return json(res,{error:'Invalid quiz code.'},404); if(s.status!=='Active'&&s.status!=='Live')return json(res,{error:'This quiz is not available yet.'},403); return json(res,{id:s.id,status:s.status,name:s.quiz.name}); }
  const quizMatch = pathname.match(/^\/api\/quizzes\/(q_[\w-]+)$/);
  if (quizMatch && req.method === 'PATCH') { const s=await getCreated(quizMatch[1]); if(!s)return json(res,{error:'Quiz not found.'},404); const data=await body(req); if(data.command==='activate'){s.status='Active';s.state='lobby';} if(data.command==='deactivate')s.status='Inactive'; if(data.command==='delete'){await redis('DEL',createdKey(s.id)); return json(res,{deleted:true});} await saveCreated(s); return json(res,{...s.quiz,id:s.id,code:s.code,status:s.status}); }
  const match = pathname.match(/^\/api\/sessions\/([^/]+)(?:\/(.+))?$/);
  if (!match) return json(res,{error:'Invalid session'},404);
  let s = sessions[match[1]];
  if (!s) s = await getCreated(match[1]);
  if (!s) return json(res,{error:'Invalid session'},404);
  const action = match[2] || '';
  await advanceIfNeeded(s);
  if (req.method === 'GET') {
    const playerId = new URL(req.url, `http://${req.headers.host}`).searchParams.get('playerId');
    return json(res, publicState(s, playerId));
  }
  const data = await body(req);
  if (action === 'join') {
    if (s.custom && s.status !== 'Active' && s.status !== 'Live') return json(res,{error:'This quiz is not available yet.'},403);
    const name = String(data.name || '').trim().slice(0, 30);
    if (!name) return json(res,{error:'Please enter your name.'},400);
    const id = Math.random().toString(36).slice(2,10);
    s.players[id] = {id,name,score:0,answers:{}};
    s.custom ? await saveCreated(s) : saveSessions();
    return json(res,{playerId:id, state:publicState(s, id)});
  }
  if (action === 'answer') {
    const p = s.players[data.playerId];
    if (!p || s.state !== 'question' || Number(data.question) !== s.question || p.answers[s.question] !== undefined) return json(res,{error:'Your answer cannot be accepted.'},400);
    const elapsed = Math.max(0, Date.now() - s.startedAt);
    const quizQuestions = s.custom ? createdQuestions(s) : questions;
    const correct = Number(data.answer) === quizQuestions[s.question].correct;
    const speedBonus = Math.max(0, Math.round(1000 * (1 - elapsed / 20000)));
    const earned = correct ? 1000 + speedBonus : 0;
    p.answers[s.question] = {answer:Number(data.answer), correct, earned}; p.score += earned;
    s.custom ? await saveCreated(s) : saveSessions();
    return json(res,{correct, earned, state:publicState(s, data.playerId)});
  }
  if (action === 'host') {
    if (data.command === 'start') { s.state='question'; s.status='Live'; s.startedAt=Date.now(); s.resultsStartedAt=null; }
    if (data.command === 'end') { s.state='finished'; s.status='Finished'; s.resultsStartedAt=Date.now(); }
    if (data.command === 'reset') { if (s.custom) { s.state='lobby'; s.status='Active'; s.question=0; s.startedAt=null; s.resultsStartedAt=null; s.players={}; } else { sessions[s.id] = newSession(s.id); } }
    s.custom ? await saveCreated(s) : saveSessions();
    return json(res, publicState(s.custom?s:sessions[s.id]));
  }
  return json(res,{error:'Unknown command.'},400);
}

const handler = async (req,res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req,res,url.pathname);
    const file = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//,'');
    const full = path.normalize(path.join(publicDir,file));
    if (!full.startsWith(publicDir) || !fs.existsSync(full)) { res.writeHead(404); return res.end('Not found'); }
    const type = full.endsWith('.html')?'text/html; charset=utf-8':full.endsWith('.css')?'text/css':full.endsWith('.js')?'application/javascript':'application/octet-stream';
    res.writeHead(200,{'Content-Type':type}); fs.createReadStream(full).pipe(res);
  } catch(e) { json(res,{error:e.message},500); }
};
if (require.main === module) http.createServer(handler).listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(x=>x && x.family==='IPv4' && !x.internal).map(x=>x.address);
  console.log(`Philips Quiz: http://localhost:${PORT}`); ips.forEach(ip=>console.log(`Споделете: http://${ip}:${PORT}`));
});

module.exports = handler;
