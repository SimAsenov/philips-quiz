const app = document.getElementById('app');

function escapeHtml(value) {
  return String(value || '').replace(/[&<>]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[char]));
}

function layout(content) {
  app.innerHTML = '<section class="shell"><header class="top"><img class="logo" src="/assets/philips-logo.png" alt="Philips"><span class="pill"><i></i> LIVE QUIZ</span></header><main class="content">' + content + '</main></section>';
}

function home() {
  layout('<div class="home"><section class="hero"><div class="eyebrow">PHILIPS LEARNING EXPERIENCES</div><h1>Philips Quiz Maker</h1><p class="hero-copy">Create, manage and run live Philips quizzes for trainings, sales events and product knowledge sessions.</p><div class="hero-actions"><button class="primary" id="create">Create Quiz</button><button class="outline" id="join">Join Quiz</button><button class="text-action" id="library">All Quizzes <span>→</span></button></div><div class="hero-stat"><b>20 sec.</b><span>per question</span><b>1,000 pts.</b><span>for a correct answer</span></div></section></div>');
  document.getElementById('create').onclick = createQuiz;
  document.getElementById('join').onclick = joinQuiz;
  document.getElementById('library').onclick = library;
}

function createQuiz() {
  layout('<div class="maker"><button class="back" id="back">← Back to Home</button><div class="eyebrow">NEW QUIZ</div><h1>Create a Quiz</h1><section class="form-card"><label>Quiz name<input id="quiz-name" placeholder="e.g. Sonicare product knowledge"></label><label>Category<input id="quiz-category" placeholder="e.g. Oral Health Care"></label><label>Creator name<input id="quiz-creator" placeholder="Your name"></label><label>Question text<textarea id="question" placeholder="Type your question"></textarea></label><label>Answer option 1<input id="answer-a" placeholder="Answer option 1"></label><label>Answer option 2<input id="answer-b" placeholder="Answer option 2"></label><p class="muted">The first answer is marked as correct for this recovery version.</p></section><div class="maker-actions"><button class="outline" id="cancel">Cancel</button><button class="primary" id="save">Save Quiz</button></div></div>');
  document.getElementById('back').onclick = home;
  document.getElementById('cancel').onclick = home;
  document.getElementById('save').onclick = saveQuiz;
}

async function saveQuiz() {
  const name = document.getElementById('quiz-name').value.trim();
  const creator = document.getElementById('quiz-creator').value.trim();
  const text = document.getElementById('question').value.trim();
  const a = document.getElementById('answer-a').value.trim();
  const b = document.getElementById('answer-b').value.trim();
  if (!name || !creator || !text || !a || !b) return alert('Please complete every field.');
  const quiz = {id: crypto.randomUUID(), name, creator, category: document.getElementById('quiz-category').value.trim() || 'General', question: text, answers: [a,b], code: String(Math.floor(100000 + Math.random() * 900000)), status: 'Draft'};
  localStorage.setItem('philips-recovery-quizzes', JSON.stringify([quiz, ...getQuizzes()]));
  library();
}

function getQuizzes() {
  try { return JSON.parse(localStorage.getItem('philips-recovery-quizzes') || '[]'); } catch (_) { return []; }
}

function library() {
  const quizzes = getQuizzes();
  const cards = quizzes.length ? quizzes.map(quiz => '<article class="quiz-library-card"><div class="card-status ' + quiz.status.toLowerCase() + '"><i></i>' + quiz.status + '</div><h2>' + escapeHtml(quiz.name) + '</h2><p>' + escapeHtml(quiz.category) + '</p><div class="quiz-meta"><span>1 question</span><span>Code: <b>' + quiz.code + '</b></span></div><div class="card-actions"><button class="primary small" data-host="' + quiz.id + '">Open Host View</button></div></article>').join('') : '<div class="empty-state"><b>No Quizzes Yet</b><p>Create your first Philips Quiz.</p></div>';
  layout('<div class="maker library"><button class="back" id="back">← Home</button><div class="library-head"><div><div class="eyebrow">MY QUIZZES</div><h1>All Quizzes</h1></div><button class="primary compact" id="create">+ Create Quiz</button></div><div class="quiz-library">' + cards + '</div></div>');
  document.getElementById('back').onclick = home;
  document.getElementById('create').onclick = createQuiz;
  document.querySelectorAll('[data-host]').forEach(button => button.onclick = () => hostView(button.dataset.host));
}

function hostView(id) {
  const quiz = getQuizzes().find(item => item.id === id);
  if (!quiz) return library();
  layout('<div class="maker manage"><button class="back" id="back">← Back to My Quizzes</button><div class="eyebrow">HOST VIEW</div><h1>' + escapeHtml(quiz.name) + '</h1><div class="manage-code"><span>QUIZ CODE</span><b>' + quiz.code + '</b><small>Share this code with participants</small></div><section class="form-card lobby-card"><h2>Live Lobby</h2><div class="participant-count">0 <span>connected participants</span></div><p class="muted">Participants can join using the quiz code.</p></section><div class="host-actions"><button class="primary start-button" id="start">Start Quiz</button></div></div>');
  document.getElementById('back').onclick = library;
  document.getElementById('start').onclick = () => hostQuestion(quiz);
}

function hostQuestion(quiz) {
  layout('<div class="center"><div class="eyebrow">HOST VIEW · QUESTION 1 OF 1</div><div class="timer">20.0</div><h2>' + escapeHtml(quiz.question) + '</h2><div class="answers"><div class="answer"><b>A</b>' + escapeHtml(quiz.answers[0]) + '</div><div class="answer"><b>B</b>' + escapeHtml(quiz.answers[1]) + '</div></div><p class="muted">Only participants can submit an answer.</p></div>');
}

function joinQuiz() {
  layout('<div class="flow join-flow"><button class="back" id="back">← Home</button><div class="eyebrow">FOR PARTICIPANTS</div><h1>Join a Quiz</h1><p class="muted">Enter the six-digit code shared by the host.</p><input id="code" inputmode="numeric" maxlength="6" placeholder="000000"><button class="primary" id="continue">Continue</button></div>');
  document.getElementById('back').onclick = home;
  document.getElementById('continue').onclick = () => {
    const quiz = getQuizzes().find(item => item.code === document.getElementById('code').value.trim());
    if (!quiz) return alert('Invalid quiz code.');
    layout('<div class="center"><div class="eyebrow">PHILIPS QUIZ</div><h1>' + escapeHtml(quiz.name) + '</h1><p class="muted">You have successfully joined the quiz. Waiting for the host to start.</p></div>');
  };
}

home();

