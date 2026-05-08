/* ============================================================
   AgBizu v2 – Pure HTML/JS/CSS – app.js
   Firebase Realtime Database (Namespace/Legacy Mode - file://)
   ============================================================ */
'use strict';

// ======================== FIREBASE SETUP ========================
const firebaseConfig = {
    apiKey: "AIzaSyASa8uMK4O1U_bQC5Ykl-OflJttFSJFNnM",
    authDomain: "orange-proof.firebaseapp.com",
    databaseURL: "https://orange-proof-default-rtdb.firebaseio.com",
    projectId: "orange-proof",
    storageBucket: "orange-proof.firebasestorage.app",
    messagingSenderId: "619099154724",
    appId: "1:619099154724:web:e61ff7ce22e29be929ebb1"
};

// Inicializa o Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.database();
const storage = firebase.storage();

// ======================== STATE ========================
const S = {
    currentUser: null,
    events: [],
    transactions: [],
    soundsEnabled: true,
    currentDate: new Date(),
    selectedDate: null,
    viewMode: 'month',
    editingEventId: null,
    lastRenderedYear: null,
    lastModalClose: 0,
    financeType: 'expense',
    editingTransactionId: null,
    editingOccurrenceDate: null,
    showGlobalFinance: localStorage.getItem('agbizu_show_global_finance') !== 'false',
    sessionStartTime: Date.now(),
    lessons: [],
    weeklyPlanner: {}
};

// ======================== STATS TRACKING ========================
function toDateStr(d) {
    if (!d) return '';
    const date = new Date(d);
    const Y = date.getFullYear(), M = String(date.getMonth() + 1).padStart(2, '0'), D = String(date.getDate()).padStart(2, '0');
    return `${Y}-${M}-${D}`;
}

// Convert YYYY-MM-DD to DD/MM/YYYY
function fmtDate(s) {
    if (!s || !s.includes('-')) return s || '';
    const [y, m, d] = s.split('-');
    return `${d}/${m}/${y}`;
}

// Convert DD/MM/YYYY to YYYY-MM-DD
function parseDate(s) {
    if (!s || !s.includes('/')) return s || '';
    const [d, m, y] = s.split('/');
    return `${y}-${m}-${d}`;
}

// Input mask helper
function applyMask(id, type) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g, '');
        if (type === 'date') {
            if (v.length > 8) v = v.slice(0, 8);
            if (v.length > 4) v = v.replace(/^(\d{2})(\d{2})(\d{4}).*/, '$1/$2/$3');
            else if (v.length > 2) v = v.replace(/^(\d{2})(\d{2}).*/, '$1/$2');
        } else if (type === 'time') {
            if (v.length > 4) v = v.slice(0, 4);
            if (v.length > 2) v = v.replace(/^(\d{2})(\d{2}).*/, '$1:$2');
        }
        e.target.value = v;
        if (type === 'date' && id === 'evt-date') updateWorkBadge(v);
    });
}

function trackAction(actionName) {
    if (!S.currentUser) return;
    try {
        const cleanName = actionName.replace(/[.#$[\]]/g, '_');
        const today = new Date().toISOString().split('T')[0];

        // Total global
        db.ref(`users/${S.currentUser}/stats/actions/${cleanName}`).transaction(c => (c || 0) + 1);
        // Diário
        db.ref(`users/${S.currentUser}/stats/dailyActions/${today}/${cleanName}`).transaction(c => (c || 0) + 1);

    } catch (e) { console.error("Track error:", e); }
}

function updateTimeSpent() {
    if (!S.currentUser || document.hidden) return;
    const now = Date.now();
    const diff = Math.floor((now - S.sessionStartTime) / 1000);
    S.sessionStartTime = now;
    if (diff <= 0) return;
    try {
        db.ref(`users/${S.currentUser}/stats/timeSpent`).transaction(c => (c || 0) + diff);
    } catch (e) { }
}
setInterval(updateTimeSpent, 30000); // Update every 30s
window.addEventListener('beforeunload', updateTimeSpent);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') S.sessionStartTime = Date.now();
    else updateTimeSpent();
});

// ======================== AUDIO ========================
const audio = {};
function loadAudio() {
    try {
        audio.click = new Audio('click.mp3');
        audio.modal = audio.click;
        audio.click.preload = 'auto';
    } catch (e) { }
}
function play(key) {
    if (!S.soundsEnabled) return;
    try { const a = audio[key]; if (a) { a.currentTime = 0; a.play().catch(() => { }); } } catch (e) { }
}

// Global click listener for sounds and modal blocking
let mouseDownTarget = null;
document.addEventListener('mousedown', (e) => { mouseDownTarget = e.target; });

document.addEventListener('click', (e) => {
    const activeModal = document.querySelector('.modal-overlay:not(.hidden)');

    // Se houver modal aberto
    if (activeModal) {
        const sheet = activeModal.querySelector('.modal-sheet');
        // Se o clique (tanto o mousedown quanto o mouseup/click target) for fora do "papel" do modal
        if (sheet && !sheet.contains(e.target) && !sheet.contains(mouseDownTarget)) {
            // Ignorar se o clique for dentro do calendário do Flatpickr
            if (e.target.closest('.flatpickr-calendar')) return;

            e.preventDefault();
            e.stopPropagation();
            play('click');
            closeModal(activeModal.id);
            return;
        }
    }

    // Prevenção de cliques duplos/fantasmas (cooldown após fechar modais)
    if (Date.now() - S.lastModalClose < 300) {
        e.preventDefault();
        e.stopPropagation();
        return;
    }

    // Som de clique global (caso não tenha sido capturado pelo modal acima)
    if (e.target.closest('button, a, .day-cell, .mini-month, .lp-flag-btn, .chip, #fab-wrapper, [role="button"]')) {
        play('click');
    }
}, true);

// ======================== OVERLAY CARREGAMENTO ========================
function showLoading(msgKey = 'loading_wait') {
    const msg = typeof i18n !== 'undefined' ? i18n.t(msgKey) : msgKey;
    let el = document.getElementById('firebase-loading');
    if (!el) {
        el = document.createElement('div');
        el.id = 'firebase-loading';
        el.style.cssText = `position:fixed;inset:0;background:#ffffff;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:99999;gap:14px;font-family:var(--font);`;
        el.innerHTML = `<img class="imgGif" src="icone.png" ><p id="fb-load-msg" style="color:#374151;font-size:.95rem; margin-top:10px;">${msg}</p>`;
        document.body.appendChild(el);
    } else {
        document.getElementById('fb-load-msg').textContent = msg;
        el.style.display = 'flex';
    }
}
function hideLoading() {
    const el = document.getElementById('firebase-loading');
    if (el) el.style.display = 'none';
}

// ======================== FIREBASE STORAGE ========================
function userRef(path = '') {
    return db.ref(`users/${S.currentUser}${path ? '/' + path : ''}`);
}

async function saveProfile() {
    if (!S.currentUser) return;
    await userRef().update({
        scale: S.userScale || null,
        sounds: S.soundsEnabled
    });
}

function startRealtimeSync() {
    try {
        console.log("[DEBUG] Iniciando startRealtimeSync");
        if (!S.currentUser) return;

        userRef('events').off();
        userRef('events').on('value', (snap) => {
            console.log("[DEBUG] Sincronizando eventos...");
            const raw = snap.exists() ? snap.val() : {};
            S.events = Object.entries(raw).map(([k, v]) => ({ id: k, ...v }));
            S.lastRenderedYear = null;
            refreshCalendar();
        });

        userRef('transactions').off();
        userRef('transactions').on('value', (snap) => {
            console.log("[DEBUG] Sincronizando transações...");
            const raw = snap.exists() ? snap.val() : {};
            S.transactions = Object.entries(raw).map(([k, t]) => ({
                ...t,
                id: k,
                amount: parseFloat(t.amount) || 0,
                checked: t.checked || false
            }));
            if (!$('modal-finances').classList.contains('hidden')) updateFinanceUI();
            S.lastRenderedYear = null;
            refreshCalendar();
        });

        // Sincronizar aulas (público) - Usando uma ref global
        db.ref('lessons').on('value', (snap) => {
            console.log("[DEBUG] Sincronizando aulas...");
            const raw = snap.exists() ? snap.val() : {};
            S.lessons = Object.entries(raw).map(([k, v]) => ({ id: k, ...v }));
            if (S.viewMode === 'lessons') renderLessonsView();
        });

        // Sincronizar Cronograma Semanal
        db.ref('weekly_planner').on('value', (snap) => {
            console.log("[DEBUG] Sincronizando cronograma semanal...");
            S.weeklyPlanner = snap.val() || {};
            renderWeeklyPlanner();
        });
    } catch (e) {
        console.error("Error in startRealtimeSync:", e);
    }
}

// Inicia o carregamento logo ao carregar o script (apenas se já tiver idioma definido)
if (localStorage.getItem('agbizu_lang')) {
    showLoading();
}

// ======================== AUTH LOGIC (Unified with ViewGo) ========================
let isLoginMode = true;
let currentAuthStep = 1;

window.resetAuthUI = function () {
    isLoginMode = true;
    currentAuthStep = 1;

    // Resetar inputs
    const inputs = document.querySelectorAll('.login-footer input');
    inputs.forEach(i => i.value = '');

    // Resetar erro
    const errEl = $('login-error');
    if (errEl) errEl.textContent = '';

    // Resetar Hero (Logo/Titulo) e liberar o lock de foco para a próxima sessão
    const screen = $('login-screen');
    if (screen) {
        screen.classList.remove('focused');
        if (typeof screen._resetFocusLock === 'function') screen._resetFocusLock();
    }

    // Aplicar estado visual (Forçar login mode)
    // Como toggleAuthMode inverte, vamos setar isLoginMode false e chamar toggle
    isLoginMode = false;
    toggleAuthMode();
};

window.toggleAuthMode = function () {
    isLoginMode = !isLoginMode;
    currentAuthStep = 1;
    goToAuthStep(1);

    const groupName = $('group-name');
    const groupConfirm = $('group-confirm');
    const emailGroup = $('group-email-step1');
    const passGroup = $('group-password');
    const btnSubmit = $('btn-login-submit');
    const btnNext = $('btn-auth-next');
    const btnToggle = $('txt-toggle');
    const forgotBtn = $('btn-forgot-pass');
    const stepsIndicator = $('auth-steps-indicator');
    const step3 = $('step-3');
    const step4 = $('step-4');
    const titleEl = $('auth-section-title');

    if (isLoginMode) {
        if (titleEl) {
            titleEl.setAttribute('data-i18n', 'login_header_access');
            titleEl.textContent = typeof i18n !== 'undefined' ? i18n.t('login_header_access') : 'Acesso à Conta';
        }

        // Login 2 steps: Email -> Password
        groupName.classList.add('hidden');
        groupConfirm.classList.add('hidden');
        emailGroup.classList.remove('hidden');
        passGroup.classList.remove('hidden');
        stepsIndicator.classList.add('hidden');
        step3.classList.add('hidden');
        if (step4) step4.classList.add('hidden');

        // Move Email to Step 1, Password to Step 2
        $('step-1').appendChild(emailGroup);
        $('step-2').appendChild(passGroup);

        btnSubmit.classList.add('hidden');
        btnNext.classList.remove('hidden');
        btnToggle.innerHTML = i18n.t('login_no_account') || 'Não tem uma conta? <span style="color: var(--primary);">Cadastre-se.</span>';
        if (forgotBtn) forgotBtn.closest('#forgot-pass-wrap')?.classList.remove('hidden');
        $('login-form')?.classList.remove('register-mode');
    } else {
        if (titleEl) {
            titleEl.setAttribute('data-i18n', 'login_header_register');
            titleEl.textContent = typeof i18n !== 'undefined' ? i18n.t('login_header_register') : 'Criar Nova Conta';
        }

        // Register 4 steps: Name -> Email -> Password -> Confirm
        groupName.classList.remove('hidden');
        groupConfirm.classList.remove('hidden');
        emailGroup.classList.remove('hidden');
        passGroup.classList.remove('hidden');
        stepsIndicator.classList.remove('hidden');
        step3.classList.remove('hidden');
        if (step4) step4.classList.remove('hidden');

        // Move Name to Step 1, Email to Step 2, Password to Step 3, Confirm to Step 4
        $('step-1').appendChild(groupName);
        $('step-2').appendChild(emailGroup);
        $('step-3').appendChild(passGroup);
        $('step-4').appendChild(groupConfirm);

        btnSubmit.classList.add('hidden');
        btnNext.classList.remove('hidden');
        btnToggle.innerHTML = i18n.t('login_have_account') || 'Já tem uma conta? <span style="color: var(--primary);">Fazer login</span>';
        if (forgotBtn) forgotBtn.closest('#forgot-pass-wrap')?.classList.add('hidden');
        $('login-form')?.classList.add('register-mode');
    }
    updateStepDots();
    $('login-error').textContent = '';
};

window.nextAuthStep = async function () {
    const maxSteps = isLoginMode ? 2 : 4;
    const errEl = $('login-error');
    errEl.textContent = '';

    // Regex para validação de e-mail real
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (currentAuthStep === 1) {
        if (isLoginMode) {
            if (!emailRegex.test($('inp-email').value)) {
                errEl.textContent = i18n.t('err_invalid_email');
                return;
            }
        } else {
            if ($('inp-name').value.trim().length < 3) {
                errEl.textContent = i18n.t('err_short_name');
                return;
            }
        }
    } else if (currentAuthStep === 2) {
        if (!isLoginMode) {
            if (!emailRegex.test($('inp-email').value)) {
                errEl.textContent = i18n.t('err_invalid_email');
                return;
            }
        }
    } else if (currentAuthStep === 3 && !isLoginMode) {
        if ($('inp-pass').value.length < 6) {
            errEl.textContent = i18n.t('login_err_pass');
            return;
        }
    }

    if (currentAuthStep < maxSteps) {
        currentAuthStep++;
        goToAuthStep(currentAuthStep);
    }
};

window.prevAuthStep = function () {
    if (currentAuthStep > 1) {
        currentAuthStep--;
        goToAuthStep(currentAuthStep);
    }
};

function goToAuthStep(step) {
    const wrapper = $('auth-step-wrapper');
    wrapper.style.transform = `translateX(-${(step - 1) * 100}%)`;

    const maxSteps = isLoginMode ? 2 : 4;
    const btnNext = $('btn-auth-next');
    const btnSubmit = $('btn-login-submit');
    const btnBack = $('btn-auth-back');

    btnBack.classList.toggle('hidden', step === 1);

    if (step === maxSteps) {
        btnNext.classList.add('hidden');
        btnSubmit.classList.remove('hidden');
        btnSubmit.querySelector('#txt-login-btn').textContent = isLoginMode ? i18n.t('login_btn') : i18n.t('login_btn_create');
    } else {
        btnNext.classList.remove('hidden');
        btnSubmit.classList.add('hidden');
    }

    updateStepDots();
}

function updateStepDots() {
    const dots = document.querySelectorAll('.step-dot');
    dots.forEach((dot, idx) => {
        dot.classList.toggle('active', idx === currentAuthStep - 1);
        dot.classList.toggle('hidden', isLoginMode); // Hide dots in login mode if simplified
    });
}

let _recoveryCountdownTimer = null;

window.toggleRecovery = function (show) {
    const loginForm = $('login-form');
    const recoveryEl = $('recovery-area');
    const formState = $('recovery-form-state');
    const successState = $('recovery-success-state');

    if (show) {
        if (loginForm) loginForm.classList.add('hidden');
        if (recoveryEl) recoveryEl.classList.remove('hidden');
        // Always start at form state
        if (formState) formState.classList.remove('hidden');
        if (successState) successState.classList.add('hidden');
        const inp = $('inp-recovery-email');
        if (inp) { inp.value = ''; setTimeout(() => inp.focus(), 120); }
    } else {
        if (loginForm) loginForm.classList.remove('hidden');
        if (recoveryEl) recoveryEl.classList.add('hidden');
        // Clear countdown
        if (_recoveryCountdownTimer) { clearInterval(_recoveryCountdownTimer); _recoveryCountdownTimer = null; }
    }
    const errEl = $('login-error');
    const recErr = $('recovery-error');
    if (errEl) errEl.textContent = '';
    if (recErr) recErr.textContent = '';
};

function _startResendCountdown(seconds = 60) {
    const countdownWrap = $('recovery-countdown-wrap');
    const resendWrap = $('recovery-resend-wrap');
    const countdownNum = $('recovery-countdown');

    if (countdownWrap) countdownWrap.classList.remove('hidden');
    if (resendWrap) resendWrap.classList.add('hidden');
    if (countdownNum) countdownNum.textContent = seconds;

    if (_recoveryCountdownTimer) clearInterval(_recoveryCountdownTimer);
    let remaining = seconds;
    _recoveryCountdownTimer = setInterval(() => {
        remaining--;
        if (countdownNum) countdownNum.textContent = remaining;
        if (remaining <= 0) {
            clearInterval(_recoveryCountdownTimer);
            _recoveryCountdownTimer = null;
            if (countdownWrap) countdownWrap.classList.add('hidden');
            if (resendWrap) resendWrap.classList.remove('hidden');
        }
    }, 1000);
}

