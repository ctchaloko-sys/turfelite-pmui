// --- CONFIGURATION PAR DÉFAUT (Ecrasée par la BDD si existante) ---
const CONFIG = {
    whatsapp: '22646553556',
    email: 'emmabrn888@gmail.com',
    facebook: '',
    instagram: '',
    price_week: '25000',
    price_month: '95000',
    price_year: '250000',
    supabaseUrl: 'https://VOTRE_PROJET.supabase.co', // À REMPLIR DANS LE README
    supabaseAnonKey: 'VOTRE_CLE_ANON' // À REMPLIR DANS LE README
};

// Initialisation Supabase
const supabase = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);

// --- ÉTAT GLOBAL ---
let currentUser = null;
let currentProfile = null;
let isVip = false;

// --- UTILITAIRES ---
const esc = (str) => {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, (m) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
};

const showToast = (msg, isError = false) => {
    // Implémentation basique de toast Android-like
    const toast = document.createElement('div');
    toast.textContent = msg;
    toast.style.cssText = `
        position: fixed; bottom: 100px; left: 50%; transform: translateX(-50%);
        background: ${isError ? 'var(--error-red)' : 'var(--bg-elevated)'};
        color: #fff; padding: 12px 24px; border-radius: 20px; z-index: 9999;
        font-size: 0.9rem; box-shadow: 0 4px 12px rgba(0,0,0,0.3); transition: opacity 0.3s;
    `;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
};

const getWhatsAppLink = (message) => `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(message)}`;

// --- THEME MANAGEMENT ---
const initTheme = () => {
    const saved = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    document.getElementById('theme-toggle').addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
    });
};

// --- AUTHENTIFICATION ---
const listenAuth = () => {
    supabase.auth.onAuthStateChange(async (event, session) => {
        currentUser = session?.user || null;
        if (currentUser) {
            const { data: profile } = await supabase.from('profiles').select('*').eq('id', currentUser.id).single();
            currentProfile = profile;
            
            // Verifier VIP status
            const { data: subs } = await supabase.from('subscriptions')
                .select('*')
                .eq('user_id', currentUser.id)
                .eq('status', 'active')
                .gt('end_date', new Date().toISOString());
            isVip = subs && subs.length > 0;
        } else {
            currentProfile = null;
            isVip = false;
        }
        updateHeaderUI();
        renderCurrentRoute(); // Rafraichir la vue
    });
};

const updateHeaderUI = () => {
    const container = document.getElementById('auth-header-container');
    if (currentUser) {
        container.innerHTML = `
            <button onclick="window.location.hash='#/compte'" class="btn-outline" style="padding:6px 12px">
                <i data-lucide="user"></i> Compte
            </button>
        `;
    } else {
        container.innerHTML = `
            <button onclick="openAuthModal('login')" class="btn-outline" style="padding:6px 12px">Connexion</button>
        `;
    }
    lucide.createIcons();
};

// --- ROUTEUR SPA BASIQUE ---
const routes = {
    '/': renderHome,
    '/pronostics': renderPicks,
    '/vip': renderVIP,
    '/vip-plans': renderVIPPlans,
    '/resultats': renderResults,
    '/faq': renderFAQ,
    '/admin': renderAdmin // Protégé en interne
};

const router = () => {
    const hash = window.location.hash.slice(1) || '/';
    const main = document.getElementById('app-content');
    main.innerHTML = '<div class="section-padding text-center"><i data-lucide="loader" class="spin"></i> Chargement...</div>';
    lucide.createIcons();
    
    // Fermer le menu mobile si ouvert
    const handler = routes[hash] || render404;
    handler(main);
};

window.addEventListener('hashchange', router);
window.addEventListener('load', () => {
    initTheme();
    listenAuth();
    lucide.createIcons();
    // Charger la config depuis la base
    supabase.from('settings').select('*').then(({data}) => {
        if(data) data.forEach(row => CONFIG[row.key] = row.value);
        document.getElementById('wa-float').href = getWhatsAppLink("Bonjour, j'ai besoin d'aide.");
        router();
    });
});

// --- RENDU DES VUES (Exemples) ---

async function renderHome(container) {
    container.innerHTML = `
        <section class="hero">
            <div class="hero-bg">
                <img src="harness-racing.jpg" class="active" onerror="this.style.display='none'">
            </div>
            <div class="hero-overlay"></div>
            <div class="hero-content">
                <h1>Vivre autrement les pronostics</h1>
                <p>Des analyses pensées pour vous aider à mieux lire chaque course.</p>
                <div class="hero-actions">
                    <a href="#/pronostics" class="btn-primary"><i data-lucide="lock-open"></i> Accéder aux pronostics</a>
                    <a href="${getWhatsAppLink("Bonjour, je souhaite des infos sur TURFELITE-PMU.")}" target="_blank" class="btn-outline"><i data-lucide="message-circle"></i> Assistance</a>
                </div>
            </div>
        </section>
        <section class="section-padding glass-card mt-4" style="margin: 20px;">
            <h2 class="text-center">Nos analyses combinent l'expertise humaine et des outils d'intelligence artificielle.</h2>
        </section>
    `;
    lucide.createIcons();
}

