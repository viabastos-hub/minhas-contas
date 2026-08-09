/* ==========================================================================
   MINHAS CONTAS - BULLETPROOF DATA PRESERVATION & SYNC ENGINE
   ========================================================================== */

class AccountsApp {
  constructor() {
    this.AUTH_CPF_KEY = 'minhas_contas_logged_cpf_v1';
    this.THEME_KEY = 'minhas_contas_app_theme_v1';

    // State
    this.activeCpf = null;
    this.activeUser = null; // { cpf, name, phone, email, password }
    this.profiles = [];
    this.activeProfileId = 'all'; // 'all' (Consolidado) or profile ID
    this.accounts = [];
    this.personPixMap = {};
    this.budgetGoal = 3000;

    this.currentTab = 'dashboard';
    this.selectedDate = new Date();
    this.calendarDate = new Date();
    this.deferredPrompt = null;
    this.categoryChart = null;

    // Cloud Database Endpoint
    this.cloudDbEndpoint = 'https://minhas-contas-sync-default-rtdb.firebaseio.com';

    // Filters for All Accounts Tab
    this.listFilters = {
      search: '',
      status: 'all',
      type: 'all',
      person: 'all',
      category: 'all'
    };

    this.init();
  }

  init() {
    this.initTheme();
    this.initPwa();
    this.populateReportSelectors();
    this.autoMigrateLegacyData();
    this.checkCpfAuth();
  }

  /* ------------------------------------------------------------------------
     1. BULLETPROOF DATA PRESERVATION & MIGRATION
     ------------------------------------------------------------------------ */
  autoMigrateLegacyData() {
    try {
      const legacyRaw = localStorage.getItem('minhas_contas_app_data_v2');
      if (legacyRaw) {
        const legacyAccounts = JSON.parse(legacyRaw);
        if (Array.isArray(legacyAccounts) && legacyAccounts.length > 0) {
          localStorage.setItem('minhas_contas_legacy_backup', legacyRaw);
        }
      }
    } catch (e) {
      console.log('Legacy scan check completed.');
    }
  }