async function sendRecoveryEmail() {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const email = ($('inp-recovery-email')?.value || '').trim();
    const errEl = $('recovery-error');
    const btn = $('btn-send-recovery');

    if (errEl) errEl.textContent = '';

    if (!email) {
        if (errEl) errEl.textContent = i18n.t('err_fill_all');
        return;
    }
    if (!emailRegex.test(email)) {
        if (errEl) errEl.textContent = i18n.t('err_invalid_email');
        return;
    }

    // Loading state on button
    if (btn) { btn.disabled = true; btn.style.opacity = '0.7'; }
    showLoading('loading_connecting');

    try {
        await firebase.auth().sendPasswordResetEmail(email);
        hideLoading();

        // Show success state
        const formState = $('recovery-form-state');
        const successState = $('recovery-success-state');
        if (formState) formState.classList.add('hidden');
        if (successState) successState.classList.remove('hidden');

        // Show masked email in subtitle
        const sentTo = $('recovery-sent-to');
        if (sentTo) {
            const masked = email.replace(/(.{2}).+(@.+)/, '$1***$2');
            sentTo.textContent = masked;
        }

        // Restart animation by re-cloning the ripple
        const ripple = document.querySelector('.recovery-success-ripple');
        if (ripple) {
            ripple.style.animation = 'none';
            ripple.offsetHeight; // reflow
            ripple.style.animation = '';
        }

        _startResendCountdown(60);
    } catch (error) {
        hideLoading();
        if (btn) { btn.disabled = false; btn.style.opacity = ''; }
        let msg = error.message || i18n.t('login_err_conn');
        if (error.code === 'auth/user-not-found') msg = i18n.t('recovery_err_not_found') || 'Nenhuma conta encontrada com este e-mail.';
        if (error.code === 'auth/invalid-email') msg = i18n.t('err_invalid_email');
        if (error.code === 'auth/too-many-requests') msg = i18n.t('recovery_err_too_many') || 'Muitas tentativas. Aguarde alguns minutos.';
        if (errEl) errEl.textContent = msg;
    }
}

window.resendRecoveryEmail = async function () {
    const btn = $('btn-resend-recovery');
    if (btn) { btn.disabled = true; }
    await sendRecoveryEmail();
    if (btn) { btn.disabled = false; }
};


// Global Auth State Observer
firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
        console.log("User logged in:", user.uid);
        S.currentUser = user.uid;

        // Check if user has scale/sounds in Database
        try {
            const snap = await userRef().once('value');
            const data = snap.val() || {};
            S.userScale = data.scale || null;
            S.soundsEnabled = data.sounds !== undefined ? data.sounds : true;
            updateSoundIcon();

            // If new user, initialize basic entry
            if (!snap.exists()) {
                await userRef().update({
                    email: user.email,
                    displayName: user.displayName,
                    createdAt: new Date().toISOString()
                });
            }
        } catch (e) {
            console.error("Error fetching user profile:", e);
        }

        localStorage.setItem('agbizu_session', user.uid);

        // Check for Admin
        if (user.email === 'maispraticodesenvolvimento@gmail.com') {
            const btnAdd = document.getElementById('btn-add-lesson');
            if (btnAdd) btnAdd.classList.remove('hidden');

            const fabAdd = document.getElementById('fab-action-lesson');
            if (fabAdd) fabAdd.classList.remove('hidden');

            // Mostrar botões de edição do cronograma semanal
            document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));

            // Também mostrar painel adm se existir
            const btnAdm = document.getElementById('btn-admin-panel');
            if (btnAdm) {
                btnAdm.classList.remove('hidden');
                btnAdm.onclick = () => window.location.href = 'adm.html';
            }
        }

        initApp();
    } else {
        console.log("No user session.");
        logout(true); // silent logout
    }
});

window.setFPValue = function (id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    if (id.includes('date')) el.value = fmtDate(val);
    else el.value = val;
};

function initApp() {
    try {
        console.log("[DEBUG] Início do initApp");
        // O cabeçalho deve ser mostrado sempre para que o menu (hambúrguer) esteja visível
        show('scale-bar');

        if (S.userScale) {
            if ($('scale-display')) $('scale-display').textContent = S.userScale.display;
            S.forceScale = false;
        }
        else {
            S.forceScale = true;
        }

        S.currentDate = new Date();
        setView('lessons');
        startRealtimeSync();

        hide('login-screen');
        show('app-screen');
        if ($('app-screen')) $('app-screen').style.display = 'flex';
        if (typeof window.showAgentFab === 'function') window.showAgentFab();

        if (typeof i18n !== 'undefined') i18n.applyToDOM();
        updateSoundIcon();
        runOnboardingFlow();

        // Setup Custom Input Masks (No Popups)
        applyMask('evt-date', 'date');
        applyMask('evt-end-date', 'date');
        applyMask('trans-date', 'date');
        applyMask('evt-time', 'time');
        applyMask('evt-end-time', 'time');

        // Inicializa estado do sidebar no Desktop
        if (localStorage.getItem('agbizu_sidebar_collapsed') === 'true' && window.innerWidth >= 900) {
            document.getElementById('side-menu')?.classList.add('collapsed');
            const sideBtnIcon = document.querySelector('#btn-collapse-sidebar span');
            if (sideBtnIcon) sideBtnIcon.style.transform = 'rotate(180deg)';
        }

        // Pequeno delay para não sobrepor outras modais iniciais
        setTimeout(() => {
            showPromotionalToasts();
        }, 1500);

        hideLoading();
        console.log("[DEBUG] initApp finalizado com sucesso");
    } catch (err) {
        console.error("Critical error in initApp:", err);
        hideLoading();
    }
}

// ======================== LOGIN FOCUS BEHAVIOR (Mobile) ========================
// Quando um input da tela de login recebe foco em telas pequenas (<= 640px),
// a classe 'focused' é adicionada ao #login-screen para mover o formulário ao topo,
// ocultando o hero e evitando que o teclado virtual sobreponha os campos.
(function setupLoginFocusBehavior() {
    const loginScreen = document.getElementById('login-screen');
    if (!loginScreen) return;

    // Uma vez que o usuário focar num input pela primeira vez em mobile,
    // o estado "focused" fica permanente até o próximo logout/reset.
    let loginFocusLocked = false;

    function onLoginInputFocus() {
        if (window.innerWidth > 640) return;
        if (!loginFocusLocked) {
            loginFocusLocked = true;
        }
        loginScreen.classList.add('focused');
    }

    // Delega apenas o focusin — o focusout não remove mais a classe após o primeiro foco.
    loginScreen.addEventListener('focusin', (e) => {
        if (e.target.matches('input')) onLoginInputFocus();
    });

    // Expõe reset para ser chamado pelo resetAuthUI ao fazer logout
    loginScreen._resetFocusLock = () => { loginFocusLocked = false; };
})();

// Update the form submission
document.getElementById('login-form').onsubmit = async (e) => {
    e.preventDefault();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const email = $('inp-email').value;
    const pass = $('inp-pass').value;
    const name = $('inp-name').value;
    const confirm = $('inp-confirm').value;
    const errEl = $('login-error');

    errEl.textContent = '';

    const maxSteps = isLoginMode ? 2 : 4;
    if (currentAuthStep < maxSteps) {
        nextAuthStep();
        return;
    }

    if (isLoginMode) {
        if (!email || !pass) {
            errEl.textContent = i18n.t('err_fill_all');
            return;
        }
        if (!emailRegex.test(email)) {
            errEl.textContent = i18n.t('err_invalid_email');
            return;
        }
        showLoading('loading_connecting');
        try {
            await firebase.auth().signInWithEmailAndPassword(email, pass);
        } catch (err) {
            hideLoading();
            errEl.textContent = i18n.t('login_err_wrong') || "E-mail ou senha incorretos.";
            console.error(err);
        }
    } else {
        if (!name || !email || !pass || !confirm) {
            errEl.textContent = i18n.t('err_fill_all');
            return;
        }
        if (!emailRegex.test(email)) {
            errEl.textContent = i18n.t('err_invalid_email');
            return;
        }
        if (pass !== confirm) {
            errEl.textContent = i18n.t('err_pass_mismatch');
            return;
        }
        if (pass.length < 6) {
            errEl.textContent = i18n.t('login_err_pass');
            return;
        }

        showLoading('loading_connecting');
        try {
            const result = await firebase.auth().createUserWithEmailAndPassword(email, pass);
            await result.user.updateProfile({ displayName: name });
        } catch (err) {
            hideLoading();
            if (err.code === 'auth/email-already-in-use') {
                errEl.textContent = i18n.t('err_email_exists');
                // Retroceder para a aba de e-mail automaticamente
                currentAuthStep = 2;
                goToAuthStep(2);
            } else {
                errEl.textContent = i18n.t('login_err_conn');
            }
            console.error(err);
        }
    }
};

async function logout(silent = false) {
    if (!silent) {
        closeModal('modal-logout');
        showLoading('loading_wait');
    }

    try {
        await firebase.auth().signOut();
    } catch (e) {
        console.error("Logout error:", e);
    }

    S.currentUser = null; S.userScale = null; S.events = []; S.transactions = []; S.customSeq = [];
    localStorage.removeItem('agbizu_session');

    if (!silent) {
        refreshCalendar();
        resetAuthUI();
        show('login-screen');
        hide('app-screen');
        if (typeof window.hideAgentFab === 'function') window.hideAgentFab();
        hideLoading();
    } else {
        // Mesmo em boot silencioso, precisamos estar no modo login e sem loader
        resetAuthUI();
        show('login-screen');
        hide('app-screen');
        hideLoading();
    }
}

// ======================== HOLIDAYS ========================
function isHoliday(date) {
    const holidays = typeof i18n !== 'undefined' ? i18n.t('holidays') : {};
    return holidays[toDateStr(date)] || null;
}

/** Returns the daily Bible messages for the current language */
function getMensagensDoDia() {
    if (typeof i18n !== 'undefined') {
        const msgs = i18n.t('daily_messages');
        if (Array.isArray(msgs)) return msgs;
    }
    // Fallback hardcoded PT (shouldn't reach here if i18n loaded)
    return [
        { dia: 1, versiculo: 'João 3:16', mensagem: 'Porque Deus amou o mundo de tal maneira que deu o seu Filho unigênito...', reflexao: 'O amor de Deus é a base do evangelho.' },
        { dia: 2, versiculo: 'Salmos 23:1', mensagem: 'O Senhor é o meu pastor; nada me faltará.', reflexao: 'Deus cuida de nós em todos os momentos.' },
    ];
}

// ======================== SCALE LOGIC ========================
function isDayOff(date, scale) {
    if (!scale) return null;
    if (typeof scale === 'object' && scale.sequence) {
        const ref2 = new Date(scale.referenceDate);
        const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const start = new Date(ref2.getFullYear(), ref2.getMonth(), ref2.getDate());
        const delta = Math.round((target - start) / 86400000);
        const seq = scale.sequence;
        const idx = ((delta % seq.length) + seq.length) % seq.length;
        return seq[idx] === 0;
    }
    return null;
}
function getWorkStatus(date, scale) {
    if (!scale) return null;
    const off = isDayOff(date, scale);
    return off === null ? null : { isOff: off };
}

// ======================== DATE HELPERS ========================
function toDateStr(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}
function normalizeDate(d) {
    const p = typeof d === 'string' ? new Date(d + 'T12:00:00') : new Date(d);
    return new Date(p.getFullYear(), p.getMonth(), p.getDate());
}
function getDaysInMonth(year, month) {
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const days = [];
    // Mês anterior (padding)
    for (let i = first.getDay() - 1; i >= 0; i--) days.push({ date: new Date(year, month, -i), cur: false });
    // Mês atual
    for (let d = 1; d <= last.getDate(); d++) days.push({ date: new Date(year, month, d), cur: true });
    // Mês posterior (padding)
    let nextDay = 1;
    while (days.length < 42) {
        days.push({ date: new Date(year, month + 1, nextDay++), cur: false });
    }
    return days;
}
function fmtMonthYear(date) {
    const locale = typeof i18n !== 'undefined' ? i18n.t('locale') : 'pt-BR';
    return date.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}

// ======================== EVENTS ========================
function getEventsForDate(d) {
    const targetDate = normalizeDate(d);
    const targetStr = toDateStr(targetDate);
    const result = [];

    S.events.forEach(e => {
        const start = normalizeDate(e.date);
        const end = e.endDate ? normalizeDate(e.endDate) : start;

        // Check if within range for non-recurring events OR 'periodo' span
        if (!e.recurrence || e.recurrence === 'none' || e.recurrence === 'periodo') {
            if (targetDate >= start && targetDate <= end) {
                let finalItem = {
                    ...e,
                    isIgnored: !!(e.excludedDates && e.excludedDates[targetStr]),
                    occurrenceDate: targetStr
                };
                if (e.overrides && e.overrides[targetStr]) {
                    finalItem = { ...finalItem, ...e.overrides[targetStr] };
                }
                result.push(finalItem);
            }
            return;
        }

        // Recurring Logic
        if (targetDate < start) return;
        // In recurring events, endDate acts as the series end if it exists. 
        // If the occurrence is on targetDate, we verify if targetDate <= end.
        if (e.endDate && targetDate > end) return;

        let isOccurrence = false;
        if (e.recurrence === 'daily') isOccurrence = true;
        else if (e.recurrence === 'weekly') {
            const diffDays = Math.round((targetDate - start) / 86400000);
            isOccurrence = diffDays % 7 === 0;
        }
        else if (e.recurrence === 'monthly') {
            isOccurrence = targetDate.getDate() === start.getDate();
        }
        else if (e.recurrence === 'yearly') {
            isOccurrence = targetDate.getDate() === start.getDate() && targetDate.getMonth() === start.getMonth();
        }

        if (isOccurrence) {
            let finalItem = { ...e, isIgnored: !!(e.excludedDates && e.excludedDates[targetStr]), occurrenceDate: targetStr };
            // Aplicar sobreposição se existir para este dia
            if (e.overrides && e.overrides[targetStr]) {
                finalItem = { ...finalItem, ...e.overrides[targetStr] };
            }
            result.push(finalItem);
        }
    });
    return result;
}

function getTransactionsForDate(d) {
    const targetDate = normalizeDate(d);
    const targetStr = toDateStr(targetDate);
    const result = [];

    S.transactions.forEach(t => {
        const start = normalizeDate(t.date);
        if (targetDate < start) return;

        if (t.date === targetStr) {
            let finalItem = { ...t, isIgnored: !!(t.excludedDates && t.excludedDates[targetStr]), occurrenceDate: targetStr, currentInstallment: 1 };
            if (t.overrides && t.overrides[targetStr]) {
                finalItem = { ...finalItem, ...t.overrides[targetStr] };
            }
            result.push(finalItem);
            return;
        }

        if (!t.recurrence || t.recurrence === 'none') return;

        let isOccurrence = false;
        let currentInstallment = 0;

        if (t.recurrence === 'daily') {
            isOccurrence = true;
            const diffDays = Math.round((targetDate - start) / 86400000);
            currentInstallment = diffDays + 1;
        }
        else if (t.recurrence === 'weekly') {
            const diffDays = Math.round((targetDate - start) / 86400000);
            isOccurrence = diffDays % 7 === 0;
            currentInstallment = Math.floor(diffDays / 7) + 1;
        }
        else if (t.recurrence === 'monthly') {
            const targetMonth = targetDate.getMonth();
            const targetYear = targetDate.getFullYear();
            const startDay = start.getDate();
            const daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
            const effectiveDay = Math.min(startDay, daysInTargetMonth);

            isOccurrence = targetDate.getDate() === effectiveDay;
            if (isOccurrence) {
                currentInstallment = (targetYear - start.getFullYear()) * 12 + (targetMonth - start.getMonth()) + 1;
            }
        }
        else if (t.recurrence === 'yearly') {
            const targetMonth = targetDate.getMonth();
            const targetYear = targetDate.getFullYear();
            const startMonth = start.getMonth();
            const startDay = start.getDate();

            if (targetMonth === startMonth) {
                const daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
                const effectiveDay = Math.min(startDay, daysInTargetMonth);
                isOccurrence = targetDate.getDate() === effectiveDay;

                if (isOccurrence) {
                    currentInstallment = targetYear - start.getFullYear() + 1;
                }
            }
        }

        if (t.installments > 0) {
            if (currentInstallment > t.installments || currentInstallment < 1) {
                isOccurrence = false;
            }
        }

        if (isOccurrence) {
            let finalItem = { ...t, isIgnored: !!(t.excludedDates && t.excludedDates[targetStr]), occurrenceDate: targetStr, currentInstallment };
            if (t.overrides && t.overrides[targetStr]) {
                finalItem = { ...finalItem, ...t.overrides[targetStr] };
            }
            result.push(finalItem);
        }
    });
    return result;
}

async function addEvent(data) {
    const ev = { id: uid(), createdAt: new Date().toISOString(), ...data };
    S.events.push(ev);
    await userRef(`events/${ev.id}`).set(ev);
}

async function updateEvent(id, data) {
    const existing = S.events.find(e => e.id === id);
    if (!existing) return;
    const updated = { ...existing, ...data, updatedAt: new Date().toISOString() };
    S.events = S.events.map(e => e.id === id ? updated : e);
    await userRef(`events/${id}`).set(updated);
}

async function deleteEvent(id) {
    await userRef(`events/${id}`).remove();
}

// Removido generateRecurring pois agora é virtual.
function uid() { return Date.now() + '-' + Math.random().toString(36).slice(2, 9); }

// ======================== DOM & RENDERING ========================
window.goToViewGo = () => { window.location.href = 'https://www.viewgo.com.br/login'; };
window.closeAnyModal = () => document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => closeModal(m.id));

