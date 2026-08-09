/* ==========================================================================
   MINHAS CONTAS - APPLICATION LOGIC
   ========================================================================== */

class AccountsApp {
  constructor() {
    this.USERS_KEY = 'minhas_contas_users_v2';
    this.ACTIVE_USER_KEY = 'minhas_contas_active_user_v2';
    this.PIN_KEY = 'minhas_contas_app_pin_v1';
    this.THEME_KEY = 'minhas_contas_app_theme_v1';

    // State
    this.users = [];
    this.currentUser = null;
    this.accounts = [];
    this.personPixMap = {};
    this.selectedAccountIds = new Set();

    this.currentTab = 'dashboard';
    this.selectedDate = new Date();
    this.calendarDate = new Date();
    this.pinCode = localStorage.getItem(this.PIN_KEY) || null;
    this.enteredPin = '';
    this.deferredPrompt = null;
    this.categoryChart = null;

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
    this.loadUsers();
    this.loadAuthSession();
    this.initTheme();
    this.initPwa();
    this.setupEventListeners();
    this.render();

    if (window.lucide) {
      lucide.createIcons();
    }
  }

  /* ------------------------------------------------------------------------
     1. USER AUTHENTICATION & DATA ISOLATION
     ------------------------------------------------------------------------ */
  loadUsers() {
    const raw = localStorage.getItem(this.USERS_KEY);
    if (raw) {
      try { this.users = JSON.parse(raw); } catch (e) { this.users = []; }
    } else {
      this.users = [];
    }
  }

  loadAuthSession() {
    const raw = localStorage.getItem(this.ACTIVE_USER_KEY);
    if (raw) {
      try {
        this.currentUser = JSON.parse(raw);
        this.loadData();
      } catch (e) {
        this.currentUser = null;
      }
    } else {
      this.currentUser = null;
    }
  }

  getStorageKey() {
    const userId = this.currentUser ? this.currentUser.id : 'guest';
    return `minhas_contas_data_user_${userId}`;
  }

  switchAuthTab(tab) {
    const loginBtn = document.getElementById('tabBtnLogin');
    const regBtn = document.getElementById('tabBtnRegister');
    const loginForm = document.getElementById('loginForm');
    const regForm = document.getElementById('registerForm');

    if (tab === 'register') {
      loginBtn?.classList.remove('active');
      regBtn?.classList.add('active');
      loginForm?.classList.add('hidden');
      regForm?.classList.remove('hidden');
    } else {
      regBtn?.classList.remove('active');
      loginBtn?.classList.add('active');
      regForm?.classList.add('hidden');
      loginForm?.classList.remove('hidden');
    }
  }

  handleLogin(e) {
    e.preventDefault();
    const usernameInput = document.getElementById('loginUsername').value.trim().toLowerCase();
    const passwordInput = document.getElementById('loginPassword').value.trim();

    const foundUser = this.users.find(u => 
      (u.username.toLowerCase() === usernameInput || u.email?.toLowerCase() === usernameInput) && 
      u.password === passwordInput
    );

    if (!foundUser) {
      alert('Usuário ou senha incorretos. Por favor, verifique seus dados.');
      return;
    }

    this.currentUser = foundUser;
    localStorage.setItem(this.ACTIVE_USER_KEY, JSON.stringify(foundUser));
    this.loadData();
    this.render();
    this.showToast(`🎉 Bem-vindo(a) de volta, ${foundUser.name}!`);
  }

  handleRegister(e) {
    e.preventDefault();
    const name = document.getElementById('regName').value.trim();
    const username = document.getElementById('regUsername').value.trim().toLowerCase();
    const password = document.getElementById('regPassword').value.trim();

    if (!name || !username || !password) {
      alert('Por favor, preencha todos os campos do cadastro.');
      return;
    }

    const exists = this.users.some(u => u.username.toLowerCase() === username);
    if (exists) {
      alert('Este usuário/e-mail já está cadastrado! Faça login ou escolha outro nome de usuário.');
      return;
    }

    const newUser = {
      id: 'user_' + Date.now(),
      name,
      username,
      password,
      createdAt: new Date().toISOString()
    };

    this.users.push(newUser);
    localStorage.setItem(this.USERS_KEY, JSON.stringify(this.users));

    this.currentUser = newUser;
    localStorage.setItem(this.ACTIVE_USER_KEY, JSON.stringify(newUser));

    // New user starts 100% CLEAN/EMPTY!
    this.accounts = [];
    this.saveData();

    this.render();
    this.showToast(`✨ Conta criada com sucesso! Seja bem-vindo(a), ${newUser.name}!`);
  }

