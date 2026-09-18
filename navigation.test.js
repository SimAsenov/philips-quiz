const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(__dirname + '/public/app.js', 'utf8');

function page(respond, storage = {}) {
  const app = {innerHTML: ''};
  const values = new Map(Object.entries(storage));
  const requests = [];
  const context = vm.createContext({
    document: {querySelector: selector => selector === '#app' ? app : null, querySelectorAll: () => []},
    location: {search: '', origin: 'https://example.test', href: '/'},
    localStorage: {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)},
    crypto: {randomUUID: () => 'test-owner'}, URLSearchParams, console,
    setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 1,
    window: {}, navigator: {}, alert: message => {throw Error(message)}, confirm: () => true,
    fetch: async (url, opts) => {requests.push({url, opts}); return {ok: true, json: async () => respond(url, opts)};}
  });
  vm.runInContext(source, context);
  return {run: code => vm.runInContext(code, context), app, requests, values};
}
const quiz = {id:'q_test',name:'Example',creator:'Test',questions:[{text:'Question',answers:['A','B'],correct:0}],createdAt:'2026-09-18',status:'Draft',code:'123456'};

test('restored home, question editor and join screen have connected navigation', () => {
  const p = page(() => []);
  assert.match(p.app.innerHTML, /HOW IT WORKS/);
  assert.doesNotMatch(p.app.innerHTML, /global-back/);
  p.run('showCreate(); addMakerQuestion(); addMakerAnswer(0)');
  assert.match(p.app.innerHTML, /Question 2/);
  assert.match(p.app.innerHTML, /Answer option 3/);
  p.run('showJoinCode()'); assert.match(p.app.innerHTML, /acceptQuizCode/);
  p.run('home()'); assert.match(p.app.innerHTML, /Philips Quiz Maker/);
});

test('library reads both historical owner identities and merges duplicates', async () => {
  const p = page(() => [quiz], {'philips-owner-id':'old-owner','philips-owner':'new-owner'});
  await p.run('showLibrary()');
  assert.deepEqual(p.requests.map(r=>r.url), ['/api/quizzes?owner=old-owner','/api/quizzes?owner=new-owner']);
  assert.equal(JSON.parse(p.values.get('philips-created-quizzes')).length, 1);
  assert.match(p.app.innerHTML, /Example/);
});

test('a delayed library response cannot overwrite navigation to the editor', async () => {
  let resolve;
  const pending = new Promise(r => resolve = r);
  const p = page(() => pending);
  const load = p.run('showLibrary()');
  p.run('showCreate()'); resolve([quiz]); await load;
  assert.match(p.app.innerHTML, /Quiz information/);
  assert.doesNotMatch(p.app.innerHTML, /quiz-library-card/);
});

test('editing and duplicating persist on the server, not just in the browser', async () => {
  const p = page((url, opts) => opts?.method === 'PATCH' ? {...quiz,name:'Edited'} : opts?.method === 'POST' ? {...quiz,id:'q_copy'} : [quiz], {'philips-created-quizzes':JSON.stringify([quiz])});
  p.run("showCreate('q_test'); makerDraft.name='Edited'");
  await p.run('saveMakerQuiz()');
  const edit=p.requests.find(r=>r.opts?.method==='PATCH');
  assert.equal(edit.url, '/api/quizzes/q_test');
  assert.equal(JSON.parse(edit.opts.body).command, 'update');
  await p.run("duplicateQuiz('q_test')");
  const duplicate=p.requests.find(r=>r.opts?.method==='POST');
  assert.equal(duplicate.url, '/api/quizzes');
  assert.equal(JSON.parse(duplicate.opts.body).name, 'Example (Copy)');
});

test('removing an earlier option keeps the same correct answer', () => {
  const p = page(() => []);
  p.run("showCreate(); makerDraft.questions[0]={text:'Q',answers:['A','B','C'],correct:2}; removeMakerAnswer(0,0)");
  assert.equal(p.run('makerDraft.questions[0].correct'), 1);
  assert.equal(p.run('makerDraft.questions[0].answers[makerDraft.questions[0].correct]'), 'C');
});

test('quoted question content cannot break form attributes', () => {
  const p=page(()=>[]);
  assert.equal(p.run('esc(\'a"<b>\')'), 'a&quot;&lt;b&gt;');
});

test('delete is persisted and a storage failure is shown in the library', async () => {
  const p=page((url,opts)=>opts?.method==='PATCH'?{deleted:true}:[], {'philips-created-quizzes':JSON.stringify([quiz])});
  await p.run("deleteQuiz('q_test')");
  assert.equal(JSON.parse(p.requests[0].opts.body).command,'delete');
  assert.equal(JSON.parse(p.values.get('philips-created-quizzes')).length,0);
  const failed=page(()=>{throw Error('Connection interrupted')}, {'philips-created-quizzes':JSON.stringify([quiz])});
  await failed.run('showLibrary()');
  assert.match(failed.app.innerHTML,/Could not refresh your quizzes/);
  assert.match(failed.app.innerHTML,/Example/);
});