function $(id) { return document.getElementById(id); }
function show(id) {
    const el = $(id);
    if (el) {
        el.classList.remove('hidden');
        if (el.classList.contains('form-error')) el.style.display = 'block';
    }
}
function hide(id) { const el = $(id); if (el) el.classList.add('hidden'); }
const catColor = (cat) => ({ evento: '#3b82f6', aniversario: '#ec4899', trabalho: '#22c55e', pessoal: '#a855f7', saude: '#ef4444', estudo: '#f59e0b' })[cat] || '#3b82f6';

let lastModalOpen = 0;
function openModal(id) {
    const now = Date.now();
    if (now - lastModalOpen < 400) return;
    lastModalOpen = now;

    // Garantir que nenhum outro modal esteja aberto antes de abrir o novo
    window.closeAnyModal();

    // Limpar os toasts (removendo visíveis) para não conflitar com modals de inicialização
    const toastContainer = document.getElementById('toast-container');
    if (toastContainer) toastContainer.innerHTML = '';

    const el = $(id);
    if (el) {
        el.classList.remove('hidden');
        play('modal');
        if (typeof window.hideAgentFab === 'function') window.hideAgentFab();
        trackAction('open_modal_' + id);
    }
}

function closeModal(id) {
    console.log("debug: fechou side-menu");
    const el = $(id); if (!el) return;

    const sheet = el.querySelector('.modal-sheet');
    if (sheet) {
        sheet.style.transform = 'translateY(0)'; // Reseta para a próxima abertura
        sheet.style.transition = '';
    }
    el.classList.add('hidden');
    S.lastModalClose = Date.now();

    // Show FAB only if NO other modal is open
    setTimeout(() => {
        const anyActiveModal = document.querySelector('.modal-overlay:not(.hidden)');
        const sideMenuOpen = document.getElementById('side-menu')?.classList.contains('active');
        if (!anyActiveModal && !sideMenuOpen && typeof window.showAgentFab === 'function') {
            window.showAgentFab();
        }
    }, 100);
}

function toggleSideMenu(open) {
    const menu = $('side-menu');
    const overlay = $('side-menu-overlay');
    const session = localStorage.getItem('agbizu_session');

    if (open) {
        menu.classList.add('active');
        overlay.classList.remove('hidden');
        if (session && typeof window.hideAgentFab === 'function') window.hideAgentFab();
        play('modal');
    } else {
        menu.classList.remove('active');
        overlay.classList.add('hidden');
        const content = document.querySelector('.side-menu-content');
        if (content) {
            setTimeout(() => { content.scrollTop = 0; }, 300);
        }
        if (session && typeof window.showAgentFab === 'function') window.showAgentFab();
    }
}

window.closeAnyModal = () => {
    toggleSideMenu(false);
    ['modal-day', 'modal-event', 'modal-search', 'modal-scale', 'modal-logout', 'modal-onboarding-sound', 'modal-bible', 'modal-lang', 'modal-finances', 'modal-transaction', 'modal-confirm', 'modal-recurrence-choice'].forEach(closeModal);
};

window.showRecurrenceChoiceModal = function (onOnlyThis, onAll, hideOnlyThis = false) {
    play('click');
    if (typeof i18n !== 'undefined') i18n.applyToDOM();

    const btnOnlyThis = $('btn-save-recurring-instance');
    if (btnOnlyThis) {
        if (hideOnlyThis) btnOnlyThis.classList.add('hidden');
        else btnOnlyThis.classList.remove('hidden');
    }

    $('btn-save-recurring-all').onclick = () => {
        closeModal('modal-recurrence-choice');
        onAll();
    };
    $('btn-save-recurring-instance').onclick = () => {
        closeModal('modal-recurrence-choice');
        onOnlyThis();
    };
    $('btn-cancel-recurring-choice').onclick = () => {
        closeModal('modal-recurrence-choice');
    };

    openModal('modal-recurrence-choice');
};

window.showConfirmModal = function (titleKey, descKey, onConfirm) {
    play('click');
    const t = (k) => typeof i18n !== 'undefined' ? (i18n.t(k) || k) : k;
    if ($('confirm-title')) $('confirm-title').textContent = t(titleKey);
    if ($('confirm-desc')) $('confirm-desc').textContent = t(descKey);

    if ($('btn-agree-confirm')) {
        let confirmed = false;
        $('btn-agree-confirm').onclick = async (e) => {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            if (confirmed) return;
            confirmed = true;
            closeModal('modal-confirm');
            if (onConfirm) await onConfirm();
        };
    }

    if ($('btn-cancel-confirm')) {
        $('btn-cancel-confirm').onclick = (e) => {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            closeModal('modal-confirm');
        };
    }

    openModal('modal-confirm');
};

function refreshCalendar() {
    if (S.viewMode === 'month') {
        renderMonthView();
        updateGlobalFinanceSummary();
    } else if (S.viewMode === 'year') {
        renderYearView();
    } else if (S.viewMode === 'ai') {
        // AI view logic if needed, currently just Hello World
    }
}

function updateGlobalFinanceSummary() {
    const m = S.currentDate.getMonth();
    const y = S.currentDate.getFullYear();

    // Para o resumo global, precisamos considerar as recorrentes no mês
    let totalInc = 0, totalExp = 0;

    // Opção simplificada: iterar todos os dias do mês
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    for (let i = 1; i <= daysInMonth; i++) {
        const d = new Date(y, m, i);
        const trs = getTransactionsForDate(d);
        trs.forEach(t => {
            if (t.isIgnored) return;
            if (t.type === 'income') totalInc += t.amount;
            else totalExp += t.amount;
        });
    }

    const incomeEl = $('glb-total-income');
    const expenseEl = $('glb-total-expenses');
    const balanceEl = $('glb-total-balance');

    if (incomeEl) incomeEl.textContent = formatVal(totalInc);
    if (expenseEl) expenseEl.textContent = formatVal(totalExp);
    if (balanceEl) balanceEl.textContent = formatVal(totalInc - totalExp);

    // Também atualiza o modal (caso esteja aberto)
    const finIncEl = $('fin-total-income');
    const finExpEl = $('fin-total-expenses');
    const finBalEl = $('fin-total-balance');

    if (finIncEl) finIncEl.textContent = formatVal(totalInc);
    if (finExpEl) finExpEl.textContent = formatVal(totalExp);
    if (finBalEl) finBalEl.textContent = formatVal(totalInc - totalExp);
}

function renderMonthView() {
    const y = S.currentDate.getFullYear();
    const wrapper = $('month-slides-wrapper');
    if (!wrapper) return;

    // Se mudou o ano, regera os 12 slides
    if (S.lastRenderedYear !== y) {
        initMonthSwiper(y);
        S.lastRenderedYear = y;
    }

    const m = S.currentDate.getMonth();
    wrapper.style.transform = `translateX(-${m * 100}%)`;
    const titleEl = $('month-title');
    if (titleEl) titleEl.textContent = fmtMonthYear(S.currentDate);
}

function initMonthSwiper(year) {
    const wrapper = $('month-slides-wrapper');
    if (!wrapper) return;
    wrapper.innerHTML = '';

    // Render weekday headers with i18n
    const wdEl = $('cal-weekdays');
    if (wdEl) {
        const wd = typeof i18n !== 'undefined' ? i18n.t('weekdays') : ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
        wdEl.innerHTML = wd.map(d => `<div>${d}</div>`).join('');
    }

    const dayMore = typeof i18n !== 'undefined' ? i18n.t('day_more') : 'mais';

    for (let m = 0; m < 12; m++) {
        const slide = document.createElement('div');
        slide.className = 'month-slide';
        const date = new Date(year, m, 1);
        const days = getDaysInMonth(year, m);
        const today = toDateStr(new Date());

        days.forEach(({ date: d, cur }) => {
            const ds = toDateStr(d);
            const ws = getWorkStatus(d, S.userScale);
            const evs = getEventsForDate(d);
            const trs = getTransactionsForDate(d);
            const cell = document.createElement('div');
            cell.className = 'day-cell' + (!cur ? ' other-month' : '') + (ds === today ? ' today' : '') + (cur && ws ? (ws.isOff ? ' off-day' : ' work-day') : '');

            let pillsHtml = '';
            const allItems = [
                ...evs.filter(e => !e.isIgnored).map(ev => ({ type: 'event', title: ev.title, time: ev.time, color: catColor(ev.category) })),
                ...trs.filter(t => !t.isIgnored).map(t => ({ type: 'finance', title: t.desc, amount: t.amount, color: t.type === 'income' ? '#16a34a' : '#dc2626' }))
            ];

            pillsHtml = allItems.slice(0, 2).map(item => {
                const text = item.type === 'event'
                    ? (item.time ? item.time + ' ' : '') + item.title
                    : (item.type === 'finance' ? (item.color === '#16a34a' ? '+' : '-') + ' ' + formatVal(item.amount) + ' ' + item.title : '');
                return `<div class="day-event-pill" style="background:${item.color}">${text}</div>`;
            }).join('');

            cell.innerHTML = `
        <div class="day-num"><span>${d.getDate()}</span>${(isHoliday(d) && cur ? '<span class="day-holiday-badge">F</span>' : '')}</div>
        ${(isHoliday(d) && cur ? `<div class="day-holiday-name">${isHoliday(d)}</div>` : '')}
        <div class="day-events-wrap">
          ${pillsHtml}
          ${(allItems.length > 2 ? `<div class="day-more">+${allItems.length - 2} ${dayMore}</div>` : '')}
        </div>
        ${(cur && ws && S.userScale ? `<div class="day-work-label ${ws.isOff ? 'off' : 'work'}">${i18n.t(ws.isOff ? 'badge_off' : 'badge_work')}</div><div class="day-work-dot ${ws.isOff ? 'off' : 'work'}"> </div>` : '')}
      `;
            cell.onclick = (e) => { e.stopPropagation(); play('click'); openDayModal(d); };
            slide.appendChild(cell);
        });
        wrapper.appendChild(slide);
    }
}

function renderYearView() {
    const grid = $('year-grid');
    if (!grid) return;

    const year = S.currentDate.getFullYear();
    const titleEl = $('year-title');
    if (titleEl) titleEl.textContent = String(year);

    const summaryContainer = $('year-summary-container');
    grid.innerHTML = '';

    const today = toDateStr(new Date());
    const locale = typeof i18n !== 'undefined' ? i18n.t('locale') : 'pt-BR';
    const wdMini = typeof i18n !== 'undefined' ? i18n.t('weekdays_mini') : ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
    const t = (k) => typeof i18n !== 'undefined' ? i18n.t(k) : k;

    let annualIncome = 0;
    let annualExpense = 0;
    const monthlyData = [];

    // 1. Calculate Monthly & Annual Totals
    for (let m = 0; m < 12; m++) {
        let mIncome = 0;
        let mExpense = 0;
        const daysInMonth = new Date(year, m + 1, 0).getDate();

        for (let day = 1; day <= daysInMonth; day++) {
            const d = new Date(year, m, day);
            const trs = getTransactionsForDate(d);
            trs.forEach(tr => {
                if (tr.isIgnored) return;
                if (tr.type === 'income') mIncome += tr.amount;
                else mExpense += tr.amount;
            });
        }

        annualIncome += mIncome;
        annualExpense += mExpense;
        monthlyData.push({ m, mIncome, mExpense, mBalance: mIncome - mExpense });
    }

    // 2. Render Year Summary Top Section
    if (summaryContainer) {
        const maxVal = Math.max(...monthlyData.map(d => Math.max(d.mIncome, d.mExpense, 100)));

        let chartHtml = monthlyData.map(d => {
            const incH = (d.mIncome / maxVal) * 100;
            const expH = (d.mExpense / maxVal) * 100;
            const mName = new Date(year, d.m, 1).toLocaleDateString(locale, { month: 'short' }).substring(0, 1);

            return `
        <div class="chart-column">
          <div class="chart-bars">
            <div class="chart-bar income" style="height: ${incH}%"></div>
            <div class="chart-bar expense" style="height: ${expH}%"></div>
          </div>
          <span class="chart-label">${mName}</span>
        </div>
      `;
        }).join('');

        summaryContainer.innerHTML = `
   

      <div class="year-chart-wrapper">
      
        <div class="year-chart-header">
          <div class="year-chart-title">${t('finance_title')} (${year})</div>
          
          <div class="year-chart-legend">
            <div class="legend-item"><div class="legend-dot income"></div><span>${t('finance_type_income')}</span></div>
            <div class="legend-item"><div class="legend-dot expense"></div><span>${t('finance_type_expense')}</span></div>
          </div>
        </div>
        <div class="year-chart-container">
          ${chartHtml}
        </div>
           <div class="year-summary-cards" style="margin-top: 20px;">
        <div class="year-summary-card income">
          <div class="label">${t('finance_income')}</div>
          <div class="value" style="font-size: 1.1rem;  line-height: 1;">${formatVal(annualIncome)}</div>
        </div>
        <div class="year-summary-card expense">
          <div class="label">${t('finance_expenses')}</div>
          <div class="value" style="font-size: 1.1rem;  line-height: 1;">${formatVal(annualExpense)}</div>
        </div>
        <div class="year-summary-card balance">
          <div class="label">${t('finance_balance')}</div>
          <div class="value" style="font-size: 1.1rem;  line-height: 1;">${formatVal(annualIncome - annualExpense)}</div>
        </div>
      </div>
      </div>
    `;
    }

    // 3. Render Month Cards
    for (let m = 0; m < 12; m++) {
        const monthDate = new Date(year, m, 1);
        const mData = monthlyData[m];
        const card = document.createElement('div');
        card.className = 'mini-month';

        let html = `<div class="mini-month-title">${monthDate.toLocaleDateString(locale, { month: 'long' })}</div><div class="mini-grid">`;
        wdMini.forEach(d => html += `<div class="mini-day-hdr">${d}</div>`);

        getDaysInMonth(year, m).forEach(({ date, cur }) => {
            const ds = toDateStr(date);
            const ws = getWorkStatus(date, S.userScale);
            let cls = 'mini-day' + (!cur ? ' other' : (ds === today ? ' today' : (isHoliday(date) ? ' holiday' : (ws ? (ws.isOff ? ' off-day' : ' work-day') : ''))));
            if (cur && getEventsForDate(date).filter(e => !e.isIgnored).length > 0) cls += ' has-event';
            html += `<div class="${cls}">${cur ? date.getDate() : ''}</div>`;
        });

        html += `</div>`; // Fechar mini-grid

        // Monthly Summary Pills
        html += `
      <div class="mini-month-fin">
        <div class="mini-fin-item inc">
          <span class="material-symbols-outlined" style="font-size: 10px;">arrow_upward</span>
          ${mData.mIncome > 0 ? (mData.mIncome >= 1000 ? (mData.mIncome / 1000).toFixed(1) + 'k' : mData.mIncome.toFixed(0)) : '0'}
        </div>
        <div class="mini-fin-item exp">
          <span class="material-symbols-outlined" style="font-size: 10px;">arrow_downward</span>
          ${mData.mExpense > 0 ? (mData.mExpense >= 1000 ? (mData.mExpense / 1000).toFixed(1) + 'k' : mData.mExpense.toFixed(0)) : '0'}
        </div>
        <div class="mini-fin-item bal" style="color: ${mData.mBalance >= 0 ? 'var(--green)' : 'var(--danger)'}">
          ${mData.mBalance >= 0 ? '+' : ''}${mData.mBalance !== 0 ? (Math.abs(mData.mBalance) >= 1000 ? (Math.abs(mData.mBalance) / 1000).toFixed(1) + 'k' : Math.abs(mData.mBalance).toFixed(0)) : '0'}
        </div>
      </div>
    `;

        card.innerHTML = html;
        card.onclick = () => { play('click'); S.currentDate = monthDate; setView('month'); };
        grid.appendChild(card);
    }
}

function setView(mode) {
    S.viewMode = mode;
    // Update view containers visibility
    const views = {
        'month': $('view-month'),
        'year': $('view-year'),
        'ai': $('viewAI'),
        'lessons': $('view-lessons'),
        'lesson-detail': $('view-lesson-detail')
    };
    Object.keys(views).forEach(k => {
        if (views[k]) views[k].classList.toggle('active', mode === k);
    });

    // Update button active state
    const lessonBtns = [$('btn-view-lessons'), $('btn-show-lessons')];
    const monthBtns = [$('btn-view-month'), $('btn-go-home')];

    lessonBtns.forEach(b => {
        if (b) {
            b.classList.toggle('active', mode === 'lessons');
            b.classList.toggle('btn-primary', mode === 'lessons');
            b.classList.toggle('btn-outline', mode !== 'lessons');
        }
    });

    monthBtns.forEach(b => {
        if (b) {
            b.classList.toggle('active', mode === 'month');
            b.classList.toggle('btn-primary', mode === 'month');
            b.classList.toggle('btn-outline', mode !== 'month');
        }
    });

    const otherBtns = {
        'year': $('btn-view-year'),
        'ai': $('btn-view-ai')
    };
    Object.keys(otherBtns).forEach(k => {
        if (otherBtns[k]) otherBtns[k].classList.toggle('active', mode === k);
    });

    // Ensure admin elements are visible if admin is logged in
    const isAdmin = firebase.auth().currentUser?.email === 'maispraticodesenvolvimento@gmail.com';
    const btnAdd = document.getElementById('btn-add-lesson');
    if (btnAdd) {
        if (isAdmin) btnAdd.classList.remove('hidden');
        else btnAdd.classList.add('hidden');
    }

    if (isAdmin) {
        document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
    }

    if (mode === 'lessons') renderLessonsView();
    if (mode === 'month') renderWeeklyPlanner();
    refreshCalendar();
}

function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate(str, len = 20) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) + '...' : str;
}