async function renderPicks(container) {
    if (!currentUser) {
        container.innerHTML = `
            <div class="section-padding text-center">
                <h2>Pronostics & Favoris</h2>
                <p>Connectez-vous ou créez un compte pour consulter les favoris gratuits.</p>
                <button onclick="openAuthModal('login')" class="btn-primary mt-4">Se connecter</button>
            </div>
        `;
        return;
    }

    // Récupérer les favoris (Safe: RLS protège les vrais VIP picks)
    const { data: free } = await supabase.from('free_picks').select('*').order('created_at', { ascending: false }).limit(1);

    let html = `<div class="section-padding"><h2>Sélection gratuite indicative</h2>`;
    
    if (free && free.length > 0) {
        const favs = JSON.parse(free[0].favorites || '[]');
        html += `<p>${esc(free[0].analysis)}</p><div style="display:flex; gap:10px; margin-top:20px;">`;
        favs.forEach(f => html += `<span style="background:var(--bg-elevated); padding:10px 20px; border-radius:8px; font-weight:bold;">${esc(f)}</span>`);
        html += `</div>`;
    } else {
        html += `<p>Aucune analyse gratuite disponible pour le moment.</p>`;
    }

    // Bloc VIP Teaser
    html += `
        <div class="locked-card glass-card mt-4" style="margin-top: 40px;">
            <div class="locked-overlay">
                <i data-lucide="lock" style="color: var(--gold-primary); width: 48px; height: 48px; margin-bottom: 10px;"></i>
                <h3>Pronostic complet réservé aux membres VIP</h3>
                <p>Passez au niveau supérieur : analyses d'experts + outils d'intelligence artificielle.</p>
                <a href="#/vip" class="btn-primary mt-4">Déverrouiller avec mon code VIP</a>
            </div>
            <div class="blur-content">
                <p>Tiercé: ① •••• ② •••• ③ ••••</p>
                <p>Quarté: ① •••• ② •••• ③ •••• ④ ••••</p>
            </div>
        </div>
    </div>`;

    container.innerHTML = html;
    lucide.createIcons();
}

async function renderVIP(container) {
    if (!currentUser) {
        window.location.hash = '#/vip-plans';
        return;
    }

    if (!isVip) {
        // Formulaire de saisie du code VIP
        container.innerHTML = `
            <div class="section-padding text-center max-w-md" style="max-width:500px; margin: 0 auto;">
                <h2 style="color: var(--gold-primary)"><i data-lucide="crown"></i> Espace VIP</h2>
                <p>Saisissez votre code confidentiel unique transmis par l'administrateur pour déverrouiller tous les pronostics.</p>
                
                <div class="glass-card mt-4">
                    <input type="text" id="vip-code-input" placeholder="Entrez votre code VIP ici..." 
                           style="width: 100%; padding: 15px; text-align: center; font-size: 1.2rem; letter-spacing: 2px; border-radius: 8px; border: 1px solid var(--gold-primary); background: var(--bg-main); color: var(--text-primary); margin-bottom: 15px;">
                    <button id="btn-redeem" class="btn-primary" style="width: 100%; justify-content: center;">Valider et Déverrouiller</button>
                </div>
                
                <p class="mt-4"><a href="#/vip-plans" style="color: var(--text-secondary); text-decoration: underline;">Je n'ai pas de code, voir les abonnements</a></p>
            </div>
        `;
        lucide.createIcons();

        document.getElementById('btn-redeem').addEventListener('click', async () => {
            const code = document.getElementById('vip-code-input').value.trim();
            if(!code) return;
            document.getElementById('btn-redeem').innerHTML = '<i data-lucide="loader" class="spin"></i> Validation...';
            
            const { data, error } = await supabase.rpc('redeem_vip_code', { p_code: code });
            
            if(error) { showToast("Erreur réseau.", true); }
            else if(data === 'ok') {
                showToast("Accès autorisé ! Bienvenue dans l'espace VIP.");
                isVip = true; // Update local state immediately
                renderVIP(container); // Reload view
            } else {
                const msgs = {
                    'invalid': 'Code incorrect.', 'expired': 'Ce code a expiré.', 
                    'disabled': 'Code désactivé.', 'used': 'Code déjà utilisé.'
                };
                showToast(msgs[data] || "Erreur.", true);
            }
            document.getElementById('btn-redeem').innerHTML = 'Valider et Déverrouiller';
        });
        return;
    }

    // SI VIP EST ACTIF : Afficher les vraies données
    const { data: vipPicks } = await supabase.from('vip_picks').select('*').eq('status', 'published').order('created_at', { ascending: false });
    
    let html = `<div class="section-padding"><h2 style="color: var(--gold-primary);"><i data-lucide="crown"></i> Pronostics VIP du jour</h2>`;
    
    if(vipPicks && vipPicks.length > 0) {
        vipPicks.forEach(pick => {
            html += `
                <div class="glass-card mt-4" style="border: 1px solid var(--gold-primary);">
                    <h3>${esc(pick.race_info)}</h3>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 15px;">
                        <div><strong>Favori:</strong> ${esc(pick.favorite)}</div>
                        <div><strong>Tuyau:</strong> ${esc(pick.tuyau)}</div>
                        <div><strong>Outsider:</strong> ${esc(pick.outsider)}</div>
                        <div><strong>Tokard:</strong> ${esc(pick.tokard)}</div>
                    </div>
                    <hr style="border-color: var(--border-color); margin: 15px 0;">
                    <p><strong>Tiercé:</strong> ${esc(pick.tierce)}</p>
                    <p><strong>Quarté:</strong> ${esc(pick.quarte)}</p>
                    <p><strong>Quinté+:</strong> ${esc(pick.quinte_plus)}</p>
                    <div class="mt-4"><small><em>Synthèse : ${esc(pick.synthesis)}</em></small></div>
                </div>
            `;
        });
    } else {
        html += `<p>Les analyses VIP du jour sont en cours de préparation par nos experts.</p>`;
    }
    html += `</div>`;
    container.innerHTML = html;
    lucide.createIcons();
}

