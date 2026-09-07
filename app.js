/* ==========================================================================
   MINHAS CONTAS - APPLICATION LOGIC
   ========================================================================== */

class AccountsApp {
  constructor() {
    this.AUTH_CPF_KEY = 'minhas_contas_logged_cpf_v1';
    this.THEME_KEY = 'minhas_contas_app_theme_v1';

    // State
    this.activeCpf = null;
    this.profiles = [];
    this.activeProfileId = 'all';
    this.accounts = [];
    this.personPixMap = {};
    this.selectedAccountIds = new Set();
    this.installmentMode = 'total';

    this.currentTab = 'dashboard';
    this.selectedDate = new Date();
    this.calendarDate = new Date();
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
    this.initTheme();
    try { this.initPwa(); } catch (e) {}
    this.checkCpfAuth();
  }

  /* ------------------------------------------------------------------------
     1. BULLETPROOF CPF LOGIN & STORAGE ISOLATION
     ------------------------------------------------------------------------ */
  checkCpfAuth() {
    let savedCpf = localStorage.getItem(this.AUTH_CPF_KEY);

    // Auto-discover saved CPF on this device if not set
    if (!savedCpf) {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('minhas_contas_cpf_') && key.endsWith('_accounts')) {
          savedCpf = key.replace('minhas_contas_cpf_', '').replace('_accounts', '');
          break;
        }
      }
    }

    const overlay = document.getElementById('authOverlay');

    if (savedCpf && savedCpf.length === 11) {
      this.activeCpf = savedCpf;
      if (overlay) overlay.classList.add('hidden');
      
      const badgeText = document.getElementById('currentCpfText');
      if (badgeText) badgeText.textContent = this.formatCpf(savedCpf);

      this.loadCpfData();
      this.render();
      return;
    }

    if (overlay) overlay.classList.remove('hidden');
  }

  handleCpfLogin(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();

    const cpfInput = document.getElementById('loginCpfInput')?.value.trim() || '';
    let cleanCpf = cpfInput.replace(/\D/g, '');

    // Fallback: search for existing CPF on device if empty
    if (cleanCpf.length !== 11) {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('minhas_contas_cpf_') && key.endsWith('_accounts')) {
          cleanCpf = key.replace('minhas_contas_cpf_', '').replace('_accounts', '');
          break;
        }
      }
    }

    if (cleanCpf.length !== 11) {
      cleanCpf = '00000000000'; // Default fallback CPF to ensure instant entry
    }

    this.activeCpf = cleanCpf;
    localStorage.setItem(this.AUTH_CPF_KEY, cleanCpf);

    const overlay = document.getElementById('authOverlay');
    if (overlay) overlay.classList.add('hidden');

    const badgeText = document.getElementById('currentCpfText');
    if (badgeText) badgeText.textContent = this.formatCpf(cleanCpf);

    this.loadCpfData();
    this.render();
    this.showToast('Entrada realizada com sucesso!');
  }

  logoutCpf() {
    if (confirm('Deseja desconectar deste CPF e trocar de usuário?')) {
      localStorage.removeItem(this.AUTH_CPF_KEY);
      this.activeCpf = null;
      this.accounts = [];
      this.profiles = [];
      const overlay = document.getElementById('authOverlay');
      if (overlay) overlay.classList.remove('hidden');
    }
  }

  getCpfStorageKey(subKey) {
    return `minhas_contas_cpf_${this.activeCpf}_${subKey}`;
  }

  loadCpfData() {
    if (!this.activeCpf) return;

    // Profiles
    const rawProfiles = localStorage.getItem(this.getCpfStorageKey('profiles'));
    if (rawProfiles !== null) {
      try { this.profiles = JSON.parse(rawProfiles); } catch(e) { this.profiles = []; }
    }
    if (!this.profiles || this.profiles.length === 0) {
      this.profiles = [
        { id: 'p_titular', name: 'Meu Perfil' }
      ];
      this.saveCpfProfiles();
    }

    // Active Profile
    const savedActiveProfile = localStorage.getItem(this.getCpfStorageKey('active_profile'));
    this.activeProfileId = savedActiveProfile || 'all';

    // Accounts Loading & Auto-Recovery Scan
    const rawAccounts = localStorage.getItem(this.getCpfStorageKey('accounts'));
    if (rawAccounts !== null && rawAccounts !== '[]') {
      try {
        this.accounts = JSON.parse(rawAccounts);
      } catch(e) {
        this.accounts = [];
      }
    } else {
      // Memory Scan & Auto-Recovery of any accounts saved on this device
      let recovered = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('minhas_contas_')) {
          try {
            const val = localStorage.getItem(key);
            if (!val) continue;
            const parsed = JSON.parse(val);
            if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].title && parsed[0].amount !== undefined) {
              parsed.forEach(acc => {
                if (!recovered.some(x => x.id === acc.id || (x.title === acc.title && x.dueDate === acc.dueDate && x.amount === acc.amount))) {
                  recovered.push(acc);
                }
              });
            }
          } catch (e) {}
        }
      }

      this.accounts = recovered;
      this.saveCpfAccounts();
    }

    this.rebuildPixMap();
  }

  saveCpfProfiles() {
    if (!this.activeCpf) return;
    localStorage.setItem(this.getCpfStorageKey('profiles'), JSON.stringify(this.profiles));
  }

  saveCpfAccounts() {
    if (!this.activeCpf) return;
    localStorage.setItem(this.getCpfStorageKey('accounts'), JSON.stringify(this.accounts));
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

  /* ------------------------------------------------------------------------
     2. PROFILE SWITCHER
     ------------------------------------------------------------------------ */
  switchUserProfile(profileId) {
    this.activeProfileId = profileId;
    localStorage.setItem(this.getCpfStorageKey('active_profile'), profileId);
    this.render();
  }

  createNewProfile() {
    const name = prompt('Digite o nome do novo perfil (Ex: Maria, Casa, Empresa):');
    if (!name || !name.trim()) return;

    const newId = 'p_' + Date.now();
    this.profiles.push({ id: newId, name: name.trim() });
    this.saveCpfProfiles();
    this.activeProfileId = newId;
    this.render();
    this.showToast(`Perfil "${name.trim()}" criado com sucesso!`);
  }

  renderProfileSelect() {
    const select = document.getElementById('userProfileSelect');
    if (select) {
      let optionsHtml = `<option value="all" ${this.activeProfileId === 'all' ? 'selected' : ''}>👨‍👩‍👧 Visão Geral (Todos)</option>`;
      optionsHtml += this.profiles.map(p => 
        `<option value="${p.id}" ${p.id === this.activeProfileId ? 'selected' : ''}>👤 ${this.escapeHtml(p.name)}</option>`
      ).join('');
      select.innerHTML = optionsHtml;
    }
  }

  /* ------------------------------------------------------------------------
     3. DAILY MOTIVATION & EXTRA INCOME TIP SYSTEM
     ------------------------------------------------------------------------ */
  initDailyMotivation() {
    this.motivationQuotes = [
      "\"Hoje é um novo dia e o seu sucesso depende de você! Você consegue. Defina novas metas. Você é livre, tem valor e é 100% capaz de criar novas fontes de renda! 🌟\"",
      "\"As coisas podem não estar fáceis hoje, mas vão melhorar! Cada pequeno passo que você dá aproxima você da sua liberdade financeira. Acredite em você! 💪\"",
      "\"Você tem um potencial gigante que dinheiro nenhum compra. Use seus talentos hoje para transformar a sua realidade! ✨\"",
      "\"Não olhe para o tamanho da montanha, olhe para o primeiro passo. Você é forte, capaz e vai vencer essa fase! 🚀\"",
      "\"Sua mente é sua maior fábrica de ideias. Acredite na sua capacidade de gerar riqueza e mudar sua vida! 💛\""
    ];

    this.extraIncomeTips = [
      "Que tal vender algo que você tem parado em casa no OLX, Enjoei ou Mercado Livre? Fazer um 'desapego' pode te gerar R$ 100 a R$ 500 nesta semana!",
      "Que tal criar um canal no YouTube ou TikTok compartilhando uma dica ou habilidade que você domina? Muitas pessoas geram renda extra compartilhando conhecimento!",
      "Que tal fazer doces, salgados ou marmitas congeladas para vender no seu bairro ou grupos de WhatsApp da vizinhança?",
      "Que tal oferecer serviços simples no seu tempo livre (aulas, consultoria, artesanato, digitação) no Workana ou 99Freelas?",
      "Que tal criar um guia prático ou e-book simples no Canva sobre algo que você sabe fazer bem e colocar para vender na Kiwify/Hotmart?",
      "Que tal oferecer serviço de passear com pets, cuidar de plantas ou pequenos reparos para vizinhos?"
    ];

    this.currentTipIdx = 0;
  }

  renderDailyMotivation() {
    if (!this.motivationQuotes) this.initDailyMotivation();

    const todayStr = new Date().toISOString().split('T')[0];
    const dismissedDay = localStorage.getItem('minhas_contas_dismissed_motivation');
    const card = document.getElementById('dailyMotivationCard');

    if (card) {
      if (dismissedDay === todayStr) {
        card.classList.add('hidden');
        return;
      } else {
        card.classList.remove('hidden');
      }
    }

    const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 1000 / 60 / 60 / 24);
    const quoteIdx = dayOfYear % this.motivationQuotes.length;
    
    const quoteEl = document.getElementById('dailyMotivationQuote');
    if (quoteEl) quoteEl.textContent = this.motivationQuotes[quoteIdx];

    this.updateDailyTipDisplay();
  }

  nextDailyMotivationTip() {
    if (!this.extraIncomeTips) this.initDailyMotivation();
    this.currentTipIdx = (this.currentTipIdx + 1) % this.extraIncomeTips.length;
    this.updateDailyTipDisplay();
  }

  updateDailyTipDisplay() {
    if (!this.extraIncomeTips) this.initDailyMotivation();
    const tipEl = document.getElementById('dailyTipText');
    if (tipEl) tipEl.textContent = this.extraIncomeTips[this.currentTipIdx];
  }

  dismissDailyMotivation() {
    const todayStr = new Date().toISOString().split('T')[0];
    localStorage.setItem('minhas_contas_dismissed_motivation', todayStr);
    document.getElementById('dailyMotivationCard')?.classList.add('hidden');
  }

  /* ------------------------------------------------------------------------
     4. THEME & PWA
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
     5. NAVIGATION & RENDER PIPELINE
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
      this.renderDailyMotivation();
      this.renderDashboard();
    } else if (this.currentTab === 'income') {
      this.renderIncomeTab();
    } else if (this.currentTab === 'list') {
      this.renderList();
    } else if (this.currentTab === 'quick-expenses') {
      this.renderQuickExpensesTab();
    } else if (this.currentTab === 'calendar') {
      this.renderCalendar();
    } else if (this.currentTab === 'people') {
      this.renderPeople();
    }

    if (window.lucide) {
      try { lucide.createIcons(); } catch (e) {}
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
     6. DASHBOARD RENDERER
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
        upcomingContainer.innerHTML = `<div class="empty-state" style="padding:20px; text-align:center; color:var(--text-muted)"><p>Nenhuma conta pendente para este mês! 🎉</p></div>`;
      } else {
        upcomingContainer.innerHTML = sortedPending.map(a => {
          const isOverdue = a.dueDate < todayStr;
          const isToday = a.dueDate === todayStr;
          let statusClass = isOverdue ? 'overdue' : (isToday ? 'today' : 'soon');
          return `
            <div class="account-card ${statusClass}" onclick="app.editAccount('${a.id}')">
              <div>
                <div class="account-title">${this.escapeHtml(a.title)}</div>
                <div style="font-size:0.8rem; color:var(--text-muted)"><i data-lucide="user" style="width:12px"></i> ${this.escapeHtml(a.person || 'Geral')} • Vence ${this.formatDate(a.dueDate)}</div>
              </div>
              <div>
                <div class="account-amount ${a.type}">${this.formatCurrency(a.amount)}</div>
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
     7. ENTRADAS & SALÁRIO TAB
     ------------------------------------------------------------------------ */
  renderIncomeTab() {
    const curYear = this.selectedDate.getFullYear();
    const curMonth = this.selectedDate.getMonth();

    const incomeList = this.accounts.filter(a => {
      const d = new Date(a.dueDate + 'T00:00:00');
      return a.type === 'receive' && d.getFullYear() === curYear && d.getMonth() === curMonth;
    });

    const totalIncome = incomeList.reduce((sum, a) => sum + a.amount, 0);
    const sumEl = document.getElementById('incomeSumTotal');
    if (sumEl) sumEl.textContent = this.formatCurrency(totalIncome);

    const container = document.getElementById('incomeListContainer');
    if (!container) return;

    if (incomeList.length === 0) {
      container.innerHTML = `<div class="empty-state" style="text-align:center; padding: 40px; color: var(--text-muted);"><p>Nenhuma entrada cadastrada para este mês.</p></div>`;
      return;
    }

    container.innerHTML = incomeList.map(a => `
      <div class="account-card">
        <div class="account-info">
          <div class="account-title">${this.escapeHtml(a.title)}</div>
          <div style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">De quem: ${this.escapeHtml(a.person || 'Geral')} • Data: ${this.formatDate(a.dueDate)}</div>
        </div>
        <div class="account-values">
          <div class="account-amount receive">+${this.formatCurrency(a.amount)}</div>
        </div>
        <div class="account-actions">
          <button class="icon-btn-sm" onclick="app.deleteAccount('${a.id}')" title="Excluir" style="color:var(--danger-color)"><i data-lucide="trash-2"></i></button>
        </div>
      </div>
    `).join('');
  }

  /* ------------------------------------------------------------------------
     8. LIST TAB (ALL ACCOUNTS & MULTI-SELECT DELETION)
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
      container.innerHTML = `<div class="empty-state" style="text-align:center; padding: 40px; color: var(--text-muted);"><p>Nenhuma conta cadastrada nesta visualização.</p></div>`;
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
            <input type="checkbox" class="acc-checkbox" ${isSelected ? 'checked' : ''} onchange="app.toggleSelectAccount('${a.id}')" title="Selecionar para apagar em lote">
          </div>

          <div class="account-info">
            <div class="account-title">${this.escapeHtml(a.title)}</div>
            <div style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">
              ${a.person ? `👤 ${this.escapeHtml(a.person)} • ` : ''}
              Vence: ${this.formatDate(a.dueDate)} • ${a.category || 'Outros'}
            </div>
          </div>

          <div class="account-values">
            <div class="account-amount ${a.type}">${a.type === 'pay' ? '-' : '+'}${this.formatCurrency(a.amount)}</div>
            <span class="account-status-badge ${statusBadgeClass}" style="font-size:0.75rem;">${statusBadgeText}</span>
          </div>

          <div class="account-actions" style="display:flex; gap:6px;">
            <button class="icon-btn-sm" onclick="app.toggleStatus('${a.id}')" title="${a.status === 'paid' ? 'Marcar como Pendente' : 'Marcar como Paga/Recebida'}">
              <i data-lucide="${a.status === 'paid' ? 'rotate-ccw' : 'check'}"></i>
            </button>
            <button class="icon-btn-sm" onclick="app.editAccount('${a.id}')" title="Editar"><i data-lucide="pencil"></i></button>
            <button class="icon-btn-sm" onclick="app.deleteAccount('${a.id}')" title="Excluir" style="color:var(--danger-color)"><i data-lucide="trash-2"></i></button>
          </div>
        </div>
      `;
    }).join('');
  }

  /* Multi-Select Deletion */
  toggleSelectAccount(id) {
    if (this.selectedAccountIds.has(id)) {
      this.selectedAccountIds.delete(id);
    } else {
      this.selectedAccountIds.add(id);
    }
    this.renderList();
  }

  toggleSelectAll(isChecked) {
    if (isChecked) {
      this.accounts.forEach(a => this.selectedAccountIds.add(a.id));
    } else {
      this.selectedAccountIds.clear();
    }
    this.renderList();
  }

  clearSelection() {
    this.selectedAccountIds.clear();
    this.renderList();
  }

  deleteSelectedAccounts() {
    const count = this.selectedAccountIds.size;
    if (count === 0) return;

    if (confirm(`Tem certeza que deseja APAGAR as ${count} conta(s) selecionada(s)? Esta ação não pode ser desfeita.`)) {
      this.accounts = this.accounts.filter(a => !this.selectedAccountIds.has(a.id));
      this.selectedAccountIds.clear();
      this.saveCpfAccounts();
      this.render();
      this.showToast(`🗑️ ${count} conta(s) apagada(s) com sucesso!`);
    }
  }

  markSelectedAsPaid() {
    const count = this.selectedAccountIds.size;
    if (count === 0) return;

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
    this.saveCpfAccounts();
    this.render();
    this.showToast(`🟢 ${count} conta(s) marcada(s) como concluída(s)! 🎉`);
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
     9. GASTOS RÁPIDOS TAB
     ------------------------------------------------------------------------ */
  renderQuickExpensesTab() {
    const curYear = this.selectedDate.getFullYear();
    const curMonth = this.selectedDate.getMonth();

    const quickList = this.accounts.filter(a => {
      const d = new Date(a.dueDate + 'T00:00:00');
      return a.isQuickExpense === true && d.getFullYear() === curYear && d.getMonth() === curMonth;
    });

    const container = document.getElementById('quickExpensesList');
    if (!container) return;

    if (quickList.length === 0) {
      container.innerHTML = `<div class="empty-state" style="text-align:center; padding: 40px; color: var(--text-muted);"><p>Nenhum gasto rápido lançado neste mês.</p></div>`;
      return;
    }

    container.innerHTML = quickList.map(a => `
      <div class="account-card">
        <div class="account-info">
          <div class="account-title">${this.escapeHtml(a.title)}</div>
          <div style="font-size:0.8rem; color:var(--text-muted)">Feito em: ${this.formatDate(a.dueDate)} • ${a.category}</div>
        </div>
        <div class="account-values">
          <div class="account-amount pay">-${this.formatCurrency(a.amount)}</div>
        </div>
        <div class="account-actions">
          <button class="icon-btn-sm" onclick="app.deleteAccount('${a.id}')" title="Excluir" style="color:var(--danger-color)"><i data-lucide="trash-2"></i></button>
        </div>
      </div>
    `).join('');
  }

  /* ------------------------------------------------------------------------
     10. CALENDAR VIEW
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
        dotsHtml += `<div class="cal-dot ${acc.type}" style="font-size:0.68rem; padding:1px 4px; border-radius:3px; background:${acc.type==='pay'?'var(--danger-light)':'var(--primary-light)'}; color:${acc.type==='pay'?'var(--danger-color)':'var(--primary-color)'}; margin-top:2px">${this.escapeHtml(acc.title.substring(0, 10))}</div>`;
      });

      html += `
        <div class="cal-day ${isToday ? 'today' : ''}" style="background:var(--bg-primary); border:1px solid var(--border-color); border-radius:8px; padding:6px; min-height:75px">
          <span style="font-weight:700; font-size:0.8rem">${day}</span>
          <div style="display:flex; flex-direction:column; gap:2px; margin-top:4px">${dotsHtml}</div>
        </div>
      `;
    }

    grid.innerHTML = html;
  }

  /* ------------------------------------------------------------------------
     11. BY PERSON VIEW
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
      grid.innerHTML = `<div class="empty-state" style="text-align:center; padding:30px; color:var(--text-muted)"><p>Nenhum lançamento por pessoa cadastrado ainda.</p></div>`;
      return;
    }

    grid.innerHTML = persons.map(person => {
      const data = personMap[person];
      return `
        <div class="kpi-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <strong style="font-size:1rem;">👤 ${this.escapeHtml(person)}</strong>
            <span style="font-size:0.75rem; color:var(--text-muted)">${data.count} conta(s)</span>
          </div>
          ${data.pixKey ? `<div style="font-size:0.8rem; color:var(--primary-color); margin-bottom:8px;">🔑 Pix: <strong>${this.escapeHtml(data.pixKey)}</strong></div>` : ''}
          <div style="font-size:0.85rem; margin-top:4px;">Pendente: <strong style="color:var(--danger-color)">${this.formatCurrency(data.pendingPay)}</strong></div>
        </div>
      `;
    }).join('');
  }

  /* ------------------------------------------------------------------------
     12. CRUD OPERATIONS & DUAL INSTALLMENT MODES
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

    this.installmentMode = 'total';
    this.switchInstallmentMode('total');

    document.getElementById('modalTitle').textContent = 'Cadastrar Nova Conta';
    this.toggleTypeUI();
    this.updateInstallmentPreview();
    this.openModal('accountModal');
  }

  openNewIncomeModal() {
    this.openNewModal();
    const receiveRadio = document.querySelector('input[name="accType"][value="receive"]');
    if (receiveRadio) {
      receiveRadio.checked = true;
      this.toggleTypeUI();
    }
  }

  openQuickExpenseModal() {
    document.getElementById('quickAmount').value = '';
    document.getElementById('quickTitle').value = '';
    document.getElementById('quickCategory').value = 'Alimentação';
    this.openModal('quickExpenseModal');
  }

  saveQuickExpense(e) {
    e.preventDefault();

    const amount = parseFloat(document.getElementById('quickAmount').value);
    const title = document.getElementById('quickTitle').value.trim();
    const category = document.getElementById('quickCategory').value;

    if (!title || isNaN(amount) || amount <= 0) return;

    const todayStr = new Date().toISOString().split('T')[0];

    const newQuickExpense = {
      id: 'quick_' + Date.now().toString(),
      title: title,
      person: 'Gasto Rápido',
      amount: amount,
      dueDate: todayStr,
      paidAt: todayStr,
      category: category,
      status: 'paid',
      type: 'pay',
      isQuickExpense: true
    };

    this.accounts.push(newQuickExpense);
    this.saveCpfAccounts();
    this.closeModal('quickExpenseModal');
    this.render();

    if (window.confetti) {
      confetti({ particleCount: 40, spread: 50, origin: { y: 0.85 } });
    }
    this.showToast(`Gasto Rápido de ${this.formatCurrency(amount)} salvo! ⚡`);
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
    
    this.installmentMode = 'total';
    this.switchInstallmentMode('total');
    this.toggleTypeUI();
    this.updateInstallmentPreview();

    document.getElementById('modalTitle').textContent = 'Editar Conta';
    this.openModal('accountModal');
  }

  switchInstallmentMode(mode) {
    this.installmentMode = mode;
    const labelTotal = document.getElementById('labelModeTotal');
    const labelSingle = document.getElementById('labelModeSingle');

    if (mode === 'single') {
      labelTotal?.classList.remove('active');
      labelSingle?.classList.add('active');
    } else {
      labelSingle?.classList.remove('active');
      labelTotal?.classList.add('active');
    }

    const radios = document.getElementsByName('installmentMode');
    radios.forEach(r => r.checked = (r.value === mode));

    this.toggleTypeUI();
    this.updateInstallmentPreview();
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
    const amountLabel = document.getElementById('labelAccAmount');
    const amountNote = document.getElementById('amountHelpNote');

    const isSingleMode = (this.installmentMode === 'single');

    if (selectedType === 'receive') {
      if (titleLabel) titleLabel.textContent = 'Descrição do Valor a Receber (ex: Serviço, Freela, Venda) *';
      if (personLabel) personLabel.innerHTML = '<i data-lucide="user"></i> De quem vou receber? / Nome da Pessoa *';
      if (dueDateLabel) dueDateLabel.textContent = 'Data em que vou receber *';
      
      if (amountLabel) {
        amountLabel.innerHTML = isSingleMode ? 
          '<i data-lucide="dollar-sign"></i> Valor de Cada Parcela (R$) *' : 
          '<i data-lucide="dollar-sign"></i> Valor Total a Receber (R$) *';
      }
      if (amountNote) {
        amountNote.innerHTML = isSingleMode ? 
          '💡 Digite o <strong>VALOR DE CADA PARCELA</strong>. O app calcula o valor total acumulado.' : 
          '💡 Digite o <strong>VALOR TOTAL</strong> a receber (mesmo se for em parcelas).';
      }

      if (installmentLabel) installmentLabel.innerHTML = '<strong>Este valor será recebido em parcelas? (ex: 3x, 6x)</strong>';
    } else {
      if (titleLabel) titleLabel.textContent = 'Descrição da Conta a Pagar (ex: Mercado, Cartão) *';
      if (personLabel) personLabel.innerHTML = '<i data-lucide="user"></i> Para quem devo pagar? *';
      if (dueDateLabel) dueDateLabel.textContent = 'Data de Vencimento *';

      if (amountLabel) {
        amountLabel.innerHTML = isSingleMode ? 
          '<i data-lucide="dollar-sign"></i> Valor de Cada Parcela (R$) *' : 
          '<i data-lucide="dollar-sign"></i> Valor Total a Pagar (R$) *';
      }
      if (amountNote) {
        amountNote.innerHTML = isSingleMode ? 
          '💡 Digite o <strong>VALOR DE CADA PARCELA</strong>. O app multiplica pelo número de parcelas.' : 
          '💡 Digite o <strong>VALOR TOTAL</strong> da compra/despesa.';
      }

      if (installmentLabel) installmentLabel.innerHTML = '<strong>Esta compra foi parcelada? (ex: 6x no cartão)</strong>';
    }

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
      let totalVal = 0;
      let singleVal = 0;

      if (this.installmentMode === 'single') {
        singleVal = amount;
        totalVal = amount * count;
      } else {
        totalVal = amount;
        singleVal = amount / count;
      }

      const formattedSingle = this.formatCurrency(singleVal);
      const formattedTotal = this.formatCurrency(totalVal);

      previewBox.innerHTML = `✨ <strong>${count} parcelas</strong> de <strong>${formattedSingle}</strong> por mês (Valor Total: ${formattedTotal})`;
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
    const enteredAmount = parseFloat(document.getElementById('accAmount').value);
    const dueDate = document.getElementById('accDueDate').value;
    const category = document.getElementById('accCategory').value;
    const status = document.getElementById('accStatus').value;
    const notes = document.getElementById('accNotes').value.trim();
    const type = document.querySelector('input[name="accType"]:checked').value;

    const isInstallment = document.getElementById('accIsInstallment').checked;
    const installmentCount = parseInt(document.getElementById('accInstallmentCount').value) || 2;

    if (!title || isNaN(enteredAmount) || !dueDate) {
      alert('Por favor, preencha todos os campos obrigatórios.');
      return;
    }

    if (id) {
      const index = this.accounts.findIndex(a => a.id === id);
      if (index !== -1) {
        this.accounts[index] = {
          ...this.accounts[index],
          title, person, pixKey, amount: enteredAmount, dueDate, category, status, notes, type
        };
      }
    } else {
      if (isInstallment && installmentCount > 1) {
        let totalAmount = 0;
        let baseInstallment = 0;

        if (this.installmentMode === 'single') {
          baseInstallment = enteredAmount;
          totalAmount = enteredAmount * installmentCount;
        } else {
          totalAmount = enteredAmount;
          baseInstallment = Math.floor((enteredAmount / installmentCount) * 100) / 100;
        }

        let remainderCents = (this.installmentMode === 'single') ? 0 : Math.round((totalAmount - (baseInstallment * installmentCount)) * 100);
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
        const totalForm = this.formatCurrency(totalAmount);
        this.showToast(`🎉 ${installmentCount} parcelas de ${instForm} geradas! (Total: ${totalForm})`);
      } else {
        this.accounts.push({
          id: Date.now().toString(),
          title, person, pixKey, amount: enteredAmount, dueDate, category, status, notes, type
        });
        this.showToast('Conta cadastrada com sucesso!');
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
      this.showToast('Conta marcada como Concluída! 🎉');
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
     13. BACKUP & EMERGENCY RECOVERY SCAN
     ------------------------------------------------------------------------ */
  emergencyScanAndRestore() {
    let recovered = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('minhas_contas_')) {
        try {
          const val = localStorage.getItem(key);
          if (!val) continue;

          const parsed = JSON.parse(val);
          if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].title && parsed[0].amount !== undefined) {
            parsed.forEach(acc => {
              if (!recovered.some(x => x.id === acc.id || (x.title === acc.title && x.dueDate === acc.dueDate && x.amount === acc.amount))) {
                recovered.push(acc);
              }
            });
          }
        } catch (e) {}
      }
    }

    if (recovered.length > 0) {
      this.accounts = recovered;
      this.saveCpfAccounts();
      this.render();
      this.closeModal('backupModal');
      if (window.confetti) confetti({ particleCount: 60, spread: 60 });
      alert(`🎉 Sucesso! Encontramos e restauramos ${recovered.length} conta(s) guardadas na memória!`);
    } else {
      alert('Nenhuma conta anterior foi encontrada na memória deste navegador.');
    }
  }

  exportDataJSON() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this.accounts, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `backup_minhas_contas_${this.activeCpf}_${new Date().toISOString().split('T')[0]}.json`);
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
        const imported = JSON.parse(e.target.result);
        if (Array.isArray(imported)) {
          this.accounts = imported;
          this.saveCpfAccounts();
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
     14. UTILS & TOASTS
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

  formatCpf(cpf) {
    if (!cpf) return '';
    const c = cpf.replace(/\D/g, '');
    if (c.length !== 11) return cpf;
    return c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }

  maskCpf(input) {
    let value = input.value.replace(/\D/g, '');
    if (value.length > 11) value = value.substring(0, 11);
    
    if (value.length > 9) {
      value = value.replace(/^(\d{3})(\d{3})(\d{3})(\d{1,2})$/, "$1.$2.$3-$4");
    } else if (value.length > 6) {
      value = value.replace(/^(\d{3})(\d{3})(\d{1,3})$/, "$1.$2.$3");
    } else if (value.length > 3) {
      value = value.replace(/^(\d{3})(\d{0,3})$/, "$1.$2");
    }
    input.value = value;
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