// ======================== MODALS & ACTIONS ========================
function buildEventItem(ev, withActions = true, showDate = false, contextDate = null) {
    const t = (k) => typeof i18n !== 'undefined' ? i18n.t(k) : k;
    const locale = typeof i18n !== 'undefined' ? i18n.t('locale') : 'pt-BR';
    const wrap = document.createElement('div');
    wrap.className = 'event-item';
    if (ev.isIgnored) wrap.style.opacity = '0.5';

    let dateHtml = '';
    if (showDate && ev.date) {
        const d = new Date(ev.date + 'T12:00:00');
        const formattedDate = d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
        dateHtml = `
      <div style="display:flex; align-items:center; gap:4px; font-size:0.75rem; color:var(--primary);  background: var(--primary-lt); padding: 2px 8px; border-radius: 12px; flex-shrink: 0;">
        <span class="material-symbols-outlined" style="font-size:14px;">calendar_today</span>
        ${formattedDate}
      </div>`;
    }

    wrap.innerHTML = `
    <div class="event-stripe" style="background:${catColor(ev.category)}"></div>
    <div class="event-body">
      <div style="display:flex; align-items:center; justify-content: space-between; gap: 8px;">
        <div class="event-title" style="${ev.isIgnored ? 'text-decoration: line-through;' : ''}">${escHtml(ev.title)}</div>
        ${dateHtml}
      </div>
      <div class="event-meta">
        ${ev.time ? `
          <span class="material-symbols-outlined" style="font-size:16px;">schedule</span>
          <span>${ev.time}${ev.endTime ? ' - ' + ev.endTime : ''}</span>
        ` : ''}
        ${ev.category ? `<span style="opacity:0.8;">• ${(typeof i18n !== 'undefined' ? i18n.t('cat_' + ev.category.toLowerCase().replace('é', 'e')) : ev.category) || ev.category}</span>` : ''}
        ${ev.recurrence && ev.recurrence !== 'none' ? '<span class="material-symbols-outlined" style="font-size:16px;">sync</span>' : ''}
        ${ev.createdAt ? `<span style="opacity:0.8; margin-left: 4px;">• ${typeof i18n !== 'undefined' ? i18n.t('launched_on') : 'Lançado em'} ${new Date(ev.createdAt).toLocaleDateString(locale)}</span>` : ''}
      </div>
      ${ev.description ? `<div class="event-description">${escHtml(ev.description)}</div>` : ''}
      ${ev.isIgnored ? `
        <div style="display:flex; align-items:center; gap:4px; color:var(--danger); font-size:0.65rem;  margin-top:4px;">
          <span class="material-symbols-outlined" style="font-size:12px;">event_busy</span>
          <span>${t('ignored_instance_badge')}</span>
        </div>` : ''}
    </div>
    ${withActions ? `
    <div class="event-actions">
      <button class="btn btn-ghost btn-icon-sm" onclick="event.stopPropagation(); editEvent('${ev.id}', ${contextDate ? `'${contextDate.toISOString().split('T')[0]}'` : 'null'})">
        <span class="material-symbols-outlined" style="font-size:20px;">edit</span>
      </button>
      <button class="btn btn-ghost btn-icon-sm" onclick="event.stopPropagation(); delEvent('${ev.id}', ${contextDate ? `'${contextDate.toISOString().split('T')[0]}'` : 'null'})">
        <span class="material-symbols-outlined" style="font-size:20px; color:var(--danger);">delete</span>
      </button>
    </div>` : ''}
  `;

    wrap.onclick = (e) => {
        if (withActions) {
            S.editingEventId = ev.id;
            openEventForm(ev, contextDate);
        } else {
            if (document.getElementById('modal-search')) closeModal('modal-search');
            if (document.getElementById('modal-day')) closeModal('modal-day');
            openEventForm(ev);
        }
    };

    return wrap;
}

function openDayModal(d) {
    S.selectedDate = d;
    const locale = typeof i18n !== 'undefined' ? i18n.t('locale') : 'pt-BR';
    $('day-modal-title').textContent = d.toLocaleDateString(locale, { day: 'numeric', month: 'long' });
    $('day-modal-weekday').textContent = d.toLocaleDateString(locale, { weekday: 'long' });

    const ws = getWorkStatus(d, S.userScale);
    const statusEl = $('day-work-status');
    statusEl.innerHTML = '';
    if (ws && S.userScale) {
        statusEl.innerHTML = `
      <div class="work-badge-large ${ws.isOff ? 'off' : 'work'}">
        <span class="material-symbols-outlined">${ws.isOff ? 'home' : 'work'}</span>
        ${ws.isOff ? (typeof i18n !== 'undefined' ? i18n.t('tutorial_off_dot') : 'Folga') : (typeof i18n !== 'undefined' ? i18n.t('tutorial_work_dot') : 'Trabalho')}
      </div>
    `;
    }

    // Eventos
    const evs = getEventsForDate(d);
    const evList = $('day-events-list');
    evList.innerHTML = evs.length ? '' : `<p class="empty-state">${typeof i18n !== 'undefined' ? i18n.t('search_no_results') : 'Sem eventos'}</p>`;
    evs.forEach(ev => {
        evList.appendChild(buildEventItem(ev, true, true, d));
    });

    // Finanças
    const trs = getTransactionsForDate(d);
    const trList = $('day-finance-list');
    trList.innerHTML = trs.length ? '' : `<p class="empty-state">${typeof i18n !== 'undefined' ? i18n.t('finance_empty') : 'Sem finanças'}</p>`;
    trs.forEach(t => {
        const isChecked = !!t.checked;
        const color = t.type === 'income' ? '#16a34a' : '#dc2626';
        const bgColor = t.type === 'income' ? '#dcfce7' : '#fee2e2';

        const div = document.createElement('div');
        div.className = 'finance-item' + (isChecked ? ' checked' : '');
        div.style = `
      display:flex; 
      align-items:center; 
      gap:12px; 
      padding: 12px 16px; 
      background: var(--surface); 
      border: 1px solid var(--border); 
      border-radius: 16px; 
      margin-bottom: 8px; 
      cursor:pointer; 
      opacity: ${t.isIgnored ? '0.4' : (isChecked ? '0.7' : '1')}; 
      box-shadow: 0 2px 8px rgba(0,0,0,0.02);
      transition: all 0.2s;
    `;

        div.innerHTML = `
      <button class="btn btn-ghost btn-icon-sm" onclick="window.toggleTransactionStatus('${t.id}', event, '${t.occurrenceDate}')" style="color: ${isChecked ? 'var(--primary)' : 'var(--text3)'}; padding: 0; width: 32px; height: 32px; flex-shrink: 0;">
        <span class="material-symbols-outlined" style="font-size:24px; font-variation-settings: 'FILL' ${isChecked ? 1 : 0}">${isChecked ? 'check_circle' : 'radio_button_unchecked'}</span>
      </button>
      
      <div style="background:${bgColor}; color:${color}; width:36px; height:36px; border-radius:10px; display:flex; align-items:center; justify-content:center; flex-shrink: 0;">
        <span class="material-symbols-outlined" style="font-size:20px;">${t.type === 'income' ? 'trending_up' : 'trending_down'}</span>
      </div>
      
      <div style="flex:1; overflow: hidden;">
        <div >
          ${truncate(t.desc)} ${t.installments > 0 ? `<span style="font-size:0.75rem; color:var(--text3);  margin-left:4px;">(${t.currentInstallment}/${t.installments})</span>` : ''}
        </div>
        <div style="font-size:0.75rem; color:var(--text3); ">${t.type === 'income' ? (typeof i18n !== 'undefined' ? i18n.t('finance_type_income') : 'Receita') : (typeof i18n !== 'undefined' ? i18n.t('finance_type_expense') : 'Despesa')}${t.createdAt ? ` • ${typeof i18n !== 'undefined' ? i18n.t('launched_on') : 'Lançado em'} ${new Date(t.createdAt).toLocaleDateString(typeof i18n !== 'undefined' ? i18n.t('locale') : 'pt-BR')}` : ''}</div>
      </div>
      
      <div style="text-align:right; flex-shrink: 0;">
        <div style="font-size:1rem; color:${color}; text-decoration: ${(isChecked || t.isIgnored) ? 'line-through' : 'none'};">
          ${t.type === 'income' ? '+' : '-'} ${formatVal(t.amount)}
        </div>
        ${t.isIgnored ? `
          <div style="display:flex; align-items:center; gap:4px; color:var(--danger); font-size:0.7rem; margin-top:4px; justify-content: flex-end;">
            <span class="material-symbols-outlined" style="font-size:14px;">event_busy</span>
            <span data-i18n="ignored_instance_badge">${typeof i18n !== 'undefined' ? i18n.t('ignored_instance_badge') : 'DESCONSIDERADO'}</span>
          </div>
        ` : ''}
      </div>
    `;
        div.onclick = (e) => {
            if (e.target.closest('button')) return;
            closeModal('modal-day');
            window.openTransactionForm(d, t);
        };
        trList.appendChild(div);
    });

    openModal('modal-day');
    trackAction('view_day_details');
}

window.editEvent = (id) => { closeModal('modal-day'); openEventForm(S.events.find(e => e.id === id)); };
window.delEvent = async (id) => {
    showLoading('loading_deleting');
    await deleteEvent(id);
    S.events = S.events.filter(e => e.id !== id);
    S.lastRenderedYear = null;
    refreshCalendar();
    hideLoading();
};

function openEventForm(evt, clickedDate = null) {
    // Garantir que nenhum outro modal esteja aberto
    window.closeAnyModal();

    const isNew = !evt;
    S.editingEventId = isNew ? null : evt.id;
    S.editingOccurrenceDate = clickedDate ? toDateStr(clickedDate) : (evt ? evt.date : toDateStr(new Date()));
    const t = (k) => typeof i18n !== 'undefined' ? i18n.t(k) : k;

    $('event-modal-title').textContent = evt ? t('edit_event') : t('new_event');
    $('evt-title').value = evt?.title || '';
    $('evt-desc').value = evt?.description || '';
    const displayDate = clickedDate || (evt?.date ? new Date(evt.date + 'T12:00:00') : (S.selectedDate || new Date()));
    setFPValue('evt-date', toDateStr(displayDate));
    setFPValue('evt-time', evt?.time || '');
    setFPValue('evt-end-date', evt?.endDate || toDateStr(displayDate));
    setFPValue('evt-end-time', evt?.endTime || '');
    $('evt-recurrence').value = evt?.recurrence || 'none';

    document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === (evt?.category || 'evento')));

    const endRow = $('evt-end-row');
    if (endRow) endRow.classList.toggle('hidden', $('evt-recurrence').value !== 'periodo');

    if (evt) show('btn-delete-event'); else hide('btn-delete-event');
    updateWorkBadge($('evt-date').value);

    const recArea = $('event-recurring-options');
    const btnIgnore = $('btn-ignore-event-instance');

    if (evt && recArea && btnIgnore) {
        recArea.classList.remove('hidden');
        const isIgnored = evt.excludedDates && evt.excludedDates[S.editingOccurrenceDate];
        const recType = (evt.recurrence && evt.recurrence !== 'none') ? evt.recurrence : 'daily';
        const i18nKey = (isIgnored ? 'consider_instance_' : 'ignore_instance_') + recType;

        const span = btnIgnore.querySelector('[data-i18n]');
        if (span) {
            span.setAttribute('data-i18n', i18nKey);
            if (typeof i18n !== 'undefined') span.innerHTML = i18n.t(i18nKey);
        }
        if (typeof i18n !== 'undefined') i18n.applyToDOM();

        btnIgnore.style.color = isIgnored ? 'var(--primary)' : 'var(--danger)';
        btnIgnore.style.borderColor = isIgnored ? 'var(--primary-lt)' : 'var(--danger-lt)';
        const icon = btnIgnore.querySelector('.material-symbols-outlined');
        if (icon) icon.textContent = isIgnored ? 'event_available' : 'event_busy';
    } else {
        // Modo Novo ou elementos não encontrados
        if (recArea) recArea.classList.add('hidden');
    }

    openModal('modal-event');
}

function updateWorkBadge(ds) {
    if (ds && ds.includes('/')) ds = parseDate(ds);
    const ws = getWorkStatus(new Date(ds + 'T12:00:00'), S.userScale);
    const b = $('event-work-badge');
    const t = (k) => typeof i18n !== 'undefined' ? i18n.t(k) : k;
    if (ws && S.userScale) {
        b.className = 'work-badge ' + (ws.isOff ? 'off' : 'work');
        b.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px;">${ws.isOff ? 'home' : 'work'}</span> ${ws.isOff ? t('badge_off') : t('badge_work')}`;
        b.classList.remove('hidden');
    } else b.classList.add('hidden');
}

let isSavingEvent = false;
async function saveEventForm(e) {
    e.preventDefault();
    if (isSavingEvent) return;
    const tEl = $('evt-title'), dEl = $('evt-date'), errT = $('err-title');
    const title = tEl.value.trim(), date = parseDate(dEl.value);

    // Resetar erros
    errT.classList.add('hidden');
    tEl.classList.remove('field-error');

    if (!title) {
        errT.classList.remove('hidden');
        tEl.classList.add('field-error');
        tEl.focus();
        return;
    }
    if (!date) return;

    isSavingEvent = true;
    const recValue = $('evt-recurrence').value;
    const data = {
        title,
        date,
        endDate: (recValue === 'periodo') ? (parseDate($('evt-end-date').value) || date) : (recValue === 'none' ? date : null),
        description: $('evt-desc').value.trim(),
        time: $('evt-time').value,
        endTime: $('evt-end-time').value,
        category: document.querySelector('.cat-btn.active')?.dataset.cat || 'evento',
        recurrence: recValue
    };

    const original = S.editingEventId ? S.events.find(e => e.id === S.editingEventId) : null;
    const isRecurring = original && original.recurrence && original.recurrence !== 'none';
    let shouldAsk = isRecurring;
    let hideOnlyThis = false;

    if (original) {
        const recurrenceChanged = (data.recurrence !== original.recurrence || data.endDate !== (original.endDate || null));
        const mainPropsSame = (data.title === original.title && data.description === original.description && data.time === original.time && data.category === original.category && data.date === original.date);

        if (recurrenceChanged) {
            hideOnlyThis = true;
            if (mainPropsSame) {
                shouldAsk = false;
            }
        }
    }

    const isEditingVirtual = isRecurring && S.editingOccurrenceDate !== original.date;

    const performAllSave = async () => {
        showLoading('loading_saving');
        const saveData = { ...data };
        if (isEditingVirtual && original) {
            saveData.date = original.date;
        }
        if (S.editingEventId) await updateEvent(S.editingEventId, saveData); else await addEvent(saveData);
        finishSave();
    };

    const performInstanceSave = async () => {
        try {
            showLoading('loading_saving');
            if (original) {
                const overrideData = {
                    title: data.title,
                    description: data.description,
                    time: data.time,
                    endTime: data.endTime,
                    category: data.category,
                    date: data.date,
                    endDate: data.endDate
                };
                if (!original.overrides) original.overrides = {};
                original.overrides[S.editingOccurrenceDate] = overrideData;
                await userRef(`events/${original.id}/overrides/${S.editingOccurrenceDate}`).set(overrideData);
            }
            finishSave();
        } catch (err) {
            console.error("Erro ao salvar sobreposição:", err);
            alert(typeof i18n !== 'undefined' ? i18n.t('err_apply_override') : "Erro ao aplicar edição específica.");
            hideLoading();
            isSavingEvent = false;
        }
    };

    const finishSave = () => {
        S.lastRenderedYear = null;
        refreshCalendar();
        hideLoading();
        closeModal('modal-event');
        play('click');
        setTimeout(() => isSavingEvent = false, 500);
    };

    if (shouldAsk) {
        window.showRecurrenceChoiceModal(performInstanceSave, performAllSave, hideOnlyThis);
        isSavingEvent = false;
        return;
    }

    showLoading('loading_saving');
    if (S.editingEventId) await updateEvent(S.editingEventId, data); else await addEvent(data);
    finishSave();
}

// Limpar erro ao digitar
document.addEventListener('DOMContentLoaded', () => {
    if ($('evt-title')) {
        $('evt-title').oninput = () => {
            $('err-title').classList.add('hidden');
            $('evt-title').classList.remove('field-error');
        };
    }
});

// ======================== SCALE SETUP ========================
function openScaleModal() {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Se já tem escala, projetamos ela para os 30-31 dias do mês
    if (S.userScale && S.userScale.sequence) {
        S.customSeq = [];
        for (let i = 0; i < daysInMonth; i++) {
            const d = new Date(startOfMonth);
            d.setDate(1 + i);
            const ws = getWorkStatus(d, S.userScale);
            S.customSeq.push(ws.isOff ? 'F' : 'T');
        }
    } else {
        S.customSeq = new Array(daysInMonth).fill(null);
    }

    const errEl = $('scale-error');
    if (errEl) { errEl.textContent = ''; hide('scale-error'); }

    renderScalePreview();
    openModal('modal-scale');
}