  handleGuestAccess() {
    const guestUser = { id: 'guest', name: 'Convidado(a)', username: 'guest' };
    this.currentUser = guestUser;
    localStorage.setItem(this.ACTIVE_USER_KEY, JSON.stringify(guestUser));
    this.loadData();
    this.render();
    this.showToast('Entrando no modo Convidado(a).');
  }

  logoutUser() {
    if (confirm('Deseja sair da sua conta?')) {
      this.currentUser = null;
      localStorage.removeItem(this.ACTIVE_USER_KEY);
      this.selectedAccountIds.clear();
      this.render();
      this.showToast('Você saiu da sua conta.');
    }
  }

  loadData() {
    if (!this.currentUser) return;
    const key = this.getStorageKey();
    const raw = localStorage.getItem(key);
    if (raw) {
      try {
        this.accounts = JSON.parse(raw);
      } catch (e) {
        this.accounts = [];
      }
    } else {
      this.accounts = [];
      this.saveData();
    }

    this.rebuildPixMap();
  }

  saveData() {
    localStorage.setItem(this.getStorageKey(), JSON.stringify(this.accounts));
    this.rebuildPixMap();
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
    return [];
  }

  clearDemoAccountsPrompt() {
    if (confirm('Deseja zerar todas as contas de teste e iniciar com a sua lista 100% limpa?')) {
      this.accounts = [];
      this.saveData();
      this.render();
      this.closeModal('backupModal');
      this.showToast('Contas zeradas! Agora você pode cadastrar suas contas reais.');
    }
  }

  clearAllData() {
    this.clearDemoAccountsPrompt();
  }

  /* ------------------------------------------------------------------------
     2. THEME & PIN LOCK & PWA
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

  togglePinLock() {
    if (this.pinCode) {
      if (confirm('Deseja REMOVER a senha de proteção por PIN?')) {
        this.pinCode = null;
        localStorage.removeItem(this.PIN_KEY);
        this.showToast('Senha de PIN removida.');
      }
    } else {
      const pin = prompt('Digite um PIN de 4 dígitos para proteger o app:');
      if (pin && /^\d{4}$/.test(pin)) {
        this.pinCode = pin;
        localStorage.setItem(this.PIN_KEY, pin);
        this.showToast('Senha de PIN cadastrada com sucesso!');
      } else if (pin) {
        alert('O PIN deve conter exatamente 4 números!');
      }
    }
  }

  enterPin(num) {
    if (this.enteredPin.length < 4) {
      this.enteredPin += num;
      this.updatePinDots();
      if (this.enteredPin.length === 4) {
        setTimeout(() => this.checkPin(), 100);
      }
    }
  }

  clearPin() {
    this.enteredPin = '';
    this.updatePinDots();
  }

  updatePinDots() {
    const dots = document.querySelectorAll('.pin-dots .dot');
    dots.forEach((dot, index) => {
      if (index < this.enteredPin.length) {
        dot.classList.add('filled');
      } else {
        dot.classList.remove('filled');
      }
    });
  }

  checkPin() {
    if (this.pinCode && this.enteredPin === this.pinCode) {
      document.getElementById('pinOverlay').classList.add('hidden');
      this.enteredPin = '';
    } else if (this.pinCode) {
      alert('PIN incorreto! Tente novamente.');
      this.clearPin();
    }
  }

  initPwa() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(err => console.log('SW Registration error:', err));
    }

    // Android / Desktop auto-prompt listener
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

    // iOS (iPhone / iPad) auto-prompt detection
    const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isInStandaloneMode = ('standalone' in window.navigator) && (window.navigator.standalone);

    if (isIos && !isInStandaloneMode) {
      const iosBanner = document.getElementById('iosInstallBanner');
      if (iosBanner) iosBanner.classList.remove('hidden');
    }
  }

  closeInstallBanner() {
    const banner = document.getElementById('installBanner');
    if (banner) banner.classList.add('hidden');
  }

  /* ------------------------------------------------------------------------
     3. NAVIGATION & PROFILE UI
     ------------------------------------------------------------------------ */
  setupEventListeners() {
    if (this.pinCode) {
      document.getElementById('pinOverlay').classList.remove('hidden');
    }
  }

