(async function () {
  'use strict';
  document.documentElement.classList.add('js');
  const workspaceTime = document.querySelector('[data-workspace-time]');
  if (workspaceTime) {
    const dateLabel = document.querySelector('[data-workspace-date]');
    const weekdayLabel = document.querySelector('[data-workspace-weekday]');
    const format = options => new Intl.DateTimeFormat('tr-TR', { ...options, timeZone: 'Europe/Istanbul' });
    const timeFormat = format({ hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dateFormat = format({ day: 'numeric', month: 'long', year: 'numeric' });
    const weekdayFormat = format({ weekday: 'long' });
    const updateClock = () => {
      const now = new Date();
      workspaceTime.textContent = timeFormat.format(now);
      workspaceTime.dateTime = now.toISOString();
      dateLabel.textContent = dateFormat.format(now);
      weekdayLabel.textContent = weekdayFormat.format(now);
    };
    updateClock();
    setInterval(updateClock, 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) updateClock(); });
  }

  const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';

  // Drafts are account-scoped on the server; no form data is stored in localStorage.
  const draftForm = document.querySelector('form[data-draft-form]');
  if (draftForm) { void (async () => {
    const key = location.pathname;
    const status = document.createElement('div');
    status.className = 'draft-status d-flex flex-wrap align-items-center gap-3 mb-3';
    const message = document.createElement('span'); message.setAttribute('role','status'); message.setAttribute('aria-live','polite');
    message.textContent = 'Taslaklar bu hesaba özel, şifreli saklanır.';
    const discard = document.createElement('button'); discard.type='button'; discard.className='btn btn-link btn-sm p-0'; discard.textContent='Taslağı sil';
    status.append(message,discard); draftForm.before(status);
    let dirty=false, timer, saving=Promise.resolve(), submitting=false, stopped=false;
    const editedDuringRestore=new Set();let restoring=true;
    const trackEarly=event=>{if(restoring && event.target.name)editedDuringRestore.add(event.target.name);};
    draftForm.addEventListener('input',trackEarly);draftForm.addEventListener('change',trackEarly);
    const fields = () => [...draftForm.elements].filter(f=>f.name && !f.disabled && f.type!=='file' && f.name!=='_csrf');
    const collect = () => {
      const data={};
      for(const f of fields()) {
        if(f.type==='checkbox') {
          if(f.name==='team_ids') { if(!data[f.name])data[f.name]=[]; if(f.checked)data[f.name].push(f.value); }
          else data[f.name]=f.checked?f.value:'';
        } else if(f.type!=='submit' && f.type!=='button') data[f.name]=f.value;
      }
      if(draftForm.dataset.step) data._step=draftForm.dataset.step;
      return data;
    };
    try {
      const restoreController=new AbortController();const restoreTimeout=setTimeout(()=>restoreController.abort(),8000);
      let response;try{response=await fetch('/drafts?form='+encodeURIComponent(key),{headers:{Accept:'application/json'},signal:restoreController.signal});}finally{clearTimeout(restoreTimeout);}
      if(!response.ok)throw new Error('Taslak okunamadı');
      const draft=await response.json();
      if(draft.data) {
        const invalid=Boolean(draftForm.querySelector('.is-invalid'));
        for(const f of fields()) {
          if(editedDuringRestore.has(f.name) || (invalid && !f.dataset.sensitive))continue;
          const value=draft.data[f.name]; if(value===undefined)continue;
          if(f.type==='checkbox')f.checked=Array.isArray(value)?value.includes(f.value):String(value)===f.value;
          else if(typeof value==='string')f.value=value;
        }
        if(!invalid && !editedDuringRestore.size && !draftForm.dataset.stepTouched && draft.data._step)draftForm.dataset.restoredStep=draft.data._step;
        message.textContent='Taslağınız geri yüklendi. Kaldığınız yerden devam edebilirsiniz.';
      }
    } catch (_) { message.textContent='Taslak bağlantısı kurulamadı. Değişiklikler kaydedilene kadar bu sayfayı açık tutun.'; }
    restoring=false;draftForm.removeEventListener('input',trackEarly);draftForm.removeEventListener('change',trackEarly);
    draftForm.dispatchEvent(new Event('draft:restored'));
    const save = () => {
      clearTimeout(timer); if(!dirty || submitting || stopped)return;
      const payload=JSON.stringify({form:key,data:collect()}); dirty=false;
      saving=saving.catch(()=>{}).then(async()=>{
        const response=await fetch('/drafts',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,Accept:'application/json'},body:payload,keepalive:true});
        if(!response.ok)throw new Error('Taslak kaydedilemedi');
        if(!dirty)message.textContent='Taslak kaydedildi · yenileseniz de bilgileriniz korunur.';
      }).catch(()=>{dirty=true;message.textContent='Taslak kaydedilemedi. Bağlantıyı kontrol edin; formu kapatmayın.';});
    };
    const changed=()=>{if(stopped)return;dirty=true;message.textContent='Taslak kaydediliyor…';clearTimeout(timer);timer=setTimeout(save,250);};
    draftForm.addEventListener('input',changed); draftForm.addEventListener('change',changed); draftForm.addEventListener('draft:changed',changed);
    if(editedDuringRestore.size)changed();
    draftForm.addEventListener('submit',event=>{queueMicrotask(()=>{submitting=!event.defaultPrevented;});});
    window.addEventListener('pagehide',()=>{
      if(!dirty || submitting || stopped)return;
      navigator.sendBeacon('/drafts',new Blob([JSON.stringify({_csrf:csrf,form:key,data:collect()})],{type:'application/json'}));
    });
    discard.addEventListener('click',async()=>{
      clearTimeout(timer);stopped=true;
      try { await saving;const response=await fetch('/drafts',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({form:key,discard:true})});if(!response.ok)throw new Error();dirty=false;location.reload(); }
      catch(_){stopped=false;message.textContent='Taslak silinemedi. Tekrar deneyin.';}
    });
  })(); }

  document.querySelectorAll('[data-reveal-url]').forEach(button=>{
    let valueNode, hideTimer;
    const hide=()=>{clearTimeout(hideTimer);valueNode?.remove();valueNode=null;button.textContent='Göster';button.setAttribute('aria-expanded','false');};
    button.addEventListener('click',async()=>{
      if(valueNode){hide();return;}
      button.disabled=true;
      try {
        const response=await fetch(button.dataset.revealUrl,{method:'POST',headers:{'X-CSRF-Token':csrf,Accept:'application/json'}});
        const data=await response.json();if(!response.ok)throw new Error(data.message || 'Erişim bilgisi açılamadı.');
        valueNode=document.createElement('output');valueNode.className='d-block text-break py-2';valueNode.textContent=data.value || 'Kayıt yok';button.after(valueNode);
        button.textContent='Gizle';button.setAttribute('aria-expanded','true');hideTimer=setTimeout(hide,30000);
      } catch(error){button.textContent=error.message || 'Erişim bilgisi açılamadı';}finally{button.disabled=false;}
    });
  });

  document.querySelectorAll('.progress-bar[data-width]').forEach((el) => { el.style.width = `${el.dataset.width}%`; });

  document.querySelectorAll('select.auto-submit').forEach((el) => {
    el.addEventListener('change', () => {
      if(el.id==='flt_technology')el.form.elements.tech_version.value='';
      if(el.id==='flt_tech_category') {el.form.elements.technology.value='';el.form.elements.tech_version.value='';}
      el.form.requestSubmit();
    });
  });

  document.querySelectorAll('form[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (e) => { if (!window.confirm(form.dataset.confirm)) e.preventDefault(); });
  });

  // Focus project search with /, without interrupting form entry.
  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest('input, textarea, select, [contenteditable]')) return;
    const search = document.getElementById('project-search');
    if (search && search.getClientRects().length) { event.preventDefault(); search.focus(); }
  });

  const subdomainLabel = document.querySelector('[data-subdomain-parent]');
  if (subdomainLabel) {
    const preview = document.getElementById('subdomain-preview');
    const updatePreview = () => {
      const label = subdomainLabel.value.trim().toLowerCase();
      preview.textContent = `${label || 'panel'}.${subdomainLabel.dataset.subdomainParent}`;
    };
    subdomainLabel.addEventListener('input', updatePreview);
    updatePreview();
  }

  // Wizard
  const form = document.querySelector('form[data-wizard]');
  if (form) {
    const panes = [...form.querySelectorAll('.wizard-pane')];
    const steps = [...document.querySelectorAll('#wizardSteps .wizard-step')];
    const prev = form.querySelector('[data-prev]');
    const next = form.querySelector('[data-next]');
    const submit = form.querySelector('[data-submit]');
    let current = Math.max(0,Math.min(3,Number(form.dataset.restoredStep)||0));

    const firstErr = steps.findIndex((s) => s.classList.contains('has-error'));
    if (firstErr > 0) current = firstErr;

    const validPane = (i) => {
      const inputs = [...panes[i].querySelectorAll('input, select, textarea')];
      const bad = inputs.find((el) => !el.checkValidity());
      if (bad) { bad.reportValidity(); return false; }
      return true;
    };

    const show = (i) => {
      const previous = current;
      current = Math.max(0, Math.min(panes.length - 1, i));
      form.dataset.step = String(current);
      if(previous !== current){form.dataset.stepTouched='1';form.dispatchEvent(new Event('draft:changed'));}
      panes.forEach((p, k) => p.classList.toggle('active', k === current));
      steps.forEach((s, k) => {
        s.classList.toggle('active', k === current);
        s.classList.toggle('done', k < current);
        const btn = s.querySelector('button');
        if (k === current) btn.setAttribute('aria-current', 'step'); else btn.removeAttribute('aria-current');
      });
      prev.disabled = current === 0;
      next.classList.toggle('d-none', current === panes.length - 1);
      submit.classList.toggle('d-none', current !== panes.length - 1 && form.dataset.mode !== 'edit');
    };

    next.addEventListener('click', () => { if (validPane(current)) { show(current + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); } });
    prev.addEventListener('click', () => show(current - 1));
    steps.forEach((s, k) => s.querySelector('button').addEventListener('click', () => {
      if (k <= current || validPane(current)) show(k);
    }));
    form.addEventListener('submit', (e) => {
      for (let i = 0; i < panes.length; i += 1) {
        if ([...panes[i].querySelectorAll('input, select, textarea')].some((el) => !el.checkValidity())) {
          e.preventDefault(); show(i); validPane(i); return;
        }
      }
    });
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && current < panes.length - 1) { e.preventDefault(); next.click(); }
    });
    form.addEventListener('draft:restored',()=>{if(firstErr<0 && !form.dataset.stepTouched && form.dataset.restoredStep)show(Number(form.dataset.restoredStep));});
    show(current);
  }

  // Technology catalog: category <-> technology <-> popular versions
  const catalogEl = document.getElementById('techCatalog');
  if (catalogEl && form) {
    const cat = JSON.parse(catalogEl.textContent);
    const fld = (n) => form.elements[n];
    const baseOf = (dl) => { if (!dl.dataset.base) dl.dataset.base = JSON.stringify([...dl.options].map((o) => [o.value, o.label])); return JSON.parse(dl.dataset.base); };
    const mkOpt = ([value, label]) => { const o = document.createElement('option'); o.value = value; if (label && label !== value) o.label = label; return o; };
    const setList = (id, entries) => {
      const dl = document.getElementById(id);
      if (!dl) return;
      const seen = new Set();
      const rows = [...entries, ...baseOf(dl)].filter(([v]) => v && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()));
      dl.replaceChildren(...rows.map(mkOpt));
    };
    const techInfo = () => cat.techs[(fld('technology').value || '').trim().toLowerCase()] || null;
    const syncVersions = () => { const t = techInfo(); setList('dl_tech_version', t ? t.versions.map((v) => [v]) : []); };
    const syncLangVersions = () => setList('dl_language_version', (cat.languages[(fld('language').value || '').trim()] || []).map((v) => [v]));
    const syncTechList = () => {
      const dl = document.getElementById('dl_technology');
      if (!dl) return;
      const c = fld('tech_category').value;
      const names = c && cat.byCategory[c] ? cat.byCategory[c] : null;
      dl.replaceChildren(...baseOf(dl).filter(([v]) => !names || names.includes(v) || !cat.techs[v.toLowerCase()]).map(mkOpt));
    };
    const onTech = () => {
      const t = techInfo();
      const catSel = fld('tech_category');
      if (t && (!catSel.value || catSel.dataset.auto === '1')) { catSel.value = t.category; catSel.dataset.auto = '1'; syncTechList(); }
      if (t && t.language && fld('technology').dataset.siteDetected !== '1' && !fld('language').value) { fld('language').value = t.language; syncLangVersions(); }
      syncVersions();
    };
    fld('technology').addEventListener('input', onTech);
    fld('language').addEventListener('input', syncLangVersions);
    fld('tech_category').addEventListener('change', () => { fld('tech_category').dataset.auto = ''; syncTechList(); });
    syncTechList();
    syncVersions();
    syncLangVersions();
    form.addEventListener('draft:restored',()=>{syncTechList();syncVersions();syncLangVersions();});
  }

  // RDAP / WHOIS / DNS lookup for domain & server forms
  const lookupBar = document.querySelector('[data-lookup-url]');
  const entityForm = lookupBar && lookupBar.closest('form');
  if (lookupBar && entityForm) {
    const btn = document.getElementById('lookupBtn');
    const out = document.getElementById('lookupResult');
    const kind = lookupBar.dataset.lookupKind;
    const LABELS = { name: 'Ad', registrar: 'Registrar', registered_at: 'Kayıt tarihi', expiry_date: 'Bitiş tarihi', ssl_issuer: 'SSL sağlayıcısı', ssl_expiry: 'SSL bitiş', nameservers: "Name server'lar", dns_managed_by: 'DNS yönetimi', hostname: 'Hostname', ip_address: 'IP', provider: 'Sağlayıcı', location: 'Konum' };
    const fillIfEmpty = kind === 'servers' ? ['name'] : [];
    const mk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
    const show = (cls, text) => { out.replaceChildren(mk('div', `alert alert-${cls} mb-0 py-2 small`, text)); out.classList.remove('d-none'); };
    if(kind==='domains') {
      let lastQuery='',lookupTimer;
      const domainField=entityForm.elements.name;
      domainField.addEventListener('input',()=>{
        for(const field of entityForm.querySelectorAll('.is-detected')) {
          if(field.name!=='name' && field.dataset.lookupValue && field.value===field.dataset.lookupValue) {
            field.value='';field.classList.remove('is-detected');delete field.dataset.lookupValue;
          }
        }
        clearTimeout(lookupTimer);
        lookupTimer=setTimeout(()=>{const query=domainField.value.trim();if(query!==lastQuery && /\.[a-z\u00a1-\uffff]{2,}(?:\/.*)?$/i.test(query) && !btn.disabled){lastQuery=query;btn.click();}},700);
      });
    }
    btn.addEventListener('click', async () => {
      const f = entityForm.elements;
      const query = (kind === 'domains' ? f.name.value : (f.hostname.value || f.ip_address.value || f.name.value)).trim();
      if (!query) { show('warning', kind === 'domains' ? 'Önce alan adını yazın.' : 'Önce hostname veya IP adresini yazın.'); return; }
      btn.disabled = true;
      const orig = btn.innerHTML;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Sorgulanıyor';
      try {
        const res = await fetch(lookupBar.dataset.lookupUrl, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ query }) });
        const data = await res.json().catch(() => ({ ok: false, message: 'Sunucudan geçersiz yanıt.' }));
        if (!res.ok || !data.ok) { show('danger', data.message || 'Sorgu başarısız.'); return; }
        if (kind === 'domains' && f.name.value.trim() !== query) return;
        const changed = [];
        const unapplied = [];
        if (kind === 'domains' && data.fields?.name) {
          if (f.name.value !== data.fields.name) changed.push('name');
          f.name.value = data.fields.name;
          f.name.classList.remove('is-invalid');
          const error = f.name.parentElement.querySelector('.invalid-feedback');
          if (error) error.remove();
        }
        for (const [name, value] of Object.entries(data.fields || {})) {
          const el = f[name];
          if (!el || value === null || value === undefined || value === '') continue;
          if (el.value.trim() && (!el.classList.contains('is-detected') || (el.dataset.lookupValue && el.value!==el.dataset.lookupValue))) { if(el.value!==String(value))unapplied.push(`${LABELS[name] || name}: ${String(value).replace(/\n/g, ', ')}`);continue; }
          if (el.value === value) continue;
          el.value = value;
          el.classList.add('is-detected');
          el.dataset.lookupValue=String(value);
          changed.push(name);
        }
        const wrap = mk('div', `alert alert-${changed.length ? 'success' : 'secondary'} mb-0 py-2 small`);
        const head = mk('div', 'fw-semibold mb-1');
        head.append(mk('i', 'bi bi-check-circle me-1'), document.createTextNode(changed.length ? `${changed.length} alan dolduruldu — kontrol edip kaydedin` : 'Mevcut alanlar korundu; sorgu sonuçlarını kontrol edin'));
        wrap.append(head);
        if (changed.length) {
          const badges = mk('div', 'd-flex flex-wrap gap-1 mb-1');
          for (const name of changed) badges.append(mk('span', 'badge text-bg-light border', `${LABELS[name] || name}: ${String(data.fields[name]).replace(/\n/g, ', ')}`));
          wrap.append(badges);
        }
        if (unapplied.length) wrap.append(mk('div', 'text-warning-emphasis', 'Kaynakla farklı değerler bulundu; mevcut alanlar değiştirilmedi: '+unapplied.join(' · ')));
        if (data.summary && data.summary.length) wrap.append(mk('div', 'text-secondary', data.summary.join(' · ')));
        for (const m of data.messages || []) wrap.append(mk('div', 'text-warning-emphasis', m));
        out.replaceChildren(wrap);
        out.classList.remove('d-none');
        entityForm.dispatchEvent(new Event('draft:changed'));
      } catch (_) {
        show('danger', 'Bağlantı hatası, tekrar deneyin.');
      } finally {
        btn.disabled = false;
        btn.innerHTML = orig;
      }
    });
  }

  const projectDomain = document.getElementById('project-domain-input');
  if(projectDomain && form) {
    const button=document.getElementById('project-domain-lookup');
    const result=document.getElementById('project-domain-result');
    const selected=form.elements.domain_id;
    const techButton=document.getElementById('project-tech-lookup');
    const techResult=document.getElementById('project-tech-result');
    const techApply=document.getElementById('project-tech-apply');
    const techApplyPanel=document.getElementById('project-tech-apply-panel');
    const technologyFields=['technology','tech_category','tech_version','language','language_version','framework'];
    let detectedTechnologyFields=null;
    const invalidateTechnologyResult=()=>{detectedTechnologyFields=null;techApplyPanel?.classList.add('d-none');};
    techApply?.addEventListener('click',()=>{
      if(!detectedTechnologyFields)return;
      // Explicit application replaces all six fields so old versions cannot follow a new stack.
      for(const key of technologyFields) {
        const field=form.elements[key];if(!field)continue;
        field.value=detectedTechnologyFields[key] || '';
        field.dataset.siteAutoValue=field.value;
        if(key==='technology')field.dataset.siteDetected='1';
        field.dispatchEvent(new Event('input',{bubbles:true}));
      }
      form.dispatchEvent(new Event('draft:changed'));
      techApplyPanel?.classList.add('d-none');
      techResult.append(document.createTextNode(' · Sonuçlar forma uygulandı. Kaydederek tamamlayabilirsiniz.'));
    });
    let controller,lookupTimer,lastQuery='';
    const manualFields=[...form.querySelectorAll('[name^="domain_"]')].filter(f=>f.name!=='domain_id' && f.name!=='domain_lookup');
    const run=async()=>{
      const query=projectDomain.value.trim() || (selected.value?selected.selectedOptions[0].textContent.trim():'');if(!query){if(techResult)techResult.textContent='Önce Temel adımından bir domain / site adresi girin.';return;}
      projectDomain.value=query;
      invalidateTechnologyResult();
      lastQuery=query;controller?.abort();controller=new AbortController();const activeController=controller;button.disabled=true;if(techButton)techButton.disabled=true;result.textContent='Domain, DNS, SSL ve teknoloji ipuçları sorgulanıyor…';if(techResult)techResult.textContent='Site teknolojileri ve sürümleri sorgulanıyor…';
      try {
        const response=await fetch('/projects/lookup-domain',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,Accept:'application/json'},body:JSON.stringify({query}),signal:controller.signal});
        const data=await response.json();if(!response.ok || !data.ok)throw new Error(data.message || 'Bilgiler alınamadı.');
        if(controller!==activeController || activeController.signal.aborted || projectDomain.value.trim()!==query)return;
        for(const [key,value] of Object.entries(data.fields || {})) {
          if(key==='name')continue;
          const field=form.elements['domain_'+key];if(!field || !value || (field.value && !field.dataset.autoValue))continue;
          field.value=value;field.dataset.autoValue=value;
        }
        for(const key of technologyFields) {
          const field=form.elements[key];
          if(field?.dataset.siteAutoValue && field.value===field.dataset.siteAutoValue && !data.projectFields?.[key]) {
            field.value='';delete field.dataset.siteAutoValue;
          }
        }
        for(const [key,value] of Object.entries(data.projectFields || {})) {
          const field=form.elements[key];if(!field || !value || (field.value && field.value!==field.dataset.siteAutoValue))continue;
          if(field.tagName==='SELECT' && ![...field.options].some(o=>o.value===value))continue;
          field.value=value;field.dataset.siteAutoValue=String(value);if(key==='technology')field.dataset.siteDetected='1';field.dispatchEvent(new Event('input',{bubbles:true}));
        }
        if(data.domainId && [...selected.options].some(o=>o.value===String(data.domainId)))selected.value=String(data.domainId);
        result.textContent=[data.domainId?'Kayıtlı domain bulundu.':'Yeni domain, projeyi kaydettiğinizde eklenecek.',...(data.summary || []),...(data.messages || [])].join(' · ');
        if(techResult) {
          const technologies=data.info?.site?.technologies || [];
          const details=technologies.map(t=>`${t.name}${t.versions?.length>1?' · birden fazla sürüm: '+t.versions.join(' / '):t.version?' '+t.version:' · sürüm yayımlanmıyor'} (${t.sources?.join(', ') || t.source})`);
          techResult.textContent=details.length?details.join(' · '):(data.projectFields?.technology?`${data.projectFields.technology}${data.projectFields.tech_version?' '+data.projectFields.tech_version:' · sürüm yayımlanmıyor'}`:'Teknoloji belirlenemedi. Alanları elle doldurabilirsiniz.');
          detectedTechnologyFields=data.projectFields || {};
          if(Object.keys(detectedTechnologyFields).length)techApplyPanel?.classList.remove('d-none');
        }
        form.dispatchEvent(new Event('draft:changed'));
      }catch(error){if(error.name!=='AbortError'){result.textContent='Bilgiler alınamadı. Domaini ve diğer alanları elle doldurabilirsiniz.';if(techResult)techResult.textContent='Siteye ulaşılamadı. Alanları elle doldurabilirsiniz.';}}
      finally{if(controller===activeController){button.disabled=false;if(techButton)techButton.disabled=false;}}
    };
    button.addEventListener('click',run);
    techButton?.addEventListener('click',run);
    projectDomain.addEventListener('input',()=>{
      clearTimeout(lookupTimer);controller?.abort();invalidateTechnologyResult();
      const query=projectDomain.value.trim();
      if(selected.value && selected.selectedOptions[0]?.textContent.trim()!==query)selected.value='';
      for(const f of manualFields)if(f.dataset.autoValue && f.value===f.dataset.autoValue){f.value='';delete f.dataset.autoValue;}
      if(/\.[a-z\u00a1-\uffff]{2,}(?:\/.*)?$/i.test(query))lookupTimer=setTimeout(()=>{if(query!==lastQuery)run();},700);
    });
    selected.addEventListener('change',()=>{
      controller?.abort();clearTimeout(lookupTimer);invalidateTechnologyResult();
      projectDomain.value=selected.value?selected.selectedOptions[0].textContent.trim():'';
      for(const f of manualFields) { f.value='';delete f.dataset.autoValue; }
      form.dispatchEvent(new Event('draft:changed'));
      if(projectDomain.value)run();
    });
  }
}());