function renderScalePreview() {
    const wrap = $('scale-weekday-grid');
    wrap.innerHTML = '';
    const dayNames = typeof i18n !== 'undefined' ? i18n.t('weekdays') : ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const locale = typeof i18n !== 'undefined' ? i18n.t('locale') : 'pt-BR';

    const now = new Date();
    const currentMonthName = now.toLocaleDateString(locale, { month: 'long' });
    const todayStr = toDateStr(now);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const offset = startOfMonth.getDay();

    let html = `
    <div class="scale-month-block">
      <div class="scale-month-name" style="text-transform: capitalize;">${currentMonthName}</div>
      <div class="scale-mini-grid">
  `;

    // Headers
    dayNames.forEach(d => html += `<div class="scale-hdr">${d}</div>`);

    // Offset days
    for (let i = 0; i < offset; i++) {
        html += `<div class="scale-day" style="opacity: 0; pointer-events: none;"></div>`;
    }

    // Actual days
    for (let idx = 0; idx < S.customSeq.length; idx++) {
        const st = S.customSeq[idx];
        const date = new Date(startOfMonth);
        date.setDate(1 + idx);
        const isToday = toDateStr(date) === todayStr;

        html += `
      <div class="scale-day ${st === 'T' ? 'work-explicit' : (st === 'F' ? 'off-explicit' : '')} ${isToday ? 'scale-today-marker' : ''}" 
           onclick="toggleScaleDay(${idx})">
        ${date.getDate()}
      </div>`;
    }

    html += `</div></div>`;
    wrap.innerHTML = html;

    // Habilita o botão sempre para podermos clicar e mostrar erro
    $('btn-save-scale').disabled = false;
    // Limpa o erro se o usuário começar a interagir
    hide('scale-error');
}

window.toggleScaleDay = (idx) => { play('click'); const s = S.customSeq[idx]; S.customSeq[idx] = s === 'T' ? 'F' : (s === 'F' ? 'T' : 'T'); renderScalePreview(); };

window.modifyWeeks = (delta) => {
    play('click');
    if (delta > 0) {
        for (let i = 0; i < 7; i++) S.customSeq.push(null);
    } else {
        if (S.customSeq.length > 7) S.customSeq.splice(-7);
    }
    renderScalePreview();
};

window.applyPreset = (type) => {
    play('click');
    const presets = {
        '4_serv': 'FTFTFTFTFFF FTFTFTFTFFF'.replace(/ /g, '').split(''), // Exemplo aproximado
        '5_serv': 'FTFTFTFTFTFFF FTFTFTFTFTFFF'.replace(/ /g, '').split(''),
        'dobradinha': 'FTFTFFTTFTFTTF'.split(''),
        'admin': 'FTTTTTF'.split(''),
        '12x36': 'TF'.split(''),
        '24x72': 'TFFF'.split('')
    };

    const base = presets[type];
    if (!base) return;

    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    // Preenche o mês inteiro repetindo o padrão
    S.customSeq = [];
    for (let i = 0; i < daysInMonth; i++) {
        S.customSeq.push(base[i % base.length]);
    }

    renderScalePreview();
};

async function saveScale() {
    const errEl = $('scale-error');
    const t = (k) => typeof i18n !== 'undefined' ? i18n.t(k) : k;
    errEl.textContent = '';
    hide('scale-error');

    const seqFull = S.customSeq.map(s => s === 'T' ? 1 : 0);
    const incomplete = S.customSeq.some(x => x === null);
    if (incomplete) {
        errEl.textContent = t('scale_err_incomplete');
        show('scale-error');
        return;
    }

    if (seqFull.every(v => v === 0)) {
        errEl.textContent = t('scale_err_seq');
        show('scale-error');
        return;
    }

    const seq = getShortestPattern(seqFull);

    // A referência agora é o dia 1 do mês atual
    const now = new Date();
    const ref = new Date(now.getFullYear(), now.getMonth(), 1);
    ref.setHours(0, 0, 0, 0);

    const display = seq.length <= 7 ? (seq.filter(v => v === 1).length + 'x' + seq.filter(v => v === 0).length) : (typeof i18n !== 'undefined' ? i18n.t('custom_scale') : 'Escala Custom');
    S.userScale = { sequence: seq, referenceDate: ref.getTime(), display };
    S.forceScale = false;

    showLoading('loading_saving');
    await saveProfile();
    hideLoading();

    $('scale-display').textContent = S.userScale.display;
    show('scale-bar');
    closeModal('modal-scale');
    S.lastRenderedYear = null;
    refreshCalendar();
    runOnboardingFlow();
}

window.setOnboardingSound = (enabled) => {
    S.soundsEnabled = enabled;
    updateSoundIcon();
    localStorage.setItem('agbizu_onboarding_sound', 'done');
    saveProfile();
    closeModal('modal-onboarding-sound');
    play('click');
};

// ======================== SEARCH & PAGINATION ========================
S.searchState = {
    results: [],
    page: 0,
    pageSize: 10
};

function renderSearch(query) {
    const t = (k) => typeof i18n !== 'undefined' ? i18n.t(k) : k;
    const locale = typeof i18n !== 'undefined' ? i18n.t('locale') : 'pt-BR';
    const q = query.trim().toLowerCase();

    const countEl = $('events-count');
    const resultsEl = $('search-results');
    resultsEl.innerHTML = '';

    if (!q) {
        if (countEl) countEl.style.display = "none";
        return;
    }

    if (countEl) {
        countEl.style.display = "flex";
        countEl.style.gap = "5px";
    }

    // 1. Filtrar Aulas (Conteúdos)
    const filteredLessons = S.lessons.filter(l => 
        l.title.toLowerCase().includes(q) ||
        (l.json || '').toLowerCase().includes(q)
    ).map(l => ({ ...l, searchType: 'lesson' }));

    // 2. Definir Resultados
    const finalResults = filteredLessons;

    S.searchState.results = finalResults;
    S.searchState.page = 0;

    if (countEl) {
        countEl.innerHTML = `${finalResults.length} <span data-i18n="events_count_zero">${t('events_count_zero')}</span>`;
        if (typeof i18n !== 'undefined') i18n.applyToDOM();
    }

    renderSearchPage();
}

function renderSearchPage() {
    const resultsEl = $('search-results');
    const btnMore = $('btn-load-more-search');
    if (btnMore) btnMore.remove();

    const start = S.searchState.page * S.searchState.pageSize;
    const end = start + S.searchState.pageSize;
    const items = S.searchState.results.slice(start, end);

    items.forEach(item => {
        if (item.searchType === 'lesson') {
            resultsEl.appendChild(buildLessonSearchItem(item));
        } else {
            resultsEl.appendChild(buildEventItem(item, false, true));
        }
    });

    if (end < S.searchState.results.length) {
        const loadMoreBtn = document.createElement('button');
        loadMoreBtn.id = 'btn-load-more-search';
        loadMoreBtn.className = 'btn btn-outline btn-full';
        loadMoreBtn.style.marginTop = '16px';
        loadMoreBtn.style.marginBottom = '24px';
        loadMoreBtn.innerHTML = `
      <span class="material-symbols-outlined" style="font-size:18px;">expand_more</span>
      <span>${typeof i18n !== 'undefined' ? i18n.t('btn_load_more') : 'Carregar Mais'}</span>
    `;
        loadMoreBtn.onclick = () => {
            S.searchState.page++;
            renderSearchPage();
        };
        resultsEl.appendChild(loadMoreBtn);
    }
}

function buildLessonSearchItem(lesson) {
    const wrap = document.createElement('div');
    wrap.className = 'event-item';
    wrap.style.cursor = 'pointer';

    wrap.innerHTML = `
        <div class="event-stripe" style="background: var(--primary);"></div>
        <div class="event-body">
            <div style="display:flex; align-items:center; justify-content: space-between; gap: 8px;">
                <div class="event-title">${lesson.title}</div>
                <div style="display:flex; align-items:center; gap:4px; font-size:0.75rem; color:var(--primary); background: var(--primary-lt); padding: 2px 8px; border-radius: 12px; flex-shrink: 0;">
                    <span class="material-symbols-outlined" style="font-size:14px;">school</span>
                    Aula
                </div>
            </div>
            <div class="event-meta">
                <span class="material-symbols-outlined" style="font-size:16px;">play_circle</span>
                <span style="opacity:0.8;">Conteúdo Educativo</span>
            </div>
        </div>
    `;

    wrap.onclick = () => {
        closeModal('modal-search');
        window.openLessonDetail(lesson.id);
    };

    return wrap;
}

// Mensagem Diária e Onboarding Sequencial
function runOnboardingFlow() {
    // 1. Escala Obrigatória
    if (S.forceScale) {
        setTimeout(() => { openScaleModal(); }, 400);
        return;
    }

    // 2. Mensagem Bíblica Diária
    const showedBible = checkDailyMessage();
    if (showedBible) return;

    // 3. Onboarding de Som
    checkOnboardingSound();
}

window.checkOnboardingSound = () => {
    if (!localStorage.getItem('agbizu_onboarding_sound')) {
        openModal('modal-onboarding-sound');
    }
};

function checkDailyMessage() {
    const today = toDateStr(new Date());
    const lastDate = localStorage.getItem('agbizu_last_msg_date');
    if (lastDate === today) return false;

    const dayOfMonth = new Date().getDate();
    const msgs = getMensagensDoDia();
    const msg = msgs.find(m => m.dia === dayOfMonth) || msgs[0];

    $('bible-verse-ref').textContent = msg.versiculo;
    $('bible-message').textContent = `“${msg.mensagem}”`;
    $('bible-reflection').textContent = msg.reflexao;

    openModal('modal-bible');
    localStorage.setItem('agbizu_last_msg_date', today);
    return true;
}

function updateSoundIcon() {
    const on = S.soundsEnabled;
    if ($('icon-sound-on')) $('icon-sound-on').classList.toggle('hidden', !on);
    if ($('icon-sound-off')) $('icon-sound-off').classList.toggle('hidden', on);

    if ($('shortcut-icon-sound-on')) $('shortcut-icon-sound-on').classList.toggle('hidden', !on);
    if ($('shortcut-icon-sound-off')) $('shortcut-icon-sound-off').classList.toggle('hidden', on);

    localStorage.setItem('agbizu_sounds_enabled', on);
}