  renderProfileSelect() {
    const select = document.getElementById('userProfileSelect');
    if (select) {
      select.innerHTML = this.profiles.map(p => 
        `<option value="${p.id}" ${p.id === this.activeProfileId ? 'selected' : ''}>👤 ${this.escapeHtml(p.name)}</option>`
      ).join('');
    }
  }

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

  /* ------------------------------------------------------------------------
     4. RENDER PIPELINE
     ------------------------------------------------------------------------ */
  render() {
    const authOverlay = document.getElementById('authOverlay');
    const userBadge = document.getElementById('currentUserNameDisplay');

    if (!this.currentUser) {
      document.body.classList.add('not-logged-in');
      if (authOverlay) authOverlay.classList.remove('hidden');
      return;
    } else {
      document.body.classList.remove('not-logged-in');
      if (authOverlay) authOverlay.classList.add('hidden');
      if (userBadge) userBadge.textContent = `👤 ${this.currentUser.name}`;
    }

    this.updateMonthTitle();
    this.populatePeopleSelects();
    this.populateCategorySelect();

    if (this.currentTab === 'dashboard') {
      this.renderDashboard();
    } else if (this.currentTab === 'list') {
      this.renderList();
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
    const persons = Array.from(new Set(this.accounts.map(a => a.person?.trim()).filter(Boolean))).sort();

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
    const categories = Array.from(new Set(this.accounts.map(a => a.category).filter(Boolean))).sort();
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
     5. DASHBOARD RENDERER
     ------------------------------------------------------------------------ */
  renderDashboard() {
    const curYear = this.selectedDate.getFullYear();
    const curMonth = this.selectedDate.getMonth();
    const selectedPerson = document.getElementById('dashboardPersonFilter')?.value || 'all';

    const monthAccounts = this.accounts.filter(acc => {
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
        if (acc.status === 'pending') {
          toPay += acc.amount;
          toPayCount++;
        } else if (acc.status === 'paid') {
          alreadyPaid += acc.amount;
        }
      } else if (acc.type === 'receive') {
        if (acc.status === 'pending') {
          toReceive += acc.amount;
          toReceiveCount++;
        }
      }
    });

    const balance = toReceive - toPay;

    document.getElementById('kpiToPay').textContent = this.formatCurrency(toPay);
    document.getElementById('kpiToPaySub').textContent = `${toPayCount} conta(s) pendente(s)`;

    document.getElementById('kpiToReceive').textContent = this.formatCurrency(toReceive);
    document.getElementById('kpiToReceiveSub').textContent = `${toReceiveCount} conta(s) a receber`;

    document.getElementById('kpiBalance').textContent = this.formatCurrency(balance);
    document.getElementById('kpiAlreadyPaid').textContent = this.formatCurrency(alreadyPaid);

    const todayStr = new Date().toISOString().split('T')[0];
    const overdueAccounts = this.accounts.filter(a => a.type === 'pay' && a.status === 'pending' && a.dueDate < todayStr);
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
          return `
            <div class="upcoming-item ${statusClass}" onclick="app.editAccount('${a.id}')">
              <div>
                <div class="upcoming-title">${this.escapeHtml(a.title)}</div>
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
     6. LIST TAB RENDERER (ALL ACCOUNTS & BATCH SELECTION)
     ------------------------------------------------------------------------ */
  renderList() {
    const search = document.getElementById('searchInput')?.value.toLowerCase() || '';
    const status = document.getElementById('statusFilter')?.value || 'all';
    const type = document.getElementById('typeFilter')?.value || 'all';
    const person = document.getElementById('personListFilter')?.value || 'all';
    const category = document.getElementById('categoryFilter')?.value || 'all';

    const todayStr = new Date().toISOString().split('T')[0];

    const filtered = this.accounts.filter(a => {
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

    // Update Batch Actions Bar State
    const batchBar = document.getElementById('batchActionBar');
    const selectedCountBadge = document.getElementById('selectedCountText');
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');

    if (batchBar && selectedCountBadge) {
      const selSize = this.selectedAccountIds.size;
      if (selSize > 0) {
        batchBar.classList.remove('hidden');
        selectedCountBadge.textContent = `${selSize} selecionada(s)`;
        if (selectAllCheckbox) {
          selectAllCheckbox.checked = (filtered.length > 0 && filtered.every(a => this.selectedAccountIds.has(a.id)));
        }
      } else {
        batchBar.classList.add('hidden');
        if (selectAllCheckbox) selectAllCheckbox.checked = false;
      }
    }

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
      const isSelected = this.selectedAccountIds.has(a.id);
      
      let statusBadgeClass = 'status-badge-pending';
      let statusBadgeText = a.type === 'pay' ? '🟡 Pendente' : '🟡 A Receber';
      if (a.status === 'paid') {
        statusBadgeClass = 'status-badge-paid';
        statusBadgeText = a.type === 'pay' ? '🟢 Paga' : '🟢 Recebida';
      } else if (isOverdue) {
        statusBadgeClass = 'status-badge-overdue';
        statusBadgeText = '🔴 Atrasada';
      }

      return `
        <div class="account-card ${a.status === 'paid' ? 'status-paid' : ''} ${isSelected ? 'selected' : ''}">
          <div class="acc-checkbox-wrapper">
            <input type="checkbox" class="acc-checkbox" ${isSelected ? 'checked' : ''} onchange="app.toggleSelectAccount('${a.id}')" title="Selecionar para apagar ou concluir em lote">
          </div>

          <div class="type-indicator ${a.type}">
            <i data-lucide="${a.type === 'pay' ? 'arrow-down-right' : 'arrow-up-right'}"></i>
          </div>

          <div class="account-info">
            <div class="account-title-row">
              <span class="account-title">${this.escapeHtml(a.title)}</span>
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

            <button class="icon-btn-sm" onclick="app.openWhatsappModal('${a.id}')" title="Enviar Mensagem WhatsApp">
              <i data-lucide="message-square" style="color:#22c55e"></i>
            </button>

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

  /* Batch Operations */
  toggleSelectAccount(id) {
    if (this.selectedAccountIds.has(id)) {
      this.selectedAccountIds.delete(id);
    } else {
      this.selectedAccountIds.add(id);
    }
    this.renderList();
  }

  toggleSelectAll(isChecked) {
    const search = document.getElementById('searchInput')?.value.toLowerCase() || '';
    const status = document.getElementById('statusFilter')?.value || 'all';
    const type = document.getElementById('typeFilter')?.value || 'all';
    const person = document.getElementById('personListFilter')?.value || 'all';
    const category = document.getElementById('categoryFilter')?.value || 'all';
    const todayStr = new Date().toISOString().split('T')[0];

    const filtered = this.accounts.filter(a => {
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

    if (isChecked) {
      filtered.forEach(a => this.selectedAccountIds.add(a.id));
    } else {
      filtered.forEach(a => this.selectedAccountIds.delete(a.id));
    }
    this.renderList();
  }

  clearSelection() {
    this.selectedAccountIds.clear();
    this.renderList();
  }

  deleteSelectedAccounts() {
    const count = this.selectedAccountIds.size;
    if (count === 0) {
      this.showToast('Nenhuma conta selecionada para apagar.');
      return;
    }

    if (confirm(`Tem certeza que deseja APAGAR as ${count} conta(s) selecionada(s)? Esta ação não pode ser desfeita.`)) {
      this.accounts = this.accounts.filter(a => !this.selectedAccountIds.has(a.id));
      this.selectedAccountIds.clear();
      this.saveData();
      this.render();
      this.showToast(`🗑️ ${count} conta(s) apagada(s) com sucesso!`);
    }
  }

  markSelectedAsPaid() {
    const count = this.selectedAccountIds.size;
    if (count === 0) {
      this.showToast('Nenhuma conta selecionada.');
      return;
    }

    const todayStr = new Date().toISOString().split('T')[0];
    this.accounts.forEach(a => {
      if (this.selectedAccountIds.has(a.id)) {
        a.status = 'paid';
        a.paidAt = todayStr;
      }
    });

    if (window.confetti) {
      confetti({ particleCount: 60, spread: 60, origin: { y: 0.8 } });
    }

    this.selectedAccountIds.clear();
    this.saveData();
    this.render();
    this.showToast(`🟢 ${count} conta(s) marcada(s) como concluída(s)! 🎉`);
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
     7. CALENDAR TAB RENDERER
     ------------------------------------------------------------------------ */
  renderCalendar() {
    const year = this.calendarDate.getFullYear();
    const month = this.calendarDate.getMonth();

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
      const dayAccounts = this.accounts.filter(a => a.dueDate === dateStr);
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
    const dayAccounts = this.accounts.filter(a => a.dueDate === dateStr);
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
            <div style="font-size:0.8rem; color:var(--text-muted)">${this.escapeHtml(a.person || 'Geral')} • ${a.category}</div>
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
     8. BY PERSON VIEW & CHAVE PIX REGISTRY
     ------------------------------------------------------------------------ */
  renderPeople() {
    const grid = document.getElementById('peopleCardsGrid');
    if (!grid) return;

    const personMap = {};
    this.accounts.forEach(a => {
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
      this.saveData();
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
     9. CRUD OPERATIONS & DYNAMIC TYPE LABELS
     ------------------------------------------------------------------------ */
  openNewModal() {
    document.getElementById('accId').value = '';
    document.getElementById('accTitle').value = '';
    document.getElementById('accPerson').value = '';
    document.getElementById('accPixKey').value = '';
    document.getElementById('accAmount').value = '';
    document.getElementById('accDueDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('accCategory').value = 'Salário/Renda';
    document.getElementById('accStatus').value = 'pending';
    document.getElementById('accNotes').value = '';
    document.getElementById('accIsInstallment').checked = false;
    document.getElementById('accInstallmentCount').value = 2;
    document.getElementById('installmentOptions').classList.add('hidden');

    document.getElementById('modalTitle').textContent = 'Cadastrar Nova Conta';
    this.toggleTypeUI();
    this.updateInstallmentPreview();
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

    const radios = document.getElementsByName('accType');
    radios.forEach(r => r.checked = (r.value === acc.type));
    this.toggleTypeUI();
    this.updateInstallmentPreview();

    document.getElementById('modalTitle').textContent = 'Editar Conta';
    this.openModal('accountModal');
  }

  toggleTypeUI() {
    const selectedType = document.querySelector('input[name="accType"]:checked')?.value || 'pay';
    const payBtn = document.querySelector('.type-btn.pay');
    const receiveBtn = document.querySelector('.type-btn.receive');

    payBtn?.classList.toggle('active', selectedType === 'pay');
    receiveBtn?.classList.toggle('active', selectedType === 'receive');

    // Dynamic labels for Pagar vs Receber
    const personLabel = document.getElementById('labelAccPerson');
    const installmentLabel = document.getElementById('labelAccInstallment');
    const titleLabel = document.getElementById('labelAccTitle');
    const dueDateLabel = document.getElementById('labelAccDueDate');
    const amountLabel = document.getElementById('labelAccAmount');
    const amountNote = document.getElementById('amountHelpNote');

    if (selectedType === 'receive') {
      if (titleLabel) titleLabel.textContent = 'Descrição do Valor a Receber (ex: Serviço, Freela, Venda) *';
      if (personLabel) personLabel.innerHTML = '<i data-lucide="user"></i> De quem vou receber? / Nome da Pessoa *';
      if (dueDateLabel) dueDateLabel.textContent = 'Data em que vou receber *';
      if (amountLabel) amountLabel.innerHTML = '<i data-lucide="dollar-sign"></i> Valor Total a Receber (R$) *';
      if (amountNote) amountNote.innerHTML = '💡 Digite o <strong>VALOR TOTAL</strong> a receber (mesmo se for em parcelas).';
      if (installmentLabel) installmentLabel.innerHTML = '<strong>Este valor será recebido em parcelas? (ex: 3x, 6x)</strong>';
    } else {
      if (titleLabel) titleLabel.textContent = 'Descrição da Conta a Pagar (ex: Mercado, Cartão) *';
      if (personLabel) personLabel.innerHTML = '<i data-lucide="user"></i> Para quem devo pagar? *';
      if (dueDateLabel) dueDateLabel.textContent = 'Data de Vencimento *';
      if (amountLabel) amountLabel.innerHTML = '<i data-lucide="dollar-sign"></i> Valor Total a Pagar (R$) *';
      if (amountNote) amountNote.innerHTML = '💡 Digite o <strong>VALOR TOTAL</strong> da compra/despesa.';
      if (installmentLabel) installmentLabel.innerHTML = '<strong>Esta compra foi parcelada? (ex: 6x no cartão)</strong>';
    }

    this.updateInstallmentPreview();
    if (window.lucide) lucide.createIcons();
  }

  toggleInstallmentOptions() {
    const isChecked = document.getElementById('accIsInstallment').checked;
    document.getElementById('installmentOptions').classList.toggle('hidden', !isChecked);
    this.updateInstallmentPreview();
  }

  updateInstallmentPreview() {
    const amountInput = document.getElementById('accAmount');
    const countInput = document.getElementById('accInstallmentCount');
    const isInstallment = document.getElementById('accIsInstallment')?.checked;
    const previewBox = document.getElementById('installmentPreview');

    if (!previewBox) return;

    const amount = parseFloat(amountInput?.value) || 0;
    const count = parseInt(countInput?.value) || 2;

    if (isInstallment && amount > 0 && count >= 2) {
      const instVal = (amount / count).toFixed(2);
      const formattedInst = this.formatCurrency(parseFloat(instVal));
      const formattedTotal = this.formatCurrency(amount);

      previewBox.innerHTML = `✨ <strong>${count} parcelas</strong> de <strong>${formattedInst}</strong> por mês (Valor Total: ${formattedTotal})`;
      previewBox.classList.remove('hidden');
    } else {
      previewBox.classList.add('hidden');
      previewBox.innerHTML = '';
    }
  }

  saveAccount(e) {
    e.preventDefault();

    const id = document.getElementById('accId').value;
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
          title, person, pixKey, amount, dueDate, category, status, notes, type
        };
      }
    } else {
      if (isInstallment && installmentCount > 1) {
        const baseInstallment = Math.floor((amount / installmentCount) * 100) / 100;
        let remainderCents = Math.round((amount - (baseInstallment * installmentCount)) * 100);
        const baseDate = new Date(dueDate + 'T00:00:00');

        for (let i = 1; i <= installmentCount; i++) {
          const instDate = new Date(baseDate);
          instDate.setMonth(instDate.getMonth() + (i - 1));
          const instDateStr = instDate.toISOString().split('T')[0];

          let currentAmount = baseInstallment;
          if (remainderCents > 0) {
            currentAmount = parseFloat((currentAmount + 0.01).toFixed(2));
            remainderCents--;
          }

          this.accounts.push({
            id: Date.now().toString() + '_' + i,
            title: `${title} (${i}/${installmentCount})`,
            person,
            pixKey,
            amount: currentAmount,
            dueDate: instDateStr,
            category,
            status: i === 1 ? status : 'pending',
            notes: notes ? `${notes} - Parcela ${i}/${installmentCount}` : `Parcela ${i}/${installmentCount}`,
            type
          });
        }
        const instForm = this.formatCurrency(baseInstallment);
        const totalForm = this.formatCurrency(amount);
        this.showToast(`🎉 ${installmentCount} parcelas de ~${instForm} geradas com sucesso! (Total: ${totalForm})`);
      } else {
        this.accounts.push({
          id: Date.now().toString(),
          title, person, pixKey, amount, dueDate, category, status, notes, type
        });
        this.showToast('Conta cadastrada com sucesso!');
      }
    }

    this.saveData();
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
      this.showToast('Conta marcada como Concluída/Recebida! 🎉');
    }

    this.saveData();
    this.render();
  }

  deleteAccount(id) {
    if (confirm('Tem certeza que deseja excluir esta conta?')) {
      this.accounts = this.accounts.filter(a => a.id !== id);
      this.saveData();
      this.render();
      this.showToast('Conta excluída.');
    }
  }

  /* ------------------------------------------------------------------------
     10. WHATSAPP MESSAGE GENERATOR & REPORTS
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
    text += `Status: ${acc.status === 'paid' ? '✅ *CONCLUÍDO/RECEBIDO*' : '🟡 *PENDENTE*'}\n\n`;
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
    const persons = Array.from(new Set(this.accounts.map(a => a.person?.trim()).filter(Boolean))).sort();
    if (persons.length === 0) {
      alert('Nenhuma pessoa registrada para gerar extrato.');
      return;
    }

    const selectedPerson = prompt(`Digite o nome da pessoa para gerar o extrato (Opções: ${persons.join(', ')}):`, persons[0]);
    if (!selectedPerson) return;

    const personAccounts = this.accounts.filter(a => a.person === selectedPerson);
    const totalPending = personAccounts.filter(a => a.type === 'pay' && a.status === 'pending').reduce((sum, a) => sum + a.amount, 0);

    let html = `
      <div style="font-family: sans-serif; padding: 10px;">
        <h2 style="color: #10b981; margin-bottom: 4px;">Extrato de Prestação de Contas</h2>
        <h3 style="margin-bottom: 16px;">Favorecido/Pessoa: <strong>${this.escapeHtml(selectedPerson)}</strong></h3>
        <p style="color: #64748b; font-size: 0.9rem; margin-bottom: 20px;">Gerado em ${new Date().toLocaleDateString('pt-BR')}</p>

        <table style="width:100%; border-collapse: collapse; margin-bottom: 20px;">
          <thead>
            <tr style="background:#0f172a; color:white; text-align:left;">
              <th style="padding:10px; border:1px solid #334155;">Descrição</th>
              <th style="padding:10px; border:1px solid #334155;">Vencimento</th>
              <th style="padding:10px; border:1px solid #334155;">Valor</th>
              <th style="padding:10px; border:1px solid #334155;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${personAccounts.map(a => `
              <tr style="border-bottom:1px solid #e2e8f0;">
                <td style="padding:10px;">${this.escapeHtml(a.title)}</td>
                <td style="padding:10px;">${this.formatDate(a.dueDate)}</td>
                <td style="padding:10px; font-weight:bold; color:${a.type==='pay'?'#f43f5e':'#10b981'}">${this.formatCurrency(a.amount)}</td>
                <td style="padding:10px;">${a.status === 'paid' ? '🟢 Concluída' : '🟡 Pendente'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div style="background:#1e293b; color:white; padding:16px; border-radius:8px; text-align:right;">
          <span style="font-size:1.1rem">Total Pendente a Pagar para ${this.escapeHtml(selectedPerson)}: <strong style="color:#f43f5e; font-size:1.3rem">${this.formatCurrency(totalPending)}</strong></span>
        </div>
      </div>
    `;

    document.getElementById('reportPrintArea').innerHTML = html;
    this.openModal('reportModal');
  }

  /* ------------------------------------------------------------------------
     11. BACKUP & RESTORE JSON
     ------------------------------------------------------------------------ */
  exportDataJSON() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this.accounts, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `backup_minhas_contas_${this.activeProfileId}_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    this.showToast('Backup exportado com sucesso!');
  }

  importDataJSON(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importedData = JSON.parse(e.target.result);
        if (Array.isArray(importedData)) {
          this.accounts = importedData;
          this.saveData();
          this.render();
          this.closeModal('backupModal');
          alert('Backup importado com sucesso!');
        } else {
          alert('Arquivo JSON inválido.');
        }
      } catch (err) {
        alert('Erro ao ler arquivo de backup.');
      }
    };
    reader.readAsText(file);
  }

  /* ------------------------------------------------------------------------
     12. UTILS & TOASTS
     ------------------------------------------------------------------------ */
  openModal(modalId) {
    document.getElementById(modalId)?.classList.remove('hidden');
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