// Fonction Admin (Vue restreinte)
async function renderAdmin(container) {
    if (!currentUser || currentProfile?.role !== 'admin') {
        container.innerHTML = `<div class="section-padding text-center"><h2>403 - Accès refusé</h2></div>`;
        return;
    }
    
    container.innerHTML = `
        <div class="section-padding">
            <h2>Administration TURFELITE-PMU</h2>
            <p>Seules les données sauvegardées ici modifient le site.</p>
            <!-- Formulaire simplifé pour générer un code (Exemple) -->
            <div class="glass-card mt-4">
                <h3>Générer un code VIP</h3>
                <select id="admin-plan" class="form-group"><option value="week">Semaine</option><option value="month">Mois</option></select>
                <button id="btn-gen-code" class="btn-primary">Générer</button>
                <p id="admin-code-result" style="margin-top:10px; font-weight:bold; color:var(--wa-green);"></p>
            </div>
        </div>
    `;
    
    document.getElementById('btn-gen-code').addEventListener('click', async () => {
        // Dans un cas réel, appel RPC admin_create_code qui retourne le code clair + insère le hash
        // Pour l'exemple frontal on simule la logique :
        const code = "VIP-" + Math.random().toString(36).substr(2, 8).toUpperCase();
        
        // Hashage via crypto API front (pour demo, idéalement backend)
        const encoder = new TextEncoder();
        const data = encoder.encode(code);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        await supabase.from('access_codes').insert([{
            code_hash: hashHex,
            plan: document.getElementById('admin-plan').value,
            created_by: currentUser.id
        }]);

        document.getElementById('admin-code-result').innerText = "Code à transmettre : " + code;
    });
}

// Gestion des Modals Auth
const authModal = document.getElementById('auth-modal');
const authForm = document.getElementById('auth-form');
let authMode = 'login'; // login ou register

window.openAuthModal = (mode) => {
    authMode = mode;
    document.getElementById('auth-title').innerText = mode === 'login' ? 'Connexion' : 'Créer un compte';
    document.getElementById('auth-submit').innerText = mode === 'login' ? 'Se connecter' : 'S\'inscrire';
    document.getElementById('switch-auth-mode').innerText = mode === 'login' ? 'Créer un compte' : 'Déjà un compte ? Connexion';
    authModal.classList.remove('hidden');
};

document.querySelector('.close-modal').addEventListener('click', () => authModal.classList.add('hidden'));
document.getElementById('switch-auth-mode').addEventListener('click', (e) => {
    e.preventDefault();
    openAuthModal(authMode === 'login' ? 'register' : 'login');
});

authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    
    document.getElementById('auth-submit').disabled = true;
    
    let result;
    if (authMode === 'login') {
        result = await supabase.auth.signInWithPassword({ email, password });
    } else {
        result = await supabase.auth.signUp({ email, password });
    }
    
    document.getElementById('auth-submit').disabled = false;
    
    if (result.error) {
        showToast(result.error.message, true);
    } else {
        authModal.classList.add('hidden');
        showToast("Authentification réussie !");
    }
});

function render404(container) {
    container.innerHTML = `<div class="section-padding text-center"><h2>Page introuvable</h2></div>`;
}