document.addEventListener('DOMContentLoaded', () => {
    // Apply i18n on first load
    if (typeof i18n !== 'undefined') {
        i18n.applyToDOM();
        // Re-render calendar on lang change
        document.addEventListener('langchange', () => {
            S.lastRenderedYear = null;
            if (S.currentUser) {
                refreshCalendar();
                // FIX: Only reopen the day modal if it was already open
                const dayModal = $('modal-day');
                if (dayModal && !dayModal.classList.contains('hidden') && S.selectedDate) {
                    openDayModal(S.selectedDate);
                }
            }
        });
    }

    loadAudio();

    // ---- Listeners de Teclado/Foco no Login ----
    const loginScr = $('login-screen');
    const loginInputs = [$('inp-email'), $('inp-pass'), $('inp-name'), $('inp-confirm')];
    loginInputs.forEach(inp => {
        if (inp) {
            inp.onfocus = () => loginScr.classList.add('focused');
            // Removido o loginScr.classList.remove('focused') no onblur para manter o topo oculto
        }
    });

    const btnNewEv = $('btn-new-event');
    if (btnNewEv) btnNewEv.onclick = () => { window.closeAnyModal(); S.selectedDate = new Date(); openEventForm(); };

    const btnNewTrans = $('btn-new-transaction-side');
    if (btnNewTrans) btnNewTrans.onclick = () => { window.closeAnyModal(); window.openTransactionForm(new Date()); };

    if ($('btn-add-from-day')) $('btn-add-from-day').onclick = () => { closeModal('modal-day'); openEventForm(); };
    if ($('btn-toggle-sound')) $('btn-toggle-sound').onclick = () => { S.soundsEnabled = !S.soundsEnabled; updateSoundIcon(); saveProfile(); };
    if ($('btn-shortcut-sound')) {
        $('btn-shortcut-sound').onclick = () => { S.soundsEnabled = !S.soundsEnabled; updateSoundIcon(); saveProfile(); };
    }
    if ($('btn-logout')) $('btn-logout').onclick = () => { window.closeAnyModal(); openModal('modal-logout'); };
    if ($('btn-confirm-logout')) $('btn-confirm-logout').onclick = () => logout();
    if ($('btn-cancel-logout')) $('btn-cancel-logout').onclick = () => closeModal('modal-logout');
    if ($('btn-close-bible')) {
        $('btn-close-bible').onclick = () => {
            closeModal('modal-bible');
            runOnboardingFlow();
        };
    }

    if ($('btn-open-menu')) $('btn-open-menu').onclick = () => toggleSideMenu(true);
    if ($('btn-close-menu')) $('btn-close-menu').onclick = () => toggleSideMenu(false);
    if ($('btn-collapse-sidebar')) {
        $('btn-collapse-sidebar').onclick = () => window.toggleSidebar();
    }
    if ($('side-menu-overlay')) $('side-menu-overlay').onclick = () => toggleSideMenu(false);
    $('btn-lang-picker').onclick = () => { window.closeAnyModal(); window.openLangPicker(); };

    if ($('btn-open-scale')) $('btn-open-scale').onclick = () => { toggleSideMenu(false); openScaleModal(); };
    if ($('btn-view-lessons')) $('btn-view-lessons').onclick = () => setView('lessons');
    if ($('btn-view-month')) $('btn-view-month').onclick = () => setView('month');
    if ($('btn-view-year')) $('btn-view-year').onclick = () => setView('year');
    if ($('btn-view-ai')) $('btn-view-ai').onclick = () => setView('ai');
    if ($('btn-agent-side')) $('btn-agent-side').onclick = () => { toggleSideMenu(false); setView('ai'); };

    if ($('month-title')) {
        $('month-title').style.cursor = 'pointer';
        $('month-title').onclick = () => setView('year');
    }
    if ($('btn-prev-month')) $('btn-prev-month').onclick = () => { S.currentDate.setDate(1); S.currentDate.setMonth(S.currentDate.getMonth() - 1); refreshCalendar(); };
    if ($('btn-next-month')) $('btn-next-month').onclick = () => { S.currentDate.setDate(1); S.currentDate.setMonth(S.currentDate.getMonth() + 1); refreshCalendar(); };
    if ($('btn-prev-month-abs')) $('btn-prev-month-abs').onclick = () => { S.currentDate.setDate(1); S.currentDate.setMonth(S.currentDate.getMonth() - 1); refreshCalendar(); };
    if ($('btn-next-month-abs')) $('btn-next-month-abs').onclick = () => { S.currentDate.setDate(1); S.currentDate.setMonth(S.currentDate.getMonth() + 1); refreshCalendar(); };
    window.goToToday = () => {
        S.currentDate = new Date();
        setView('month');
        refreshCalendar();
        toggleSideMenu(false);
    };
    if ($('btn-today')) $('btn-today').onclick = goToToday;
    if ($('btn-go-home')) $('btn-go-home').onclick = goToToday;

    const swiper = $('month-swiper');
    const wrapper = $('month-slides-wrapper');

    if (swiper && wrapper) {
        let startX = 0, currentTranslate = 0, isDragging = false;

        swiper.addEventListener('touchstart', e => {
            startX = e.touches[0].clientX;
            isDragging = true;
            wrapper.style.transition = 'none';
        }, { passive: true });

        swiper.addEventListener('touchmove', e => {
            if (!isDragging) return;
            const diff = e.touches[0].clientX - startX;
            const m = S.currentDate.getMonth();
            const translate = -(m * wrapper.offsetWidth) + diff;
            wrapper.style.transform = `translateX(${translate}px)`;
        }, { passive: true });

        swiper.addEventListener('touchend', e => {
            if (!isDragging) return;
            isDragging = false;
            const diff = e.changedTouches[0].clientX - startX;
            wrapper.style.transition = '';

            if (Math.abs(diff) > swiper.offsetWidth / 5) {
                S.currentDate.setDate(1);
                if (diff > 0) S.currentDate.setMonth(S.currentDate.getMonth() - 1);
                else S.currentDate.setMonth(S.currentDate.getMonth() + 1);
            }
            refreshCalendar();
        }, { passive: true });
    }
    if ($('btn-prev-year')) $('btn-prev-year').onclick = () => { S.currentDate.setFullYear(S.currentDate.getFullYear() - 1); renderYearView(); };
    if ($('btn-next-year')) $('btn-next-year').onclick = () => { S.currentDate.setFullYear(S.currentDate.getFullYear() + 1); renderYearView(); };
    if ($('btn-back-to-month')) $('btn-back-to-month').onclick = () => setView('month');
    if ($('evt-recurrence')) {
        $('evt-recurrence').onchange = (e) => {
            const endRow = $('evt-end-row');
            if (endRow) endRow.classList.toggle('hidden', e.target.value !== 'periodo');
        };
    }
    if ($('event-form')) $('event-form').onsubmit = saveEventForm;
    if ($('btn-close-day')) $('btn-close-day').onclick = () => closeModal('modal-day');
    if ($('btn-close-event')) $('btn-close-event').onclick = () => closeModal('modal-event');
    if ($('btn-cancel-event')) $('btn-cancel-event').onclick = () => closeModal('modal-event');
    if ($('btn-delete-event')) {
        let clickedDel = false;
        $('btn-delete-event').onclick = (e) => {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            if (clickedDel) return;
            clickedDel = true;
            if (S.editingEventId) {
                closeModal('modal-event');
                window.showConfirmModal('confirm_delete_title', 'confirm_delete_desc', async () => {
                    await window.delEvent(S.editingEventId);
                });
            }
            setTimeout(() => clickedDel = false, 500); // Libera após 500ms
        };
    }
    if ($('btn-open-scale')) $('btn-open-scale').onclick = () => { toggleSideMenu(false); openScaleModal(); };
    if ($('btn-close-scale')) $('btn-close-scale').onclick = () => closeModal('modal-scale');
    if ($('btn-save-scale')) $('btn-save-scale').onclick = () => { saveScale(); trackAction('save_scale'); };
    if ($('btn-clear-seq')) $('btn-clear-seq').onclick = () => {
        const now = new Date();
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        S.customSeq = new Array(daysInMonth).fill(null);
        renderScalePreview();
    };

    document.querySelectorAll('.cat-btn').forEach(b => b.onclick = () => { document.querySelectorAll('.cat-btn').forEach(x => x.classList.remove('active')); b.classList.add('active'); });

    // ---- Pesquisa ----
    if ($('btn-search')) {
        $('btn-search').onclick = () => {
            window.closeAnyModal();
            if ($('btn-clear-search')) $('btn-clear-search').onclick = () => { if ($('search-input')) $('search-input').value = ''; renderSearch(''); };
            play('click'); $('search-input').value = ''; renderSearch('');
            openModal('modal-search');
            setTimeout(() => $('search-input').focus(), 400);
        };
    }
    if ($('search-input')) $('search-input').oninput = e => renderSearch(e.target.value);
    if ($('btn-close-search')) $('btn-close-search').onclick = () => closeModal('modal-search');

    // ---- Financeira ----
    if ($('btn-open-finances')) $('btn-open-finances').onclick = () => { toggleSideMenu(false); play('click'); openFinances(); };
    if ($('btn-close-finances')) $('btn-close-finances').onclick = () => closeModal('modal-finances');
    if ($('btn-add-transaction')) $('btn-add-transaction').onclick = () => { closeModal('modal-finances'); window.openTransactionForm(); };
    if ($('btn-close-transaction')) $('btn-close-transaction').onclick = () => closeModal('modal-transaction');
    if ($('btn-delete-transaction')) {
        let clickedDelTrans = false;
        $('btn-delete-transaction').onclick = (e) => {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            if (clickedDelTrans) return;
            clickedDelTrans = true;
            if (S.editingTransactionId) {
                // Modal de confirmação já é chamado em window.deleteTransaction
                window.deleteTransaction(S.editingTransactionId);
                closeModal('modal-transaction');
            }
            setTimeout(() => clickedDelTrans = false, 500);
        };
    }

    window.updateGlobalFinanceVisibility = function () {
        const container = $('finance-global-summary-container');
        const iconVisible = $('icon-finance-visible');
        const iconHidden = $('icon-finance-hidden');
        const shortVisible = $('shortcut-icon-finance-on');
        const shortHidden = $('shortcut-icon-finance-off');

        if (S.showGlobalFinance) {
            if (container) container.style.display = 'block';
            if (iconVisible) iconVisible.classList.remove('hidden');
            if (iconHidden) iconHidden.classList.add('hidden');
            if (shortVisible) shortVisible.classList.remove('hidden');
            if (shortHidden) shortHidden.classList.add('hidden');
        } else {
            if (container) container.style.display = 'none';
            if (iconVisible) iconVisible.classList.add('hidden');
            if (iconHidden) iconHidden.classList.remove('hidden');
            if (shortVisible) shortVisible.classList.add('hidden');
            if (shortHidden) shortHidden.classList.remove('hidden');
        }
        localStorage.setItem('agbizu_show_global_finance', S.showGlobalFinance);
    };

    window.updateGlobalFinanceVisibility();

    if ($('btn-toggle-global-finance')) {
        $('btn-toggle-global-finance').onclick = () => {
            S.showGlobalFinance = !S.showGlobalFinance;
            window.updateGlobalFinanceVisibility();
            play('click');
        };
    }

    if ($('btn-shortcut-finance')) {
        $('btn-shortcut-finance').onclick = () => {
            S.showGlobalFinance = !S.showGlobalFinance;
            window.updateGlobalFinanceVisibility();
            play('click');
        };
    }

    if ($('btn-close-global-finance')) {
        $('btn-close-global-finance').onclick = () => {
            S.showGlobalFinance = false;
            window.updateGlobalFinanceVisibility();
            play('click');
        };
    }

    if ($('finance-global-summary')) {
        $('finance-global-summary').style.cursor = 'pointer';
        $('finance-global-summary').onclick = () => {
            play('click');
            openFinances();
        };
    }

    window.setTransType = (type) => {
        S.financeType = type;
        const incBtn = $('trans-type-income');
        const expBtn = $('trans-type-expense');
        if (type === 'income') {
            if (incBtn) incBtn.classList.add('active');
            if (expBtn) expBtn.classList.remove('active');
        } else {
            if (expBtn) expBtn.classList.add('active');
            if (incBtn) incBtn.classList.remove('active');
        }
    };

    if ($('trans-type-income')) $('trans-type-income').onclick = () => { window.setTransType('income'); play('click'); };
    if ($('trans-type-expense')) $('trans-type-expense').onclick = () => { window.setTransType('expense'); play('click'); };

    if ($('trans-recurrence')) {
        $('trans-recurrence').addEventListener('change', (e) => {
            const gInsts = $('group-installments');
            if (gInsts) {
                if (e.target.value === 'none') {
                    gInsts.classList.add('hidden');
                    $('trans-installments').value = '';
                } else {
                    gInsts.classList.remove('hidden');
                }
            }
        });
    }

    if ($('transaction-form')) {
        let isSavingTrans = false;
        $('transaction-form').onsubmit = async (e) => {
            e.preventDefault();
            if (isSavingTrans) return;
            play('click');
            const transId = S.editingTransactionId || Date.now().toString();
            const transAmount = parseFloat($('trans-amount').value) || 0;
            const transDateValue = parseDate($('trans-date').value);
            const transDescValue = $('trans-desc').value || (typeof i18n !== 'undefined' ? i18n.t('default_transaction') : 'Transação');

            const original = S.editingTransactionId ? S.transactions.find(t => t.id === S.editingTransactionId) : null;

            const saveDataLocal = {
                id: transId,
                type: S.financeType,
                desc: transDescValue,
                amount: transAmount,
                date: transDateValue,
                recurrence: $('trans-recurrence')?.value || 'none',
                installments: parseInt($('trans-installments')?.value) || 0,
                createdAt: original && original.createdAt ? original.createdAt : new Date().toISOString()
            };
            const isRecurring = original && original.recurrence && original.recurrence !== 'none';
            let shouldAsk = isRecurring;
            let hideOnlyThis = false;

            if (original) {
                const recurrenceChanged = (saveDataLocal.recurrence !== original.recurrence || saveDataLocal.installments !== (original.installments || 0));
                const mainPropsSame = (saveDataLocal.desc === original.desc && saveDataLocal.amount === original.amount && saveDataLocal.type === original.type && saveDataLocal.date === original.date);

                if (recurrenceChanged) {
                    hideOnlyThis = true; // Não permite "Somente nesta" se a regra de repetição mudou
                    if (mainPropsSame) {
                        // Se alterou *apenas* a repetição/parcelas, aplica em todas direto pulando o modal
                        shouldAsk = false;
                    }
                }
            }

            const isEditingVirtual = isRecurring && S.editingOccurrenceDate !== original?.date;

            const finishTransSave = () => {
                S.lastRenderedYear = null;
                refreshCalendar();
                if (!$('modal-finances').classList.contains('hidden')) updateFinanceUI();
                hideLoading();
                closeModal('modal-transaction');
                setTimeout(() => isSavingTrans = false, 500);
            };

            const performAllSave = async () => {
                showLoading('loading_saving');
                const finalData = { ...saveDataLocal };
                if (isEditingVirtual && original) {
                    finalData.date = original.date;
                }
                const idx = S.transactions.findIndex(t => t.id === transId);
                if (idx !== -1) S.transactions[idx] = finalData; else S.transactions.push(finalData);
                await userRef(`transactions/${transId}`).set(finalData);
                finishTransSave();
            };

            const performInstanceSave = async () => {
                try {
                    showLoading('loading_saving');
                    if (original) {
                        const overrideData = {
                            desc: saveDataLocal.desc,
                            amount: saveDataLocal.amount,
                            type: saveDataLocal.type,
                            date: saveDataLocal.date
                        };
                        if (!original.overrides) original.overrides = {};
                        original.overrides[S.editingOccurrenceDate] = overrideData;
                        await userRef(`transactions/${original.id}/overrides/${S.editingOccurrenceDate}`).set(overrideData);
                    }
                    finishTransSave();
                } catch (err) {
                    console.error("Erro ao salvar sobreposição de transação:", err);
                    alert(typeof i18n !== 'undefined' ? i18n.t('err_process_transaction') : "Erro ao processar transação.");
                    hideLoading();
                }
            };

            try {
                if (shouldAsk) {
                    window.showRecurrenceChoiceModal(performInstanceSave, performAllSave, hideOnlyThis);
                    isSavingTrans = false;
                } else {
                    isSavingTrans = true;
                    await performAllSave();
                }
            } catch (err) {
                hideLoading();
                console.error("Error saving transaction:", err);
                alert(typeof i18n !== 'undefined' ? i18n.t('err_save_transaction') : "Erro ao salvar transação. Verifique sua conexão.");
                isSavingTrans = false;
            }
        };
    }

    if ($('btn-add-fin-from-day')) {
        $('btn-add-fin-from-day').onclick = () => {
            console.log("[DEBUG] Botão 'Nova Transação' clicado");
            play('click');
            const d = S.selectedDate || new Date();
            console.log("[DEBUG] Data selecionada:", d);

            console.log("[DEBUG] Tentando fechar modal-day");
            closeModal('modal-day');

            console.log("[DEBUG] Chamando window.openTransactionForm");
            window.openTransactionForm(d);
        };
    } else {
        console.warn("[DEBUG] Elemento 'btn-add-fin-from-day' NÃO encontrado no DOM durante registro");
    }

    if ($('btn-ignore-event-instance')) {
        $('btn-ignore-event-instance').onclick = () => {
            const dateStr = parseDate($('evt-date').value);
            const eventId = S.editingEventId;
            if (eventId && dateStr) window.ignoreEventInstance(eventId, dateStr);
        };
    }

    if ($('btn-ignore-trans-instance')) {
        $('btn-ignore-trans-instance').onclick = () => {
            const dateStr = parseDate($('trans-date').value);
            const transId = S.editingTransactionId;
            if (transId && dateStr) window.ignoreTransactionInstance(transId, dateStr);
        };
    }
    document.querySelectorAll('.modal-sheet').forEach(sheet => {
        const overlay = sheet.parentElement;
        const overlayId = overlay.id;
        let startY = 0, currentY = 0, isDragging = false;

        const startDrag = (e) => {
            if (e.target.closest('button, input, select')) return;

            // Se clicou no overlay, só inicia se for NO FUNDO (área escura)
            if (e.currentTarget === overlay && e.target !== overlay) return;

            startY = e.clientY; currentY = 0;
            isDragging = true;
            sheet.style.transition = 'none';
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
        };

        const onMove = (e) => {
            if (!isDragging) return;
            currentY = e.clientY - startY;
            if (currentY > 0) {
                e.preventDefault();
                sheet.style.transform = `translateY(${currentY}px)`;
            }
        };

        const onUp = (e) => {
            if (!isDragging) return;
            isDragging = false;
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);

            if (currentY < 10 && e.target === overlay) {
                // Tratado pelo document.click global para evitar ghost clicks
            } else if (currentY > 60) { // Arraste profundo
                sheet.style.transition = 'transform 0.2s cubic-bezier(0.4, 0, 1, 1)';
                sheet.style.transform = 'translateY(100%)';
                setTimeout(() => closeModal(overlayId), 180);
            } else { // Arraste curto (volta)
                sheet.style.transition = 'transform 0.4s cubic-bezier(0.18, 0.89, 0.32, 1.28)';
                sheet.style.transform = 'translateY(0)';
            }
            currentY = 0;
        };

        // Registrar alças: Barra cinza, Cabeçalho e o próprio Fundo (Overlay)
        const handle = sheet.querySelector('.modal-handle');
        const header = sheet.querySelector('.modal-header');

        if (handle) handle.addEventListener('pointerdown', startDrag);
        if (header) header.addEventListener('pointerdown', startDrag);
        overlay.addEventListener('pointerdown', startDrag);

        // Impedir que o toque dentro do conteúdo do modal cause conflito de scroll/drag no fundo
        sheet.addEventListener('pointerdown', (e) => {
            if (e.target !== handle && !header.contains(e.target)) e.stopPropagation();
        }, { passive: true });
    });

    // ---- Inteligência de Teclado (Mobile) ----
    if (window.visualViewport) {
        const vv = window.visualViewport;
        const updateKeyboard = () => {
            // Diferença entre a tela total e a área visível (teclado)
            const h = window.innerHeight - vv.height;
            document.documentElement.style.setProperty('--keyboard-h', (h > 60 ? h : 0) + 'px');

            // Auto-scroll para o campo focado
            const active = document.activeElement;
            if (h > 60 && active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
                setTimeout(() => active.scrollIntoView({ block: 'center', behavior: 'smooth' }), 150);
            }
        };
        vv.addEventListener('resize', updateKeyboard);
        vv.addEventListener('scroll', updateKeyboard);
    }
});
// ======================== FINANCE LOGIC ========================
function updateFinanceUI() {
    const m = S.currentDate.getMonth();
    const y = S.currentDate.getFullYear();
    const locale = typeof i18n !== 'undefined' ? i18n.t('locale') : 'pt-BR';
    const monthName = new Date(y, m, 1).toLocaleDateString(locale, { month: 'long' });

    if ($('finance-month-label')) {
        $('finance-month-label').textContent = (typeof i18n !== 'undefined' ? i18n.t('finance_month_summary') : 'Resumo de') + ' ' + monthName;
    }

    let totalInc = 0, totalExp = 0;
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const allForMonth = [];

    for (let i = 1; i <= daysInMonth; i++) {
        const d = new Date(y, m, i);
        const trs = getTransactionsForDate(d);
        trs.forEach(t => {
            if (t.isIgnored) return;
            if (t.type === 'income') totalInc += t.amount;
            else totalExp += t.amount;
            if (!allForMonth.some(x => x.id === t.id && x.occurrenceDate === t.occurrenceDate)) {
                allForMonth.push(t);
            }
        });
    }

    const finIncEl = $('fin-total-income');
    const finExpEl = $('fin-total-expenses');
    const finBalEl = $('fin-total-balance');

    if (finIncEl) finIncEl.textContent = formatVal(totalInc);
    if (finExpEl) finExpEl.textContent = formatVal(totalExp);
    if (finBalEl) finBalEl.textContent = formatVal(totalInc - totalExp);

    renderFinanceList(allForMonth);
}

function openFinances() {
    updateFinanceUI();
    openModal('modal-finances');
    trackAction('view_finances');
}

function formatVal(v) {
    const locale = typeof i18n !== 'undefined' ? i18n.t('locale') : 'pt-BR';
    const cur = locale === 'pt-BR' ? 'BRL' : 'USD';
    return v.toLocaleString(locale, { style: 'currency', currency: cur });
}

function renderFinanceList(list) {
    const container = $('finance-list');
    container.innerHTML = '';
    if (list.length === 0) {
        container.innerHTML = `<p style="text-align:center; opacity:0.5; margin-top:20px;" data-i18n="finance_empty">${typeof i18n !== 'undefined' ? i18n.t('finance_empty') : 'Sem transações'}</p>`;
        return;
    }

    list.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(t => {
        const isChecked = !!t.checked;
        const div = document.createElement('div');
        div.className = 'finance-item' + (isChecked ? ' checked' : '');
        div.style = `display:flex; align-items:center; justify-content:space-between; padding:12px; background:var(--surface); border:1px solid var(--border); border-radius:12px; opacity: ${isChecked ? '0.6' : '1'}; transition: all 0.2s;`;
        div.innerHTML = `
      <div style="display:flex; align-items:center; gap:12px;">
        <button class="btn btn-ghost btn-icon-sm" onclick="window.toggleTransactionStatus('${t.id}', event, '${t.occurrenceDate}')" style="color: ${isChecked ? 'var(--primary)' : 'var(--text3)'}; padding: 0; width: 28px; height: 28px;">
          <span class="material-symbols-outlined" style="font-size:22px; font-variation-settings: 'FILL' ${isChecked ? 1 : 0}">${isChecked ? 'check_circle' : 'radio_button_unchecked'}</span>
        </button>
        <div style="background:${t.type === 'income' ? '#dcfce7' : '#fee2e2'}; color:${t.type === 'income' ? '#166534' : '#991b1b'}; width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center;">
          <span class="material-symbols-outlined" style="font-size:18px;">${t.type === 'income' ? 'trending_up' : 'trending_down'}</span>
        </div>
        <div>
          <div>${truncate(t.desc)} ${t.installments > 0 ? `<span style="font-size:0.65rem; color:var(--text3);  margin-left:4px;">(${t.currentInstallment}/${t.installments})</span>` : ''}</div>
          <div style="font-size:0.65rem; color:var(--text2);">${new Date(t.date + 'T12:00:00').toLocaleDateString(typeof i18n !== 'undefined' ? i18n.t('locale') : 'pt-BR')}${t.createdAt ? ` • ${typeof i18n !== 'undefined' ? i18n.t('launched_on') : 'Lançado em'} ${new Date(t.createdAt).toLocaleDateString(typeof i18n !== 'undefined' ? i18n.t('locale') : 'pt-BR')}` : ''}</div>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:12px;">
          <div style="font-size:0.85rem;  color:${t.type === 'income' ? '#16a34a' : '#dc2626'}; text-decoration: ${isChecked ? 'line-through' : 'none'};">
          ${t.type === 'income' ? '+' : '-'} ${formatVal(t.amount)}
        </div>
        <button class="btn btn-ghost btn-icon-sm" onclick="window.deleteTransaction('${t.id}')" style="display:none;">
          <span class="material-symbols-outlined" style="font-size:18px; color:var(--text3);">delete</span>
        </button>
      </div>
    `;
        div.onclick = (e) => {
            // Se clicou no botão de excluir, não abre o formulário
            if (e.target.closest('button')) return;
            play('click');
            closeModal('modal-finances');
            window.openTransactionForm(null, t);
        };
        container.appendChild(div);
    });
}

