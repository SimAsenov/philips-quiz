const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const appSource = fs.readFileSync(__dirname + '/public/app.js', 'utf8');
const serverSource = fs.readFileSync(__dirname + '/server.js', 'utf8');
const cyrillic = /\p{Script=Cyrillic}/u;

function page() {
  const app = {innerHTML: ''}, storage = new Map();
  const ctx = vm.createContext({
    document: {querySelector: s => s === '#app' ? app : null, querySelectorAll: () => []},
    location: {search: '', origin: 'https://quiz.test'}, URLSearchParams,
    localStorage: {getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v)},
    crypto: {randomUUID: () => 'test-owner'}, window: {}, navigator: {}, console,
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1,
    alert(message) {throw Error(message);}, confirm: () => false,
    fetch() {throw Error('Unexpected network call');}
  });
  vm.runInContext(appSource, ctx);
  return {app, run: code => vm.runInContext(code, ctx)};
}

function backend() {
  const ctx = vm.createContext({
    require: name => name === 'fs' ? {readFileSync() {throw Error('No saved data');}} : require(name),
    module: {exports: {}}, __dirname, process: {env: {VERCEL: '1'}}, console, URL
  });
  vm.runInContext(serverSource, ctx);
  return {run: code => vm.runInContext(code, ctx)};
}

test('shipped runtime files have no hardcoded Cyrillic and declare English', () => {
  for (const file of ['public/app.js','public/index.html','public/style.css','server.js']) {
    assert.doesNotMatch(fs.readFileSync(__dirname + '/' + file, 'utf8'), cyrillic, file);
  }
  assert.match(fs.readFileSync(__dirname + '/public/index.html','utf8'), /lang="en"/);
  assert.doesNotMatch(appSource, /const translations|localize\(|englishQuestions/);
});

test('navigation, editing, lobby and status messages render English directly', () => {
  const p = page();
  const cases = [
    ['home()', 'HOW IT WORKS'], ['choose()', 'Choose a session'],
    ['showCreate()', 'Create a Quiz'], ['showJoinCode()', '6-digit quiz code'],
    ['join()', 'Ready to join?'], ['waitingForNext()', 'Your answer is recorded'],
    ['connectionError()', 'This live quiz link is not available'],
    ['renderLibrary([])', 'No Quizzes Yet']
  ];
  for (const [action, expected] of cases) {
    p.run(action); assert.ok(p.app.innerHTML.includes(expected), action);
    assert.doesNotMatch(p.app.innerHTML, cyrillic, action);
  }
});

test('all ten demo questions retain answer order and correct-option indexes', () => {
  const s = backend();
  const questions = JSON.parse(s.run('JSON.stringify(questions)'));
  assert.equal(questions.length, 10);
  assert.deepEqual(questions.map(q => q.correct), [0,3,2,2,3,2,2,2,0,1]);
  assert.deepEqual(questions.map(q => q.answers[q.correct]), [
    'Philips Aqua SenseIQ','99.9%','Up to 5 years','80%','All of the above',
    '8 modes and 3 intensities','-0.08 mm','5 modes',
    'It measures and adapts temperature to the hair’s needs',
    'A skin-tone sensor and intensity recommendation'
  ]);
  assert.doesNotMatch(JSON.stringify(questions), cyrillic);
});

test('host and player use the same server-provided English question and reveal', () => {
  const s = backend(), p = page();
  for (let i = 0; i < 10; i++) {
    const current = s.run(`JSON.stringify(publicState({...newSession('1'),state:'question',question:${i},startedAt:100000}))`);
    p.run('state=' + current + ';playerQuestion()');
    const q = JSON.parse(current).questionData;
    const escapedQuestion = p.run('esc(' + JSON.stringify(q.text) + ')');
    assert.ok(p.app.innerHTML.includes(escapedQuestion));
    for (const answer of q.answers) assert.ok(p.app.innerHTML.includes(p.run('esc(' + JSON.stringify(answer) + ')')));
    p.run('renderHost()'); assert.ok(p.app.innerHTML.includes(escapedQuestion));
    const result = s.run(`JSON.stringify(publicState({...newSession('1'),state:'results',question:${i},resultsStartedAt:100000}))`);
    for (const render of ['answerReveal()', 'renderHost()']) {
      p.run('state=' + result + ';' + render);
      assert.ok(p.app.innerHTML.includes(p.run('esc(' + JSON.stringify(JSON.parse(result).reveal.correctAnswer) + ')')));
      assert.doesNotMatch(p.app.innerHTML, cyrillic);
    }
  }
});

test('custom content is escaped, never translated or rewritten during rendering', () => {
  const p = page();
  const text = '\u041a\u043e\u0439 \u043e\u0442\u0433\u043e\u0432\u043e\u0440 \u0435 \u0432\u0435\u0440\u0435\u043d?';
  const answer = '\u0420\u0430\u0431\u043e\u0442\u0430 \u0441 Philips';
  p.run('showCreate();makerDraft.questions[0]=' + JSON.stringify({text,answers:[answer,'A "quoted" <option>'],correct:0}) + ';addMakerQuestion()');
  assert.ok(p.app.innerHTML.includes(text)); assert.ok(p.app.innerHTML.includes(answer));
  assert.match(p.app.innerHTML, /A &quot;quoted&quot; &lt;option&gt;/);
  p.run('state=' + JSON.stringify({custom:true,state:'question',question:0,total:1,startedAt:100000,players:[],questionData:{category:'Custom',text,answers:[answer,'Other']}}) + ';playerQuestion()');
  assert.ok(p.app.innerHTML.includes(text)); assert.ok(p.app.innerHTML.includes(answer));
});

test('all lifecycle screens and management labels remain English', () => {
  const p = page();
  const quiz = {id:'q_test',name:'English quiz',creator:'Host',category:'General',code:'654321',status:'Active',createdAt:'2026-09-18',questions:[{text:'Question',answers:['A','B'],correct:0}]};
  p.run('saveMakerQuizzes([' + JSON.stringify(quiz) + ']);showManage("q_test")');
  assert.match(p.app.innerHTML, /Host controls/); assert.doesNotMatch(p.app.innerHTML,cyrillic);
  for (const phase of ['lobby','question','results','finished']) {
    for (const render of ['renderPlayer()', 'renderHost()']) {
      p.run('state=' + JSON.stringify({custom:true,id:'q_test',title:'English quiz',code:'654321',state:phase,question:0,total:1,startedAt:100000,resultsStartedAt:120000,players:[{id:'p1',name:'Player',score:750}],answered:1,myAnswer:phase==='question'?null:{answer:0,correct:true,earned:750},questionData:phase==='question'?{category:'General',text:'English question?',answers:['A','B']}:null,reveal:phase==='results'||phase==='finished'?{category:'General',text:'English question?',correctAnswer:'A'}:null}) + ';' + render);
      assert.doesNotMatch(p.app.innerHTML,cyrillic,phase + ' ' + render);
    }
  }
});
