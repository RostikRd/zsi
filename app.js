/* Urban Canopy — funkčný prototyp (localStorage, RBAC, mock AI) */
(function () {
  'use strict';

  var STORAGE_KEY = 'urban-canopy-proto-v1';
  var LOGIN_FAIL_PREFIX = 'uc_login_fail_';
  var CAPTCHA_KEY_PREFIX = 'login_captcha_exp_';
  var HASH_SYNC = false;
  var ROUTE_TO_HASH = {
    overview: '#/overview',
    trees: '#/trees',
    inspections: '#/inspections',
    risk: '#/risk',
    orders: '#/orders',
    export: '#/export',
    admin: '#/admin/users'
  };

  function nowIso() {
    return new Date().toISOString();
  }

  function uid(prefix) {
    return prefix + '-' + Math.random().toString(36).slice(2, 10);
  }

  function scoreToCategory(score) {
    if (score < 0.33) return 'LOW';
    if (score < 0.66) return 'MEDIUM';
    return 'HIGH';
  }

  function categorySk(cat) {
    var m = { LOW: 'Nízke', MEDIUM: 'Stredné', HIGH: 'Vysoké' };
    return m[cat] || cat;
  }

  function seedState() {
    return {
      users: [
        { id: 'u1', email: 'arborista@test.sk', name: 'M. Kováč', password: 'heslo123', role: 'ARBORIST', district: 'Centrum', active: true },
        { id: 'u-arb-sev', email: 'arborista.sever@test.sk', name: 'P. Severák', password: 'heslo123', role: 'ARBORIST', district: 'Sever', active: true },
        { id: 'u2', email: 'dispatcher@test.sk', name: 'J. Novák', password: 'heslo123', role: 'DISPATCHER', district: null, active: true },
        { id: 'u3', email: 'admin@test.sk', name: 'Admin Systémový', password: 'admin123', role: 'ADMIN', district: null, active: true },
        { id: 'u-cit', email: 'obcan@test.sk', name: 'J. Verejný', password: 'heslo123', role: 'CITIZEN', district: null, active: true }
      ],
      trees: [
        { id: 'T-1', species: 'Lipa malolistá', lat: 48.144, lng: 17.108, address: 'Hlavná 12', dbh: 42, district: 'Centrum', plantedYear: 1998, lifecycle: 'ACTIVE' },
        { id: 'T-2', species: 'Javor horský', lat: 48.152, lng: 17.115, address: 'Parková ul.', dbh: 28, district: 'Centrum', plantedYear: 2005, lifecycle: 'ACTIVE' },
        { id: 'T-500', species: 'Dub letný', lat: 48.178, lng: 17.052, address: 'Lesná 4', dbh: 55, district: 'Sever', plantedYear: 1980, lifecycle: 'ACTIVE' }
      ],
      inspections: [],
      assessments: [],
      workOrders: [],
      citizenReports: [],
      eventLog: [],
      session: null,
      selectedTreeId: 'T-1',
      aiScenario: 'MOCK_065',
      route: 'overview',
      filterDistrict: '',
      filterRisk: 'all'
    };
  }

  function hashToRoute(hash) {
    var h = (hash || '').replace(/^#\/?/, '').toLowerCase();
    if (!h) return 'overview';
    if (h === 'admin' || h.indexOf('admin') === 0) return 'admin';
    var map = {
      overview: 'overview',
      trees: 'trees',
      inspections: 'inspections',
      risk: 'risk',
      orders: 'orders',
      export: 'export'
    };
    return map[h] || 'overview';
  }

  function getFilterDistrict() {
    var el = document.getElementById('flt-district');
    if (el) return el.value.trim();
    return state.filterDistrict != null ? state.filterDistrict : '';
  }

  function getFilterRisk() {
    var el = document.getElementById('flt-risk');
    if (el) return el.value || 'all';
    return state.filterRisk != null ? state.filterRisk : 'all';
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return seedState();
      var s = JSON.parse(raw);
      var base = seedState();
      if (!s.users || !s.trees) {
        if (s && s.citizenReports && s.citizenReports.length) {
          base.citizenReports = s.citizenReports;
        }
        if (s && s.eventLog && s.eventLog.length) {
          base.eventLog = s.eventLog.concat(base.eventLog).slice(0, 200);
        }
        return base;
      }
      Object.keys(base).forEach(function (k) {
        if (s[k] === undefined || s[k] === null) s[k] = base[k];
      });
      return s;
    } catch (e) {
      return seedState();
    }
  }

  function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  var state = loadState();

  function logEvent(type, detail) {
    state.eventLog.unshift({ t: nowIso(), type: type, detail: detail || '' });
    if (state.eventLog.length > 200) state.eventLog.pop();
    saveState(state);
  }

  function getUser() {
    if (!state.session) return null;
    return state.users.find(function (u) { return u.id === state.session.userId; }) || null;
  }

  function canAccessTree(user, tree) {
    if (!user || !tree) return false;
    if (user.role === 'ADMIN' || user.role === 'DISPATCHER') return true;
    if (user.role === 'ARBORIST') return user.district === tree.district;
    return false;
  }

  function canRunAi(user) {
    return user && (user.role === 'DISPATCHER' || user.role === 'ARBORIST' || user.role === 'ADMIN');
  }

  function canExport(user) {
    return user && (user.role === 'DISPATCHER' || user.role === 'ADMIN');
  }

  function canManageUsers(user) {
    return user && user.role === 'ADMIN';
  }

  function latestAssessmentForTree(treeId) {
    var list = state.assessments.filter(function (a) { return a.treeId === treeId; });
    list.sort(function (a, b) {
      var ta = new Date(a.completedAt || a.requestedAt || 0).getTime();
      var tb = new Date(b.completedAt || b.requestedAt || 0).getTime();
      return tb - ta;
    });
    return list[0] || null;
  }

  function assessmentHasScore(a) {
    return a && (a.status === 'COMPLETED' || a.status === 'REVIEWED') && a.score != null;
  }

  function pinStyle(tree) {
    var a = latestAssessmentForTree(tree.id);
    var cat = assessmentHasScore(a) ? a.category : null;
    if (cat === 'HIGH') return 'map__pin--high';
    if (cat === 'MEDIUM') return 'map__pin--mid';
    return 'map__pin--low';
  }

  function mapPercent(lat, lng) {
    var top = 10 + ((48.2 - lat) / 0.1) * 80;
    var left = 10 + ((lng - 17.0) / 0.15) * 80;
    return { top: Math.max(8, Math.min(92, top)), left: Math.max(8, Math.min(92, left)) };
  }

  function filteredTrees() {
    var q = (document.getElementById('global-search') && document.getElementById('global-search').value) || '';
    q = q.trim().toLowerCase();
    return state.trees.filter(function (t) {
      if (!q) return true;
      return (
        t.id.toLowerCase().indexOf(q) >= 0 ||
        t.species.toLowerCase().indexOf(q) >= 0 ||
        (t.address && t.address.toLowerCase().indexOf(q) >= 0)
      );
    });
  }

  function filterTreesByDrawer() {
    var d = getFilterDistrict();
    var r = getFilterRisk();
    return filteredTrees().filter(function (t) {
      if (d && t.district.toLowerCase().indexOf(d.toLowerCase()) < 0) return false;
      if (r === 'all') return true;
      var a = latestAssessmentForTree(t.id);
      if (r === 'none') return !assessmentHasScore(a);
      if (!assessmentHasScore(a)) return false;
      if (r === 'high') return a.category === 'HIGH';
      if (r === 'mid') return a.category === 'MEDIUM';
      if (r === 'low') return a.category === 'LOW';
      return true;
    });
  }

  function toast(msg, kind) {
    var wrap = document.getElementById('toast-root');
    if (!wrap) return;
    var el = document.createElement('div');
    el.className = 'toast' + (kind === 'warn' ? ' toast--warn' : kind === 'bad' ? ' toast--bad' : kind === 'ok' ? ' toast--ok' : '');
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(function () {
      el.remove();
    }, 4200);
  }

  function showLogin(show) {
    document.getElementById('screen-login').classList.toggle('hidden', !show);
    document.getElementById('screen-app').classList.toggle('hidden', show);
    document.documentElement.classList.toggle('proto-app-active', !show);
  }

  function updateHeader() {
    var u = getUser();
    document.getElementById('bar-name').textContent = u ? u.name : '—';
    document.getElementById('bar-role').textContent = u ? u.role + (u.district ? ' · ' + u.district : '') : '—';
    document.getElementById('bar-avatar').textContent = u ? u.name.slice(0, 2).toUpperCase() : '?';
    var adm = document.getElementById('rail-admin');
    if (adm) adm.classList.toggle('hidden', !canManageUsers(u));
  }

  function navigate(route, opts) {
    state.route = route;
    saveState(state);
    if (!opts || !opts.skipHash) {
      var th = ROUTE_TO_HASH[route];
      if (th && window.location.hash !== th) {
        HASH_SYNC = true;
        window.location.hash = th;
        setTimeout(function () {
          HASH_SYNC = false;
        }, 100);
      }
    }
    render();
  }

  function riskFilterOptions(selected) {
    var opts = [
      ['all', 'Všetky'],
      ['high', 'Vysoké'],
      ['mid', 'Stredné'],
      ['low', 'Nízke'],
      ['none', 'Bez AI']
    ];
    return opts
      .map(function (o) {
        return '<option value="' + o[0] + '"' + (selected === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      })
      .join('');
  }

  function renderNav() {
    var u = getUser();
    document.querySelectorAll('#rail-nav .rail__link').forEach(function (a) {
      var r = a.getAttribute('data-route');
      a.classList.toggle('rail__link--active', r === state.route);
      if (r === 'export') a.classList.toggle('hidden', !canExport(u));
    });
  }

  function renderOverview() {
    var u = getUser();
    var trees = filterTreesByDrawer();
    var sel =
      trees.find(function (x) { return x.id === state.selectedTreeId; }) ||
      trees[0] ||
      state.trees[0] ||
      null;
    if (sel) state.selectedTreeId = sel.id;

    var pinsHtml = state.trees
      .map(function (t) {
        var p = mapPercent(t.lat, t.lng);
        var cls = pinStyle(t);
        var on = t.id === state.selectedTreeId ? ' map__pin--sel' : '';
        return (
          '<button type="button" class="map__pin ' +
          cls +
          on +
          '" style="left:' +
          p.left +
          '%;top:' +
          p.top +
          '%" data-tree="' +
          t.id +
          '" title="' +
          t.id +
          '"></button>'
        );
      })
      .join('');

    var listHtml = trees
      .map(function (t) {
        var a = latestAssessmentForTree(t.id);
        var tag = '';
        if (assessmentHasScore(a)) {
          tag =
            '<span class="tag ' +
            (a.category === 'HIGH' ? 'tag--bad' : a.category === 'MEDIUM' ? 'tag--warn' : 'tag--ok') +
            '">AI ' +
            categorySk(a.category).toLowerCase() +
            '</span>';
        } else {
          tag = '<span class="tag" style="opacity:0.7">bez AI</span>';
        }
        var active = t.id === state.selectedTreeId ? ' trees__item--active' : '';
        return (
          '<li class="trees__item' +
          active +
          '" data-tree="' +
          t.id +
          '"><div class="trees__icon trees__icon--alert" aria-hidden="true"></div><div class="trees__body"><div class="trees__row"><span class="trees__id">' +
          t.id +
          '</span>' +
          tag +
          '</div><span class="trees__name">' +
          escapeHtml(t.species) +
          '</span><span class="trees__addr">' +
          escapeHtml(t.address || '') +
          '</span></div></li>'
        );
      })
      .join('');

    var t = sel;
    var a = t ? latestAssessmentForTree(t.id) : null;
    var riskHtml = '';
    if (!t) {
      riskHtml = '<p class="empty-state">Žiadny strom</p>';
    } else {
      var ring = assessmentHasScore(a) ? Math.round((a.score || 0) * 100) : 0;
      riskHtml =
        '<article class="panel panel--risk"><header class="panel__head"><h3 class="panel__h">Predikcia rizika (AI)</h3><span class="panel__model">' +
        (a && a.modelVersion ? escapeHtml(a.modelVersion) : '—') +
        '</span></header>' +
        (assessmentHasScore(a)
          ? '<div class="risk"><div class="risk__ring" style="--p:' +
            ring +
            '"><span class="risk__value">' +
            (a.score != null ? a.score.toFixed(2).replace('.', ',') : '—') +
            '</span><span class="risk__cap">skóre</span></div><div class="risk__side"><span class="risk__badge">' +
            categorySk(a.category) +
            ' riziko</span><p class="risk__text">' +
            escapeHtml(a.explanation || '') +
            (a.humanOverride ? ' · Override: ' + escapeHtml(a.overrideReason || '') : '') +
            '</p></div></div>'
          : '<p class="panel__p">' +
            (a && a.status === 'FAILED'
              ? 'Hodnotenie zlyhalo: ' +
                escapeHtml(a.errorMessage || '') +
                (a.rejectedRawScore != null ? ' — API simulácia vrátila skóre ' + a.rejectedRawScore + ' (TC-04-03).' : '') +
                '</p><p class="http-hint">Môžete zopakovať hodnotenie (retry). Stav FAILED / možnosť nového pokusu (TC-04-02).'
              : 'Zatiaľ nie je dokončené AI hodnotenie.') +
            '</p>') +
        '<div class="panel__actions inspector__actions">' +
        (canRunAi(u) && t && canAccessTree(u, t)
          ? '<label class="field-row" style="margin:0;flex:1;min-width:140px">Scenár mocku <select id="ai-scenario"><option value="MOCK_065">Úspech 0,65 (TC-04-01)</option><option value="TIMEOUT">Timeout (TC-04-02)</option><option value="INVALID">Neplatné skóre (TC-04-03)</option><option value="RANDOM">Náhodné platné skóre</option></select></label><button type="button" class="btn btn--ghost" id="btn-run-ai">' +
            (a && a.status === 'FAILED' ? 'Zopakovať hodnotenie (retry)' : 'Spustiť hodnotenie') +
            '</button>'
          : '<span class="empty-state">Nemáte oprávnenie alebo prístup k okrsku.</span>') +
        '</div>' +
        (a && a.status === 'COMPLETED'
          ? '<div class="panel__form"><h4 class="panel__h" style="font-size:0.9rem">Revízia (UC-05)</h4><p class="panel__p"><label><input type="checkbox" id="rev-override" /> Override na nižšiu kategóriu</label></p><div class="field-row"><label for="rev-reason">Dôvod override (min. 20 znakov)</label><textarea id="rev-reason" placeholder="Text…"></textarea></div><button type="button" class="btn btn--accent" id="btn-review">Potvrdiť revíziu</button></div>'
          : a && a.status === 'REVIEWED'
            ? '<p class="panel__p">Revízia dokončená (REVIEWED).' +
              (a.humanOverride && a.originalAiScore != null
                ? ' História (TC-05-02): pôvodné AI skóre pred override: <strong>' +
                  String(a.originalAiScore).replace('.', ',') +
                  '</strong>.'
                : '') +
              '</p>'
            : '') +
        '</article>';
    }

    var insList = t ? state.inspections.filter(function (i) { return i.treeId === t.id; }) : [];
    var insHtml =
      insList.length === 0
        ? '<p class="panel__p panel__p--dim">Zatiaľ žiadna kontrola.</p>'
        : '<ul class="risk__bullets">' +
          insList
            .map(function (i) {
              return '<li>' + escapeHtml(i.id) + ' · ' + i.status + ' · ' + escapeHtml(i.notes.slice(0, 80)) + '</li>';
            })
            .join('') +
          '</ul>';

    var wo = t
      ? state.workOrders.filter(function (w) {
          return w.treeId === t.id && w.status !== 'DONE' && w.status !== 'CLOSED' && w.status !== 'CANCELLED';
        })
      : [];
    var woHtml =
      wo.length === 0
        ? '<p class="panel__p panel__p--dim">Žiadny otvorený príkaz pre tento strom.</p>'
        : wo
            .map(function (w) {
              return '<p class="panel__p">' + escapeHtml(w.title) + ' — ' + w.status + '</p>';
            })
            .join('');

    var access = t && canAccessTree(u, t);

    return (
      '<section class="canvas" aria-label="Mapa"><div class="map"><div class="map__grid"></div><div class="map__glow"></div>' +
      pinsHtml +
      '<div class="map__hud"><span class="map__hud-title">Mestská zeleň</span><span class="map__hud-sub">' +
      trees.length +
      ' stromov vo filtri</span></div><div class="map__legend"><span class="map__leg-item"><i class="map__dot map__dot--high"></i> Vysoké</span><span class="map__leg-item"><i class="map__dot map__dot--mid"></i> Stredné</span><span class="map__leg-item"><i class="map__dot map__dot--low"></i> Nízke</span></div></div></section>' +
      '<aside class="drawer"><div class="drawer__head"><h1 class="drawer__h">Filtre a zoznam</h1><p class="drawer__hint">Vyberte strom na mape alebo zo zoznamu</p></div>' +
      '<div class="filters"><div class="field"><label for="flt-district">Okrsok</label><input id="flt-district" type="text" placeholder="napr. Centrum" value="' +
      escapeHtml(state.filterDistrict || '') +
      '" /></div>' +
      '<div class="field field--half"><label for="flt-risk">Riziko</label><select id="flt-risk">' +
      riskFilterOptions(state.filterRisk || 'all') +
      '</select></div>' +
      '<button type="button" class="btn btn--accent" id="btn-apply-flt">Použiť filtre</button>' +
      '<p id="flt-perf" class="hint http-hint" style="margin-top:0.5rem"></p></div>' +
      '<div class="list-head"><span class="list-head__title">Výsledky</span><span class="list-head__count">' +
      trees.length +
      '</span></div><ul class="trees">' +
      listHtml +
      '</ul></aside>' +
      '<aside class="inspector"><div class="inspector__top"><div><p class="inspector__label">Vybraný strom</p><h2 class="inspector__title">' +
      (t ? t.id + ' · ' + escapeHtml(t.species) : '—') +
      '</h2></div><span class="status status--on">' +
      (t ? t.lifecycle : '') +
      '</span></div>' +
      '<dl class="facts"><div class="facts__row"><dt>Poloha</dt><dd>' +
      (t ? t.lat.toFixed(4) + ', ' + t.lng.toFixed(4) : '—') +
      '</dd></div><div class="facts__row"><dt>Okrsok</dt><dd>' +
      (t ? escapeHtml(t.district) : '—') +
      '</dd></div><div class="facts__row"><dt>DBH</dt><dd>' +
      (t ? t.dbh + ' cm' : '—') +
      '</dd></div></dl>' +
      riskHtml +
      '<article class="panel"><header class="panel__head"><h3 class="panel__h">Kontrola (UC-03)</h3></header>' +
      (t && access
        ? '<form id="form-insp" class="form-stack"><div class="field-row"><label>Poznámky</label><textarea name="notes" required rows="3"></textarea></div><div class="field-row"><label>Odporúčanie</label><input name="rec" type="text" /></div><div class="field-row"><label>2× JPEG (simulácia)</label><input name="f1" type="file" accept="image/jpeg" /><input name="f2" type="file" accept="image/jpeg" style="margin-top:0.35rem" /></div><button type="submit" class="btn btn--line">Odoslať kontrolu</button></form><div style="margin-top:0.75rem">' +
          insHtml +
          '</div>'
        : t
          ? '<p class="empty-state">HTTP 403 Forbidden — prístup zamietnutý (simulácia REST API; TC-03-02).</p>' + insHtml
          : '') +
      '</article>' +
      '<article class="panel panel--muted"><header class="panel__head"><h3 class="panel__h">Pracovný príkaz (UC-06)</h3></header>' +
      woHtml +
      (access && u && (u.role === 'DISPATCHER' || u.role === 'ARBORIST' || u.role === 'ADMIN')
        ? '<form id="form-wo" class="form-stack" style="margin-top:0.75rem"><div class="field-row field-row--inline"><div><label>Tím</label><input name="team" required placeholder="Tím A" /></div><div><label>Termín</label><input name="due" type="date" /></div></div><button type="submit" class="btn btn--accent btn--full">Vytvoriť príkaz „orez“</button></form>' +
          '<p class="panel__p panel__p--dim" style="margin-top:0.5rem">Uzavretie: v časti Príkazy — stav DONE vyžaduje dátum dokončenia (TC-06-02).</p>'
        : '<p class="empty-state">Vytvorenie príkazu: dispečer/arborista s prístupom.</p>') +
      '</article>' +
      '<div class="panel" style="margin-top:1rem"><header class="panel__head"><h3 class="panel__h">Denník udalostí</h3></header><ol class="log-list" style="list-style:none;padding-left:0;margin:0">' +
      state.eventLog
        .slice(0, 12)
        .map(function (e) {
          return '<li>' + escapeHtml(e.t) + ' — ' + escapeHtml(e.type) + ' — ' + escapeHtml(e.detail) + '</li>';
        })
        .join('') +
      '</ol></div>' +
      (u && (u.role === 'DISPATCHER' || u.role === 'ADMIN') && state.citizenReports && state.citizenReports.length
        ? '<div class="panel" style="margin-top:1rem"><header class="panel__head"><h3 class="panel__h">Občianske hlásenia (UC-10)</h3></header><ul class="risk__bullets">' +
          state.citizenReports
            .slice()
            .reverse()
            .map(function (c) {
              return (
                '<li>' +
                escapeHtml(c.id) +
                ' · ' +
                escapeHtml(c.status) +
                ' · ' +
                escapeHtml((c.description || '').slice(0, 60)) +
                '…</li>'
              );
            })
            .join('') +
          '</ul></div>'
        : '') +
      '</aside>'
    );
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderTreesPage() {
    var rows = filteredTrees()
      .map(function (t) {
        var a = latestAssessmentForTree(t.id);
        return (
          '<tr><td>' +
          escapeHtml(t.id) +
          '</td><td>' +
          escapeHtml(t.species) +
          '</td><td>' +
          escapeHtml(t.district) +
          '</td><td>' +
          (assessmentHasScore(a) ? a.score.toFixed(2) : '—') +
          '</td></tr>'
        );
      })
      .join('');
    var u = getUser();
    var form =
      u && (u.role === 'ARBORIST' || u.role === 'DISPATCHER' || u.role === 'ADMIN')
        ? '<h2 class="drawer__h" style="margin-top:1.5rem">Nový strom (UC-02)</h2><form id="form-new-tree" class="form-stack" style="max-width:520px;margin-top:0.75rem">' +
          '<div class="field-row"><label>Druh *</label><input name="species" id="tree-species" placeholder="napr. Lipa malolistá" /></div>' +
          '<p id="tree-err-species" class="field-error hidden"></p>' +
          '<div class="field-row field-row--inline"><div><label>Zem. šírka *</label><input name="lat" id="tree-lat" type="number" step="0.000001" placeholder="48.144" /></div><div><label>Zem. dĺžka *</label><input name="lng" id="tree-lng" type="number" step="0.000001" placeholder="17.108" /></div></div>' +
          '<p id="tree-err-coords" class="field-error hidden"></p>' +
          '<div class="field-row"><label>Okrsok *</label><input name="district" required placeholder="Centrum" /></div>' +
          '<div class="field-row field-row--inline"><div><label>DBH (cm)</label><input name="dbh" type="number" min="1" placeholder="40" /></div><div><label>Rok výsadby</label><input name="year" type="number" min="1900" max="2100" /></div></div>' +
          '<div class="field-row"><label>Adresa</label><input name="address" type="text" /></div>' +
          '<button type="submit" class="btn btn--accent">Uložiť strom</button></form>'
        : '';
    return (
      '<div class="workspace workspace--single" style="padding:1rem 1.25rem;overflow:auto"><h1 class="drawer__h">Zoznam stromov</h1><div class="table-wrap"><table class="data-table"><thead><tr><th>ID</th><th>Druh</th><th>Okrsok</th><th>AI skóre</th></tr></thead><tbody>' +
      rows +
      '</tbody></table></div>' +
      form +
      '</div>'
    );
  }

  function renderInspectionsPage() {
    var rows = state.inspections
      .map(function (i) {
        return (
          '<tr><td>' +
          escapeHtml(i.id) +
          '</td><td>' +
          escapeHtml(i.treeId) +
          '</td><td>' +
          escapeHtml(i.status) +
          '</td><td>' +
          escapeHtml(i.notes.slice(0, 40)) +
          '…</td></tr>'
        );
      })
      .join('');
    return (
      '<div class="workspace workspace--single" style="padding:1rem 1.25rem;overflow:auto"><h1 class="drawer__h">Kontroly</h1><div class="table-wrap"><table class="data-table"><thead><tr><th>ID</th><th>Strom</th><th>Stav</th><th>Poznámka</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="4" class="empty-state">Žiadne kontroly</td></tr>') +
      '</tbody></table></div></div>'
    );
  }

  function renderRiskPage() {
    var rows = state.assessments
      .map(function (a) {
        return (
          '<tr><td>' +
          escapeHtml(a.id) +
          '</td><td>' +
          escapeHtml(a.treeId) +
          '</td><td>' +
          escapeHtml(a.status) +
          '</td><td>' +
          (a.score != null ? a.score.toFixed(2) : '—') +
          '</td><td>' +
          escapeHtml(a.modelVersion || '') +
          '</td></tr>'
        );
      })
      .join('');
    return (
      '<div class="workspace workspace--single" style="padding:1rem 1.25rem;overflow:auto"><h1 class="drawer__h">AI hodnotenia rizika</h1><p class="hint" style="color:var(--text-dim)">Scenár mocku sa volí na Prehľade pri spustení hodnotenia.</p><div class="table-wrap"><table class="data-table"><thead><tr><th>ID</th><th>Strom</th><th>Stav</th><th>Skóre</th><th>Model</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="5" class="empty-state">Žiadne záznamy</td></tr>') +
      '</tbody></table></div></div>'
    );
  }

  function renderOrdersPage() {
    var rows = state.workOrders
      .map(function (w) {
        return (
          '<tr data-wid="' +
          escapeHtml(w.id) +
          '"><td>' +
          escapeHtml(w.id) +
          '</td><td>' +
          escapeHtml(w.treeId) +
          '</td><td>' +
          escapeHtml(w.title) +
          '</td><td>' +
          escapeHtml(w.status) +
          '</td><td>' +
          escapeHtml(w.team || '') +
          '</td><td><select class="wo-st" data-id="' +
          escapeHtml(w.id) +
          '">' +
          ['CREATED', 'ASSIGNED', 'IN_PROGRESS', 'DONE', 'CLOSED']
            .map(function (s) {
              return '<option value="' + s + '"' + (w.status === s ? ' selected' : '') + '>' + s + '</option>';
            })
            .join('') +
          '</select> <input type="date" class="wo-done" data-id="' +
          escapeHtml(w.id) +
          '" value="' +
          (w.completedAt ? w.completedAt.slice(0, 10) : '') +
          '" /></td></tr>'
        );
      })
      .join('');
    return (
      '<div class="workspace workspace--single" style="padding:1rem 1.25rem;overflow:auto"><h1 class="drawer__h">Pracovné príkazy</h1><p class="hint" style="color:var(--text-dim)">Prechod na DONE: vyplňte dátum dokončenia (TC-06-02).</p><div class="table-wrap"><table class="data-table"><thead><tr><th>ID</th><th>Strom</th><th>Názov</th><th>Stav</th><th>Tím</th><th>Zmena / dokončenie</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6" class="empty-state">Žiadne príkazy</td></tr>') +
      '</tbody></table></div></div>'
    );
  }

  function renderExportPage() {
    var u = getUser();
    if (!canExport(u)) {
      return '<div class="workspace workspace--single" style="padding:1.5rem"><p class="empty-state">403 — export je len pre dispečéra alebo admina (UC-08).</p></div>';
    }
    return (
      '<div class="workspace workspace--single" style="padding:1rem 1.25rem;overflow:auto"><h1 class="drawer__h">Export CSV (TC-08)</h1><p class="hint" style="color:var(--text-dim)">Rovnaká množina ako na Prehľade: globálne vyhľadávanie + uložené filtre okrsku a rizika (stav z „Použiť filtre“).</p><button type="button" class="btn btn--accent" id="btn-export-csv">Stiahnuť CSV</button></div>'
    );
  }

  function renderAdminPage() {
    var u = getUser();
    if (!canManageUsers(u)) {
      return '<div class="workspace workspace--single" style="padding:1.5rem"><p class="empty-state">403 — len admin (TC-09-02).</p></div>';
    }
    var rows = state.users
      .map(function (user) {
        return (
          '<tr><td>' +
          escapeHtml(user.email) +
          '</td><td>' +
          escapeHtml(user.name) +
          '</td><td><select class="role-sel" data-id="' +
          escapeHtml(user.id) +
          '">' +
          ['CITIZEN', 'ARBORIST', 'DISPATCHER', 'ADMIN']
            .map(function (r) {
              return '<option value="' + r + '"' + (user.role === r ? ' selected' : '') + '>' + r + '</option>';
            })
            .join('') +
          '</select></td><td>' +
          (user.district ? escapeHtml(user.district) : '—') +
          '</td></tr>'
        );
      })
      .join('');
    return (
      '<div class="workspace workspace--single" style="padding:1rem 1.25rem;overflow:auto"><h1 class="drawer__h">Správa používateľov (UC-09)</h1><div class="table-wrap"><table class="data-table"><thead><tr><th>E-mail</th><th>Meno</th><th>Rola</th><th>Okrsok (arborista)</th></tr></thead><tbody>' +
      rows +
      '</tbody></table></div><p class="hint" style="color:var(--text-dim)">Zmena roly: aktuálna session sa okamžite obnoví z údajov používateľa (TC-09-01). Cieľový účet po zmene roly vidí nové oprávnenia po ďalšom prihlásení.</p></div>'
    );
  }

  function render() {
    updateHeader();
    renderNav();
    var main = document.getElementById('main-workspace');
    if (!main) return;
    var html = '';
    if (state.route === 'overview') html = renderOverview();
    else if (state.route === 'trees') html = renderTreesPage();
    else if (state.route === 'inspections') html = renderInspectionsPage();
    else if (state.route === 'risk') html = renderRiskPage();
    else if (state.route === 'orders') html = renderOrdersPage();
    else if (state.route === 'export') html = renderExportPage();
    else if (state.route === 'admin') html = renderAdminPage();
    else html = renderOverview();
    main.innerHTML = html;
    main.className = 'workspace';
    bindOverviewHandlers();
    bindFormHandlers();
  }

  function bindFormHandlers() {
    var ft = document.getElementById('form-new-tree');
    if (ft) {
      ft.addEventListener('submit', function (e) {
        e.preventDefault();
        var fd = new FormData(ft);
        var elSp = document.getElementById('tree-err-species');
        var elC = document.getElementById('tree-err-coords');
        var inpSp = document.getElementById('tree-species');
        var inpLa = document.getElementById('tree-lat');
        var inpLn = document.getElementById('tree-lng');
        if (elSp) {
          elSp.classList.add('hidden');
          elSp.textContent = '';
        }
        if (elC) {
          elC.classList.add('hidden');
          elC.textContent = '';
        }
        if (inpSp) inpSp.classList.remove('field-input--error');
        if (inpLa) inpLa.classList.remove('field-input--error');
        if (inpLn) inpLn.classList.remove('field-input--error');
        var lat = parseFloat(fd.get('lat'));
        var lng = parseFloat(fd.get('lng'));
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180 || isNaN(lat) || isNaN(lng)) {
          toast('[HTTP 400] Neplatné súradnice WGS-84 (TC-02-02)', 'bad');
          if (elC) {
            elC.textContent = 'Neplatné súradnice (rozsah šírky -90…90, dĺžky -180…180).';
            elC.classList.remove('hidden');
          }
          if (inpLa) inpLa.classList.add('field-input--error');
          if (inpLn) inpLn.classList.add('field-input--error');
          return;
        }
        var species = (fd.get('species') || '').trim();
        if (!species) {
          toast('[HTTP 400] Validačná chyba: druh je povinný (TC-02-02)', 'bad');
          if (elSp) {
            elSp.textContent = 'Pole druh je povinné.';
            elSp.classList.remove('hidden');
          }
          if (inpSp) inpSp.classList.add('field-input--error');
          return;
        }
        var id = 'T-' + Math.floor(1000 + Math.random() * 8999);
        state.trees.push({
          id: id,
          species: species,
          lat: lat,
          lng: lng,
          district: (fd.get('district') || '').trim(),
          dbh: parseInt(fd.get('dbh'), 10) || 30,
          plantedYear: parseInt(fd.get('year'), 10) || 2000,
          address: (fd.get('address') || '').trim(),
          lifecycle: 'ACTIVE'
        });
        logEvent('TREE_CREATED', id);
        saveState(state);
        toast('Strom uložený: ' + id, 'ok');
        render();
      });
    }

    document.querySelectorAll('.role-sel').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var id = sel.getAttribute('data-id');
        var user = state.users.find(function (u) { return u.id === id; });
        if (user) {
          user.role = sel.value;
          logEvent('ROLE_CHANGED', user.email + ' -> ' + user.role);
          saveState(state);
          if (state.session && state.session.userId === id) {
            toast('Vaša rola bola zmenená — oprávnenia aktualizované (TC-09-01).', 'ok');
          } else {
            toast('Rola uložená. Cieľový účet uvidí zmenu po ďalšom prihlásení.', 'ok');
          }
          render();
        }
      });
    });

    document.querySelectorAll('.wo-st').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var id = sel.getAttribute('data-id');
        var wo = state.workOrders.find(function (w) { return w.id === id; });
        if (!wo) return;
        var newSt = sel.value;
        if (newSt === 'DONE') {
          var inp = document.querySelector('.wo-done[data-id="' + id + '"]');
          if (!inp || !inp.value) {
            toast('Vyplňte dátum dokončenia (TC-06-02)', 'warn');
            sel.value = wo.status;
            return;
          }
          wo.completedAt = inp.value + 'T12:00:00.000Z';
        }
        wo.status = newSt;
        logEvent('WORKORDER_STATUS', wo.id + ' ' + newSt);
        saveState(state);
        toast('Stav príkazu aktualizovaný', 'ok');
        render();
      });
    });

    var ex = document.getElementById('btn-export-csv');
    if (ex) {
      ex.addEventListener('click', function () {
        var trees = filterTreesByDrawer();
        var lines = [['id', 'species', 'district', 'lat', 'lng', 'dbh', 'ai_score', 'ai_category'].join(',')];
        trees.forEach(function (t) {
          var a = latestAssessmentForTree(t.id);
          lines.push(
            [t.id, '"' + t.species.replace(/"/g, '""') + '"', '"' + t.district + '"', t.lat, t.lng, t.dbh, a && a.score != null ? a.score : '', a && a.category ? a.category : ''].join(
              ','
            )
          );
        });
        var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'stromy-export.csv';
        a.click();
        URL.revokeObjectURL(a.href);
        logEvent('EXPORT_CSV', 'rows=' + trees.length);
        saveState(state);
        toast('CSV stiahnuté', 'ok');
      });
    }
  }

  function bindOverviewHandlers() {
    var main = document.getElementById('main-workspace');
    if (!main) return;

    main.querySelectorAll('.map__pin').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.selectedTreeId = btn.getAttribute('data-tree');
        saveState(state);
        render();
      });
    });

    main.querySelectorAll('.trees__item').forEach(function (li) {
      li.addEventListener('click', function () {
        state.selectedTreeId = li.getAttribute('data-tree');
        saveState(state);
        render();
      });
    });

    var flt = document.getElementById('btn-apply-flt');
    if (flt) {
      flt.addEventListener('click', function () {
        var fd = document.getElementById('flt-district');
        var fr = document.getElementById('flt-risk');
        state.filterDistrict = fd ? fd.value.trim() : '';
        state.filterRisk = fr ? fr.value : 'all';
        saveState(state);
        var t0 = performance.now();
        render();
        var ms = performance.now() - t0;
        requestAnimationFrame(function () {
          var el = document.getElementById('flt-perf');
          if (el) {
            el.textContent =
              'Filtrovanie (TC-07): ' +
              ms.toFixed(0) +
              ' ms · ' +
              filterTreesByDrawer().length +
              ' stromov' +
              (ms > 2000 ? ' — pozor: nad cieľom 2 s' : ' — v rámci cieľa <2 s');
          }
        });
      });
    }

    var fi = document.getElementById('form-insp');
    if (fi) {
      fi.addEventListener('submit', function (e) {
        e.preventDefault();
        var u = getUser();
        var t = state.trees.find(function (x) { return x.id === state.selectedTreeId; });
        if (!t || !canAccessTree(u, t)) {
          toast('HTTP 403 Forbidden — uloženie kontroly zamietnuté (TC-03-02).', 'bad');
          return;
        }
        var fd = new FormData(fi);
        var f1 = fi.querySelector('[name="f1"]').files.length;
        var f2 = fi.querySelector('[name="f2"]').files.length;
        if (f1 < 1 || f2 < 1) {
          toast('Pridajte 2 obrázky JPEG (TC-03-01)', 'warn');
          return;
        }
        var insp = {
          id: uid('IN'),
          treeId: t.id,
          userId: u.id,
          notes: (fd.get('notes') || '').trim(),
          recommendation: (fd.get('rec') || '').trim(),
          status: 'SUBMITTED',
          createdAt: nowIso(),
          mediaCount: 2
        };
        state.inspections.push(insp);
        logEvent('INSPECTION_SUBMITTED', insp.id + ' ' + t.id);
        saveState(state);
        toast('Kontrola odoslaná (SUBMITTED)', 'ok');
        fi.reset();
        render();
      });
    }

    var fw = document.getElementById('form-wo');
    if (fw) {
      fw.addEventListener('submit', function (e) {
        e.preventDefault();
        var u = getUser();
        var t = state.trees.find(function (x) { return x.id === state.selectedTreeId; });
        if (!t || !canAccessTree(u, t)) return;
        var la = latestAssessmentForTree(t.id);
        var highOk = la && assessmentHasScore(la) && la.category === 'HIGH';
        if (!highOk) {
          if (
            !window.confirm(
              'Strom nemá v tomto zázname vysoké AI riziko (HIGH). Príkaz odporúčame pri vysokom riziku (TC-06-01). Chcete pokračovať?'
            )
          ) {
            return;
          }
        }
        var fd = new FormData(fw);
        var wo = {
          id: uid('WO'),
          treeId: t.id,
          title: 'Orez',
          type: 'PRUNING',
          status: 'ASSIGNED',
          priority: 'NORMAL',
          team: (fd.get('team') || '').trim(),
          dueDate: fd.get('due') || null,
          sourceAssessmentId: (latestAssessmentForTree(t.id) || {}).id || null,
          createdAt: nowIso()
        };
        state.workOrders.push(wo);
        logEvent('WORKORDER_CREATED', wo.id);
        saveState(state);
        toast('Pracovný príkaz vytvorený', 'ok');
        render();
      });
    }

    var run = document.getElementById('btn-run-ai');
    if (run) {
      run.addEventListener('click', function () {
        var u = getUser();
        var t = state.trees.find(function (x) { return x.id === state.selectedTreeId; });
        if (!t || !canRunAi(u) || !canAccessTree(u, t)) return;
        var sc = (document.getElementById('ai-scenario') || {}).value || 'MOCK_065';
        var as = {
          id: uid('RA'),
          treeId: t.id,
          status: 'PENDING',
          requestedAt: nowIso(),
          modelVersion: 'mock-v1'
        };
        state.assessments.push(as);
        saveState(state);
        render();

        var idx = state.assessments.length - 1;

        setTimeout(function () {
          var cur = state.assessments[idx];
          if (!cur) return;
          cur.status = 'PROCESSING';
          saveState(state);
          render();

          setTimeout(function () {
            var c = state.assessments[idx];
            if (!c) return;
            if (sc === 'TIMEOUT') {
              c.status = 'FAILED';
              c.errorMessage = 'Timeout AI služby (TC-04-02)';
              logEvent('AI_TIMEOUT', c.id);
              toast('AI timeout — FAILED', 'warn');
            } else if (sc === 'INVALID') {
              c.rejectedRawScore = 1.5;
              c.status = 'FAILED';
              c.errorMessage = 'Validácia servera: skóre ' + c.rejectedRawScore + ' mimo [0,1] — neuložené ako COMPLETED (TC-04-03)';
              logEvent('AI_INVALID', c.id + ' raw=' + c.rejectedRawScore);
              toast('Validácia zlyhala — neuložené ako COMPLETED (TC-04-03)', 'warn');
            } else {
              var score = sc === 'MOCK_065' ? 0.65 : 0.25 + Math.random() * 0.7;
              c.status = 'COMPLETED';
              c.completedAt = nowIso();
              c.score = score;
              c.category = scoreToCategory(score);
              c.explanation = 'Mock výstup: stabilita a zdravotný stav (prototyp).';
              logEvent('AI_COMPLETED', c.id + ' score=' + c.score);
              toast('AI hodnotenie dokončené', 'ok');
            }
            saveState(state);
            render();
          }, 700);
        }, 400);
      });
    }

    var rev = document.getElementById('btn-review');
    if (rev) {
      rev.addEventListener('click', function () {
        var t = state.trees.find(function (x) { return x.id === state.selectedTreeId; });
        if (!t) return;
        var a = latestAssessmentForTree(t.id);
        if (!a || a.status !== 'COMPLETED') return;
        var ov = document.getElementById('rev-override');
        var reason = (document.getElementById('rev-reason') || {}).value || '';
        if (ov && ov.checked) {
          if (reason.trim().length < 20) {
            toast('Dôvod musí mať min. 20 znakov (TC-05-02)', 'bad');
            return;
          }
          a.originalAiScore = a.score;
          a.originalCategory = a.category;
          a.humanOverride = true;
          a.overrideReason = reason.trim();
          if (a.category === 'HIGH') a.category = 'MEDIUM';
          else if (a.category === 'MEDIUM') a.category = 'LOW';
          a.status = 'REVIEWED';
          logEvent('RISK_OVERRIDE', a.id + ' história AI skóre=' + a.originalAiScore);
        } else {
          a.humanOverride = false;
          a.status = 'REVIEWED';
          logEvent('RISK_CONFIRMED', a.id);
        }
        saveState(state);
        toast('Revízia uložená', 'ok');
        render();
      });
    }
  }

  function loginFailCount(email) {
    var k = LOGIN_FAIL_PREFIX + email;
    return parseInt(sessionStorage.getItem(k) || '0', 10);
  }

  function setLoginFail(email, n) {
    sessionStorage.setItem(LOGIN_FAIL_PREFIX + email, String(n));
  }

  function refreshLoginCaptcha(email) {
    var a = Math.floor(Math.random() * 9) + 1;
    var b = Math.floor(Math.random() * 9) + 1;
    sessionStorage.setItem(CAPTCHA_KEY_PREFIX + email, String(a + b));
    var q = document.getElementById('login-captcha-q');
    var inp = document.getElementById('login-captcha');
    if (q) q.textContent = 'Koľko je ' + a + ' + ' + b + '? (overenie po 3 neúspechoch, TC-01-02)';
    if (inp) inp.value = '';
  }

  function updateLoginCaptchaRow(email) {
    var row = document.getElementById('login-captcha-row');
    if (!row) return;
    if (loginFailCount(email) >= 3) {
      row.classList.remove('hidden');
      refreshLoginCaptcha(email);
    } else {
      row.classList.add('hidden');
    }
  }

  function onLoginSubmit(e) {
    e.preventDefault();
    var email = (document.getElementById('login-email').value || '').trim().toLowerCase();
    var pass = document.getElementById('login-pass').value || '';
    var err = document.getElementById('login-error');
    err.classList.add('hidden');

    var user = state.users.find(function (u) { return u.email.toLowerCase() === email; });
    if (!user || user.password !== pass) {
      setLoginFail(email, loginFailCount(email) + 1);
      err.textContent = 'Neplatné prihlasovacie údaje.';
      err.classList.remove('hidden');
      logEvent('LOGIN_FAIL', email);
      saveState(state);
      updateLoginCaptchaRow(email);
      return;
    }

    if (loginFailCount(email) >= 3) {
      var exp = sessionStorage.getItem(CAPTCHA_KEY_PREFIX + email);
      var cap = (document.getElementById('login-captcha') || {}).value || '';
      if (!exp || String(parseInt(cap, 10)) !== exp || parseInt(cap, 10) !== parseInt(exp, 10)) {
        err.textContent = 'Neplatné prihlasovacie údaje alebo overenie (CAPTCHA).';
        err.classList.remove('hidden');
        refreshLoginCaptcha(email);
        return;
      }
    }

    if (!user.active) {
      err.textContent = 'Účet je neaktívny.';
      err.classList.remove('hidden');
      return;
    }
    setLoginFail(email, 0);
    sessionStorage.removeItem(CAPTCHA_KEY_PREFIX + email);
    var capRow = document.getElementById('login-captcha-row');
    if (capRow) capRow.classList.add('hidden');
    state.session = { userId: user.id, startedAt: nowIso() };
    saveState(state);
    logEvent('LOGIN_OK', user.email);
    showLogin(false);
    navigate('overview');
  }

  function logout() {
    state.session = null;
    saveState(state);
    HASH_SYNC = true;
    if (window.location.hash) {
      window.location.hash = '';
    }
    setTimeout(function () {
      HASH_SYNC = false;
    }, 100);
    showLogin(true);
  }

  function maybeNotifyCitizenReports() {
    var u = getUser();
    if (!u || (u.role !== 'DISPATCHER' && u.role !== 'ADMIN')) return;
    var n = state.citizenReports ? state.citizenReports.length : 0;
    if (n === 0) return;
    var key = 'citizen_toast_' + (state.session && state.session.startedAt);
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, '1');
      toast('Notifikácia dashboard (TC-10): ' + n + ' občianske hlásenie(ní) — pozri panel nižšie.', 'ok');
    }
  }

  function init() {
    document.getElementById('form-login').addEventListener('submit', onLoginSubmit);
    document.getElementById('btn-logout').addEventListener('click', logout);

    document.querySelectorAll('#rail-nav .rail__link').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        navigate(a.getAttribute('data-route'));
      });
    });

    window.addEventListener('hashchange', function () {
      if (HASH_SYNC) return;
      if (!state.session) return;
      var r = hashToRoute(location.hash);
      if (r !== state.route) {
        state.route = r;
        saveState(state);
        render();
      }
    });

    var gs = document.getElementById('global-search');
    if (gs) {
      gs.addEventListener('input', function () {
        if (state.route === 'overview' || state.route === 'trees') render();
      });
    }

    if (state.session && state.users.some(function (u) { return u.id === state.session.userId; })) {
      showLogin(false);
      if (!location.hash || location.hash === '#') {
        HASH_SYNC = true;
        window.location.hash = ROUTE_TO_HASH[state.route] || '#/overview';
        setTimeout(function () {
          HASH_SYNC = false;
        }, 100);
      } else {
        state.route = hashToRoute(location.hash);
        saveState(state);
      }
      render();
      maybeNotifyCitizenReports();
    } else {
      state.session = null;
      saveState(state);
      showLogin(true);
    }
  }

  init();
})();