window.openTransactionForm = function (d = null, trans = null) {
    window.closeAnyModal();
    console.log("[DEBUG] openTransactionForm executada", { d, trans });
    const form = $('transaction-form');
    if (!form) return;

    form.reset();
    S.editingTransactionId = trans ? trans.id : null;
    S.editingOccurrenceDate = d ? toDateStr(d) : (trans ? trans.date : toDateStr(new Date()));
    const t = (k) => typeof i18n !== 'undefined' ? i18n.t(k) : k;
    const titleEl = document.querySelector('#modal-transaction .modal-title');
    const btnDel = $('btn-delete-transaction');

    if (trans) {
        // Modo Edição
        if (titleEl) titleEl.textContent = t('finance_edit') || 'Editar Transação';
        if (btnDel) btnDel.classList.remove('hidden');
        if ($('trans-desc')) $('trans-desc').value = trans.desc || '';
        if ($('trans-amount')) $('trans-amount').value = trans.amount || 0;
        // Se for ocorrência recorrente, d terá a data clicada
        const displayDate = d || (trans.date ? new Date(trans.date + 'T12:00:00') : new Date());
        if ($('trans-date')) setFPValue('trans-date', toDateStr(displayDate));
        if ($('trans-recurrence')) {
            $('trans-recurrence').value = trans.recurrence || 'none';
            if (trans.recurrence && trans.recurrence !== 'none') {
                $('group-installments')?.classList.remove('hidden');
                if ($('trans-installments')) $('trans-installments').value = trans.installments || '';
            } else {
                $('group-installments')?.classList.add('hidden');
                if ($('trans-installments')) $('trans-installments').value = '';
            }
        }
        window.setTransType(trans.type || 'expense');

        // Mostrar botão de "Desconsiderar" para qualquer transação recorrente
        const recArea = $('trans-recurring-options');
        const btnIgnore = $('btn-ignore-trans-instance');
        if (recArea && btnIgnore) {
            recArea.classList.remove('hidden');
            // Toggle texto conforme estado e recorrência
            const isIgnored = trans.excludedDates && trans.excludedDates[$('trans-date').value];
            const recType = (trans.recurrence && trans.recurrence !== 'none') ? trans.recurrence : 'daily';
            const i18nKey = (isIgnored ? 'consider_instance_' : 'ignore_instance_') + recType;

            const span = btnIgnore.querySelector('[data-i18n]');
            if (span) {
                span.setAttribute('data-i18n', i18nKey);
                if (typeof i18n !== 'undefined') span.innerHTML = i18n.t(i18nKey);
            }
            if (typeof i18n !== 'undefined') i18n.applyToDOM();

            btnIgnore.style.color = isIgnored ? 'var(--primary)' : 'var(--danger)';
            btnIgnore.style.borderColor = isIgnored ? 'var(--primary-lt)' : 'var(--danger-lt)';
            const icon = btnIgnore.querySelector('.material-symbols-outlined');
            if (icon) icon.textContent = isIgnored ? 'event_available' : 'event_busy';
        }
    } else {
        // Modo Novo
        if (titleEl) titleEl.textContent = t('finance_add') || 'Nova Transação';
        if (btnDel) btnDel.classList.add('hidden');
        if ($('trans-date')) setFPValue('trans-date', toDateStr(d || new Date()));
        if ($('trans-recurrence')) $('trans-recurrence').value = 'none';
        $('group-installments')?.classList.add('hidden');
        if ($('trans-installments')) $('trans-installments').value = '';
        if ($('trans-recurring-options')) $('trans-recurring-options').classList.add('hidden');
        window.setTransType('expense');
    }

    openModal('modal-transaction');
};

window.deleteTransaction = function (id) {
    window.showConfirmModal('confirm_delete_title', 'confirm_delete_trans_desc', async () => {
        play('click');
        showLoading('loading_deleting');
        await userRef(`transactions/${id}`).remove();
        S.transactions = S.transactions.filter(t => t.id !== id);
        S.lastRenderedYear = null;
        refreshCalendar();
        hideLoading();
        // Atualiza a UI financeira silenciosamente se o modal estiver aberto
        if (!$('modal-finances').classList.contains('hidden')) updateFinanceUI();
    });
};

window.toggleTransactionStatus = async function (id, event, dateStr = null) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    const t = S.transactions.find(x => x.id === id);
    if (!t) return;

    const targetDate = dateStr || t.date;
    const isRecurring = t.recurrence && t.recurrence !== 'none';

    // Determinar estado atual (prioridade no override)
    const currentChecked = (t.overrides && t.overrides[targetDate] && t.overrides[targetDate].checked !== undefined)
        ? t.overrides[targetDate].checked
        : !!t.checked;

    const newState = !currentChecked;

    try {
        if (isRecurring) {
            if (!t.overrides) t.overrides = {};
            if (!t.overrides[targetDate]) t.overrides[targetDate] = {};
            t.overrides[targetDate].checked = newState;
            await userRef(`transactions/${id}/overrides/${targetDate}`).update({ checked: newState });
        } else {
            t.checked = newState;
            await userRef(`transactions/${id}`).update({ checked: newState });
        }

        if (!$('modal-finances').classList.contains('hidden')) updateFinanceUI();
        if (!$('modal-day').classList.contains('hidden') && S.selectedDate) openDayModal(S.selectedDate);
        // Notificamos o calendário para atualizar os dots se necessário
        S.lastRenderedYear = null;
        refreshCalendar();
    } catch (err) {
        console.error("Error toggling transaction status:", err);
    }
};

function getShortestPattern(arr) {
    const n = arr.length;
    // Patterns like 2, 3, 4, 12/36, etc.
    for (let len = 1; len <= Math.floor(n / 2); len++) {
        let match = true;
        for (let i = len; i < n; i++) {
            if (arr[i] !== arr[i % len]) { match = false; break; }
        }
        if (match) return arr.slice(0, len);
    }

    // Weekly patterns (7 or 14 days) even if n is 30/31
    for (let len of [7, 14]) {
        if (n >= len * 2) {
            let match = true;
            for (let i = len; i < n; i++) {
                if (arr[i] !== arr[i % len]) { match = false; break; }
            }
            if (match) return arr.slice(0, len);
        }
    }
    return arr;
}
window.ignoreEventInstance = async function (id, dateStr) {
    const event = S.events.find(e => e.id === id);
    if (!event) return;
    const isCurrentlyIgnored = !!(event.excludedDates && event.excludedDates[dateStr]);

    try {
        showLoading('loading_saving');
        if (!event.excludedDates) event.excludedDates = {};

        if (isCurrentlyIgnored) {
            delete event.excludedDates[dateStr];
            await userRef(`events/${id}/excludedDates/${dateStr}`).remove();
        } else {
            event.excludedDates[dateStr] = true;
            await userRef(`events/${id}/excludedDates/${dateStr}`).set(true);
        }

        refreshCalendar();
        hideLoading();
        closeModal('modal-event');
    } catch (err) {
        hideLoading();
        console.error("Error toggling ignore status for event:", err);
    }
};

window.ignoreTransactionInstance = async function (id, dateStr) {
    const t = S.transactions.find(x => x.id === id);
    if (!t) return;
    const isCurrentlyIgnored = !!(t.excludedDates && t.excludedDates[dateStr]);

    try {
        showLoading('loading_saving');
        if (!t.excludedDates) t.excludedDates = {};

        if (isCurrentlyIgnored) {
            delete t.excludedDates[dateStr];
            await userRef(`transactions/${id}/excludedDates/${dateStr}`).remove();
        } else {
            t.excludedDates[dateStr] = true;
            await userRef(`transactions/${id}/excludedDates/${dateStr}`).set(true);
        }

        S.lastRenderedYear = null;
        refreshCalendar();
        if (!$('modal-finances').classList.contains('hidden')) updateFinanceUI();
        hideLoading();
        closeModal('modal-transaction');
    } catch (err) {
        hideLoading();
        console.error("Error toggling ignore status for transaction:", err);
    }
};
window.goToAgent = () => {
    toggleSideMenu(false);
    trackAction('open_ai_agent');
    { toggleSideMenu(false); setView('ai'); };
};

// ======================== TOAST NOTIFICATIONS ========================
function createToast(options = {}) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.dataset.toastId = options.id;

    const t = (k) => typeof i18n !== 'undefined' ? i18n.t(k) : k;

    toast.innerHTML = `
    <div class="toast-header">
      <div class="toast-icon ${options.type || ''}">
        <span class="material-symbols-outlined">${options.icon || 'info'}</span>
      </div>
      <div class="toast-content">
        <div class="toast-title">${options.title || ''}</div>
        <div class="toast-msg">${options.message || ''}</div>
      </div>
    </div>
    <div class="toast-footer">
      <label class="toast-checkbox-wrapper">
        <input type="checkbox" id="toast-dont-show-${options.id}">
        <span class="toast-checkbox-label">${t('toast_dont_show_again')}</span>
      </label>
      <div class="toast-buttons">
        ${options.secondaryBtn ? `<button class="toast-btn ghost" id="toast-btn-sec-${options.id}">${options.secondaryBtn}</button>` : ''}
        <button class="toast-btn primary" id="toast-btn-main-${options.id}">${options.primaryBtn || 'OK'}</button>
      </div>
    </div>
  `;

    container.appendChild(toast);

    // Event Listeners
    const mainBtn = toast.querySelector(`#toast-btn-main-${options.id}`);
    const secBtn = toast.querySelector(`#toast-btn-sec-${options.id}`);
    const checkbox = toast.querySelector(`#toast-dont-show-${options.id}`);

    const dismiss = () => {
        // Dispensar todos os toasts do container simultaneamente
        const allToasts = container.querySelectorAll('.toast');
        allToasts.forEach(t => {
            // Verifica o checkbox de cada toast individualmente antes de remover
            const cb = t.querySelector('input[type="checkbox"]');
            const tid = t.dataset.toastId;
            if (cb && cb.checked && tid) {
                localStorage.setItem(`agbizu_dismiss_toast_${tid}`, 'true');
            }

            t.classList.add('hiding');
            setTimeout(() => t.remove(), 250);
        });
    };

    mainBtn.onclick = () => {
        if (options.onPrimary) options.onPrimary();
        dismiss();
    };

    if (secBtn) {
        secBtn.onclick = () => {
            if (options.onSecondary) options.onSecondary();
            dismiss();
        };
    }

    // Auto-dismiss opcional? Não por enquanto, melhor deixar o usuário ver.
    return toast;
}

function showPromotionalToasts() {
    // Evitar sobreposição: não exibir toasts promocionais se algum modal estiver aberto
    if (document.querySelector('.modal-overlay:not(.hidden)')) return;
    const lp = document.getElementById('lang-picker-overlay');
    if (lp && lp.style.display !== 'none' && !lp.classList.contains('hide')) return;

    const t = (k) => typeof i18n !== 'undefined' ? i18n.t(k) : k;

    // 1. Toast do Cronograma
    if (!localStorage.getItem('agbizu_dismiss_toast_scale')) {
        createToast({
            id: 'scale',
            type: 'tutorial',
            icon: 'assignment',
            title: t('toast_scale_title'),
            message: t('toast_scale_desc'),
            primaryBtn: t('toast_btn_scale'),
            secondaryBtn: t('toast_btn_ok'),
            onPrimary: () => {
                setView('month');
            }
        });
    }
}

// ======================== SIDEBAR COLLAPSE ========================
window.toggleSidebar = (collapsed = null) => {
    const menu = document.getElementById('side-menu');
    const btn = document.getElementById('btn-collapse-sidebar');
    if (!menu) return;

    if (collapsed === null) {
        collapsed = !menu.classList.contains('collapsed');
    }

    menu.classList.toggle('collapsed', collapsed);

    // Atualiza ícone do botão (rotação)
    if (btn) {
        const icon = btn.querySelector('span');
        if (icon) icon.style.transform = collapsed ? 'rotate(180deg)' : 'rotate(0deg)';
    }

    localStorage.setItem('agbizu_sidebar_collapsed', collapsed);

    // Forçar redimensionamento para alinhar componentes (ex: swiper)
    setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
};

// ======================== LESSONS SYSTEM ========================

window.addLessonSection = function (data = null) {
    const container = document.getElementById('lesson-sections-container');
    const sectionIndex = container.children.length;
    const randomId = 'sec-media-' + Math.random().toString(36).substring(2, 9);

    const sectionDiv = document.createElement('div');
    sectionDiv.className = 'lesson-section-row';
    sectionDiv.style = `
        padding: 16px;
        background: #f8fafc;
        border: 1px solid var(--border);
        border-radius: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        position: relative;
    `;

    sectionDiv.innerHTML = `
        <button type="button" class="btn btn-ghost btn-icon-sm" onclick="this.parentElement.remove()" style="position: absolute; top: 8px; right: 8px; color: var(--danger);">
            <span class="material-symbols-outlined" style="font-size: 18px;">delete</span>
        </button>
        
        <div class="field-group" style="margin-bottom: 0;">
            <label class="field-label" style="font-size: 0.75rem;">Título da Seção</label>
            <input type="text" class="field-input sec-title" placeholder="Ex: Introdução" value="${data?.title || ''}" />
        </div>
        
        <div class="field-group" style="margin-bottom: 0;">
            <label class="field-label" style="font-size: 0.75rem;">Subtítulo</label>
            <input type="text" class="field-input sec-subtitle" placeholder="Opcional" value="${data?.subtitle || ''}" />
        </div>

        <div class="field-group" style="margin-bottom: 0;">
            <label class="field-label" style="font-size: 0.75rem;">Link / ID / Upload de Mídia</label>
            <div style="display: flex; gap: 8px;">
                <input type="text" id="${randomId}" class="field-input flex-1 sec-media" placeholder="Link, ID YouTube ou faça upload" value="${data?.mediaUrl || ''}" />
                <button type="button" class="btn btn-outline" onclick="document.getElementById('${randomId}-file').click()" style="padding: 0 10px; border-radius: 10px;">
                    <span class="material-symbols-outlined" style="font-size: 18px;">upload_file</span>
                </button>
                <input type="file" id="${randomId}-file" accept="image/*,video/*" style="display: none;" onchange="window.handleGeneralUpload(this, '${randomId}')" />
            </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div class="field-group" style="margin-bottom: 0;">
                <label class="field-label" style="font-size: 0.75rem;">Link Externo (URL)</label>
                <input type="text" class="field-input sec-link-url" placeholder="https://..." value="${data?.linkUrl || ''}" />
            </div>
            <div class="field-group" style="margin-bottom: 0;">
                <label class="field-label" style="font-size: 0.75rem;">Texto do Link</label>
                <input type="text" class="field-input sec-link-label" placeholder="Ex: Baixar PDF" value="${data?.linkLabel || ''}" />
            </div>
        </div>

      

        <div class="field-group" style="margin-bottom: 0;">
            <label class="field-label" style="font-size: 0.75rem;">Conteúdo (Ex: <b>Negrito</b>, <i>Itálico</i>, <br> Pular Linha)</label>
            <textarea class="field-input sec-content" rows="4" placeholder="Escreva o conteúdo aqui...">${data?.content || ''}</textarea>
        </div>
          <div class="field-group" style="margin-bottom: 0;">
            <label class="field-label" style="font-size: 0.75rem;">Gabarito / Resposta (Fica oculto até o clique)</label>
            <textarea class="field-input sec-answer" rows="2" placeholder="Digite a resposta ou explicação aqui...">${data?.answer || ''}</textarea>
        </div>
    `;

    // Adicionar listener de paste para capturar formatação
    const textarea = sectionDiv.querySelector('.sec-content');
    textarea.addEventListener('paste', function (e) {
        const html = e.clipboardData.getData('text/html');
        if (html) {
            e.preventDefault();
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;

            // Função recursiva simples para converter tags básicas
            function clean(node) {
                let text = "";
                node.childNodes.forEach(child => {
                    if (child.nodeType === 3) { // Text node
                        text += child.textContent;
                    } else if (child.nodeType === 1) { // Element node
                        let content = clean(child);
                        let tag = child.tagName;

                        let wrapBold = (tag === 'B' || tag === 'STRONG' || child.style.fontWeight === 'bold' || parseInt(child.style.fontWeight) >= 600);
                        let wrapItalic = (tag === 'I' || tag === 'EM' || child.style.fontStyle === 'italic');

                        let prefix = "";
                        let suffix = "";

                        if (tag === 'P') suffix = "\n\n";
                        else if (tag === 'DIV' || tag === 'BR' || tag === 'H1' || tag === 'H2' || tag === 'H3') suffix = "\n";
                        else if (tag === 'LI') {
                            prefix = "• ";
                            suffix = "\n";
                        }

                        let inner = content;
                        if (wrapBold) inner = `<b>${inner}</b>`;
                        if (wrapItalic) inner = `<i>${inner}</i>`;

                        text += prefix + inner + suffix;
                    }
                });
                return text;
            }

            let cleanedText = clean(tempDiv);
            // Remover excessos de quebras triplas ou leading/trailing
            cleanedText = cleanedText.replace(/\n{3,}/g, '\n\n').trim();

            // Inserir no cursor
            const start = this.selectionStart;
            const end = this.selectionEnd;
            const val = this.value;
            this.value = val.substring(0, start) + cleanedText + val.substring(end);
            this.selectionStart = this.selectionEnd = start + cleanedText.length;
        }
    });

    container.appendChild(sectionDiv);
};