  emergencyScanAndRestore() {
    let recoveredAccounts = [];
    let recoveredProfiles = [];

    // Scan all keys in localStorage
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('minhas_contas_')) {
        try {
          const val = localStorage.getItem(key);
          if (!val) continue;

          const parsed = JSON.parse(val);
          if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].title && parsed[0].amount !== undefined) {
            // Found account list
            parsed.forEach(acc => {
              if (!recoveredAccounts.some(x => x.id === acc.id || (x.title === acc.title && x.dueDate === acc.dueDate && x.amount === acc.amount))) {
                recoveredAccounts.push(acc);
              }
            });
          } else if (parsed && Array.isArray(parsed.accounts)) {
            parsed.accounts.forEach(acc => {
              if (!recoveredAccounts.some(x => x.id === acc.id || (x.title === acc.title && x.dueDate === acc.dueDate && x.amount === acc.amount))) {
                recoveredAccounts.push(acc);
              }
            });
          }
        } catch (e) {
          // ignore non-JSON keys
        }
      }
    }

    if (recoveredAccounts.length > 0) {
      this.accounts = recoveredAccounts;
      this.saveCpfAccounts();
      this.render();
      this.closeModal('backupModal');
      if (window.confetti) confetti({ particleCount: 60, spread: 60 });
      alert(`🎉 Sucesso! Encontramos e restauramos ${recoveredAccounts.length} conta(s) guardadas na memória!`);
    } else {
      alert('Nenhuma conta anterior foi encontrada na memória deste navegador.');
    }
  }

  /* ------------------------------------------------------------------------
     2. AUTH VIEWS & NAVIGATION
     ------------------------------------------------------------------------ */
  showLoginView() {
    document.getElementById('loginForm')?.classList.remove('hidden');
    document.getElementById('registerForm')?.classList.add('hidden');
    document.getElementById('forgotForm')?.classList.add('hidden');
    document.getElementById('authCardTitle').textContent = 'Minhas Contas';
    document.getElementById('authCardTagline').textContent = 'Acesse suas finanças no celular ou computador com sincronização automática.';
    if (window.lucide) lucide.createIcons();
  }

  showRegisterView() {
    document.getElementById('loginForm')?.classList.add('hidden');
    document.getElementById('registerForm')?.classList.remove('hidden');
    document.getElementById('forgotForm')?.classList.add('hidden');
    document.getElementById('authCardTitle').textContent = 'Criar Nova Conta';
    document.getElementById('authCardTagline').textContent = 'Cadastre seu CPF, telefone e e-mail para ter acesso em qualquer celular ou computador.';
    
    const loginCpf = document.getElementById('loginCpfInput')?.value;
    const regCpf = document.getElementById('regCpfInput');
    if (regCpf && loginCpf) regCpf.value = loginCpf;

    if (window.lucide) lucide.createIcons();
  }

  showForgotPassView() {
    document.getElementById('loginForm')?.classList.add('hidden');
    document.getElementById('registerForm')?.classList.add('hidden');
    document.getElementById('forgotForm')?.classList.remove('hidden');
    document.getElementById('authCardTitle').textContent = 'Redefinir Senha';
    document.getElementById('authCardTagline').textContent = 'Informe seu CPF e seu Telefone ou E-mail para criar uma nova senha diretamente aqui.';

    const loginCpf = document.getElementById('loginCpfInput')?.value;
    const forgotCpf = document.getElementById('forgotCpfInput');
    if (forgotCpf && loginCpf) forgotCpf.value = loginCpf;

    if (window.lucide) lucide.createIcons();
  }

  togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const isPass = input.type === 'password';
    input.type = isPass ? 'text' : 'password';
    btn.innerHTML = isPass ? '<i data-lucide="eye-off"></i>' : '<i data-lucide="eye"></i>';
    if (window.lucide) lucide.createIcons();
  }

  /* ------------------------------------------------------------------------
     3. CLOUD SYNC & BULLETPROOF AUTH
     ------------------------------------------------------------------------ */
  async checkCpfAuth() {
    const savedCpf = localStorage.getItem(this.AUTH_CPF_KEY);
    const overlay = document.getElementById('authOverlay');

    if (savedCpf) {
      const user = await this.fetchUserDataByCpf(savedCpf);
      if (user) {
        this.loginSuccess(user, false);
        return;
      }
    }

    if (overlay) overlay.classList.remove('hidden');
    this.showLoginView();
  }

  async fetchUserDataByCpf(cleanCpf) {
    const rawLocal = localStorage.getItem(`minhas_contas_user_${cleanCpf}`);
    let user = rawLocal ? JSON.parse(rawLocal) : null;

    const rawAccounts = localStorage.getItem(`minhas_contas_cpf_${cleanCpf}_accounts`);
    if (!user && rawAccounts) {
      user = { cpf: cleanCpf, name: 'Titular', phone: '', email: '', password: '123' };
      this.saveLocalUserData(user);
    }

    try {
      const res = await fetch(`${this.cloudDbEndpoint}/users/${cleanCpf}.json`);
      if (res.ok) {
        const cloudData = await res.json();
        if (cloudData && cloudData.user) {
          user = cloudData.user;
          this.saveLocalUserData(user);

          if (cloudData.accounts && Array.isArray(cloudData.accounts) && cloudData.accounts.length > 0) {
            const localAccs = localStorage.getItem(`minhas_contas_cpf_${cleanCpf}_accounts`);
            if (!localAccs || localAccs === '[]') {
              localStorage.setItem(`minhas_contas_cpf_${cleanCpf}_accounts`, JSON.stringify(cloudData.accounts));
            }
          }

          if (cloudData.profiles && Array.isArray(cloudData.profiles) && cloudData.profiles.length > 0) {
            const localProfs = localStorage.getItem(`minhas_contas_cpf_${cleanCpf}_profiles`);
            if (!localProfs || localProfs === '[]') {
              localStorage.setItem(`minhas_contas_cpf_${cleanCpf}_profiles`, JSON.stringify(cloudData.profiles));
            }
          }

          if (cloudData.budgetGoal) {
            localStorage.setItem(`minhas_contas_cpf_${cleanCpf}_budget_goal`, cloudData.budgetGoal.toString());
          }
        }
      }
    } catch (err) {
      console.log('Cloud fetch offline, using local cache.');
    }

    return user;
  }

  saveLocalUserData(user) {
    localStorage.setItem(`minhas_contas_user_${user.cpf}`, JSON.stringify(user));
  }

  async syncFullDataToCloud() {
    if (!this.activeCpf) return;

    this.updateSyncBadge('Sincronizando...');

    const payload = {
      user: this.activeUser,
      profiles: this.profiles,
      accounts: this.accounts,
      budgetGoal: this.budgetGoal,
      updatedAt: new Date().toISOString()
    };

    try {
      await fetch(`${this.cloudDbEndpoint}/users/${this.activeCpf}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      this.updateSyncBadge('Nuvem Ativa');
    } catch (err) {
      this.updateSyncBadge('Offline (Salvo Local)');
    }
  }

  updateSyncBadge(text) {
    const badgeText = document.getElementById('syncStatusText');
    if (badgeText) badgeText.textContent = text;
  }

  async handleAuthLogin(e) {
    e.preventDefault();
    const btnSubmit = document.getElementById('btnLoginSubmit');
    if (btnSubmit) { btnSubmit.disabled = true; btnSubmit.innerHTML = 'Verificando...'; }

    const cpfRaw = document.getElementById('loginCpfInput')?.value.trim() || '';
    const pass = document.getElementById('loginPassInput')?.value || '';
    const cleanCpf = cpfRaw.replace(/\D/g, '');

    if (cleanCpf.length !== 11) {
      alert('Por favor, digite um CPF válido com 11 dígitos.');
      if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = '<i data-lucide="log-in"></i> Entrar no Aplicativo'; }
      if (window.lucide) lucide.createIcons();
      return;
    }

    let user = await this.fetchUserDataByCpf(cleanCpf);

    if (!user) {
      const rawAccounts = localStorage.getItem(`minhas_contas_cpf_${cleanCpf}_accounts`);
      if (rawAccounts) {
        user = { cpf: cleanCpf, name: 'Titular', phone: '', email: '', password: pass || '1234' };
        this.saveLocalUserData(user);
      } else {
        if (confirm('Nenhum cadastro encontrado com este CPF. Deseja criar sua conta agora?')) {
          this.showRegisterView();
        }
        if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = '<i data-lucide="log-in"></i> Entrar no Aplicativo'; }
        if (window.lucide) lucide.createIcons();
        return;
      }
    }

    if (user.password && user.password !== pass) {
      alert('Senha incorreta! Se você esqueceu, clique em "Esqueci a senha" abaixo para redefinir na hora.');
      if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = '<i data-lucide="log-in"></i> Entrar no Aplicativo'; }
      if (window.lucide) lucide.createIcons();
      return;
    }

    const remember = document.getElementById('rememberAuthCheck')?.checked ?? true;
    this.loginSuccess(user, remember);
  }

  async handleAuthRegister(e) {
    e.preventDefault();
    const btnSubmit = document.getElementById('btnRegisterSubmit');
    if (btnSubmit) { btnSubmit.disabled = true; btnSubmit.innerHTML = 'Criando Conta...'; }

    const cpfRaw = document.getElementById('regCpfInput')?.value.trim() || '';
    const cleanCpf = cpfRaw.replace(/\D/g, '');
    const name = document.getElementById('regNameInput')?.value.trim() || 'Titular';
    const phone = document.getElementById('regPhoneInput')?.value.trim() || '';
    const email = document.getElementById('regEmailInput')?.value.trim() || '';
    const password = document.getElementById('regPassInput')?.value || '';

    if (cleanCpf.length !== 11) {
      alert('Por favor, digite um CPF válido com 11 dígitos.');
      if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = '<i data-lucide="user-check"></i> Concluir Cadastro e Entrar'; }
      if (window.lucide) lucide.createIcons();
      return;
    }

    if (!password || password.length < 4) {
      alert('Por favor, crie uma senha com no mínimo 4 caracteres.');
      if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = '<i data-lucide="user-check"></i> Concluir Cadastro e Entrar'; }
      if (window.lucide) lucide.createIcons();
      return;
    }

    const user = { cpf: cleanCpf, name, phone, email, password };
    this.saveLocalUserData(user);
    this.activeCpf = cleanCpf;
    this.activeUser = user;

    // PRESERVE EXISTING ACCOUNTS: NEVER OVERWRITE WITH SAMPLE DATA IF USER ALREADY HAS DATA!
    const existingRawAccounts = localStorage.getItem(`minhas_contas_cpf_${cleanCpf}_accounts`);
    const legacyRaw = localStorage.getItem('minhas_contas_app_data_v2');

    if (existingRawAccounts && existingRawAccounts !== '[]') {
      try { this.accounts = JSON.parse(existingRawAccounts); } catch(e) { this.accounts = []; }
    } else if (legacyRaw && legacyRaw !== '[]') {
      try { this.accounts = JSON.parse(legacyRaw); } catch(e) { this.accounts = this.getSampleData(); }
    } else {
      this.accounts = this.getSampleData();
    }

    // PRESERVE EXISTING PROFILES
    const existingRawProfiles = localStorage.getItem(`minhas_contas_cpf_${cleanCpf}_profiles`);
    if (existingRawProfiles && existingRawProfiles !== '[]') {
      try { this.profiles = JSON.parse(existingRawProfiles); } catch(e) { this.profiles = [{ id: 'p_titular', name: `Meu Perfil (${name})` }]; }
    } else {
      this.profiles = [{ id: 'p_titular', name: `Meu Perfil (${name})` }];
    }

    this.saveCpfProfiles();
    this.saveCpfAccounts();
    await this.syncFullDataToCloud();

    this.loginSuccess(user, true);
    this.showToast(`Conta ativada com sucesso! Bem-vindo(a), ${name}!`);
  }

  async handleDirectPasswordReset(e) {
    e.preventDefault();
    const btnSubmit = document.getElementById('btnForgotSubmit');
    if (btnSubmit) { btnSubmit.disabled = true; btnSubmit.innerHTML = 'Salvando Nova Senha...'; }

    const cpfRaw = document.getElementById('forgotCpfInput')?.value || '';
    const cleanCpf = cpfRaw.replace(/\D/g, '');
    const verifyInput = document.getElementById('forgotVerifyInput')?.value.trim().toLowerCase() || '';
    const newPass = document.getElementById('forgotNewPassInput')?.value || '';
    const confirmPass = document.getElementById('forgotConfirmPassInput')?.value || '';

    if (cleanCpf.length !== 11) {
      alert('Por favor, digite o CPF cadastrado com 11 dígitos.');
      if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = '<i data-lucide="check-circle"></i> Salvar Nova Senha e Entrar'; }
      if (window.lucide) lucide.createIcons();
      return;
    }

    if (newPass !== confirmPass) {
      alert('A nova senha e a confirmação não são iguais.');
      if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = '<i data-lucide="check-circle"></i> Salvar Nova Senha e Entrar'; }
      if (window.lucide) lucide.createIcons();
      return;
    }

    if (!newPass || newPass.length < 4) {
      alert('A nova senha deve ter no mínimo 4 caracteres.');
      if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = '<i data-lucide="check-circle"></i> Salvar Nova Senha e Entrar'; }
      if (window.lucide) lucide.createIcons();
      return;
    }

    let user = await this.fetchUserDataByCpf(cleanCpf);
    if (!user) {
      user = { cpf: cleanCpf, name: 'Titular', phone: verifyInput, email: verifyInput, password: newPass };
    } else {
      const userPhoneClean = (user.phone || '').replace(/\D/g, '');
      const verifyClean = verifyInput.replace(/\D/g, '');
      const userEmail = (user.email || '').toLowerCase().trim();

      const phoneMatches = userPhoneClean && (verifyClean.includes(userPhoneClean) || userPhoneClean.includes(verifyClean));
      const emailMatches = userEmail && userEmail === verifyInput;

      if (!phoneMatches && !emailMatches && (user.phone || user.email)) {
        alert('O telefone ou e-mail digitado não confere com o cadastro deste CPF.');
        if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = '<i data-lucide="check-circle"></i> Salvar Nova Senha e Entrar'; }
        if (window.lucide) lucide.createIcons();
        return;
      }
      user.password = newPass;
    }

    this.saveLocalUserData(user);
    this.activeUser = user;
    this.activeCpf = cleanCpf;

    this.loadCpfData();
    await this.syncFullDataToCloud();

    this.loginSuccess(user, true);
    if (window.confetti) {
      confetti({ particleCount: 60, spread: 60, origin: { y: 0.8 } });
    }
    this.showToast('Nova senha salva com sucesso! Acesso liberado.');
  }

  loginSuccess(user, remember) {
    this.activeCpf = user.cpf;
    this.activeUser = user;

    if (remember) {
      localStorage.setItem(this.AUTH_CPF_KEY, user.cpf);
    }

    const overlay = document.getElementById('authOverlay');
    if (overlay) overlay.classList.add('hidden');

    const badgeText = document.getElementById('currentCpfText');
    if (badgeText) {
      badgeText.textContent = this.formatCpf(user.cpf);
    }

    this.loadCpfData();
    this.render();
    this.showToast(`Conectado como ${user.name || this.formatCpf(user.cpf)}!`);

    this.syncFullDataToCloud();

    if (window.lucide) {
      lucide.createIcons();
    }
  }

  logoutCpf() {
    if (confirm('Deseja desconectar deste CPF e voltar à tela inicial?')) {
      localStorage.removeItem(this.AUTH_CPF_KEY);
      this.activeCpf = null;
      this.activeUser = null;
      this.accounts = [];
      this.profiles = [];
      const overlay = document.getElementById('authOverlay');
      if (overlay) overlay.classList.remove('hidden');
      this.showLoginView();
      const input = document.getElementById('loginCpfInput');
      if (input) {
        input.value = '';
        input.focus();
      }
    }
  }

  maskCpf(input) {
    let value = input.value.replace(/\D/g, '');
    if (value.length > 11) value = value.substring(0, 11);
    
    if (value.length > 9) {
      value = value.replace(/^(\d{3})(\d{3})(\d{3})(\d{1,2})$/, "$1.$2.$3-$4");
    } else if (value.length > 6) {
      value = value.replace(/^(\d{3})(\d{3})(\d{1,3})$/, "$1.$2.$3");
    } else if (value.length > 3) {
      value = value.replace(/^(\d{3})(\d{1,3})$/, "$1.$2");
    }
    input.value = value;
  }

  maskPhone(input) {
    let value = input.value.replace(/\D/g, '');
    if (value.length > 11) value = value.substring(0, 11);

    if (value.length > 10) {
      value = value.replace(/^(\d{2})(\d{5})(\d{4})$/, "($1) $2-$3");
    } else if (value.length > 6) {
      value = value.replace(/^(\d{2})(\d{4})(\d{0,4})$/, "($1) $2-$3");
    } else if (value.length > 2) {
      value = value.replace(/^(\d{2})(\d{0,5})$/, "($1) $2");
    }
    input.value = value;
  }

  formatCpf(cpf) {
    if (!cpf) return '';
    const c = cpf.replace(/\D/g, '');
    if (c.length !== 11) return cpf;
    return c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }

  /* ------------------------------------------------------------------------
     4. GASTOS RÁPIDOS DO DIA A DIA (EXPRESS)
     ------------------------------------------------------------------------ */
  openQuickExpenseModal(defaultTitle = '', defaultCat = 'Alimentação') {
    const amountInput = document.getElementById('quickAmount');
    const titleInput = document.getElementById('quickTitle');
    const catSelect = document.getElementById('quickCategory');
    const memberSelect = document.getElementById('quickMember');

    if (amountInput) amountInput.value = '';
    if (titleInput) titleInput.value = defaultTitle;
    if (catSelect) catSelect.value = defaultCat;

    if (memberSelect) {
      memberSelect.innerHTML = this.profiles.map(p => 
        `<option value="${p.id}" ${p.id === this.activeProfileId ? 'selected' : ''}>👤 ${this.escapeHtml(p.name)}</option>`
      ).join('');
    }

    this.openModal('quickExpenseModal');
    setTimeout(() => {
      if (amountInput) amountInput.focus();
    }, 150);
  }

  quickAddPreset(title, category) {
    this.openQuickExpenseModal(title, category);
  }

  saveQuickExpense(e) {
    e.preventDefault();

    const amount = parseFloat(document.getElementById('quickAmount').value);
    const title = document.getElementById('quickTitle').value.trim();
    const category = document.getElementById('quickCategory').value;
    const paymentMethod = document.getElementById('quickPaymentMethod').value;
    const profileId = document.getElementById('quickMember')?.value || this.profiles[0]?.id || 'p_titular';

    if (isNaN(amount) || amount <= 0 || !title) {
      alert('Por favor, digite o valor e o que foi comprado.');
      return;
    }

    const todayStr = new Date().toISOString().split('T')[0];

    const newQuickExpense = {
      id: 'quick_' + Date.now().toString(),
      profileId: profileId,
      title: title,
      person: `Gasto Rápido (${paymentMethod})`,
      amount: amount,
      dueDate: todayStr,
      paidAt: todayStr,
      category: category,
      status: 'paid',
      type: 'pay',
      isQuickExpense: true,
      notes: `Compra do dia a dia • Forma de Pagamento: ${paymentMethod}`
    };

    this.accounts.push(newQuickExpense);
    this.saveCpfAccounts();
    this.closeModal('quickExpenseModal');
    this.render();

    if (window.confetti) {
      confetti({ particleCount: 40, spread: 50, origin: { y: 0.85 } });
    }
    this.showToast(`Gasto de ${this.formatCurrency(amount)} salvo com sucesso! ⚡`);
  }

  renderQuickExpensesTab() {
    const curYear = this.selectedDate.getFullYear();
    const curMonth = this.selectedDate.getMonth();
    const activeAccounts = this.getFilteredAccountsByActiveProfile();

    const quickList = activeAccounts.filter(a => {
      const d = new Date(a.dueDate + 'T00:00:00');
      return a.isQuickExpense === true && d.getFullYear() === curYear && d.getMonth() === curMonth;
    });

    quickList.sort((a, b) => b.dueDate.localeCompare(a.dueDate) || b.id.localeCompare(a.id));

    const totalSpent = quickList.reduce((sum, a) => sum + a.amount, 0);

    const monthTotalDisplay = document.getElementById('quickMonthTotal');
    const monthCountDisplay = document.getElementById('quickMonthCount');
    if (monthTotalDisplay) monthTotalDisplay.textContent = this.formatCurrency(totalSpent);
    if (monthCountDisplay) monthCountDisplay.textContent = `${quickList.length} compra(s)`;

    const container = document.getElementById('quickExpensesList');
    if (!container) return;

    if (quickList.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="text-align:center; padding: 40px; color: var(--text-muted);">
          <i data-lucide="zap" style="width:48px; height:48px; opacity:0.5; color:#f59e0b; margin-bottom:12px;"></i>
          <p>Nenhum gasto rápido lançado neste mês ainda.</p>
          <button class="btn-quick-expense" onclick="app.openQuickExpenseModal()" style="margin-top:14px;">
            <i data-lucide="plus"></i> Lançar Primeiro Gasto Rápido
          </button>
        </div>
      `;
      return;
    }

    container.innerHTML = quickList.map(a => {
      const memberName = this.getProfileNameById(a.profileId);
      return `
        <div class="account-card">
          <div class="type-indicator quick">
            <i data-lucide="zap"></i>
          </div>

          <div class="account-info">
            <div class="account-title-row">
              <span class="account-title">${this.escapeHtml(a.title)}</span>
              <span class="badge-tag badge-quick">⚡ Gasto Rápido</span>
              ${this.activeProfileId === 'all' ? `<span class="badge-tag badge-member"><i data-lucide="user" style="width:10px"></i> ${this.escapeHtml(memberName)}</span>` : ''}
              <span class="badge-tag">${this.escapeHtml(a.category)}</span>
            </div>

            <div class="account-meta">
              <span><i data-lucide="calendar" style="width:12px"></i> Feito em: ${this.formatDate(a.dueDate)}</span>
              ${a.notes ? `<span><i data-lucide="file-text" style="width:12px"></i> ${this.escapeHtml(a.notes)}</span>` : ''}
            </div>
          </div>

          <div class="account-values">
            <div class="account-amount pay">-${this.formatCurrency(a.amount)}</div>
            <span class="account-status-badge status-badge-paid">🟢 Quitado à Vista</span>
          </div>

          <div class="account-actions">
            <button class="icon-btn-sm" onclick="app.deleteAccount('${a.id}')" title="Excluir" style="color:var(--danger-color)">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  /* ------------------------------------------------------------------------
     5. DATA STORAGE & PROFILES (PERMANENT RETENTION)
     ------------------------------------------------------------------------ */
  getCpfStorageKey(subKey) {
    return `minhas_contas_cpf_${this.activeCpf}_${subKey}`;
  }

  loadCpfData() {
    if (!this.activeCpf) return;

    // Load Profiles
    const rawProfiles = localStorage.getItem(this.getCpfStorageKey('profiles'));
    if (rawProfiles) {
      try { this.profiles = JSON.parse(rawProfiles); } catch(e) { this.profiles = []; }
    }
    if (!this.profiles || this.profiles.length === 0) {
      const titularName = this.activeUser?.name ? `Meu Perfil (${this.activeUser.name})` : 'Meu Perfil (Titular)';
      this.profiles = [
        { id: 'p_titular', name: titularName }
      ];
      this.saveCpfProfiles();
    }

    // Active Profile
    const savedActiveProfile = localStorage.getItem(this.getCpfStorageKey('active_profile'));
    this.activeProfileId = savedActiveProfile || 'all';

    // Budget Goal
    const savedBudget = localStorage.getItem(this.getCpfStorageKey('budget_goal'));
    this.budgetGoal = savedBudget ? parseFloat(savedBudget) : 3000;

    // Accounts: Load existing or retrieve legacy/backup
    const rawAccounts = localStorage.getItem(this.getCpfStorageKey('accounts'));
    const vaultRaw = localStorage.getItem(`minhas_contas_permanent_vault_${this.activeCpf}`);
    const legacyRaw = localStorage.getItem('minhas_contas_app_data_v2');

    if (rawAccounts && rawAccounts !== '[]') {
      try { this.accounts = JSON.parse(rawAccounts); } catch(e) { this.accounts = []; }
    } else if (vaultRaw && vaultRaw !== '[]') {
      try { this.accounts = JSON.parse(vaultRaw); } catch(e) {}
    } else if (legacyRaw && legacyRaw !== '[]') {
      try { 
        this.accounts = JSON.parse(legacyRaw);
        this.saveCpfAccounts();
      } catch(e) { 
        this.accounts = this.getSampleData(); 
      }
    } else {
      this.accounts = this.getSampleData();
      this.saveCpfAccounts();
    }

    this.rebuildPixMap();
  }

  saveCpfProfiles() {
    if (!this.activeCpf) return;
    localStorage.setItem(this.getCpfStorageKey('profiles'), JSON.stringify(this.profiles));
    this.syncFullDataToCloud();
  }

  saveCpfAccounts() {
    if (!this.activeCpf) return;
    localStorage.setItem(this.getCpfStorageKey('accounts'), JSON.stringify(this.accounts));
    localStorage.setItem(`minhas_contas_permanent_vault_${this.activeCpf}`, JSON.stringify(this.accounts));
    this.rebuildPixMap();
    this.syncFullDataToCloud();
  }

  rebuildPixMap() {
    this.personPixMap = {};
    this.accounts.forEach(a => {
      if (a.person && a.pixKey) {
        this.personPixMap[a.person.trim()] = a.pixKey.trim();
      }
    });
  }

  getSampleData() {
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = String(now.getMonth() + 1).padStart(2, '0');
    
    return [
      {
        id: '1',
        profileId: 'p_titular',
        title: 'Fatura de Presente (Parc 1/3)',
        person: 'Cartão da Lílian',
        pixKey: 'lilian@email.com',
        amount: 150.00,
        type: 'pay',
        dueDate: `${curYear}-${curMonth}-15`,
        category: 'Cartão de Terceiros',
        status: 'pending',
        notes: 'Comprado presente de aniversário no cartão da Lílian'
      },
      {
        id: '2',
        profileId: 'p_titular',
        title: 'Fatura de Presente (Parc 2/3)',
        person: 'Cartão da Lílian',
        pixKey: 'lilian@email.com',
        amount: 150.00,
        type: 'pay',
        dueDate: `${curYear}-${String(now.getMonth() + 2).padStart(2, '0')}-15`,
        category: 'Cartão de Terceiros',
        status: 'pending',
        notes: 'Parcela 2 de 3'
      },
      {
        id: '3',
        profileId: 'p_titular',
        title: 'Empréstimo churrasco',
        person: 'Cunhado',
        pixKey: '11999998888',
        amount: 85.50,
        type: 'pay',
        dueDate: `${curYear}-${curMonth}-10`,
        category: 'Outros',
        status: 'pending',
        notes: 'Carne do churrasco de domingo'
      },
      {
        id: '4',
        profileId: 'p_titular',
        title: 'Aluguel do Apê',
        person: 'Imobiliária',
        pixKey: '12.345.678/0001-90',
        amount: 1200.00,
        type: 'pay',
        dueDate: `${curYear}-${curMonth}-05`,
        category: 'Moradia',
        status: 'paid',
        paidAt: `${curYear}-${curMonth}-04`,
        notes: 'Pago via Pix'
      },
      {
        id: '5',
        profileId: 'p_titular',
        title: 'Salário Mensal',
        person: 'Empresa X',
        amount: 3500.00,
        type: 'receive',
        dueDate: `${curYear}-${curMonth}-05`,
        category: 'Salário/Renda',
        status: 'paid',
        notes: 'Depósito em conta'
      }
    ];
  }

  /* ------------------------------------------------------------------------
     6. PROFILE & MEMBER MANAGEMENT
     ------------------------------------------------------------------------ */
  switchUserProfile(profileId) {
    this.activeProfileId = profileId;
    localStorage.setItem(this.getCpfStorageKey('active_profile'), profileId);
    this.render();
    this.showToast(`Visualizando: ${this.getActiveProfileDisplayName()}`);
  }

  renderMembersModal() {
    const list = document.getElementById('membersListModal');
    if (!list) return;

    list.innerHTML = this.profiles.map(p => `
      <div class="member-item-row">
        <div>
          <strong>👤 ${this.escapeHtml(p.name)}</strong>
          <span style="font-size:0.75rem; color:var(--text-muted); display:block;">${p.id === 'p_titular' ? '(Titular Principal)' : 'Membro Adicional'}</span>
        </div>
        ${p.id !== 'p_titular' ? `
          <button onclick="app.deleteMember('${p.id}')" class="btn-danger-sm" title="Excluir este membro"><i data-lucide="trash-2"></i></button>
        ` : '<span style="font-size:0.8rem; color:var(--primary-color)">Padrão</span>'}
      </div>
    `).join('');

    if (window.lucide) lucide.createIcons();
  }

  addMemberFromModal() {
    const input = document.getElementById('newMemberInput');
    const name = input?.value.trim();
    if (!name) return;

    const newId = 'p_' + Date.now();
    this.profiles.push({ id: newId, name });
    this.saveCpfProfiles();
    input.value = '';
    this.renderMembersModal();
    this.renderProfileSelect();
    this.showToast(`Membro "${name}" adicionado!`);
  }

  deleteMember(profileId) {
    const p = this.profiles.find(x => x.id === profileId);
    if (!p) return;

    if (confirm(`Tem certeza que deseja excluir o membro "${p.name}"? As contas associadas a ele serão mantidas na visão geral.`)) {
      this.profiles = this.profiles.filter(x => x.id !== profileId);
      this.saveCpfProfiles();
      if (this.activeProfileId === profileId) {
        this.activeProfileId = 'all';
      }
      this.renderMembersModal();
      this.render();
      this.showToast(`Membro "${p.name}" excluído.`);
    }
  }

  getActiveProfileDisplayName() {
    if (this.activeProfileId === 'all') {
      return '👨‍👩‍👧 Visão Geral (Todos os Usuários)';
    }
    const p = this.profiles.find(p => p.id === this.activeProfileId);
    return p ? `👤 ${p.name}` : 'Meu Perfil';
  }

  renderProfileSelect() {
    const select = document.getElementById('userProfileSelect');
    if (select) {
      let optionsHtml = `<option value="all" ${this.activeProfileId === 'all' ? 'selected' : ''}>👨‍👩‍👧 Visão Geral (Todos os Usuários)</option>`;
      optionsHtml += this.profiles.map(p => 
        `<option value="${p.id}" ${p.id === this.activeProfileId ? 'selected' : ''}>👤 ${this.escapeHtml(p.name)}</option>`
      ).join('');
      select.innerHTML = optionsHtml;
    }

    const modalMemberSelect = document.getElementById('accMember');
    if (modalMemberSelect) {
      modalMemberSelect.innerHTML = this.profiles.map(p => 
        `<option value="${p.id}">${this.escapeHtml(p.name)}</option>`
      ).join('');
      if (this.activeProfileId !== 'all') {
        modalMemberSelect.value = this.activeProfileId;
      }
    }
  }

  getFilteredAccountsByActiveProfile() {
    if (this.activeProfileId === 'all') {
      return this.accounts;
    }
    return this.accounts.filter(a => (a.profileId || 'p_titular') === this.activeProfileId);
  }

  getProfileNameById(pId) {
    const p = this.profiles.find(x => x.id === pId);
    return p ? p.name : 'Titular';
  }

  clearDemoAccountsPrompt() {
    if (confirm('Deseja zerar todas as contas deste CPF e iniciar com a sua lista 100% limpa?')) {
      this.accounts = [];
      this.saveCpfAccounts();
      this.render();
      this.closeModal('backupModal');
      this.showToast('Contas zeradas! Agora você pode cadastrar suas contas reais.');
    }
  }

  /* ------------------------------------------------------------------------
     7. SMART BUDGET GOAL
     ------------------------------------------------------------------------ */
  editBudgetGoalPrompt() {
    const current = this.budgetGoal;
    const val = prompt('Digite o valor da sua Meta/Limite de Gastos Mensal (R$):', current);
    if (val && !isNaN(parseFloat(val))) {
      this.budgetGoal = parseFloat(val);
      localStorage.setItem(this.getCpfStorageKey('budget_goal'), this.budgetGoal.toString());
      this.syncFullDataToCloud();
      this.renderDashboard();
      this.showToast(`Meta de gastos atualizada para ${this.formatCurrency(this.budgetGoal)}!`);
    }
  }

  /* ------------------------------------------------------------------------
     8. THEME & PWA
     ------------------------------------------------------------------------ */
  initTheme() {
    const savedTheme = localStorage.getItem(this.THEME_KEY) || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    this.updateThemeIcon(savedTheme);
  }

  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(this.THEME_KEY, next);
    this.updateThemeIcon(next);
  }

  updateThemeIcon(theme) {
    const icon = document.getElementById('themeIcon');
    if (icon) {
      icon.setAttribute('data-lucide', theme === 'dark' ? 'sun' : 'moon');
      if (window.lucide) lucide.createIcons();
    }
  }

  initPwa() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(err => console.log('SW Registration error:', err));
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e;
      const banner = document.getElementById('installBanner');
      if (banner) banner.classList.remove('hidden');
    });

    const installBtn = document.getElementById('btnInstallPwa');
    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        if (this.deferredPrompt) {
          this.deferredPrompt.prompt();
          const { outcome } = await this.deferredPrompt.userChoice;
          if (outcome === 'accepted') {
            console.log('User accepted PWA prompt');
          }
          this.deferredPrompt = null;
          this.closeInstallBanner();
        }
      });
    }
  }

  closeInstallBanner() {
    const banner = document.getElementById('installBanner');
    if (banner) banner.classList.add('hidden');
  }

  /* ------------------------------------------------------------------------
     9. NAVIGATION & RENDER PIPELINE
     ------------------------------------------------------------------------ */
  switchTab(tabId) {
    this.currentTab = tabId;
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.classList.toggle('active', tab.getAttribute('data-tab') === tabId);
    });
    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.toggle('active', content.id === `tab-${tabId}`);
    });

    this.render();
  }

  changeMonth(delta) {
    this.selectedDate.setMonth(this.selectedDate.getMonth() + delta);
    this.render();
  }

  resetToCurrentMonth() {
    this.selectedDate = new Date();
    this.render();
  }

  changeCalendarMonth(delta) {
    this.calendarDate.setMonth(this.calendarDate.getMonth() + delta);
    this.renderCalendar();
  }

  render() {
    if (!this.activeCpf) return;

    this.renderProfileSelect();
    this.updateMonthTitle();
    this.populatePeopleSelects();
    this.populateCategorySelect();

    if (this.currentTab === 'dashboard') {
      this.renderDashboard();
    } else if (this.currentTab === 'list') {
      this.renderList();
    } else if (this.currentTab === 'quick-expenses') {
      this.renderQuickExpensesTab();
    } else if (this.currentTab === 'reports') {
      this.renderReportsTab();
    } else if (this.currentTab === 'calendar') {
      this.renderCalendar();
    } else if (this.currentTab === 'people') {
      this.renderPeople();
    }

    if (window.lucide) {
      lucide.createIcons();
    }
  }

  updateMonthTitle() {
    const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const title = `${months[this.selectedDate.getMonth()]} ${this.selectedDate.getFullYear()}`;
    
    const dashTitle = document.getElementById('currentMonthYearDisplay');
    if (dashTitle) dashTitle.textContent = title;

    const calTitle = document.getElementById('calendarMonthTitle');
    if (calTitle) {
      const calMonth = `${months[this.calendarDate.getMonth()]} ${this.calendarDate.getFullYear()}`;
      calTitle.textContent = calMonth;
    }
  }

  populatePeopleSelects() {
    const activeAccounts = this.getFilteredAccountsByActiveProfile();
    const persons = Array.from(new Set(activeAccounts.map(a => a.person?.trim()).filter(Boolean))).sort();

    const datalist = document.getElementById('peopleDatalist');
    if (datalist) {
      datalist.innerHTML = persons.map(p => `<option value="${p}">`).join('');
    }

    const dashSelect = document.getElementById('dashboardPersonFilter');
    if (dashSelect) {
      const currentVal = dashSelect.value;
      dashSelect.innerHTML = `<option value="all">Todas as Pessoas / Todos os Cartões</option>` +
        persons.map(p => `<option value="${p}">${p}</option>`).join('');
      dashSelect.value = currentVal;
    }

    const listSelect = document.getElementById('personListFilter');
    if (listSelect) {
      const currentVal = listSelect.value;
      listSelect.innerHTML = `<option value="all">Todas as Pessoas / Terceiros</option>` +
        persons.map(p => `<option value="${p}">${p}</option>`).join('');
      listSelect.value = currentVal;
    }
  }

  populateCategorySelect() {
    const activeAccounts = this.getFilteredAccountsByActiveProfile();
    const categories = Array.from(new Set(activeAccounts.map(a => a.category).filter(Boolean))).sort();
    const select = document.getElementById('categoryFilter');
    if (select) {
      const currentVal = select.value;
      select.innerHTML = `<option value="all">Todas as Categorias</option>` +
        categories.map(c => `<option value="${c}">${c}</option>`).join('');
      select.value = currentVal;
    }
  }

  autoFillPixKey(personName) {
    if (!personName) return;
    const cleanPerson = personName.trim();
    if (this.personPixMap[cleanPerson]) {
      const pixInput = document.getElementById('accPixKey');
      if (pixInput && !pixInput.value) {
        pixInput.value = this.personPixMap[cleanPerson];
      }
    }
  }

  /* ------------------------------------------------------------------------
     10. DASHBOARD RENDERER
     ------------------------------------------------------------------------ */
  renderDashboard() {
    const curYear = this.selectedDate.getFullYear();
    const curMonth = this.selectedDate.getMonth();
    const selectedPerson = document.getElementById('dashboardPersonFilter')?.value || 'all';
    const activeAccounts = this.getFilteredAccountsByActiveProfile();

    const monthAccounts = activeAccounts.filter(acc => {
      const d = new Date(acc.dueDate + 'T00:00:00');
      const matchesMonth = d.getFullYear() === curYear && d.getMonth() === curMonth;
      const matchesPerson = selectedPerson === 'all' || acc.person === selectedPerson;
      return matchesMonth && matchesPerson;
    });

    let toPay = 0, toPayCount = 0;
    let toReceive = 0, toReceiveCount = 0;
    let alreadyPaid = 0;

    monthAccounts.forEach(acc => {
      if (acc.type === 'pay') {
        toPay += acc.amount;
        if (acc.status === 'pending') toPayCount++;
        else if (acc.status === 'paid') alreadyPaid += acc.amount;
      } else if (acc.type === 'receive') {
        if (acc.status === 'pending') {
          toReceive += acc.amount;
          toReceiveCount++;
        }
      }
    });

    const balance = toReceive - (toPay - alreadyPaid);

    // KPI Cards
    document.getElementById('kpiToPay').textContent = this.formatCurrency(toPay);
    document.getElementById('kpiToPaySub').textContent = `${toPayCount} conta(s) pendente(s)`;

    document.getElementById('kpiToReceive').textContent = this.formatCurrency(toReceive);
    document.getElementById('kpiToReceiveSub').textContent = `${toReceiveCount} conta(s) a receber`;

    document.getElementById('kpiBalance').textContent = this.formatCurrency(balance);
    document.getElementById('kpiAlreadyPaid').textContent = this.formatCurrency(alreadyPaid);

    // Render Smart Budget Goal / Progress Bar
    const budgetDisplay = document.getElementById('budgetAmountDisplay');
    const budgetBar = document.getElementById('budgetProgressBar');
    const budgetStatus = document.getElementById('budgetStatusText');
    const budgetSpentInfo = document.getElementById('budgetSpentInfo');
    const budgetRemInfo = document.getElementById('budgetRemainingInfo');

    if (budgetDisplay && budgetBar) {
      budgetDisplay.textContent = this.formatCurrency(this.budgetGoal);
      const spentPercent = this.budgetGoal > 0 ? (toPay / this.budgetGoal) * 100 : 0;
      const roundedPercent = Math.min(spentPercent, 100).toFixed(0);

      budgetBar.style.width = `${Math.min(spentPercent, 100)}%`;
      budgetBar.className = 'budget-progress-bar ' + (spentPercent >= 100 ? 'red' : (spentPercent >= 70 ? 'yellow' : 'green'));

      budgetStatus.textContent = `${roundedPercent}% do limite gasto`;
      budgetSpentInfo.textContent = `Comprometido: ${this.formatCurrency(toPay)}`;

      const remaining = this.budgetGoal - toPay;
      budgetRemInfo.textContent = remaining >= 0 ? `Disponível: ${this.formatCurrency(remaining)}` : `Ultrapassado em: ${this.formatCurrency(Math.abs(remaining))}`;
      budgetRemInfo.style.color = remaining >= 0 ? 'var(--text-muted)' : 'var(--danger-color)';
    }

    // Render Family Summary Grid (when in 'all' view)
    const famSummary = document.getElementById('familyMembersSummary');
    const famGrid = document.getElementById('familyMembersGrid');
    if (famSummary && famGrid) {
      if (this.activeProfileId === 'all' && this.profiles.length > 1) {
        famSummary.classList.remove('hidden');
        famGrid.innerHTML = this.profiles.map(p => {
          const memberMonthBills = this.accounts.filter(a => {
            const d = new Date(a.dueDate + 'T00:00:00');
            return a.profileId === p.id && a.type === 'pay' && d.getFullYear() === curYear && d.getMonth() === curMonth;
          });
          const memberTotal = memberMonthBills.reduce((sum, a) => sum + a.amount, 0);
          return `
            <div class="member-stat-badge" onclick="app.switchUserProfile('${p.id}')">
              <span class="member-stat-name">👤 ${this.escapeHtml(p.name)}</span>
              <span class="member-stat-val" style="color:var(--danger-color)">${this.formatCurrency(memberTotal)}</span>
            </div>
          `;
        }).join('');
      } else {
        famSummary.classList.add('hidden');
      }
    }

    // Overdue Alert
    const todayStr = new Date().toISOString().split('T')[0];
    const overdueAccounts = activeAccounts.filter(a => a.type === 'pay' && a.status === 'pending' && a.dueDate < todayStr);
    const overdueBanner = document.getElementById('overdueAlert');
    if (overdueBanner) {
      if (overdueAccounts.length > 0) {
        const totalOverdue = overdueAccounts.reduce((sum, a) => sum + a.amount, 0);
        document.getElementById('overdueAlertText').textContent = `${overdueAccounts.length} conta(s) vencida(s) totalizando ${this.formatCurrency(totalOverdue)}`;
        overdueBanner.classList.remove('hidden');
      } else {
        overdueBanner.classList.add('hidden');
      }
    }

    // Upcoming list
    const upcomingContainer = document.getElementById('upcomingList');
    if (upcomingContainer) {
      const sortedPending = [...monthAccounts]
        .filter(a => a.status === 'pending')
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .slice(0, 5);

      if (sortedPending.length === 0) {
        upcomingContainer.innerHTML = `<div class="empty-state"><p>Nenhuma conta pendente para este mês! 🎉</p></div>`;
      } else {
        upcomingContainer.innerHTML = sortedPending.map(a => {
          const isOverdue = a.dueDate < todayStr;
          const isToday = a.dueDate === todayStr;
          let statusClass = isOverdue ? 'overdue' : (isToday ? 'today' : 'soon');
          const memberTag = this.activeProfileId === 'all' ? ` [${this.getProfileNameById(a.profileId)}]` : '';
          return `
            <div class="upcoming-item ${statusClass}" onclick="app.editAccount('${a.id}')">
              <div>
                <div class="upcoming-title">${this.escapeHtml(a.title)}${memberTag}</div>
                <div class="upcoming-person"><i data-lucide="user" style="width:12px"></i> ${this.escapeHtml(a.person || 'Geral')} • Vence ${this.formatDate(a.dueDate)}</div>
              </div>
              <div>
                <div class="upcoming-amount ${a.type}">${this.formatCurrency(a.amount)}</div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    this.renderCategoryChart(monthAccounts);
  }

  renderCategoryChart(monthAccounts) {
    const ctx = document.getElementById('categoryChart')?.getContext('2d');
    if (!ctx) return;

    if (this.categoryChart) {
      this.categoryChart.destroy();
    }

    const catTotals = {};
    monthAccounts.filter(a => a.type === 'pay').forEach(a => {
      const cat = a.category || 'Outros';
      catTotals[cat] = (catTotals[cat] || 0) + a.amount;
    });

    const labels = Object.keys(catTotals);
    const data = Object.values(catTotals);

    if (labels.length === 0) {
      ctx.clearRect(0, 0, 300, 200);
      return;
    }

    const colors = ['#f43f5e', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#64748b'];

    this.categoryChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: data,
          backgroundColor: colors.slice(0, labels.length),
          borderWidth: 2,
          borderColor: 'transparent'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: document.documentElement.getAttribute('data-theme') === 'dark' ? '#94a3b8' : '#64748b', font: { size: 11 } }
          }
        }
      }
    });
  }

  /* ------------------------------------------------------------------------
     11. LIST TAB RENDERER
     ------------------------------------------------------------------------ */
  renderList() {
    const search = document.getElementById('searchInput')?.value.toLowerCase() || '';
    const status = document.getElementById('statusFilter')?.value || 'all';
    const type = document.getElementById('typeFilter')?.value || 'all';
    const person = document.getElementById('personListFilter')?.value || 'all';
    const category = document.getElementById('categoryFilter')?.value || 'all';
    const activeAccounts = this.getFilteredAccountsByActiveProfile();

    const todayStr = new Date().toISOString().split('T')[0];

    const filtered = activeAccounts.filter(a => {
      const matchSearch = !search || 
        a.title.toLowerCase().includes(search) || 
        (a.person && a.person.toLowerCase().includes(search)) ||
        (a.pixKey && a.pixKey.toLowerCase().includes(search)) ||
        (a.category && a.category.toLowerCase().includes(search));

      let matchStatus = true;
      if (status === 'pending') matchStatus = (a.status === 'pending' && a.dueDate >= todayStr);
      else if (status === 'overdue') matchStatus = (a.status === 'pending' && a.dueDate < todayStr);
      else if (status === 'paid') matchStatus = (a.status === 'paid');

      const matchType = type === 'all' || a.type === type;
      const matchPerson = person === 'all' || a.person === person;
      const matchCategory = category === 'all' || a.category === category;

      return matchSearch && matchStatus && matchType && matchPerson && matchCategory;
    });

    filtered.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    let sumPay = 0, sumReceive = 0;
    filtered.forEach(a => {
      if (a.type === 'pay' && a.status === 'pending') sumPay += a.amount;
      if (a.type === 'receive' && a.status === 'pending') sumReceive += a.amount;
    });

    document.getElementById('filteredCount').textContent = filtered.length;
    document.getElementById('listSumPay').textContent = this.formatCurrency(sumPay);
    document.getElementById('listSumReceive').textContent = this.formatCurrency(sumReceive);

    const container = document.getElementById('accountsContainer');
    if (!container) return;

    if (filtered.length === 0) {
      container.innerHTML = `<div class="empty-state" style="text-align:center; padding: 40px; color: var(--text-muted);">
        <i data-lucide="inbox" style="width:48px; height:48px; opacity:0.5; margin-bottom:12px;"></i>
        <p>Nenhuma conta cadastrada nesta visualização.</p>
      </div>`;
      return;
    }

    container.innerHTML = filtered.map(a => {
      const isOverdue = a.type === 'pay' && a.status === 'pending' && a.dueDate < todayStr;
      
      let statusBadgeClass = 'status-badge-pending';
      let statusBadgeText = a.type === 'pay' ? '🟡 Pendente' : '🟡 A Receber';
      if (a.status === 'paid') {
        statusBadgeClass = 'status-badge-paid';
        statusBadgeText = a.type === 'pay' ? '🟢 Paga' : '🟢 Recebida';
      } else if (isOverdue) {
        statusBadgeClass = 'status-badge-overdue';
        statusBadgeText = '🔴 Atrasada';
      }

      const memberName = this.getProfileNameById(a.profileId);

      return `
        <div class="account-card ${a.status === 'paid' ? 'status-paid' : ''}">
          <div class="type-indicator ${a.isQuickExpense ? 'quick' : a.type}">
            <i data-lucide="${a.isQuickExpense ? 'zap' : (a.type === 'pay' ? 'arrow-down-right' : 'arrow-up-right')}"></i>
          </div>

          <div class="account-info">
            <div class="account-title-row">
              <span class="account-title">${this.escapeHtml(a.title)}</span>
              ${a.isQuickExpense ? `<span class="badge-tag badge-quick">⚡ Gasto Rápido</span>` : ''}
              ${this.activeProfileId === 'all' ? `<span class="badge-tag badge-member"><i data-lucide="user" style="width:10px"></i> ${this.escapeHtml(memberName)}</span>` : ''}
              ${a.person ? `<span class="badge-tag badge-person"><i data-lucide="user" style="width:10px"></i> ${this.escapeHtml(a.person)}</span>` : ''}
              ${a.pixKey ? `<span class="badge-tag badge-pix" onclick="app.copyPixKey('${this.escapeHtml(a.pixKey)}')" title="Clique para copiar a Chave Pix"><i data-lucide="qr-code" style="width:10px"></i> Pix: ${this.escapeHtml(a.pixKey)}</span>` : ''}
              ${a.category ? `<span class="badge-tag">${this.escapeHtml(a.category)}</span>` : ''}
            </div>

            <div class="account-meta">
              <span><i data-lucide="calendar" style="width:12px"></i> ${a.type === 'receive' ? 'Data a Receber' : 'Vence'}: ${this.formatDate(a.dueDate)}</span>
              ${a.notes ? `<span><i data-lucide="file-text" style="width:12px"></i> ${this.escapeHtml(a.notes)}</span>` : ''}
            </div>
          </div>

          <div class="account-values">
            <div class="account-amount ${a.type}">${a.type === 'pay' ? '-' : '+'}${this.formatCurrency(a.amount)}</div>
            <span class="account-status-badge ${statusBadgeClass}">${statusBadgeText}</span>
          </div>

          <div class="account-actions">
            <button class="icon-btn-sm" onclick="app.toggleStatus('${a.id}')" title="${a.status === 'paid' ? 'Marcar como Pendente' : 'Marcar como Paga/Recebida'}">
              <i data-lucide="${a.status === 'paid' ? 'rotate-ccw' : 'check'}"></i>
            </button>

            ${!a.isQuickExpense ? `
              <button class="icon-btn-sm" onclick="app.openWhatsappModal('${a.id}')" title="Enviar Mensagem WhatsApp">
                <i data-lucide="message-square" style="color:#22c55e"></i>
              </button>
            ` : ''}

            <button class="icon-btn-sm" onclick="app.editAccount('${a.id}')" title="Editar">
              <i data-lucide="pencil"></i>
            </button>

            <button class="icon-btn-sm" onclick="app.deleteAccount('${a.id}')" title="Excluir" style="color:var(--danger-color)">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  copyPixKey(pixKey) {
    if (!pixKey) return;
    navigator.clipboard.writeText(pixKey).then(() => {
      this.showToast(`Chave Pix (${pixKey}) copiada!`);
    });
  }

  clearListFilters() {
    document.getElementById('searchInput').value = '';
    document.getElementById('statusFilter').value = 'all';
    document.getElementById('typeFilter').value = 'all';
    document.getElementById('personListFilter').value = 'all';
    document.getElementById('categoryFilter').value = 'all';
    this.renderList();
  }

  /* ------------------------------------------------------------------------
     12. REPORTS TAB ENGINE
     ------------------------------------------------------------------------ */
  populateReportSelectors() {
    const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const curMonth = new Date().getMonth();
    const curYear = new Date().getFullYear();

    const mSelect = document.getElementById('reportMonthSelect');
    if (mSelect && mSelect.options.length === 0) {
      mSelect.innerHTML = months.map((m, idx) => `<option value="${idx}" ${idx === curMonth ? 'selected' : ''}>${m}</option>`).join('');
    }

    const ySelect = document.getElementById('reportYearSelect');
    if (ySelect && ySelect.options.length === 0) {
      const years = [curYear - 1, curYear, curYear + 1];
      ySelect.innerHTML = years.map(y => `<option value="${y}" ${y === curYear ? 'selected' : ''}>${y}</option>`).join('');
    }
  }

  renderReportsTab() {
    const reportType = document.getElementById('reportTypeSelect')?.value || 'monthly';
    const month = parseInt(document.getElementById('reportMonthSelect')?.value ?? new Date().getMonth());
    const year = parseInt(document.getElementById('reportYearSelect')?.value ?? new Date().getFullYear());
    const container = document.getElementById('reportSheetContainer');
    if (!container) return;

    const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const monthName = months[month];

    if (reportType === 'monthly') {
      this.generateMonthlyReport(container, month, year, monthName);
    } else if (reportType === 'category') {
      this.generateCategoryReport(container, month, year, monthName);
    } else if (reportType === 'people') {
      this.generatePeopleReport(container, month, year, monthName);
    } else if (reportType === 'annual') {
      this.generateAnnualReport(container, year);
    }

    if (window.lucide) lucide.createIcons();
  }

  generateMonthlyReport(container, month, year, monthName) {
    const activeAccounts = this.getFilteredAccountsByActiveProfile();
    const monthAccounts = activeAccounts.filter(a => {
      const d = new Date(a.dueDate + 'T00:00:00');
      return d.getFullYear() === year && d.getMonth() === month;
    });

    let totalIncome = 0;
    let totalExpense = 0;
    let paidExpense = 0;
    let pendingExpense = 0;

    monthAccounts.forEach(a => {
      if (a.type === 'receive') {
        totalIncome += a.amount;
      } else {
        totalExpense += a.amount;
        if (a.status === 'paid') paidExpense += a.amount;
        else pendingExpense += a.amount;
      }
    });

    const netBalance = totalIncome - totalExpense;

    let html = `
      <div class="report-doc-header">
        <div class="report-doc-title">
          <h3>📊 Extrato Mensal Consolidado</h3>
          <span>Referência: <strong>${monthName} de ${year}</strong> • Usuário(s): <strong>${this.escapeHtml(this.getActiveProfileDisplayName())}</strong></span>
        </div>
        <div class="report-doc-meta">
          <div>CPF: ${this.formatCpf(this.activeCpf)}</div>
          <div>Data de Emissão: ${new Date().toLocaleDateString('pt-BR')}</div>
          <div>Total de Lançamentos: ${monthAccounts.length}</div>
        </div>
      </div>

      <div class="report-summary-boxes">
        <div class="report-stat-box">
          <span class="box-label">Total a Receber (Receitas)</span>
          <span class="box-val income">${this.formatCurrency(totalIncome)}</span>
        </div>
        <div class="report-stat-box">
          <span class="box-label">Total a Pagar (Despesas)</span>
          <span class="box-val expense">${this.formatCurrency(totalExpense)}</span>
        </div>
        <div class="report-stat-box">
          <span class="box-label">Saldo Líquido Previsto</span>
          <span class="box-val balance">${this.formatCurrency(netBalance)}</span>
        </div>
        <div class="report-stat-box">
          <span class="box-label">Despesas Já Pagas</span>
          <span class="box-val" style="color:var(--accent-color)">${this.formatCurrency(paidExpense)}</span>
        </div>
      </div>

      <h4 style="margin-bottom: 12px; font-size:1.1rem;">Detalhamento das Contas</h4>
    `;

    if (monthAccounts.length === 0) {
      html += `<p style="color:var(--text-muted); padding:20px 0;">Nenhum lançamento cadastrado para ${monthName}/${year}.</p>`;
    } else {
      html += `
        <div class="report-table-wrapper">
          <table class="report-table">
            <thead>
              <tr>
                <th>Usuário / Membro</th>
                <th>Tipo</th>
                <th>Descrição</th>
                <th>Favorecido / Origem</th>
                <th>Data</th>
                <th>Status</th>
                <th style="text-align:right">Valor (R$)</th>
              </tr>
            </thead>
            <tbody>
              ${monthAccounts.map(a => `
                <tr>
                  <td><strong>${this.escapeHtml(this.getProfileNameById(a.profileId))}</strong></td>
                  <td><strong>${a.isQuickExpense ? '⚡ Gasto Rápido' : (a.type === 'receive' ? '🟢 Receita' : '🔴 Despesa')}</strong></td>
                  <td>${this.escapeHtml(a.title)}</td>
                  <td>${this.escapeHtml(a.person || '-')}</td>
                  <td>${this.formatDate(a.dueDate)}</td>
                  <td>${a.status === 'paid' ? '✅ Quitado' : '🟡 Pendente'}</td>
                  <td style="text-align:right; font-weight:bold; color:${a.type==='receive'?'#10b981':'#f43f5e'}">
                    ${a.type==='receive'?'+':'-'}${this.formatCurrency(a.amount)}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    container.innerHTML = html;
  }

  generateCategoryReport(container, month, year, monthName) {
    const activeAccounts = this.getFilteredAccountsByActiveProfile();
    const monthExpenses = activeAccounts.filter(a => {
      const d = new Date(a.dueDate + 'T00:00:00');
      return a.type === 'pay' && d.getFullYear() === year && d.getMonth() === month;
    });

    const catMap = {};
    let totalSpent = 0;

    monthExpenses.forEach(a => {
      const cat = a.category || 'Outros';
      catMap[cat] = (catMap[cat] || 0) + a.amount;
      totalSpent += a.amount;
    });

    const sortedCats = Object.entries(catMap).sort((a, b) => b[1] - a[1]);

    let html = `
      <div class="report-doc-header">
        <div class="report-doc-title">
          <h3>🛒 Relatório de Gastos por Categoria</h3>
          <span>Referência: <strong>${monthName} de ${year}</strong> • Onde seu dinheiro foi aplicado</span>
        </div>
        <div class="report-doc-meta">
          <div>Total de Despesas: <strong style="color:var(--danger-color); font-size:1.1rem;">${this.formatCurrency(totalSpent)}</strong></div>
        </div>
      </div>
    `;

    if (sortedCats.length === 0) {
      html += `<p style="color:var(--text-muted); padding:20px 0;">Nenhuma despesa cadastrada para ${monthName}/${year}.</p>`;
    } else {
      html += `<div class="category-breakdown-list">`;
      sortedCats.forEach(([cat, amount]) => {
        const percent = totalSpent > 0 ? ((amount / totalSpent) * 100).toFixed(1) : 0;
        html += `
          <div class="category-report-item">
            <div class="cat-rep-header">
              <span><strong>${this.escapeHtml(cat)}</strong> (${percent}%)</span>
              <span style="color:var(--danger-color)">${this.formatCurrency(amount)}</span>
            </div>
            <div class="cat-progress-bg">
              <div class="cat-progress-fill" style="width: ${percent}%;"></div>
            </div>
          </div>
        `;
      });
      html += `</div>`;
    }

    container.innerHTML = html;
  }

  generatePeopleReport(container, month, year, monthName) {
    const activeAccounts = this.getFilteredAccountsByActiveProfile();
    const peopleMap = {};

    activeAccounts.forEach(a => {
      const person = a.person?.trim() || 'Geral';
      if (!peopleMap[person]) {
        peopleMap[person] = { toPay: 0, toReceive: 0, count: 0, pixKey: a.pixKey || this.personPixMap[person] || '' };
      }
      peopleMap[person].count++;
      if (a.type === 'pay' && a.status === 'pending') peopleMap[person].toPay += a.amount;
      if (a.type === 'receive' && a.status === 'pending') peopleMap[person].toReceive += a.amount;
    });

    let html = `
      <div class="report-doc-header">
        <div class="report-doc-title">
          <h3>👥 Extrato por Pessoa / Cartões de Terceiros</h3>
          <span>Balanço consolidado com credores e favorecidos (Lílian, Cunhado, etc.)</span>
        </div>
      </div>
      <div class="report-table-wrapper">
        <table class="report-table">
          <thead>
            <tr>
              <th>Pessoa / Favorecido</th>
              <th>Chave Pix Cadastrada</th>
              <th>Lançamentos</th>
              <th>Total a Pagar Pendente</th>
              <th>Total a Receber</th>
            </tr>
          </thead>
          <tbody>
            ${Object.entries(peopleMap).map(([p, data]) => `
              <tr>
                <td><strong>${this.escapeHtml(p)}</strong></td>
                <td>${this.escapeHtml(data.pixKey || 'Não cadastrada')}</td>
                <td>${data.count}</td>
                <td style="color:var(--danger-color); font-weight:bold;">${this.formatCurrency(data.toPay)}</td>
                <td style="color:var(--primary-color); font-weight:bold;">${this.formatCurrency(data.toReceive)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    container.innerHTML = html;
  }

  generateAnnualReport(container, year) {
    const activeAccounts = this.getFilteredAccountsByActiveProfile();
    const yearAccounts = activeAccounts.filter(a => {
      const d = new Date(a.dueDate + 'T00:00:00');
      return d.getFullYear() === year;
    });

    let annualIncome = 0;
    let annualExpense = 0;

    yearAccounts.forEach(a => {
      if (a.type === 'receive') annualIncome += a.amount;
      else annualExpense += a.amount;
    });

    const netBalance = annualIncome - annualExpense;

    let html = `
      <div class="report-doc-header">
        <div class="report-doc-title">
          <h3>📈 Relatório Financeiro Anual</h3>
          <span>Consolidado do Ano de <strong>${year}</strong></span>
        </div>
      </div>

      <div class="report-summary-boxes">
        <div class="report-stat-box">
          <span class="box-label">Receitas Anuais</span>
          <span class="box-val income">${this.formatCurrency(annualIncome)}</span>
        </div>
        <div class="report-stat-box">
          <span class="box-label">Despesas Anuais</span>
          <span class="box-val expense">${this.formatCurrency(annualExpense)}</span>
        </div>
        <div class="report-stat-box">
          <span class="box-label">Resultado Líquido do Ano</span>
          <span class="box-val balance">${this.formatCurrency(netBalance)}</span>
        </div>
      </div>
    `;

    container.innerHTML = html;
  }

  shareReportWhatsapp() {
    const month = parseInt(document.getElementById('reportMonthSelect')?.value ?? new Date().getMonth());
    const year = parseInt(document.getElementById('reportYearSelect')?.value ?? new Date().getFullYear());
    const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const monthName = months[month];

    const activeAccounts = this.getFilteredAccountsByActiveProfile();
    const monthAccounts = activeAccounts.filter(a => {
      const d = new Date(a.dueDate + 'T00:00:00');
      return d.getFullYear() === year && d.getMonth() === month;
    });

    let totalIncome = 0;
    let totalExpense = 0;
    monthAccounts.forEach(a => {
      if (a.type === 'receive') totalIncome += a.amount;
      else totalExpense += a.amount;
    });
    const balance = totalIncome - totalExpense;

    let msg = `📊 *Resumo Financeiro - ${monthName}/${year}*\n`;
    msg += `👤 *${this.getActiveProfileDisplayName()}*\n\n`;
    msg += `📈 *A Receber:* ${this.formatCurrency(totalIncome)}\n`;
    msg += `📉 *A Pagar:* ${this.formatCurrency(totalExpense)}\n`;
    msg += `⚖️ *Saldo Líquido:* ${this.formatCurrency(balance)}\n\n`;
    msg += `_Gerado via App Minhas Contas 💰_`;

    const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
  }

  printCurrentReport() {
    window.print();
  }

  /* ------------------------------------------------------------------------
     13. CALENDAR TAB RENDERER
     ------------------------------------------------------------------------ */
  renderCalendar() {
    const year = this.calendarDate.getFullYear();
    const month = this.calendarDate.getMonth();
    const activeAccounts = this.getFilteredAccountsByActiveProfile();

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const grid = document.getElementById('calendarDaysGrid');
    if (!grid) return;

    let html = '';

    for (let i = 0; i < firstDay; i++) {
      html += `<div class="cal-day empty"></div>`;
    }

    const todayStr = new Date().toISOString().split('T')[0];

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayAccounts = activeAccounts.filter(a => a.dueDate === dateStr);
      const isToday = dateStr === todayStr;

      let dotsHtml = '';
      dayAccounts.slice(0, 3).forEach(acc => {
        dotsHtml += `<div class="cal-dot ${acc.type}">${this.escapeHtml(acc.title.substring(0, 12))}</div>`;
      });
      if (dayAccounts.length > 3) {
        dotsHtml += `<div class="cal-dot">+${dayAccounts.length - 3} mais</div>`;
      }

      html += `
        <div class="cal-day ${isToday ? 'today' : ''}" onclick="app.showDayDetails('${dateStr}')">
          <span class="cal-day-num">${day}</span>
          <div class="cal-day-dots">${dotsHtml}</div>
        </div>
      `;
    }

    grid.innerHTML = html;
  }

  showDayDetails(dateStr) {
    const activeAccounts = this.getFilteredAccountsByActiveProfile();
    const dayAccounts = activeAccounts.filter(a => a.dueDate === dateStr);
    const panel = document.getElementById('calendarDayDetails');
    const title = document.getElementById('selectedDayTitle');
    const items = document.getElementById('selectedDayItems');

    title.textContent = `Contas do dia ${this.formatDate(dateStr)}`;

    if (dayAccounts.length === 0) {
      items.innerHTML = `<p style="color:var(--text-muted)">Nenhuma conta cadastrada para este dia.</p>`;
    } else {
      items.innerHTML = dayAccounts.map(a => `
        <div class="account-card" style="margin-bottom:8px">
          <div>
            <strong>${this.escapeHtml(a.title)}</strong>
            <div style="font-size:0.8rem; color:var(--text-muted)">${this.escapeHtml(this.getProfileNameById(a.profileId))} • ${this.escapeHtml(a.person || 'Geral')} • ${a.category}</div>
          </div>
          <div class="account-amount ${a.type}">${this.formatCurrency(a.amount)}</div>
        </div>
      `).join('');
    }

    panel.classList.remove('hidden');
  }

  closeDayDetails() {
    document.getElementById('calendarDayDetails')?.classList.add('hidden');
  }

  /* ------------------------------------------------------------------------
     14. BY PERSON VIEW & CHAVE PIX REGISTRY
     ------------------------------------------------------------------------ */
  renderPeople() {
    const grid = document.getElementById('peopleCardsGrid');
    if (!grid) return;

    const activeAccounts = this.getFilteredAccountsByActiveProfile();
    const personMap = {};
    activeAccounts.forEach(a => {
      const p = a.person?.trim() || 'Sem Favorecido';
      if (!personMap[p]) {
        personMap[p] = { pendingPay: 0, paidPay: 0, pendingReceive: 0, count: 0, pixKey: a.pixKey || this.personPixMap[p] || '' };
      }
      personMap[p].count++;
      if (a.pixKey) personMap[p].pixKey = a.pixKey;

      if (a.type === 'pay') {
        if (a.status === 'pending') personMap[p].pendingPay += a.amount;
        else personMap[p].paidPay += a.amount;
      } else if (a.type === 'receive') {
        if (a.status === 'pending') personMap[p].pendingReceive += a.amount;
      }
    });

    const persons = Object.keys(personMap).sort();

    if (persons.length === 0) {
      grid.innerHTML = `<div class="empty-state"><p>Nenhum lançamento por pessoa cadastrado ainda.</p></div>`;
      return;
    }

    grid.innerHTML = persons.map(person => {
      const data = personMap[person];
      const initial = person.charAt(0).toUpperCase();

      return `
        <div class="person-card">
          <div class="person-card-header">
            <div class="person-avatar">${initial}</div>
            <div>
              <div class="person-name">${this.escapeHtml(person)}</div>
              <div class="person-count">${data.count} conta(s) registrada(s)</div>
            </div>
          </div>

          <div class="person-card-body">
            ${data.pixKey ? `
              <div class="person-pix-box">
                <span>🔑 Pix: <strong>${this.escapeHtml(data.pixKey)}</strong></span>
                <button class="btn-subtle" style="font-size:0.75rem; padding:2px 8px" onclick="app.copyPixKey('${this.escapeHtml(data.pixKey)}')"><i data-lucide="copy" style="width:10px"></i> Copiar Pix</button>
              </div>
            ` : `
              <div class="person-pix-box" style="border-style:solid; border-color:var(--border-color); opacity:0.7">
                <span style="color:var(--text-muted)">Sem Chave Pix cadastrada</span>
                <button class="btn-subtle" style="font-size:0.72rem;" onclick="app.promptAddPix('${this.escapeHtml(person)}')">+ Add Pix</button>
              </div>
            `}

            <div class="person-stat-row">
              <span>Total Devido Pendente:</span>
              <strong style="color:var(--danger-color)">${this.formatCurrency(data.pendingPay)}</strong>
            </div>
            <div class="person-stat-row">
              <span>Total Já Pago:</span>
              <strong style="color:var(--primary-color)">${this.formatCurrency(data.paidPay)}</strong>
            </div>
            ${data.pendingReceive > 0 ? `
              <div class="person-stat-row">
                <span>A Receber dessa pessoa:</span>
                <strong style="color:var(--primary-color)">${this.formatCurrency(data.pendingReceive)}</strong>
              </div>
            ` : ''}
          </div>

          <div style="display:flex; gap:8px">
            <button class="btn-secondary" style="flex:1; font-size:0.8rem;" onclick="app.filterListByPerson('${this.escapeHtml(person)}')">
              <i data-lucide="list"></i> Ver Contas
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  promptAddPix(personName) {
    const pix = prompt(`Digite a Chave Pix de ${personName} (CPF, Celular, E-mail ou Aleatória):`);
    if (pix && pix.trim()) {
      this.accounts.forEach(a => {
        if (a.person && a.person.trim() === personName) {
          a.pixKey = pix.trim();
        }
      });
      this.saveCpfAccounts();
      this.render();
      this.showToast(`Chave Pix cadastrada para ${personName}!`);
    }
  }

  filterListByPerson(personName) {
    this.switchTab('list');
    document.getElementById('personListFilter').value = personName;
    this.renderList();
  }

  /* ------------------------------------------------------------------------
     15. CRUD OPERATIONS (ADD / EDIT ACCOUNTS)
     ------------------------------------------------------------------------ */
  openNewModal() {
    document.getElementById('accId').value = '';
    document.getElementById('accTitle').value = '';
    document.getElementById('accPerson').value = '';
    document.getElementById('accPixKey').value = '';
    document.getElementById('accAmount').value = '';
    document.getElementById('accDueDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('accCategory').value = 'Cartão de Terceiros';
    document.getElementById('accStatus').value = 'pending';
    document.getElementById('accNotes').value = '';
    document.getElementById('accIsInstallment').checked = false;
    document.getElementById('accInstallmentCount').value = 2;
    document.getElementById('installmentOptions').classList.add('hidden');

    const memberSelect = document.getElementById('accMember');
    if (memberSelect) {
      if (this.activeProfileId !== 'all') {
        memberSelect.value = this.activeProfileId;
      } else if (this.profiles.length > 0) {
        memberSelect.value = this.profiles[0].id;
      }
    }

    document.getElementById('modalTitle').textContent = 'Cadastrar Nova Conta';
    this.toggleTypeUI();
    this.openModal('accountModal');
  }

  editAccount(id) {
    const acc = this.accounts.find(a => a.id === id);
    if (!acc) return;

    document.getElementById('accId').value = acc.id;
    document.getElementById('accTitle').value = acc.title;
    document.getElementById('accPerson').value = acc.person || '';
    document.getElementById('accPixKey').value = acc.pixKey || '';
    document.getElementById('accAmount').value = acc.amount;
    document.getElementById('accDueDate').value = acc.dueDate;
    document.getElementById('accCategory').value = acc.category || 'Outros';
    document.getElementById('accStatus').value = acc.status;
    document.getElementById('accNotes').value = acc.notes || '';
    document.getElementById('accIsInstallment').checked = false;
    document.getElementById('installmentOptions').classList.add('hidden');

    const memberSelect = document.getElementById('accMember');
    if (memberSelect && acc.profileId) {
      memberSelect.value = acc.profileId;
    }

    const radios = document.getElementsByName('accType');
    radios.forEach(r => r.checked = (r.value === acc.type));
    this.toggleTypeUI();

    document.getElementById('modalTitle').textContent = 'Editar Conta';
    this.openModal('accountModal');
  }

  toggleTypeUI() {
    const selectedType = document.querySelector('input[name="accType"]:checked')?.value || 'pay';
    const payBtn = document.querySelector('.type-btn.pay');
    const receiveBtn = document.querySelector('.type-btn.receive');

    payBtn?.classList.toggle('active', selectedType === 'pay');
    receiveBtn?.classList.toggle('active', selectedType === 'receive');

    const personLabel = document.getElementById('labelAccPerson');
    const installmentLabel = document.getElementById('labelAccInstallment');
    const titleLabel = document.getElementById('labelAccTitle');
    const dueDateLabel = document.getElementById('labelAccDueDate');

    if (selectedType === 'receive') {
      if (titleLabel) titleLabel.textContent = 'Descrição do Valor a Receber (ex: Serviço, Freela, Venda) *';
      if (personLabel) personLabel.innerHTML = '<i data-lucide="user"></i> De quem vou receber? / Nome da Pessoa *';
      if (dueDateLabel) dueDateLabel.textContent = 'Data em que vou receber *';
      if (installmentLabel) installmentLabel.innerHTML = '<strong>Este valor será recebido em parcelas? (ex: 3x, 6x)</strong>';
    } else {
      if (titleLabel) titleLabel.textContent = 'Descrição da Conta a Pagar (ex: Mercado, Cartão) *';
      if (personLabel) personLabel.innerHTML = '<i data-lucide="user"></i> Para quem devo pagar? *';
      if (dueDateLabel) dueDateLabel.textContent = 'Data de Vencimento *';
      if (installmentLabel) installmentLabel.innerHTML = '<strong>Esta compra foi parcelada? (ex: 6x no cartão)</strong>';
    }

    if (window.lucide) lucide.createIcons();
  }

  toggleInstallmentOptions() {
    const isChecked = document.getElementById('accIsInstallment').checked;
    document.getElementById('installmentOptions').classList.toggle('hidden', !isChecked);
  }

  saveAccount(e) {
    e.preventDefault();

    const id = document.getElementById('accId').value;
    const profileId = document.getElementById('accMember')?.value || this.profiles[0]?.id || 'p_titular';
    const title = document.getElementById('accTitle').value.trim();
    const person = document.getElementById('accPerson').value.trim();
    const pixKey = document.getElementById('accPixKey').value.trim();
    const amount = parseFloat(document.getElementById('accAmount').value);
    const dueDate = document.getElementById('accDueDate').value;
    const category = document.getElementById('accCategory').value;
    const status = document.getElementById('accStatus').value;
    const notes = document.getElementById('accNotes').value.trim();
    const type = document.querySelector('input[name="accType"]:checked').value;

    const isInstallment = document.getElementById('accIsInstallment').checked;
    const installmentCount = parseInt(document.getElementById('accInstallmentCount').value) || 2;

    if (!title || isNaN(amount) || !dueDate) {
      alert('Por favor, preencha todos os campos obrigatórios.');
      return;
    }

    if (id) {
      const index = this.accounts.findIndex(a => a.id === id);
      if (index !== -1) {
        this.accounts[index] = {
          ...this.accounts[index],
          profileId, title, person, pixKey, amount, dueDate, category, status, notes, type
        };
      }
    } else {
      if (isInstallment && installmentCount > 1) {
        const installmentAmount = amount / installmentCount;
        const baseDate = new Date(dueDate + 'T00:00:00');

        for (let i = 1; i <= installmentCount; i++) {
          const instDate = new Date(baseDate);
          instDate.setMonth(instDate.getMonth() + (i - 1));
          const instDateStr = instDate.toISOString().split('T')[0];

          this.accounts.push({
            id: Date.now().toString() + i,
            profileId,
            title: `${title} (${i}/${installmentCount})`,
            person,
            pixKey,
            amount: parseFloat(installmentAmount.toFixed(2)),
            dueDate: instDateStr,
            category,
            status: i === 1 ? status : 'pending',
            notes: notes ? `${notes} - Parcela ${i}/${installmentCount}` : `Parcela ${i}/${installmentCount}`,
            type
          });
        }
        this.showToast(`${installmentCount} parcelas geradas com sucesso!`);
      } else {
        this.accounts.push({
          id: Date.now().toString(),
          profileId,
          title, person, pixKey, amount, dueDate, category, status, notes, type
        });
        this.showToast('Conta cadastrada e sincronizada na nuvem!');
      }
    }

    this.saveCpfAccounts();
    this.closeModal('accountModal');
    this.render();
  }

  toggleStatus(id) {
    const acc = this.accounts.find(a => a.id === id);
    if (!acc) return;

    acc.status = (acc.status === 'paid') ? 'pending' : 'paid';
    if (acc.status === 'paid') {
      acc.paidAt = new Date().toISOString().split('T')[0];
      if (window.confetti) {
        confetti({ particleCount: 60, spread: 60, origin: { y: 0.8 } });
      }
      this.showToast('Conta marcada como Concluída/Paga! 🎉');
    }

    this.saveCpfAccounts();
    this.render();
  }

  deleteAccount(id) {
    if (confirm('Tem certeza que deseja excluir esta conta?')) {
      this.accounts = this.accounts.filter(a => a.id !== id);
      this.saveCpfAccounts();
      this.render();
      this.showToast('Conta excluída.');
    }
  }

  /* ------------------------------------------------------------------------
     16. WHATSAPP MESSAGE GENERATOR & REPORTS
     ------------------------------------------------------------------------ */
  openWhatsappModal(id) {
    const acc = this.accounts.find(a => a.id === id);
    if (!acc) return;

    const personName = acc.person || 'Amigo(a)';
    const amountFormatted = this.formatCurrency(acc.amount);
    const dateFormatted = this.formatDate(acc.dueDate);

    let text = `Olá ${personName}! 👋\n\n`;
    text += `Segue a informação sobre a conta:\n`;
    text += `📌 *${acc.title}*\n`;
    text += `💰 Valor: *${amountFormatted}*\n`;
    text += `📅 Data: ${dateFormatted}\n`;
    if (acc.pixKey) text += `🔑 Chave Pix: *${acc.pixKey}*\n`;
    text += `Status: ${acc.status === 'paid' ? '✅ *CONCLUÍDO/PAGO*' : '🟡 *PENDENTE*'}\n\n`;
    text += `Mensagem enviada via App Minhas Contas. 📱`;

    document.getElementById('whatsappMessageText').textContent = text;
    
    const encodedText = encodeURIComponent(text);
    document.getElementById('btnOpenWhatsapp').href = `https://wa.me/?text=${encodedText}`;

    this.openModal('whatsappModal');
  }

  copyWhatsappMessage() {
    const text = document.getElementById('whatsappMessageText').textContent;
    navigator.clipboard.writeText(text).then(() => {
      this.showToast('Texto copiado para a área de transferência!');
    });
  }

  exportPersonReport() {
    this.switchTab('reports');
    const select = document.getElementById('reportTypeSelect');
    if (select) {
      select.value = 'people';
      this.renderReportsTab();
    }
  }

  /* ------------------------------------------------------------------------
     17. BACKUP & RESTORE JSON
     ------------------------------------------------------------------------ */
  exportDataJSON() {
    const exportPayload = {
      cpf: this.activeCpf,
      user: this.activeUser,
      profiles: this.profiles,
      accounts: this.accounts,
      budgetGoal: this.budgetGoal,
      exportedAt: new Date().toISOString()
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportPayload, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `backup_minhas_contas_CPF_${this.activeCpf}_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    this.showToast('Backup exportado com sucesso!');
  }

  importDataJSON(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const imported = JSON.parse(e.target.result);
        if (Array.isArray(imported)) {
          this.accounts = imported;
        } else if (imported && Array.isArray(imported.accounts)) {
          this.accounts = imported.accounts;
          if (Array.isArray(imported.profiles) && imported.profiles.length > 0) {
            this.profiles = imported.profiles;
            this.saveCpfProfiles();
          }
          if (imported.budgetGoal) {
            this.budgetGoal = imported.budgetGoal;
            localStorage.setItem(this.getCpfStorageKey('budget_goal'), this.budgetGoal.toString());
          }
          if (imported.user) {
            this.saveLocalUserData(imported.user);
          }
        } else {
          alert('Arquivo JSON inválido.');
          return;
        }

        this.saveCpfAccounts();
        await this.syncFullDataToCloud();
        this.render();
        this.closeModal('backupModal');
        alert('Backup importado e sincronizado com sucesso!');
      } catch (err) {
        alert('Erro ao ler arquivo de backup.');
      }
    };
    reader.readAsText(file);
  }

  /* ------------------------------------------------------------------------
     18. UTILS & TOASTS
     ------------------------------------------------------------------------ */
  openModal(modalId) {
    if (modalId === 'membersModal') {
      this.renderMembersModal();
    }
    document.getElementById(modalId)?.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  }

  closeModal(modalId) {
    document.getElementById(modalId)?.classList.add('hidden');
  }

  formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
  }

  formatDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  showToast(msg) {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
      background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-main);
      padding: 10px 20px; border-radius: 9999px; box-shadow: var(--shadow-lg);
      z-index: 10000; font-weight: 600; font-size: 0.9rem; animation: fadeIn 0.3s ease;
    `;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }
}

// Global App Instance
const app = new AccountsApp();