window.handleGeneralUpload = async function (input, targetId) {
    const file = input.files[0];
    if (!file) return;

    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');

    if (!isVideo && !isImage) {
        alert('Por favor, selecione uma imagem ou um vídeo.');
        return;
    }

    const folder = isVideo ? 'lesson_videos' : 'lesson_images';
    showLoading(`Fazendo upload do ${isVideo ? 'vídeo' : 'arquivo'}...`);

    try {
        const fileName = `${Date.now()}_${file.name}`;
        const storageRef = storage.ref(`${folder}/${fileName}`);
        const snapshot = await storageRef.put(file);
        const url = await snapshot.ref.getDownloadURL();

        const target = document.getElementById(targetId);
        if (target) {
            target.value = url;
            play('click');
        }
    } catch (e) {
        console.error("Upload error:", e);
        alert('Erro ao fazer upload. Verifique as permissões de storage.');
    }
    hideLoading();
};

window.openLessonModal = function (id = null) {
    const lesson = id ? S.lessons.find(l => l.id === id) : null;
    document.getElementById('lesson-id').value = id || '';
    document.getElementById('lesson-title').value = lesson?.title || '';
    document.getElementById('lesson-video-id').value = lesson?.videoId || '';
    document.getElementById('lesson-thumb').value = lesson?.thumb || '';

    // Limpar e reconstruir seções
    const container = document.getElementById('lesson-sections-container');
    container.innerHTML = '';

    if (lesson?.json) {
        try {
            const sections = JSON.parse(lesson.json);
            if (Array.isArray(sections)) {
                sections.forEach(s => window.addLessonSection(s));
            }
        } catch (e) {
            console.error("Erro ao ler JSON de seções:", e);
        }
    } else {
        // Adicionar uma seção vazia por padrão se for novo
        if (!id) window.addLessonSection();
    }

    document.getElementById('lesson-modal-title').textContent = id ? 'Editar Conteúdo' : 'Novo Conteúdo';

    openModal('modal-lesson');
    trackAction('open_lesson_modal');
};

document.getElementById('lesson-form').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('lesson-id').value;

    // Coletar seções
    const sectionElements = document.querySelectorAll('.lesson-section-row');
    const sections = Array.from(sectionElements).map(row => ({
        title: row.querySelector('.sec-title').value,
        subtitle: row.querySelector('.sec-subtitle').value,
        mediaUrl: row.querySelector('.sec-media').value,
        linkUrl: row.querySelector('.sec-link-url').value,
        linkLabel: row.querySelector('.sec-link-label').value,
        answer: row.querySelector('.sec-answer').value,
        content: row.querySelector('.sec-content').value
    }));

    const data = {
        title: document.getElementById('lesson-title').value,
        videoId: document.getElementById('lesson-video-id').value,
        thumb: document.getElementById('lesson-thumb').value,
        json: JSON.stringify(sections),
        updatedAt: new Date().toISOString()
    };

    if (!id) {
        data.createdAt = new Date().toISOString();
    } else {
        const existing = S.lessons.find(l => l.id === id);
        if (existing && existing.createdAt) {
            data.createdAt = existing.createdAt;
        } else if (existing && existing.updatedAt) {
            data.createdAt = existing.updatedAt;
        } else {
            data.createdAt = new Date().toISOString();
        }
    }

    showLoading('Salvando conteúdo...');
    try {
        const ref = id ? db.ref('lessons/' + id) : db.ref('lessons').push();
        await ref.set(data);
        closeModal('modal-lesson');
        trackAction('save_lesson');
    } catch (err) {
        console.error(err);
        alert('Erro ao salvar aula.');
    }
    hideLoading();
};

window.deleteLesson = async function (id, e) {
    if (e) e.stopPropagation();
    if (!confirm('Deseja realmente excluir esta aula?')) return;

    showLoading('Excluindo...');
    try {
        await db.ref('lessons/' + id).remove();
        trackAction('delete_lesson');
    } catch (err) {
        console.error(err);
    }
    hideLoading();
};

function renderLessonsView() {
    const grid = document.getElementById('lessons-grid');
    const empty = document.getElementById('lessons-empty');
    if (!grid) return;

    grid.innerHTML = '';
    const isAdmin = firebase.auth().currentUser?.email === 'maispraticodesenvolvimento@gmail.com';

    // Garante que o botão de adicionar só aparece para admin
    const btnAdd = document.getElementById('btn-add-lesson');
    if (btnAdd) {
        if (isAdmin) btnAdd.classList.remove('hidden');
        else btnAdd.classList.add('hidden');
    }

    if (S.lessons.length === 0) {
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');

    S.lessons.sort((a, b) => {
        const timeA = new Date(a.createdAt || 0).getTime() || 0;
        const timeB = new Date(b.createdAt || 0).getTime() || 0;
        return timeB - timeA;
    }).forEach(l => {
        const card = document.createElement('div');
        card.className = 'lesson-card';
        card.style = `
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 20px;
      overflow: hidden;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: var(--shadow-sm);
      display: flex;
      flex-direction: column;
      position: relative;
    `;

        // Hover effect via JS since we are injecting style
        card.onmouseover = () => {
            card.style.transform = 'translateY(-8px)';
            card.style.boxShadow = 'var(--shadow)';
            card.style.borderColor = 'var(--primary-lt)';
        };
        card.onmouseout = () => {
            card.style.transform = 'translateY(0)';
            card.style.boxShadow = 'var(--shadow-sm)';
            card.style.borderColor = 'var(--border)';
        };

        const thumb = l.thumb || `https://img.youtube.com/vi/${l.videoId}/mqdefault.jpg`;

        card.innerHTML = `
      <div style="width: 100%; aspect-ratio: 16/9; background: #eee; position: relative; overflow: hidden;">
        <img src="${thumb}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.src='fundoinvisivel.png'">
        <div style="position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0) 60%, rgba(0,0,0,0.4) 100%);"></div>
        <div style="position: absolute; bottom: 12px; right: 12px; background: rgba(0,0,0,0.6); color: #fff; padding: 4px 8px; border-radius: 6px; font-size: 0.7rem; backdrop-filter: blur(4px);">
          <span class="material-symbols-outlined" style="font-size: 14px; margin-right: 4px;">play_circle</span>
          VÍDEO
        </div>
      </div>
      <div style="padding: 16px; flex: 1; display: flex; flex-direction: column; gap: 8px;">
        <h3 style="font-size: 1rem; color: var(--text); margin: 0; line-height: 1.4;">${l.title}</h3>
        <div style="margin-top: auto; display: flex; align-items: center; justify-content: space-between;">
           <span style="font-size: 0.75rem; color: var(--text3);">Cadastrado em ${l.createdAt ? new Date(l.createdAt).toLocaleDateString() : 'Data indisponível'}</span>
           ${isAdmin ? `
            <div style="display: flex; gap: 4px;">
              <button class="btn btn-ghost btn-icon-sm" onclick="openLessonModal('${l.id}'); event.stopPropagation();">
                <span class="material-symbols-outlined" style="font-size: 18px;">edit</span>
              </button>
              <button class="btn btn-ghost btn-icon-sm" onclick="deleteLesson('${l.id}', event)">
                <span class="material-symbols-outlined" style="font-size: 18px; color: var(--danger);">delete</span>
              </button>
            </div>
           ` : ''}
        </div>
      </div>
    `;

        card.onclick = () => openLessonDetail(l.id);
        grid.appendChild(card);
    });
}

window.openLessonDetail = function (id) {
    const lesson = S.lessons.find(l => l.id === id);
    if (!lesson) return;

    document.getElementById('lesson-detail-title').textContent = lesson.title;

    let contentHtml = '';

    // 1. Vídeo no Topo (se houver)
    if (lesson.videoId) {
        let videoHtml = '';
        const v = lesson.videoId;
        if (v.length === 11) { // YouTube ID
            videoHtml = `<iframe src="https://www.youtube.com/embed/${v}" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen style="width:100%; aspect-ratio:16/9; border-radius:12px; margin-bottom:24px; box-shadow: var(--shadow);"></iframe>`;
        } else if (v.includes('firebasestorage') || v.includes('.mp4')) {
            videoHtml = `<video src="${v}" controls style="width:100%; aspect-ratio:16/9; border-radius:12px; margin-bottom:24px; box-shadow: var(--shadow); background: #000;"></video>`;
        } else if (v.match(/^\d+$/)) { // Vimeo
            videoHtml = `<iframe src="https://player.vimeo.com/video/${v}" frameborder="0" allowfullscreen style="width:100%; aspect-ratio:16/9; border-radius:12px; margin-bottom:24px; box-shadow: var(--shadow);"></iframe>`;
        } else {
            videoHtml = `<iframe src="${v}" frameborder="0" allowfullscreen style="width:100%; aspect-ratio:16/9; border-radius:12px; margin-bottom:24px; box-shadow: var(--shadow);"></iframe>`;
        }
        contentHtml += videoHtml;
    }

    // 2. Renderizar Seções
    if (lesson.json) {
        try {
            const sections = JSON.parse(lesson.json);
            sections.forEach(sec => {
                let mediaHtml = '';
                if (sec.mediaUrl) {
                    const m = sec.mediaUrl;
                    if (m.length === 11) {
                        mediaHtml = `<iframe src="https://www.youtube.com/embed/${m}" frameborder="0" allowfullscreen style="width:100%; aspect-ratio:16/9;"></iframe>`;
                    } else if (m.includes('firebasestorage') || m.includes('.mp4')) {
                        // Detectar se é vídeo pelo link do Firebase Storage ou extensão
                        if (m.includes('/lesson_videos%2F') || m.includes('.mp4')) {
                            mediaHtml = `<video src="${m}" controls style="width:100%; aspect-ratio:16/9; background: #000;"></video>`;
                        } else {
                            mediaHtml = `<img src="${m}" style="width:100%; display: block;" onerror="this.style.display='none'">`;
                        }
                    } else {
                        mediaHtml = `<img src="${m}" style="width:100%; display: block;" onerror="this.style.display='none'">`;
                    }
                }

                contentHtml += `
                    <div class="lesson-detail-section" style="margin-bottom: 40px;">
                        ${sec.title ? `<h2 style="font-size: 1.6rem; color: var(--primary); margin-bottom: 8px; font-weight: 700;">${sec.title}</h2>` : ''}
                        ${sec.subtitle ? `<h4 style="font-size: 1.1rem; color: var(--text3); margin-bottom: 20px; font-weight: 500;">${sec.subtitle}</h4>` : ''}
                        
                        ${mediaHtml ? `
                            <div style="margin: 24px 0; border-radius: 16px; overflow: hidden; box-shadow: var(--shadow-sm);">
                                ${mediaHtml}
                            </div>
                        ` : ''}

                        ${sec.content ? `
                            <div style="font-size: 1.05rem; color: var(--text2); line-height: 1.7; white-space: pre-line;">${sec.content}</div>
                        ` : ''}

                        ${sec.linkUrl ? `
                            <div style="margin-top: 20px;">
                                <a href="${sec.linkUrl}" target="_blank" class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 8px; text-decoration: none; padding: 12px 24px; color: #fff;">
                                    <span class="material-symbols-outlined">link</span>
                                    ${sec.linkLabel || 'Abrir Link'}
                                </a>
                            </div>
                        ` : ''}

                        ${sec.answer ? `
                            <div style="margin-top: 24px;">
                                <button class="btn btn-outline" onclick="this.nextElementSibling.classList.toggle('hidden'); this.textContent = this.nextElementSibling.classList.contains('hidden') ? 'Ver Resposta' : 'Ocultar Resposta';" style="font-size: 0.85rem; padding: 8px 16px;">
                                    Ver Resposta
                                </button>
                                <div class="hidden" style="margin-top: 12px; padding: 16px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; color: #166534; font-size: 0.95rem; line-height: 1.6; white-space: pre-line;">
                                    <div style="font-weight: 700; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
                                        <span class="material-symbols-outlined" style="font-size: 18px;">check_circle</span>
                                        Gabarito:
                                    </div>
                                    ${sec.answer}
                                </div>
                            </div>
                        ` : ''}
                    </div>
                `;
            });
        } catch (e) {
            console.error("Erro ao processar JSON da aula:", e);
            contentHtml += `<p style="color: var(--danger);">Erro ao carregar conteúdo estruturado.</p>`;
        }
    } else if (lesson.html) {
        // Legado: Iframe simples
        contentHtml += `<iframe src="${lesson.html}" width="100%" height="800px" frameborder="0" allowfullscreen style="border-radius:12px; box-shadow: var(--shadow);"></iframe>`;
    }

    document.getElementById('lesson-detail-content').innerHTML = `
        <div style="max-width: 800px; margin: 0 auto; padding: 24px;">
            ${contentHtml}
        </div>
    `;

    setView('lesson-detail');
    trackAction('view_lesson_detail');
};

// --- Upload Handler ---
window.handleLessonThumbUpload = async function (input) {
    const file = input.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        alert('Por favor, selecione uma imagem.');
        return;
    }

    showLoading('Fazendo upload da imagem...');
    try {
        const fileName = `${Date.now()}_${file.name}`;
        const storageRef = storage.ref(`lesson_thumbs/${fileName}`);
        const snapshot = await storageRef.put(file);
        const url = await snapshot.ref.getDownloadURL();

        document.getElementById('lesson-thumb').value = url;
        play('click');
    } catch (e) {
        console.error("Upload error:", e);
        alert('Erro ao fazer upload da imagem. Verifique as permissões de storage.');
    }
    hideLoading();
};

// ======================== WEEKLY PLANNER ========================

const DAY_LABELS = {
    'seg': 'Segunda-feira',
    'ter': 'Terça-feira',
    'qua': 'Quarta-feira',
    'qui': 'Quinta-feira',
    'sex': 'Sexta-feira',
    'sab': 'Sábado',
    'dom': 'Domingo'
};

function renderWeeklyPlanner() {
    const user = firebase.auth().currentUser;
    const isAdmin = user && user.email === 'maispraticodesenvolvimento@gmail.com';
    const grid = document.getElementById('weekly-schedule-grid');
    if (!grid) return;

    Object.keys(DAY_LABELS).forEach(key => {
        const card = grid.querySelector(`[data-day="${key}"]`);
        if (!card) return;

        const content = S.weeklyPlanner[key];
        const textEl = card.querySelector('.day-text');
        const actionsEl = card.querySelector('.event-actions');

        if (content) {
            // Truncate to 50 chars for summary
            const cleanText = content.replace(/<[^>]*>/g, ''); // Remove HTML for truncation check
            if (cleanText.length > 50) {
                textEl.innerHTML = cleanText.substring(0, 50) + '...';
            } else {
                textEl.innerHTML = content;
            }
        } else {
            textEl.innerHTML = isAdmin ?
                '<span style="color:var(--primary); font-size:0.8rem; font-style:italic; opacity:0.7;">+ Clique para adicionar conteúdo</span>' :
                '<span style="color:var(--text3); font-size:0.8rem; font-style:italic; opacity:0.5;">Nenhum conteúdo definido</span>';
        }

        if (isAdmin) {
            if (actionsEl) actionsEl.classList.remove('hidden');
            card.style.cursor = 'pointer';
            card.onclick = () => window.openWeeklyEditModal(key);
        } else {
            if (actionsEl) actionsEl.classList.add('hidden');
            // Se tiver conteúdo, permitir que o aluno clique para ver o texto completo
            if (content) {
                card.style.cursor = 'pointer';
                card.onclick = () => window.openWeeklyViewModal(key);
            } else {
                card.style.cursor = 'default';
                card.onclick = null;
            }
        }
    });
}

window.openWeeklyViewModal = function (key) {
    const label = DAY_LABELS[key];
    const content = S.weeklyPlanner[key] || 'Nenhum conteúdo definido';

    const dayEl = document.getElementById('weekly-view-day');
    const contentEl = document.getElementById('weekly-view-content');

    if (dayEl) dayEl.textContent = label;
    if (contentEl) contentEl.innerHTML = content;

    if (typeof openModal === 'function') {
        openModal('modal-weekly-view');
    } else {
        document.getElementById('modal-weekly-view')?.classList.remove('hidden');
    }
};

window.openWeeklyEditModal = function (key) {
    console.log("[DEBUG] Abrindo modal para:", key);
    const label = DAY_LABELS[key];
    const keyEl = document.getElementById('edit-day-key');
    const labelEl = document.getElementById('edit-day-label');
    const textEl = document.getElementById('edit-day-text');

    if (keyEl) keyEl.value = key;
    if (labelEl) labelEl.textContent = `Conteúdo para ${label}`;
    if (textEl) textEl.value = S.weeklyPlanner[key] || '';

    if (typeof openModal === 'function') {
        openModal('modal-weekly-edit');
    } else {
        document.getElementById('modal-weekly-edit')?.classList.remove('hidden');
    }
};


document.getElementById('weekly-edit-form').onsubmit = async (e) => {
    e.preventDefault();
    const key = document.getElementById('edit-day-key').value;
    const text = document.getElementById('edit-day-text').value;

    showLoading('Salvando planejamento...');
    try {
        await db.ref('weekly_planner/' + key).set(text);
        closeModal('modal-weekly-edit');
        trackAction('save_weekly_planner');
    } catch (err) {
        console.error(err);
        alert('Erro ao salvar planejamento.');
    }
    hideLoading();
};


