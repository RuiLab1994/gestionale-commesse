/* ═══════════════════════════════════════════════════
   PRODUZIONE RuiLab — area produzione del gestionale
   Passo 1: catalogo modelli, file di stampa, personale e macchine.
   Usa il client Supabase e le funzioni del gestionale (sb, sbPronto,
   esc, showToast). Tempi salvati in minuti, mostrati come ore:minuti.
═══════════════════════════════════════════════════ */
(function(){
'use strict';

const RUOLI  = [['post_produzione','Post-produzione'],['decorazione','Decorazione'],['montaggio','Montaggio'],['imballaggio','Imballaggio']];
const GIORNI = [[1,'lun'],[2,'mar'],[3,'mer'],[4,'gio'],[5,'ven'],[6,'sab'],[7,'dom']];
const PAGINE = [['prod-programmazione','Programmazione'],['prod-catalogo','Catalogo'],['prod-file','File di stampa'],['prod-magazzino','Magazzino'],['prod-personale','Personale']];
const TABELLE = ['modelli','modelli_pezzi','file_stampa','file_stampa_contenuto','personale','macchine','commesse_produzione','produzione_righe','lavori','magazzino_pezzi'];

const st = {
  pagina: null, caricato: false, errore: null, inCarica: null,
  modelli: [], pezzi: [], files: [], contenuto: [], personale: [], macchine: [], cprod: [], righe: [], lavori: [], magazzino: [],
  commessaId: null, commessaNome: null,
  selModello: null, bozzaModello: null,
  selFile: null, bozzaFile: null, filtroMacchina: '', vistaFile: 'commessa', fileCommessa: null,
  cercaModelli: '', sporco: false, canale: null, timerReload: null, daRicaricare: false
};

/* ── tempi ── */
function hm(min){
  min = Math.round(Number(min) || 0);
  return Math.floor(min/60) + ':' + String(min % 60).padStart(2,'0');
}
function leggiTempo(s){
  s = String(s ?? '').trim().replace(',', '.');
  if(!s) return 0;
  let m;
  if((m = s.match(/^(\d+):([0-5]?\d)$/))) return Number(m[1])*60 + Number(m[2]);
  if((m = s.match(/^(\d+(?:\.\d+)?)\s*h?$/i))) return Math.round(parseFloat(m[1])*60);
  if((m = s.match(/^(\d+)\s*(m|min)$/i))) return Number(m[1]);
  return NaN;
}
const e = (s)=>esc(s ?? '');
const perNome = (a,b)=>String(a.nome).localeCompare(String(b.nome),'it',{sensitivity:'base'});
const tecChip = (t)=>`<span class="pchip ${t==='resina'?'resina':'fdm'}">${t==='resina'?'Resina':'FDM'}</span>`;

/* ── dati ── */
function erroreTabelle(msg){
  return /does not exist|Could not find the table|schema cache/i.test(msg||'');
}
async function carica(){
  if(!(typeof sbPronto==='function' && sbPronto())) throw new Error('Database non collegato: esci e rientra con email e password');
  const ris = await Promise.all(TABELLE.map(t=>sb.from(t).select('*')));
  ris.forEach((r,i)=>{ if(r.error) throw new Error(r.error.message + ' [' + TABELLE[i] + ']'); });
  [st.modelli, st.pezzi, st.files, st.contenuto, st.personale, st.macchine, st.cprod, st.righe, st.lavori, st.magazzino] = ris.map(r=>r.data||[]);
  st.lavori.sort((a,b)=>a.ordine-b.ordine);
  setTimeout(aggiornaPromemoria, 0);
  st.righe.sort((a,b)=>a.ordine-b.ordine);
  st.modelli.sort(perNome); st.files.sort(perNome); st.personale.sort(perNome); st.macchine.sort(perNome);
  st.pezzi.sort((a,b)=>a.ordine-b.ordine);
  st.caricato = true; st.errore = null;
}
async function assicuraDati(){
  if(st.caricato) return;
  if(!st.inCarica) st.inCarica = carica().finally(()=>{ st.inCarica = null; });
  await st.inCarica;
}
async function ricarica(){
  st.caricato = false;
  await assicuraDati();
}
function ascolta(){
  if(st.canale || !(typeof sbPronto==='function' && sbPronto())) return;
  let ch = sb.channel('ruilab-produzione');
  TABELLE.forEach(t=>{ ch = ch.on('postgres_changes', {event:'*', schema:'public', table:t}, programmaReload); });
  st.canale = ch.subscribe();
}
function programmaReload(){
  clearTimeout(st.timerReload);
  st.timerReload = setTimeout(async()=>{
    if(st.sporco){ st.daRicaricare = true; return; }   // non disturbare chi sta scrivendo
    try{ await ricarica(); if(st.pagina) render(); aggiornaRiquadro(); }catch(err){}
  }, 800);
}

const modelloDi   = (pid)=>st.pezzi.find(p=>p.id===pid);
const nomeModello = (mid)=>{ const m = st.modelli.find(x=>x.id===mid); if(!m) return '—'; return m.nome + (m.altezza_cm ? ' ' + String(m.altezza_cm).replace(/\.0$/,'') + ' cm' : '') + (m.commessa_id ? ' · commessa ' + (nomeCommessaDaId(m.commessa_id) || '?') : ''); };
const fileDelPezzo = (pid)=>{ const c = st.contenuto.find(x=>x.pezzo_id===pid); if(!c) return null; const f = st.files.find(x=>x.id===c.file_id); return f ? {file:f, quantita:c.quantita} : null; };
const nomeMacchina = (id)=>st.macchine.find(m=>m.id===id)?.nome || 'Nessuna macchina';
const modelliCatalogo = ()=>st.modelli.filter(m=>!m.commessa_id);
const pezziSenzaFile = ()=>st.pezzi.filter(p=>!st.contenuto.some(c=>c.pezzo_id===p.id) && modelliCatalogo().some(m=>m.id===p.modello_id));

/* ── struttura comune delle pagine ── */
function testata(titolo, sotto, azioni){
  const tabs = PAGINE.map(([id,l])=>`<button type="button" class="${id===st.pagina?'on':''}" onclick="showPage('${id}')">${l}</button>`).join('');
  return `<div class="prod-tabs" role="navigation" aria-label="Sezioni produzione">${tabs}</div>
    <div class="page-hdr"><div class="ttl"><span class="prod-tag"><i class="ti ti-building-factory-2"></i> Produzione</span><h1>${titolo}</h1><p>${sotto}</p></div>${azioni||''}</div>`;
}
function contenitore(id){ return document.getElementById(id.replace('prod-','prod-box-')); }

async function mostra(id){
  const daCommessa = st.daCommessa; st.daCommessa = false;
  if(id==='prod-catalogo' && !daCommessa && st.bozzaModello?.commessa_id && !st.sporco){ st.bozzaModello = null; st.selModello = null; }
  st.pagina = id;
  ascolta();
  const box = contenitore(id); if(!box) return;
  if(!st.caricato){
    box.innerHTML = testata(PAGINE.find(p=>p[0]===id)?.[1]||'', '') + '<div class="card"><div class="empty"><span class="spinner"></span><p>Carico i dati di produzione…</p></div></div>';
    try{ await assicuraDati(); }
    catch(err){ st.errore = err.message; }
  }
  if(st.pagina===id) render();
}

function render(){
  const id = st.pagina, box = contenitore(id); if(!box) return;
  if(st.errore && !st.caricato){
    const tab = erroreTabelle(st.errore);
    box.innerHTML = testata(PAGINE.find(p=>p[0]===id)?.[1]||'', '') + `<div class="prod-banner err"><i class="ti ti-alert-triangle"></i><span>${tab
      ? 'Mancano alcune tabelle della produzione nel database: esegui gli script della cartella <b>supabase/</b> che non hai ancora eseguito (02_produzione.sql, 03_commesse_produzione.sql) nello SQL Editor di Supabase, poi ricarica la pagina.'
      : 'Dati di produzione non raggiungibili: ' + e(st.errore)}</span><button class="btn sm" onclick="Prod.riprova()">Riprova</button></div>`;
    return;
  }
  if(id==='prod-catalogo') renderCatalogo(box);
  else if(id==='prod-file') renderFile(box);
  else if(id==='prod-personale') renderPersonale(box);
  else if(id==='prod-magazzino') renderMagazzino(box);
  else if(id==='prod-commessa') renderCommessa(box);
  else renderProgrammazione(box);
}

/* ═════════════ CATALOGO MODELLI ═════════════ */
function bozzaDa(m){
  if(!m) return {id:null, commessa_id:null, nome:'', altezza:'', montaggio:0, imballaggio:0, note:'', pezzi:[{id:null, nome:'', tipo:'pezzo', tecnologia:'fdm', quantita:1, cart:0, deco:0}]};
  const b = {
    id:m.id, commessa_id:m.commessa_id||null, nome:m.nome, altezza:m.altezza_cm ?? '', montaggio:m.minuti_montaggio, imballaggio:m.minuti_imballaggio, note:m.note||'',
    pezzi: st.pezzi.filter(p=>p.modello_id===m.id).map(p=>({id:p.id, nome:p.nome, tipo:p.tipo, tecnologia:p.tecnologia, quantita:p.quantita, cart:p.minuti_carteggiatura, deco:p.minuti_decorazione}))
  };
  if(!b.pezzi.length) b.pezzi.push({id:null, nome:'', tipo:'pezzo', tecnologia:'fdm', quantita:1, cart:0, deco:0});   // si parte con una riga vuota
  return b;
}
function oreLavoroModello(mid){
  const m = st.modelli.find(x=>x.id===mid); if(!m) return 0;
  return st.pezzi.filter(p=>p.modello_id===mid).reduce((s,p)=>s + p.quantita*(p.minuti_carteggiatura + p.minuti_decorazione), 0) + m.minuti_montaggio + m.minuti_imballaggio;
}

function renderCatalogo(box){
  const lista = modelliCatalogo();
  if(!st.bozzaModello){
    const sel = lista.find(m=>m.id===st.selModello) || lista[0] || null;
    st.selModello = sel?.id || null;
    st.bozzaModello = bozzaDa(sel);
    st.sporco = false;
  }
  const q = st.cercaModelli.trim().toLowerCase();
  const filtrati = lista.filter(m=>!q || (m.nome + ' ' + (m.altezza_cm||'')).toLowerCase().includes(q));
  const items = filtrati.map(m=>{
    const pz = st.pezzi.filter(p=>p.modello_id===m.id);
    const acc = pz.filter(p=>p.tipo==='accessorio').length;
    const manca = pz.some(p=>!st.contenuto.some(c=>c.pezzo_id===p.id));
    return `<button type="button" class="prod-item ${m.id===st.selModello?'sel':''}" onclick="Prod.scegliModello('${m.id}')">
      <span class="tx"><b>${e(m.nome)}</b><span>${m.altezza_cm ? e(String(m.altezza_cm).replace(/\.0$/,'')) + ' cm · ' : ''}${pz.length - acc} ${pz.length-acc===1?'pezzo':'pezzi'}${acc ? ' + ' + acc + (acc===1?' accessorio':' accessori') : ''} · ${hm(oreLavoroModello(m.id))} h</span></span>
      ${manca ? '<i class="ti ti-alert-triangle warn" title="Pezzi senza file di stampa"></i>' : ''}</button>`;
  }).join('') || `<div class="prod-empty">${lista.length ? 'Nessun modello trovato' : 'Il catalogo è vuoto: crea il primo modello'}</div>`;

  box.innerHTML = testata('Catalogo modelli', 'I prodotti del negozio, scomposti in pezzi e accessori. Ogni pezzo esce da un solo file di stampa.',
      `<button class="btn-primary" onclick="Prod.nuovoModello()"><i class="ti ti-plus"></i> Nuovo modello</button>`) +
    `<div class="prod-split">
      <div class="card prod-list"><div class="prod-list-tools"><label for="prod-cerca-mod" class="sr-only" style="position:absolute;left:-9999px">Cerca modello</label>
        <input id="prod-cerca-mod" type="search" placeholder="Cerca modello" value="${e(st.cercaModelli)}" oninput="Prod.cercaModelli(this.value)"></div>
        <div id="prod-lista-modelli">${items}</div></div>
      <div class="prod-edit" id="prod-editor-modello">${editorModello()}</div>
    </div>`;
}

function editorModello(){
  const b = st.bozzaModello;
  const righe = b.pezzi.map((p,i)=>{
    const f = p.id ? fileDelPezzo(p.id) : null;
    const fileTxt = !p.id ? '<span class="prod-file-ref none">Salva il modello, poi assegna il file</span>'
      : f ? `<span class="prod-file-ref"><b>${e(f.file.nome)}</b><span class="muted">ne escono ${f.quantita}</span></span>`
      : '<span class="prod-file-ref none"><i class="ti ti-alert-triangle"></i> Nessun file</span>';
    return `<tr>
      <td><input type="text" value="${e(p.nome)}" placeholder="es. Testa" aria-label="Nome pezzo" oninput="Prod.pz(${i},'nome',this.value)"></td>
      <td><select aria-label="Tipo" onchange="Prod.pz(${i},'tipo',this.value)"><option value="pezzo" ${p.tipo==='pezzo'?'selected':''}>Pezzo</option><option value="accessorio" ${p.tipo==='accessorio'?'selected':''}>Accessorio</option></select></td>
      <td><select aria-label="Tecnologia" onchange="Prod.pz(${i},'tecnologia',this.value)"><option value="fdm" ${p.tecnologia==='fdm'?'selected':''}>FDM</option><option value="resina" ${p.tecnologia==='resina'?'selected':''}>Resina</option></select></td>
      <td class="q"><input type="number" min="1" value="${p.quantita}" aria-label="Quantità per statua" oninput="Prod.pz(${i},'quantita',this.value)"></td>
      <td class="t"><input type="text" value="${hm(p.cart)}" aria-label="Carteggiatura" onchange="Prod.pzTempo(${i},'cart',this)"></td>
      <td class="t"><input type="text" value="${hm(p.deco)}" aria-label="Decorazione" onchange="Prod.pzTempo(${i},'deco',this)"></td>
      <td>${fileTxt}</td>
      <td><button type="button" class="btn-del" aria-label="Elimina pezzo" onclick="Prod.togliPezzo(${i})">×</button></td>
    </tr>`;
  }).join('');

  const personalizzata = b.commessa_id ? `<div class="prod-banner" style="margin:16px 20px 0;background:var(--purple-bg);border-color:transparent;color:var(--purple)"><i class="ti ti-sparkles"></i><span style="flex:1">Statua personalizzata della commessa <b>${e(nomeCommessaDaId(b.commessa_id)||'')}</b>: non compare nel catalogo del negozio.</span><button class="btn sm" onclick="Prod.tornaACommessa()"><i class="ti ti-arrow-left"></i> Torna alla commessa</button></div>` : '';
  return `<div class="card">${personalizzata}
    <div class="prod-form">
      <div class="field grow"><label for="pm-nome">${b.commessa_id ? 'Nome della statua' : 'Nome del modello'}</label><input id="pm-nome" type="text" value="${e(b.nome)}" placeholder="es. Madonna di Lourdes" oninput="Prod.mod('nome',this.value)"></div>
      <div class="field small"><label for="pm-alt">Altezza (cm)</label><input id="pm-alt" type="number" min="0" step="0.5" value="${e(b.altezza)}" oninput="Prod.mod('altezza',this.value)"></div>
      <div class="prod-actions">
        ${b.id && !b.commessa_id ? `<button class="btn" onclick="Prod.duplicaModello()"><i class="ti ti-copy"></i> Duplica</button>
        <button class="btn danger" onclick="Prod.eliminaModello()"><i class="ti ti-trash"></i></button>` : ''}
        <button class="btn btn-save" id="pm-salva" onclick="Prod.salvaModello()"><i class="ti ti-device-floppy"></i> Salva</button>
      </div>
    </div>
    <div class="prod-sec-title">Pezzi e accessori di una statua</div>
    <div class="prod-sec-sub">Tempi in ore:minuti (es. 1:30). La stampa si indica nei file di stampa.</div>
    <div class="prod-tbl-wrap"><table class="prod-tbl">
      <thead><tr><th>Pezzo</th><th>Tipo</th><th>Tecnologia</th><th>Per statua</th><th>Carteggiatura</th><th>Decorazione</th><th>Esce dal file</th><th><span style="position:absolute;left:-9999px">Elimina</span></th></tr></thead>
      <tbody>${righe}</tbody></table></div>
    <div class="prod-add">
      <button class="btn-add" onclick="Prod.aggiungiPezzo('pezzo')"><i class="ti ti-plus"></i> Aggiungi pezzo</button>
      <button class="btn-add" onclick="Prod.aggiungiPezzo('accessorio')"><i class="ti ti-plus"></i> Aggiungi accessorio (corona, diadema, bastone…)</button>
    </div>
    <div class="prod-sec-title">Statua intera</div>
    <div class="prod-form" style="border-bottom:none;padding-top:8px">
      <div class="field mid"><label for="pm-mont">Montaggio (incollaggio, ritocco, controllo)</label><input id="pm-mont" type="text" value="${hm(b.montaggio)}" onchange="Prod.modTempo('montaggio',this)"></div>
      <div class="field mid"><label for="pm-imb">Imballaggio</label><input id="pm-imb" type="text" value="${hm(b.imballaggio)}" onchange="Prod.modTempo('imballaggio',this)"></div>
      <div class="field grow"><label for="pm-note">Note</label><input id="pm-note" type="text" value="${e(b.note)}" oninput="Prod.mod('note',this.value)"></div>
    </div>
    <div class="prod-sec-title">Totale per una statua</div>
    <div class="prod-tot" id="pm-totali">${totaliModello()}</div>
  </div>`;
}
function totaliModello(){
  const b = st.bozzaModello;
  const cart = b.pezzi.reduce((s,p)=>s + (Number(p.quantita)||0)*p.cart, 0);
  const deco = b.pezzi.reduce((s,p)=>s + (Number(p.quantita)||0)*p.deco, 0);
  const persone = cart + deco + b.montaggio + b.imballaggio;
  const files = [...new Set(b.pezzi.filter(p=>p.id).map(p=>fileDelPezzo(p.id)?.file).filter(Boolean))];
  const fTxt = files.length ? files.map(f=>`${e(f.nome)} (${hm(f.minuti_durata)})`).join(' · ') : 'nessuno ancora';
  return `<div><small>Carteggiatura</small><b>${hm(cart)}</b></div>
    <div><small>Decorazione</small><b>${hm(deco)}</b></div>
    <div><small>Montaggio + imballaggio</small><b>${hm(b.montaggio + b.imballaggio)}</b></div>
    <div class="hl"><small>Lavoro delle persone</small><b>${hm(persone)}</b></div>
    <div style="grid-column:1/-1"><small>File di stampa usati</small><span style="font-size:14px">${fTxt}</span></div>`;
}
function aggiornaTotali(){ const t = document.getElementById('pm-totali'); if(t) t.innerHTML = totaliModello(); }
function segnaSporco(){ st.sporco = true; const b = document.getElementById('pm-salva') || document.getElementById('pf-salva'); if(b) b.classList.add('primary'); }
function puoiLasciare(){ return !st.sporco || confirm('Ci sono modifiche non salvate. Lasciarle?'); }
function riediModello(){ const ed = document.getElementById('prod-editor-modello'); if(ed) ed.innerHTML = editorModello(); if(st.sporco) segnaSporco(); }

async function salvaModello(){
  const b = st.bozzaModello;
  if(!b.nome.trim()){ showToast('Scrivi il nome del modello','error'); document.getElementById('pm-nome')?.focus(); return; }
  if(b.pezzi.some(p=>!p.nome.trim())){ showToast('Ogni pezzo deve avere un nome','error'); return; }
  if(b.pezzi.some(p=>!(Number(p.quantita)>=1))){ showToast('La quantità per statua deve essere almeno 1','error'); return; }
  const btn = document.getElementById('pm-salva'); if(btn){ btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Salvo…'; }
  try{
    const rec = {nome:b.nome.trim(), altezza_cm: b.altezza==='' ? null : Number(b.altezza), minuti_montaggio:b.montaggio, minuti_imballaggio:b.imballaggio, note:b.note};
    let id = b.id;
    if(id){ const r = await sb.from('modelli').update(rec).eq('id', id); if(r.error) throw r.error; }
    else { const r = await sb.from('modelli').insert(rec).select('id').single(); if(r.error) throw r.error; id = r.data.id; }
    const prima = st.pezzi.filter(p=>p.modello_id===id).map(p=>p.id);
    const tenuti = b.pezzi.filter(p=>p.id).map(p=>p.id);
    const via = prima.filter(x=>!tenuti.includes(x));
    if(via.length){ const r = await sb.from('modelli_pezzi').delete().in('id', via); if(r.error) throw r.error; }
    const riga = (p,i)=>({modello_id:id, ordine:i, nome:p.nome.trim(), tipo:p.tipo, tecnologia:p.tecnologia, quantita:Number(p.quantita), minuti_carteggiatura:p.cart, minuti_decorazione:p.deco});
    const esistenti = b.pezzi.map((p,i)=>p.id ? {id:p.id, ...riga(p,i)} : null).filter(Boolean);
    const nuovi = b.pezzi.map((p,i)=>p.id ? null : riga(p,i)).filter(Boolean);
    if(esistenti.length){ const r = await sb.from('modelli_pezzi').upsert(esistenti); if(r.error) throw r.error; }
    if(nuovi.length){ const r = await sb.from('modelli_pezzi').insert(nuovi); if(r.error) throw r.error; }
    await ricarica();
    st.selModello = id; st.bozzaModello = bozzaDa(st.modelli.find(m=>m.id===id)); st.sporco = false;
    showToast('Modello salvato ✓');
    render();
  }catch(err){
    showToast('Salvataggio non riuscito: ' + (err.message||err), 'error');
    if(btn){ btn.disabled = false; btn.innerHTML = '<i class="ti ti-device-floppy"></i> Salva'; }
  }
}

async function eliminaModello(){
  const b = st.bozzaModello; if(!b.id) return;
  const inFile = b.pezzi.filter(p=>p.id && fileDelPezzo(p.id)).length;
  if(!confirm(`Eliminare il modello "${b.nome}"?` + (inFile ? `\n\n${inFile} suoi pezzi verranno tolti dai file di stampa.` : ''))) return;
  const r = await sb.from('modelli').delete().eq('id', b.id);
  if(r.error){ showToast('Eliminazione non riuscita: ' + r.error.message, 'error'); return; }
  st.selModello = null; st.bozzaModello = null; st.sporco = false;
  await ricarica(); showToast('Modello eliminato');
  if(b.commessa_id && st.commessaId===b.commessa_id){ st.daCommessa = false; showPage('prod-commessa'); } else render();
}

/* ═════════════ FILE DI STAMPA ═════════════ */
function bozzaFileDa(f){
  if(!f) return {id:null, nome:'', macchina_id: st.macchine.find(m=>!m.esterno)?.id || '', durata:0, note:'', righe:[{pezzo_id:'', quantita:1}]};
  return {id:f.id, nome:f.nome, macchina_id:f.macchina_id||'', durata:f.minuti_durata, note:f.note||'',
    righe: st.contenuto.filter(c=>c.file_id===f.id).map(c=>({pezzo_id:c.pezzo_id, quantita:c.quantita}))};
}
function renderFile(box){
  const lista = st.files.filter(f=>!st.filtroMacchina || f.macchina_id===st.filtroMacchina);
  if(!st.bozzaFile){
    const sel = st.files.find(f=>f.id===st.selFile) || lista[0] || null;
    st.selFile = sel?.id || null;
    st.bozzaFile = bozzaFileDa(sel);
    st.sporco = false;
  }
  const senza = pezziSenzaFile();
  const banner = senza.length ? `<div class="prod-banner"><i class="ti ti-alert-triangle"></i><span>${senza.length} ${senza.length===1?'pezzo del catalogo non esce':'pezzi del catalogo non escono'} da nessun file: ${senza.slice(0,6).map(p=>e(nomeModello(p.modello_id) + ' · ' + p.nome)).join(', ')}${senza.length>6?'…':''}</span></div>` : '';
  const voceFile = (f, extra)=>{
    const cont = st.contenuto.filter(c=>c.file_id===f.id);
    const nPezzi = cont.reduce((s,c)=>s + c.quantita, 0);
    const nMod = new Set(cont.map(c=>modelloDi(c.pezzo_id)?.modello_id)).size;
    return `<button type="button" class="prod-item ${f.id===st.selFile?'sel':''}" onclick="Prod.scegliFile('${f.id}')">
      <span class="tx"><b>${e(f.nome)}</b><span>${extra ? extra + ' · ' : ''}${e(nomeMacchina(f.macchina_id))} · ${hm(f.minuti_durata)} · ${nPezzi} ${nPezzi===1?'pezzo':'pezzi'}${nMod>1 ? ', ' + nMod + ' modelli' : ''}</span></span></button>`;
  };
  const vista = `<div class="prod-pills"><button class="prod-pill ${st.vistaFile==='commessa'?'on':''}" onclick="Prod.vistaFile('commessa')">Per commessa</button><button class="prod-pill ${st.vistaFile==='macchina'?'on':''}" onclick="Prod.vistaFile('macchina')">Per macchina</button></div>`;
  let items;
  if(st.vistaFile==='commessa'){
    // commesse aperte in produzione (nell'ordine della coda), poi quelle in preparazione
    const aperte = codaProduzione().concat(st.cprod.filter(x=>x.stato==='preparazione'));
    const usati = new Set();
    items = aperte.map(x=>{
      const cid = x.commessa_id, nome = nomeCommessaDaId(cid) || '?';
      const lanci = lanciCommessa(cid);
      lanci.forEach(l=>usati.add(l.file.id));
      const senzaFile = righeDi(cid).flatMap(r=>st.pezzi.filter(p=>p.modello_id===r.modello_id)).filter(p=>!fileDelPezzo(p.id));
      const stato = x.stato==='avviata' ? '<span class="pchip resina">Avviata</span>' : x.stato==='produzione' ? '<span class="pchip grey">In coda</span>' : '<span class="pchip fdm">In preparazione</span>';
      return `<div class="prod-grp"><div class="prod-grp-hdr"><b>${e(nome)}</b>${stato}</div>
        ${lanci.map(l=>voceFile(l.file, 'da lanciare ×' + l.n)).join('')}
        ${senzaFile.length ? `<div class="prod-grp-warn"><i class="ti ti-alert-triangle"></i> ${senzaFile.length} ${senzaFile.length===1?'pezzo':'pezzi'} senza file <button class="btn sm" onclick="Prod.nuovoFile('${cid}')">+ File per questa commessa</button></div>` : ''}
        ${!lanci.length && !senzaFile.length ? '<div class="prod-empty" style="padding:10px 14px;text-align:left">Nessuna statua con modello</div>' : ''}
      </div>`;
    }).join('');
    const altri = st.files.filter(f=>!usati.has(f.id));
    if(altri.length) items += `<div class="prod-grp"><div class="prod-grp-hdr"><b>Altri file</b><span class="pchip grey">non usati dalle commesse aperte</span></div>${altri.map(f=>voceFile(f)).join('')}</div>`;
    if(!items) items = `<div class="prod-empty">Nessun file ancora: creane uno</div>`;
  } else {
    const pills = `<button class="prod-pill ${!st.filtroMacchina?'on':''}" onclick="Prod.filtraMacchina('')">Tutte</button>` +
      st.macchine.filter(m=>st.files.some(f=>f.macchina_id===m.id)).map(m=>`<button class="prod-pill ${st.filtroMacchina===m.id?'on':''}" onclick="Prod.filtraMacchina('${m.id}')">${e(m.nome)}</button>`).join('');
    items = `<div class="prod-list-tools" style="border-top:1px solid var(--border)"><div class="prod-pills">${pills}</div></div>` +
      (lista.map(f=>voceFile(f)).join('') || `<div class="prod-empty">${st.files.length ? 'Nessun file per questa macchina' : 'Nessun file ancora: creane uno'}</div>`);
  }

  box.innerHTML = testata('File di stampa', 'Un file per macchina, con tutto quello che esce da un lancio. Può mescolare pezzi di modelli diversi; ogni pezzo esce da un solo file.',
      `<button class="btn-primary" onclick="Prod.nuovoFile()"><i class="ti ti-plus"></i> Nuovo file</button>`) + banner +
    `<div class="prod-split">
      <div class="card prod-list"><div class="prod-list-tools">${vista}</div>${items}</div>
      <div class="prod-edit" id="prod-editor-file">${editorFile()}</div>
    </div>`;
}
function opzioniPezzi(sceltoId){
  const b = st.bozzaFile;
  const altrove = new Set(st.contenuto.filter(c=>c.file_id!==b.id).map(c=>c.pezzo_id));
  const inQuesto = new Set(b.righe.map(r=>r.pezzo_id).filter(x=>x && x!==sceltoId));
  const daCommessa = st.fileCommessa ? new Set(righeDi(st.fileCommessa).map(r=>r.modello_id)) : new Set();
  const gruppi = st.modelli.slice().sort((a,b)=>(daCommessa.has(b.id)?1:0) - (daCommessa.has(a.id)?1:0) || perNome(a,b)).map(m=>{
    const pz = st.pezzi.filter(p=>p.modello_id===m.id && (p.id===sceltoId || (!altrove.has(p.id) && !inQuesto.has(p.id))));
    if(!pz.length) return '';
    return `<optgroup label="${daCommessa.has(m.id) ? '★ ' : ''}${e(nomeModello(m.id))}">${pz.map(p=>`<option value="${p.id}" ${p.id===sceltoId?'selected':''}>${e(p.nome)}${p.tipo==='accessorio'?' (accessorio)':''} · ${p.tecnologia==='resina'?'resina':'FDM'}</option>`).join('')}</optgroup>`;
  }).join('');
  return `<option value="">Scegli il pezzo…</option>` + gruppi;
}
function editorFile(){
  const b = st.bozzaFile;
  const macchine = st.macchine.map(m=>`<option value="${m.id}" ${m.id===b.macchina_id?'selected':''}>${e(m.nome)}${m.esterno?' (esterno)':''}</option>`).join('');
  const righe = b.righe.map((r,i)=>{
    const p = r.pezzo_id ? modelloDi(r.pezzo_id) : null;
    const basta = p ? Math.floor((Number(r.quantita)||0) / p.quantita) : 0;
    return `<tr>
      <td><select aria-label="Pezzo" onchange="Prod.rigaFile(${i},'pezzo_id',this.value)">${opzioniPezzi(r.pezzo_id)}</select></td>
      <td class="q"><input type="number" min="1" value="${r.quantita}" aria-label="Quanti ne escono" oninput="Prod.rigaFile(${i},'quantita',this.value)"></td>
      <td>${p ? tecChip(p.tecnologia) : ''}</td>
      <td class="muted">${p ? (basta + (basta===1?' statua':' statue')) : ''}</td>
      <td><button type="button" class="btn-del" aria-label="Togli dal file" onclick="Prod.togliRigaFile(${i})">×</button></td>
    </tr>`;
  }).join('');
  return `<div class="card">
    <div class="prod-form">
      <div class="field grow"><label for="pf-nome">Nome del file</label><input id="pf-nome" type="text" value="${e(b.nome)}" placeholder="es. Lourdes_resina_A" oninput="Prod.fileCampo('nome',this.value)"></div>
      <div class="field mid"><label for="pf-mac">Macchina</label><select id="pf-mac" onchange="Prod.fileCampo('macchina_id',this.value)"><option value="">Scegli…</option>${macchine}</select></div>
      <div class="field small"><label for="pf-dur">Durata</label><input id="pf-dur" type="text" value="${hm(b.durata)}" onchange="Prod.fileTempo(this)"></div>
      <div class="prod-actions">
        ${b.id ? `<button class="btn danger" onclick="Prod.eliminaFile()"><i class="ti ti-trash"></i></button>` : ''}
        <button class="btn btn-save" id="pf-salva" onclick="Prod.salvaFile()"><i class="ti ti-device-floppy"></i> Salva</button>
      </div>
    </div>
    <div class="prod-sec-title">Cosa esce da un lancio</div>
    <div class="prod-sec-sub">Puoi aggiungere pezzi di modelli diversi. Un pezzo già presente in un altro file non compare nell'elenco.</div>
    <div class="prod-tbl-wrap"><table class="prod-tbl" style="min-width:600px">
      <thead><tr><th>Pezzo</th><th>Quanti ne escono</th><th>Tecnologia</th><th>Basta per</th><th><span style="position:absolute;left:-9999px">Togli</span></th></tr></thead>
      <tbody>${righe}</tbody></table></div>
    <div class="prod-add"><button class="btn-add" onclick="Prod.aggiungiRigaFile()"><i class="ti ti-plus"></i> Aggiungi pezzo (da qualsiasi modello)</button></div>
    <div class="prod-form" style="border-bottom:none;padding-top:0">
      <div class="field grow"><label for="pf-note">Note</label><input id="pf-note" type="text" value="${e(b.note)}" placeholder="es. supporti, orientamento, materiale" oninput="Prod.fileCampo('note',this.value)"></div>
    </div>
  </div>`;
}
function riediFile(){ const ed = document.getElementById('prod-editor-file'); if(ed) ed.innerHTML = editorFile(); if(st.sporco) segnaSporco(); }

async function salvaFile(){
  const b = st.bozzaFile;
  const righe = b.righe.filter(r=>r.pezzo_id);
  if(!b.nome.trim()){ showToast('Scrivi il nome del file','error'); return; }
  if(!b.macchina_id){ showToast('Scegli la macchina','error'); return; }
  if(!(b.durata>0)){ showToast('Indica la durata della stampa','error'); return; }
  if(!righe.length){ showToast('Aggiungi almeno un pezzo','error'); return; }
  if(righe.some(r=>!(Number(r.quantita)>=1))){ showToast('Le quantità devono essere almeno 1','error'); return; }
  const btn = document.getElementById('pf-salva'); if(btn){ btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Salvo…'; }
  try{
    const rec = {nome:b.nome.trim(), macchina_id:b.macchina_id, minuti_durata:b.durata, note:b.note};
    let id = b.id;
    if(id){ const r = await sb.from('file_stampa').update(rec).eq('id', id); if(r.error) throw r.error; }
    else { const r = await sb.from('file_stampa').insert(rec).select('id').single(); if(r.error) throw r.error; id = r.data.id; }
    let r = await sb.from('file_stampa_contenuto').delete().eq('file_id', id); if(r.error) throw r.error;
    r = await sb.from('file_stampa_contenuto').insert(righe.map(x=>({file_id:id, pezzo_id:x.pezzo_id, quantita:Number(x.quantita)}))); if(r.error) throw r.error;
    await ricarica();
    st.selFile = id; st.bozzaFile = bozzaFileDa(st.files.find(f=>f.id===id)); st.sporco = false;
    showToast('File salvato ✓');
    render();
  }catch(err){
    const msg = err.code==='23505' ? (/nome/.test(err.message) ? 'Esiste già un file con questo nome' : 'Un pezzo è già in un altro file') : (err.message||err);
    showToast('Salvataggio non riuscito: ' + msg, 'error');
    if(btn){ btn.disabled = false; btn.innerHTML = '<i class="ti ti-device-floppy"></i> Salva'; }
  }
}
async function eliminaFile(){
  const b = st.bozzaFile; if(!b.id) return;
  if(!confirm(`Eliminare il file "${b.nome}"? I suoi pezzi resteranno senza file.`)) return;
  const r = await sb.from('file_stampa').delete().eq('id', b.id);
  if(r.error){ showToast('Eliminazione non riuscita: ' + r.error.message, 'error'); return; }
  st.selFile = null; st.bozzaFile = null; st.sporco = false;
  await ricarica(); showToast('File eliminato'); render();
}

/* ═════════════ PERSONALE E MACCHINE ═════════════ */
function renderPersonale(box){
  const attivi = st.personale.filter(p=>p.attivo);
  const tiles = RUOLI.map(([k,l])=>{
    const chi = attivi.filter(p=>(p.ruoli||[]).includes(k));
    const ore = chi.reduce((s,p)=>s + Number(p.ore_settimanali||0), 0);
    return `<div class="kpi card" style="padding:16px 18px"><div class="kpi-label">${l}</div><div class="kpi-val">${String(ore).replace(/\.0+$/,'')} h<span style="font-size:14px;font-weight:500;color:var(--text2)"> / settimana</span></div><div class="kpi-sub">${chi.length ? e(chi.map(p=>p.nome).join(', ')) : 'nessuno'}</div></div>`;
  }).join('');
  const persone = st.personale.map(p=>`<tr ${p.attivo?'':'style="opacity:.55"'}>
      <td><b>${e(p.nome)}</b>${p.attivo?'':' <span class="pchip grey">non attivo</span>'}</td>
      <td><span style="display:flex;flex-wrap:wrap;gap:6px">${(p.ruoli||[]).map(r=>`<span class="pchip grey">${e(RUOLI.find(x=>x[0]===r)?.[1]||r)}</span>`).join('') || '—'}</span></td>
      <td>${String(p.ore_settimanali).replace(/\.0+$/,'')} h</td>
      <td class="muted">${giorniTxt(p.giorni)}</td>
      <td style="text-align:right"><button class="btn sm" onclick="Prod.apriPersona('${p.id}')">Modifica</button></td></tr>`).join('')
    || `<tr><td colspan="5"><div class="prod-empty">Nessuna persona ancora: aggiungi chi lavora in studio</div></td></tr>`;
  const macchine = st.macchine.map(m=>`<tr ${m.attiva?'':'style="opacity:.55"'}>
      <td><b>${e(m.nome)}</b>${m.attiva?'':' <span class="pchip grey">non attiva</span>'}</td>
      <td>${m.esterno ? '<span class="pchip est">Esterno</span>' : '<span class="pchip grey">In studio</span>'}</td>
      <td><span style="display:flex;gap:6px">${(m.tecnologie||[]).map(tecChip).join('')}</span></td>
      <td>${m.esterno ? 'consegna in ' + m.giorni_consegna + ' giorni' : String(m.ore_giorno).replace(/\.0+$/,'') + ' h al giorno'}</td>
      <td style="text-align:right"><button class="btn sm" onclick="Prod.apriMacchina('${m.id}')">Modifica</button></td></tr>`).join('')
    || `<tr><td colspan="5"><div class="prod-empty">Nessuna macchina</div></td></tr>`;

  box.innerHTML = testata('Personale e macchine', 'Le ore disponibili ogni settimana: la programmazione riempirà solo queste.') +
    `<div class="kpi-row">${tiles}</div>
    <div class="card" style="margin-bottom:18px">
      <div class="card-hdr"><h2>Personale</h2><button class="btn sm" onclick="Prod.apriPersona('')"><i class="ti ti-plus"></i> Aggiungi persona</button></div>
      <div class="prod-tbl-wrap"><table class="prod-tbl"><thead><tr><th>Nome</th><th>Ruoli</th><th>Ore settimanali</th><th>Giorni</th><th></th></tr></thead><tbody>${persone}</tbody></table></div>
      <p class="muted" style="font-size:13px;padding:12px 20px 16px">Una persona con più ruoli conta in ognuno, ma la programmazione non le darà mai due lavori nello stesso momento.</p>
    </div>
    <div class="card">
      <div class="card-hdr"><h2>Macchine e stampatori esterni</h2><button class="btn sm" onclick="Prod.apriMacchina('')"><i class="ti ti-plus"></i> Aggiungi macchina</button></div>
      <div class="prod-tbl-wrap"><table class="prod-tbl"><thead><tr><th>Nome</th><th>Dove</th><th>Tecnologia</th><th>Disponibilità</th><th></th></tr></thead><tbody>${macchine}</tbody></table></div>
    </div>`;
}
function giorniTxt(g){
  g = (g||[]).map(Number).sort();
  if(!g.length) return '—';
  const cons = g.every((x,i)=>i===0 || x===g[i-1]+1);
  const nome = (n)=>GIORNI.find(x=>x[0]===n)?.[1];
  return cons && g.length>2 ? nome(g[0]) + '–' + nome(g[g.length-1]) : g.map(nome).join(', ');
}
function modale(html){
  let m = document.getElementById('prod-modal');
  if(!m){ m = document.createElement('div'); m.id = 'prod-modal'; m.className = 'overlay prod-modal hidden'; document.body.appendChild(m);
    m.addEventListener('click', ev=>{ if(ev.target===m) chiudiModale(); }); }
  m.innerHTML = `<div class="setup-card" role="dialog" aria-modal="true">${html}</div>`;
  m.classList.remove('hidden');
  setTimeout(()=>m.querySelector('input')?.focus(), 30);
}
function chiudiModale(){ document.getElementById('prod-modal')?.classList.add('hidden'); }

function apriPersona(id){
  const p = st.personale.find(x=>x.id===id) || {nome:'', ruoli:[], ore_settimanali:40, giorni:[1,2,3,4,5], attivo:true, note:''};
  modale(`<h3><i class="ti ti-user"></i> ${id ? 'Modifica persona' : 'Nuova persona'}</h3>
    <div class="field"><label for="pp-nome">Nome</label><input id="pp-nome" type="text" value="${e(p.nome)}"></div>
    <div class="field"><label>Ruoli</label><div class="prod-checkrow">${RUOLI.map(([k,l])=>`<label><input type="checkbox" name="pp-ruolo" value="${k}" ${(p.ruoli||[]).includes(k)?'checked':''}> ${l}</label>`).join('')}</div></div>
    <div class="field"><label for="pp-ore">Ore settimanali</label><input id="pp-ore" type="number" min="0" step="0.5" value="${p.ore_settimanali}"></div>
    <div class="field"><label>Giorni di lavoro</label><div class="prod-checkrow">${GIORNI.map(([n,l])=>`<label><input type="checkbox" name="pp-giorno" value="${n}" ${(p.giorni||[]).map(Number).includes(n)?'checked':''}> ${l}</label>`).join('')}</div></div>
    <div class="field"><label for="pp-note">Note</label><input id="pp-note" type="text" value="${e(p.note)}"></div>
    <div class="field"><div class="prod-checkrow"><label><input type="checkbox" id="pp-attivo" ${p.attivo?'checked':''}> Attivo (conta nella programmazione)</label></div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn-primary" onclick="Prod.salvaPersona('${id}')"><i class="ti ti-check"></i> Salva</button>
      ${id ? `<button class="btn-skip" style="color:var(--red)" onclick="Prod.eliminaPersona('${id}')">Elimina</button>` : ''}
      <button class="btn-skip" onclick="Prod.chiudiModale()">Annulla</button>
    </div>`);
}
async function salvaPersona(id){
  const val = (n)=>[...document.querySelectorAll(`input[name="${n}"]:checked`)].map(x=>x.value);
  const rec = {
    nome: document.getElementById('pp-nome').value.trim(),
    ruoli: val('pp-ruolo'),
    ore_settimanali: Number(document.getElementById('pp-ore').value)||0,
    giorni: val('pp-giorno').map(Number),
    note: document.getElementById('pp-note').value,
    attivo: document.getElementById('pp-attivo').checked
  };
  if(!rec.nome){ showToast('Scrivi il nome','error'); return; }
  if(!rec.giorni.length){ showToast('Scegli almeno un giorno di lavoro','error'); return; }
  const r = id ? await sb.from('personale').update(rec).eq('id', id) : await sb.from('personale').insert(rec);
  if(r.error){ showToast('Salvataggio non riuscito: ' + r.error.message, 'error'); return; }
  chiudiModale(); await ricarica(); showToast('Salvato ✓'); render();
}
async function eliminaPersona(id){
  const p = st.personale.find(x=>x.id===id);
  if(!confirm(`Eliminare ${p?.nome||'questa persona'}? Se è solo in pausa, togli la spunta "Attivo" invece di eliminarla.`)) return;
  const r = await sb.from('personale').delete().eq('id', id);
  if(r.error){ showToast('Eliminazione non riuscita: ' + r.error.message, 'error'); return; }
  chiudiModale(); await ricarica(); showToast('Eliminata'); render();
}
function apriMacchina(id){
  const m = st.macchine.find(x=>x.id===id) || {nome:'', tecnologie:['fdm'], esterno:false, ore_giorno:20, giorni_consegna:7, attiva:true, note:''};
  modale(`<h3><i class="ti ti-printer"></i> ${id ? 'Modifica macchina' : 'Nuova macchina'}</h3>
    <div class="field"><label for="pk-nome">Nome</label><input id="pk-nome" type="text" value="${e(m.nome)}"></div>
    <div class="field"><label>Tecnologia</label><div class="prod-checkrow">
      <label><input type="checkbox" name="pk-tec" value="resina" ${(m.tecnologie||[]).includes('resina')?'checked':''}> Resina</label>
      <label><input type="checkbox" name="pk-tec" value="fdm" ${(m.tecnologie||[]).includes('fdm')?'checked':''}> FDM</label></div></div>
    <div class="field"><div class="prod-checkrow"><label><input type="checkbox" id="pk-est" ${m.esterno?'checked':''} onchange="Prod.toggleEsterno(this.checked)"> Stampatore esterno</label></div></div>
    <div class="field" id="pk-ore-box" ${m.esterno?'style="display:none"':''}><label for="pk-ore">Ore di stampa al giorno</label><input id="pk-ore" type="number" min="0" max="24" step="0.5" value="${m.ore_giorno}"></div>
    <div class="field" id="pk-gg-box" ${m.esterno?'':'style="display:none"'}><label for="pk-gg">Giorni di consegna promessi</label><input id="pk-gg" type="number" min="1" value="${m.giorni_consegna}"></div>
    <div class="field"><div class="prod-checkrow"><label><input type="checkbox" id="pk-attiva" ${m.attiva?'checked':''}> Attiva</label></div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn-primary" onclick="Prod.salvaMacchina('${id}')"><i class="ti ti-check"></i> Salva</button>
      ${id ? `<button class="btn-skip" style="color:var(--red)" onclick="Prod.eliminaMacchina('${id}')">Elimina</button>` : ''}
      <button class="btn-skip" onclick="Prod.chiudiModale()">Annulla</button>
    </div>`);
}
async function salvaMacchina(id){
  const rec = {
    nome: document.getElementById('pk-nome').value.trim(),
    tecnologie: [...document.querySelectorAll('input[name="pk-tec"]:checked')].map(x=>x.value),
    esterno: document.getElementById('pk-est').checked,
    ore_giorno: Number(document.getElementById('pk-ore').value)||0,
    giorni_consegna: Number(document.getElementById('pk-gg').value)||1,
    attiva: document.getElementById('pk-attiva').checked
  };
  if(!rec.nome){ showToast('Scrivi il nome','error'); return; }
  if(!rec.tecnologie.length){ showToast('Scegli almeno una tecnologia','error'); return; }
  const r = id ? await sb.from('macchine').update(rec).eq('id', id) : await sb.from('macchine').insert(rec);
  if(r.error){ showToast('Salvataggio non riuscito: ' + r.error.message, 'error'); return; }
  chiudiModale(); await ricarica(); showToast('Salvato ✓'); render();
}
async function eliminaMacchina(id){
  const m = st.macchine.find(x=>x.id===id);
  const n = st.files.filter(f=>f.macchina_id===id).length;
  if(!confirm(`Eliminare ${m?.nome||'questa macchina'}?` + (n ? `\n\n${n} file di stampa resteranno senza macchina.` : ''))) return;
  const r = await sb.from('macchine').delete().eq('id', id);
  if(r.error){ showToast('Eliminazione non riuscita: ' + r.error.message, 'error'); return; }
  chiudiModale(); await ricarica(); showToast('Eliminata'); render();
}

/* ═════════════ PRODUZIONE DI UNA COMMESSA ═════════════ */
// Collegamento con il gestionale commesse: il codice fisso della commessa è nel database (sb_base)
function baseCommesse(){ try{ return (typeof _leggiSbBase==='function' && _leggiSbBase()) || {}; }catch(err){ return {}; } }
function nomeCommessaDaId(id){ const b = baseCommesse(); const k = Object.keys(b).find(k=>k.startsWith('commessa__') && b[k]?.id===id); return k ? k.slice('commessa__'.length) : null; }
function idCommessaDaNome(nome){ return baseCommesse()[storageKey(nome)]?.id || null; }
function datiCommessa(nome){ try{ return JSON.parse(localStorage.getItem(storageKey(nome))||'null'); }catch(err){ return null; } }
const statoProd = (cid)=>st.cprod.find(x=>x.commessa_id===cid) || null;
const righeDi = (cid)=>st.righe.filter(r=>r.commessa_id===cid);

function problemiModello(mid){
  const out = [];
  const m = st.modelli.find(x=>x.id===mid);
  if(!m) return ['modello da scegliere'];
  const pz = st.pezzi.filter(p=>p.modello_id===mid);
  if(!pz.length) out.push('nessun pezzo inserito');
  pz.forEach(p=>{
    const f = fileDelPezzo(p.id);
    if(!f) out.push(p.nome + ': nessun file di stampa');
    else{
      if(!f.file.macchina_id) out.push(f.file.nome + ': macchina da scegliere');
      if(!(f.file.minuti_durata>0)) out.push(f.file.nome + ': durata mancante');
    }
  });
  if(pz.length && !pz.some(p=>p.minuti_decorazione>0)) out.push('tempi di decorazione mancanti');
  if(!(m.minuti_imballaggio>0)) out.push('tempo di imballaggio mancante');
  return out;
}
function problemiCommessa(cid){
  const righe = righeDi(cid);
  if(!righe.length) return ['nessuna statua da produrre'];
  const out = [];
  righe.forEach(r=>{
    const etichetta = r.descrizione || nomeModello(r.modello_id);
    (r.modello_id ? problemiModello(r.modello_id) : ['modello da scegliere']).forEach(x=>out.push(etichetta + ' · ' + x));
  });
  return out;
}
// Quante volte lanciare ogni file per coprire i pezzi della commessa (il magazzino arriverà dopo)
function lanciCommessa(cid){
  const serve = {};
  righeDi(cid).forEach(r=>{
    if(!r.modello_id) return;
    const daStampare = Math.max(0, r.quantita - (r.gia_stampate||0));
    st.pezzi.filter(p=>p.modello_id===r.modello_id).forEach(p=>{ serve[p.id] = (serve[p.id]||0) + p.quantita * daStampare; });
  });
  const lanci = {};
  Object.entries(serve).forEach(([pid, n])=>{
    const f = fileDelPezzo(pid); if(!f) return;
    lanci[f.file.id] = Math.max(lanci[f.file.id]||0, Math.ceil(n / f.quantita));
  });
  return Object.entries(lanci).map(([fid, n])=>({file: st.files.find(f=>f.id===fid), n})).filter(x=>x.file);
}
function orePersoneCommessa(cid){
  return righeDi(cid).reduce((s,r)=>s + (r.modello_id ? oreLavoroModello(r.modello_id) * r.quantita : 0), 0);
}

async function apriCommessa(nome){
  if(!nome) return;
  if(typeof flushAutosave==='function') flushAutosave();
  let id = idCommessaDaNome(nome);
  if(!id && typeof salvaSuDrive==='function'){ await salvaSuDrive(); id = idCommessaDaNome(nome); }
  if(!id){ showToast('La commessa non è ancora nel database: controlla la connessione e riprova','error'); return; }
  st.commessaId = id; st.commessaNome = nome;
  showPage('prod-commessa');
}

async function preparaCommessa(cid, nome){
  // Primo accesso: crea lo stato e propone le statue prendendole dagli articoli della commessa
  if(statoProd(cid)) return;
  const r = await sb.from('commesse_produzione').insert({commessa_id:cid});
  if(r.error && r.error.code!=='23505') throw r.error;
  if(!righeDi(cid).length){
    const art = (datiCommessa(nome)?.statue||[]).filter(s=>(s.desc||'').trim());
    if(art.length){
      const rr = await sb.from('produzione_righe').insert(art.map((s,i)=>({commessa_id:cid, ordine:i, descrizione:s.desc.trim(), quantita:Math.max(1, parseInt(s.qty)||1)})));
      if(rr.error) throw rr.error;
    }
  }
  await ricarica();
}

function renderCommessa(box){
  const cid = st.commessaId, nome = st.commessaNome || nomeCommessaDaId(cid);
  if(!cid || !nome){
    box.innerHTML = testata('Produzione della commessa', '') + `<div class="card"><div class="empty"><i class="ti ti-list-details"></i><p>Apri una commessa e premi «Apri la produzione».</p><button class="btn" onclick="showPage('commesse')">Vai alle commesse</button></div></div>`;
    return;
  }
  if(!statoProd(cid)){
    box.innerHTML = testata(e(nome), 'Preparo la scheda di produzione…') + '<div class="card"><div class="empty"><span class="spinner"></span></div></div>';
    preparaCommessa(cid, nome).then(()=>{ if(st.pagina==='prod-commessa') render(); }).catch(err=>{
      box.innerHTML = testata(e(nome), '') + `<div class="prod-banner err"><i class="ti ti-alert-triangle"></i><span>Non riesco a creare la scheda di produzione: ${e(err.message||err)}</span></div>`;
    });
    return;
  }
  const sp = statoProd(cid);
  const dati = datiCommessa(nome) || {};
  const consegne = (dati.statue||[]).filter(s=>s.consegna && !s.consegnato).map(s=>s.consegna).sort();
  const consegna = consegne.length ? new Date(consegne[0]+'T12:00').toLocaleDateString('it-IT',{weekday:'short', day:'numeric', month:'long'}) : 'non indicata';
  const problemi = problemiCommessa(cid);
  const inCoda = sp.stato==='produzione', avviata = sp.stato==='avviata', inProd = inCoda || avviata;
  const pianoC = inCoda ? calcolaPiano()?.commesse?.[cid] : null;
  const statoChip = avviata ? '<span class="pchip" style="background:var(--green-bg);color:var(--green)">Avviata</span>'
    : inCoda ? '<span class="pchip" style="background:var(--blue-bg);color:var(--blue-ink)">In coda</span>'
    : problemi.length ? '<span class="pchip fdm">In attesa dei dati</span>' : '<span class="pchip grey">Dati completi</span>';
  const lavC = lavoriDi(cid);
  const statoNota = avviata ? 'avviata il ' + fmtData(new Date(sp.avviata_il||sp.aggiornato_il)) + (lavC.length ? ' · lavori fatti ' + lavC.filter(l=>l.stato==='fatto').length + ' di ' + lavC.length : '')
    : inCoda ? 'nel Gantt, non ancora sui tablet' + (pianoC?.inizioData ? ' · avvio previsto ' + fmtData(pianoC.inizioData) : '') + (pianoC?.fineData ? ' · fine prevista ' + fmtData(pianoC.fineData) : '')
    : '';

  const catalogo = modelliCatalogo();
  const personali = st.modelli.filter(m=>m.commessa_id===cid).sort(perNome);
  const righe = righeDi(cid).map((r,i)=>{
    const opz = `<option value="">Scegli…</option>
      ${personali.length ? `<optgroup label="Statue personalizzate di questa commessa">${personali.map(m=>`<option value="${m.id}" ${m.id===r.modello_id?'selected':''}>${e(m.nome)}</option>`).join('')}</optgroup>` : ''}
      <optgroup label="Catalogo del negozio">${catalogo.map(m=>`<option value="${m.id}" ${m.id===r.modello_id?'selected':''}>${e(nomeModello(m.id))}</option>`).join('')}</optgroup>
      <optgroup label="Nuova"><option value="__nuova">+ Nuova statua personalizzata</option><option value="__copia">+ Personalizzata partendo da un modello…</option></optgroup>`;
    const prob = r.modello_id ? problemiModello(r.modello_id) : ['modello da scegliere'];
    const m = st.modelli.find(x=>x.id===r.modello_id);
    const statoRiga = !prob.length ? '<span class="prod-file-ref" style="color:var(--green)"><b><i class="ti ti-circle-check"></i> Completa</b></span>'
      : `<span class="prod-file-ref none"><i class="ti ti-alert-triangle"></i> ${prob.length===1 ? e(prob[0]) : prob.length + ' dati mancanti'}</span>`;
    const azione = m ? `<button class="btn sm" onclick="Prod.modificaModelloRiga('${m.id}')">${m.commessa_id ? '<i class="ti ti-edit"></i> Pezzi e tempi' : '<i class="ti ti-eye"></i> Vedi nel catalogo'}</button>` : '';
    return `<tr>
      <td><input type="text" value="${e(r.descrizione)}" placeholder="es. Madonna con manto azzurro" aria-label="Descrizione" ${inProd?'disabled':''} onchange="Prod.rigaCampo('${r.id}','descrizione',this.value)"></td>
      <td class="q"><input type="number" min="1" value="${r.quantita}" aria-label="Quantità" ${inProd?'disabled':''} onchange="Prod.rigaCampo('${r.id}','quantita',this.value)"></td>
      <td class="q"><input type="number" min="0" max="${r.quantita}" value="${r.gia_stampate||0}" aria-label="Già stampate" title="Statue già stampate (es. dal magazzino): saltano la stampa" ${inProd?'disabled':''} onchange="Prod.rigaCampo('${r.id}','gia_stampate',this.value)"></td>
      <td><select aria-label="Modello" ${inProd?'disabled':''} onchange="Prod.rigaModello('${r.id}',this)">${opz}</select></td>
      <td>${statoRiga}</td>
      <td style="white-space:nowrap">${azione} ${inProd ? '' : `<button type="button" class="btn-del" aria-label="Togli statua" onclick="Prod.togliRiga('${r.id}')">×</button>`}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="6"><div class="prod-empty">Nessuna statua: aggiungi quelle da produrre.</div></td></tr>`;

  const lanci = lanciCommessa(cid);
  const lanciTxt = lanci.length ? lanci.map(l=>`<a href="#" onclick="Prod.apriFile('${l.file.id}');return false" style="font-weight:600">${e(l.file.nome)}</a> ×${l.n} <span class="muted">(${e(nomeMacchina(l.file.macchina_id))}, ${hm(l.file.minuti_durata*l.n)})</span>`).join('<br>') : '<span class="muted">nessuno ancora</span>';
  const elencoProblemi = problemi.length && !inProd ? `<div class="prod-banner"><i class="ti ti-alert-triangle"></i><span style="flex:1">Per metterla in coda di produzione mancano:<br>${problemi.slice(0,8).map(e).join('<br>')}${problemi.length>8 ? '<br>…e altri ' + (problemi.length-8) : ''}</span></div>` : '';
  const azioni = avviata
    ? `<button class="btn" onclick="Prod.riportaInCoda()"><i class="ti ti-arrow-back-up"></i> Riporta in coda</button>`
    : inCoda
    ? `<button class="btn" onclick="Prod.riportaInPreparazione()"><i class="ti ti-arrow-back-up"></i> Riporta in preparazione</button><button class="btn-primary" onclick="Prod.avviaProduzione('${cid}')"><i class="ti ti-player-play"></i> Avvia produzione</button>`
    : `<button class="btn-primary" ${problemi.length?'disabled':''} onclick="Prod.mandaInProduzione()"><i class="ti ti-list-numbers"></i> Metti in coda</button>`;

  box.innerHTML = testata(e(nome), `${e(dati.cliente?.nome||'Cliente non indicato')} · consegna promessa: ${e(consegna)}`,
      `<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" onclick="Prod.vaiAllaCommessa()"><i class="ti ti-arrow-left"></i> Torna alla commessa</button>${azioni}</div>`) +
    `<div style="margin:-6px 0 16px">${statoChip}${statoNota ? ` <span class="muted" style="font-size:13px">${statoNota}</span>` : ''}</div>
    ${elencoProblemi}
    <div class="card" style="margin-bottom:18px">
      <div class="card-hdr"><h2>Statue da produrre</h2><span class="sub">Dal catalogo del negozio, oppure personalizzate per questa commessa</span></div>
      <div class="prod-tbl-wrap"><table class="prod-tbl" style="min-width:820px">
        <thead><tr><th>Descrizione</th><th>Quantità</th><th title="Statue già stampate (es. dal magazzino): saltano la stampa">Già stampate</th><th>Modello</th><th>Dati</th><th></th></tr></thead>
        <tbody>${righe}</tbody></table></div>
      ${inProd ? '' : `<div class="prod-add"><button class="btn-add" onclick="Prod.aggiungiRiga()"><i class="ti ti-plus"></i> Aggiungi statua</button></div>`}
    </div>
    <div class="card">
      <div class="card-hdr"><h2>Riepilogo</h2>${inProd ? '' : `<button class="btn sm" onclick="Prod.nuovoFile('${cid}')"><i class="ti ti-file-plus"></i> Nuovo file per questa commessa</button>`}</div>
      <div class="prod-tot">
        <div class="hl"><small>Lavoro delle persone</small><b>${hm(orePersoneCommessa(cid))}</b></div>
        <div style="grid-column:span 2"><small>Stampe da lanciare</small><span style="font-size:14px;line-height:1.7">${lanciTxt}</span></div>
      </div>
      <p class="muted" style="font-size:13px;padding:0 20px 16px">Le statue segnate come «già stampate» saltano la stampa ma passano da carteggiatura, decorazione, montaggio e imballaggio. I pezzi in più delle stampe andranno in magazzino.</p>
    </div>`;
}

// Riquadro "Produzione" dentro la scheda della commessa
function aggiornaRiquadro(){
  const nome = (typeof ordineAttivo!=='undefined') ? ordineAttivo : null;
  const chip = document.getElementById('prod-stato-commessa'), txt = document.getElementById('prod-stato-testo');
  if(!chip || !txt || !nome) return;
  const cid = idCommessaDaNome(nome);
  const scrivi = (c, cls, t)=>{ chip.textContent = c; chip.className = 'pchip ' + cls; txt.textContent = t; };
  if(!cid){ scrivi('Non impostata', 'grey', 'Imposta quali statue produrre, con pezzi, file di stampa e tempi.'); return; }
  const fai = ()=>{
    const sp = statoProd(cid);
    if(!sp){ scrivi('Non impostata', 'grey', 'Imposta quali statue produrre, con pezzi, file di stampa e tempi.'); return; }
    if(sp.stato==='avviata'){ scrivi('Avviata', 'resina', 'Produzione avviata il ' + new Date(sp.avviata_il||sp.aggiornato_il).toLocaleDateString('it-IT',{day:'numeric',month:'long'}) + '.'); return; }
    if(sp.stato==='produzione'){ const pc = calcolaPiano()?.commesse?.[cid]; scrivi('In coda', 'grey', 'Nel Gantt, da avviare' + (pc?.inizioData ? ': avvio previsto ' + fmtData(pc.inizioData) : '') + '.'); return; }
    const p = problemiCommessa(cid);
    if(p.length) scrivi('In attesa dei dati', 'fdm', (p.length===1 ? 'Manca 1 dato' : 'Mancano ' + p.length + ' dati') + ' prima di poterla mettere in coda.');
    else scrivi('Dati completi', 'grey', 'Pronta da mettere in coda di produzione.');
  };
  if(st.caricato) fai();
  else assicuraDati().then(fai).catch(()=>scrivi('Non disponibile', 'grey', 'Dati di produzione non raggiungibili in questo momento.'));
}

async function rigaCampo(id, campo, v){
  const riga = st.righe.find(x=>x.id===id);
  const val = campo==='quantita' ? Math.max(1, parseInt(v)||1)
    : campo==='gia_stampate' ? Math.min(Math.max(0, parseInt(v)||0), riga?.quantita||1)
    : String(v).trim();
  const r = await sb.from('produzione_righe').update({[campo]: val}).eq('id', id);
  if(r.error){ showToast('Non salvato: ' + r.error.message, 'error'); return; }
  const loc = st.righe.find(x=>x.id===id); if(loc) loc[campo] = val;
  render();
}
async function rigaModello(id, sel){
  const v = sel.value;
  const riga = st.righe.find(x=>x.id===id);
  if(v==='__nuova' || v==='__copia'){
    let base = null;
    if(v==='__copia'){
      const elenco = modelliCatalogo();
      if(!elenco.length){ showToast('Il catalogo è vuoto','error'); render(); return; }
      scegliModelloDaCopiare(id); return;
    }
    await creaPersonalizzata(riga, base);
    return;
  }
  const r = await sb.from('produzione_righe').update({modello_id: v || null}).eq('id', id);
  if(r.error){ showToast('Non salvato: ' + r.error.message, 'error'); return; }
  await ricarica(); render();
}
function scegliModelloDaCopiare(rigaId){
  modale(`<h3><i class="ti ti-copy"></i> Parti da un modello</h3>
    <p>Copio pezzi e tempi del modello scelto in una statua personalizzata di questa commessa: poi la modifichi come serve. I pezzi copiati vanno assegnati a un file di stampa.</p>
    <div class="field"><label for="pc-mod">Modello del catalogo</label><select id="pc-mod">${modelliCatalogo().map(m=>`<option value="${m.id}">${e(nomeModello(m.id))}</option>`).join('')}</select></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn-primary" onclick="Prod.confermaCopia('${rigaId}')"><i class="ti ti-check"></i> Crea la copia</button>
      <button class="btn-skip" onclick="Prod.chiudiModale(); Prod.ridisegna()">Annulla</button>
    </div>`);
}
async function creaPersonalizzata(riga, daModelloId){
  try{
    const src = daModelloId ? st.modelli.find(m=>m.id===daModelloId) : null;
    const rec = {nome: (riga.descrizione || (src ? src.nome : 'Statua personalizzata')), commessa_id: riga.commessa_id,
      altezza_cm: src?.altezza_cm ?? null, minuti_montaggio: src?.minuti_montaggio || 0, minuti_imballaggio: src?.minuti_imballaggio || 0, note: src?.note || ''};
    const r = await sb.from('modelli').insert(rec).select('id').single(); if(r.error) throw r.error;
    const mid = r.data.id;
    if(src){
      const pz = st.pezzi.filter(p=>p.modello_id===src.id).map(p=>({modello_id:mid, ordine:p.ordine, nome:p.nome, tipo:p.tipo, tecnologia:p.tecnologia, quantita:p.quantita, minuti_carteggiatura:p.minuti_carteggiatura, minuti_decorazione:p.minuti_decorazione}));
      if(pz.length){ const rp = await sb.from('modelli_pezzi').insert(pz); if(rp.error) throw rp.error; }
    }
    const ru = await sb.from('produzione_righe').update({modello_id: mid}).eq('id', riga.id); if(ru.error) throw ru.error;
    await ricarica();
    modificaModelloRiga(mid);
  }catch(err){ showToast('Non riesco a creare la statua: ' + (err.message||err), 'error'); render(); }
}
function modificaModelloRiga(mid){
  const m = st.modelli.find(x=>x.id===mid); if(!m) return;
  if(!puoiLasciare()) return;
  st.selModello = mid; st.bozzaModello = bozzaDa(m); st.sporco = false;
  st.daCommessa = true;
  showPage('prod-catalogo');
}
async function aggiungiRiga(){
  const cid = st.commessaId;
  const r = await sb.from('produzione_righe').insert({commessa_id:cid, ordine: righeDi(cid).length, descrizione:'', quantita:1});
  if(r.error){ showToast('Non salvato: ' + r.error.message, 'error'); return; }
  await ricarica(); render();
  const ins = document.querySelectorAll('#prod-box-commessa tbody tr'); ins[ins.length-1]?.querySelector('input')?.focus();
}
async function togliRiga(id){
  const riga = st.righe.find(x=>x.id===id);
  const m = st.modelli.find(x=>x.id===riga?.modello_id);
  const msg = m?.commessa_id ? `Togliere questa statua? Anche la statua personalizzata "${m.nome}" con i suoi pezzi verrà eliminata.` : 'Togliere questa statua dalla produzione?';
  if(!confirm(msg)) return;
  let r = await sb.from('produzione_righe').delete().eq('id', id);
  if(!r.error && m?.commessa_id && !st.righe.some(x=>x.id!==id && x.modello_id===m.id)) r = await sb.from('modelli').delete().eq('id', m.id);
  if(r.error){ showToast('Non riuscito: ' + r.error.message, 'error'); return; }
  await ricarica(); render();
}
async function mandaInProduzione(){
  const cid = st.commessaId;
  const p = problemiCommessa(cid);
  if(p.length){ showToast('Mancano ancora dei dati', 'error'); return; }
  if(!confirm('Mettere la commessa in coda di produzione? Entrerà nel Gantt; sui tablet comparirà solo quando la avvii.')) return;
  const nomeC = nomeCommessaDaId(cid) || '';
  const r = await sb.from('commesse_produzione').update({stato:'produzione', mandata_il: new Date().toISOString(), nome:nomeC, consegna:consegnaIso(nomeC)}).eq('commessa_id', cid);
  if(r.error){ showToast('Non riuscito: ' + r.error.message, 'error'); return; }
  await ricarica(); showToast('Commessa in coda ✓'); render(); aggiornaRiquadro();
}
async function avviaProduzione(cid){
  const nome = nomeCommessaDaId(cid) || '';
  if(!confirm(`Avviare la produzione di ${nome}? Da ora i suoi lavori compaiono sui tablet.`)) return;
  let g;
  try{ g = await generaLavori(cid); }
  catch(err){ showToast(/lavori|magazzino/.test(err.message||'') ? 'Manca un aggiornamento del database: esegui supabase/06_tablet.sql su Supabase' : 'Non riesco a preparare i lavori: ' + (err.message||err), 'error'); await ricarica(); return; }
  const r = await sb.from('commesse_produzione').update({stato:'avviata', avviata_il: new Date().toISOString(), nome, consegna: consegnaIso(nome)}).eq('commessa_id', cid);
  if(r.error){ showToast(/avviata|check/.test(r.error.message) ? 'Manca un aggiornamento del database: esegui supabase/05_avvio_produzione.sql su Supabase' : 'Non riuscito: ' + r.error.message, 'error'); return; }
  await ricarica();
  showToast(g?.tenuti ? 'Produzione riavviata ✓ (lavori già iniziati mantenuti)' : 'Produzione avviata ✓ · ' + g.creati + ' lavori sui tablet' + (g.dalMagazzino ? ' · ' + g.dalMagazzino + ' pezzi dal magazzino' : ''));
  render(); aggiornaRiquadro();
}
async function riportaInCoda(){
  if(!confirm('Riportarla in coda? Sparirà dai tablet finché non la riavvii.')) return;
  const r = await sb.from('commesse_produzione').update({stato:'produzione', avviata_il:null}).eq('commessa_id', st.commessaId);
  if(r.error){ showToast('Non riuscito: ' + r.error.message, 'error'); return; }
  await ricarica(); render(); aggiornaRiquadro();
}
async function riportaInPreparazione(){
  if(!confirm('Riportarla in preparazione? Uscirà dal Gantt finché non la rimetti in coda.')) return;
  const r = await sb.from('commesse_produzione').update({stato:'preparazione', mandata_il:null}).eq('commessa_id', st.commessaId);
  if(r.error){ showToast('Non riuscito: ' + r.error.message, 'error'); return; }
  await ricarica(); render(); aggiornaRiquadro();
}

/* ═════════════ PROGRAMMAZIONE (Gantt) ═════════════ */
const COLORI = ['#0F766E','#6B3FC4','#C2410C','#1F4FD1','#A16207','#BE185D','#15803D','#7C3AED','#0E7490','#B45309'];
const GG = ['dom','lun','mar','mer','gio','ven','sab'];
const fmtGiorno = (d)=>GG[d.getDay()] + ' ' + d.getDate();
const fmtData = (d)=>d ? d.toLocaleDateString('it-IT',{weekday:'short', day:'numeric', month:'short'}) : '—';
function codaProduzione(){
  return st.cprod.filter(x=>x.stato==='produzione' || x.stato==='avviata').slice().sort((a,b)=>{
    const av = (x)=>x.stato==='avviata' ? 0 : 1;
    if(av(a)!==av(b)) return av(a) - av(b);             // le avviate stanno sempre davanti
    const pa = a.priorita ?? 1e9, pb = b.priorita ?? 1e9;
    if(pa!==pb) return pa - pb;
    return String(a.mandata_il||'').localeCompare(String(b.mandata_il||''));
  });
}
function promessaDi(nome){
  const s = (datiCommessa(nome)?.statue||[]).filter(x=>x.consegna && !x.consegnato).map(x=>x.consegna).sort();
  return s[0] ? new Date(s[0] + 'T12:00') : null;
}
function giorniTra(a, b){ const x = new Date(a); x.setHours(0,0,0,0); const y = new Date(b); y.setHours(0,0,0,0); return Math.round((y - x) / 86400000); }

function calcolaPiano(){
  if(!st.caricato || !window.ProdPianifica) return null;
  const elenco = codaProduzione().map((x,i)=>{
    const nome = nomeCommessaDaId(x.commessa_id) || '?';
    const lav = x.stato==='avviata' ? lavoriDi(x.commessa_id) : [];
    return {id:x.commessa_id, nome, stato:x.stato, righe:righeDi(x.commessa_id), lavori: lav.length ? lav : null, colore:COLORI[i % COLORI.length], promessa:promessaDi(nome), cliente:datiCommessa(nome)?.cliente?.nome||''};
  });
  const piano = window.ProdPianifica({adesso:new Date(), oggi:new Date(), macchine:st.macchine, personale:st.personale, modelli:st.modelli, pezzi:st.pezzi, files:st.files, contenuto:st.contenuto, commesse:elenco});
  piano.elenco = elenco;
  return piano;
}

/* Promemoria: commesse in coda il cui avvio previsto è oggi (o già passato) */
function daAvviareOggi(){
  const piano = calcolaPiano(); if(!piano) return [];
  return piano.elenco.filter(c=>c.stato==='produzione' && piano.commesse[c.id]?.inizioData && giorniTra(new Date(), piano.commesse[c.id].inizioData) <= 0);
}
function aggiornaPromemoria(){
  const lista = st.caricato ? daAvviareOggi() : [];
  const badge = document.getElementById('nav-badge-prod');
  if(badge){ badge.textContent = lista.length || ''; badge.className = 'nav-badge' + (lista.length ? ' alert' : ''); badge.title = lista.length ? 'Commesse da avviare oggi' : ''; }
  const box = document.getElementById('prod-promemoria');
  if(box) box.innerHTML = lista.length ? `<div class="prod-banner prod-promemoria"><i class="ti ti-bell-ringing"></i><span><b>Produzione da avviare oggi:</b> ${lista.map(c=>e(c.nome)).join(', ')}</span><button class="btn sm" onclick="showPage('prod-programmazione')">Vai alla programmazione</button></div>` : '';
}

function renderProgrammazione(box){
  const coda = codaProduzione();
  const attesa = st.cprod.filter(x=>x.stato==='preparazione');
  const cardAttesa = attesa.length ? `<div class="card" style="margin-top:18px">
      <div class="card-hdr"><h2>In attesa dei dati</h2><span class="sub">Non entrano nel Gantt finché non le mandi in produzione</span></div>
      ${attesa.map(x=>{ const n = problemiCommessa(x.commessa_id).length; return `<div class="prod-check"><i class="ti ti-hourglass-empty no"></i><div class="tx"><b>${e(nomeCommessaDaId(x.commessa_id)||'?')}</b><span>${n ? (n===1 ? 'manca 1 dato' : 'mancano ' + n + ' dati') : 'dati completi: pronta da mandare in produzione'}</span></div><button class="btn sm" onclick="Prod.apriCommessaId('${x.commessa_id}')">Apri</button></div>`; }).join('')}
    </div>` : '';

  if(!coda.length){
    const cat = modelliCatalogo();
    const conPersone = st.personale.filter(p=>p.attivo && (p.ruoli||[]).length).length;
    const macchine = st.macchine.filter(m=>m.attiva).length;
    const check = (ok, tit, sub, pag)=>`<div class="prod-check"><i class="ti ${ok?'ti-circle-check ok':'ti-circle-dashed no'}"></i><div class="tx"><b>${tit}</b><span>${sub}</span></div><button class="btn sm" onclick="showPage('${pag}')">Apri</button></div>`;
    box.innerHTML = testata('Programmazione', 'Il Gantt delle commesse in produzione, calcolato sulle ore di macchine e persone.') +
      `<div class="prod-banner" style="background:var(--blue-bg);border-color:transparent;color:var(--blue-ink)"><i class="ti ti-info-circle"></i><span>Nessuna commessa in produzione. Il Gantt compare quando ne mandi almeno una in produzione dalla sua scheda (commessa → «Apri la produzione» → «Manda in produzione»).</span></div>
      <div class="card"><div class="card-hdr"><h2>Cosa serve alla programmazione</h2></div><div class="prod-checks">
        ${check(macchine>0, 'Macchine', macchine + ' attive, con le ore di stampa al giorno', 'prod-personale')}
        ${check(conPersone>0, 'Personale con ruoli e ore', conPersone + ' persone attive', 'prod-personale')}
        ${check(cat.length>0, 'Catalogo modelli', cat.length + ' modelli', 'prod-catalogo')}
        ${check(st.files.length>0, 'File di stampa', st.files.length + ' file', 'prod-file')}
      </div></div>` + cardAttesa;
    return;
  }

  const piano = calcolaPiano();
  const comm = piano.elenco;
  const colore = Object.fromEntries(comm.map(c=>[c.id, c.colore]));

  // coda
  let inRitardo = 0;
  const righeCoda = comm.map((c,i)=>{
    const r = piano.commesse[c.id] || {};
    const prevista = r.fineData;
    let badge;
    if(!prevista) badge = '<span class="pchip grey">Da calcolare</span>';
    else if(!c.promessa) badge = '<span class="pchip grey">Senza data promessa</span>';
    else{
      const diff = giorniTra(c.promessa, prevista);
      if(diff > 0){ inRitardo++; badge = `<span class="pchip" style="background:var(--red-bg);color:var(--red)">${diff===1 ? '1 giorno' : diff + ' giorni'} di ritardo</span>`; }
      else badge = '<span class="pchip resina">In tempo</span>';
    }
    const nStatue = c.righe.reduce((s,x)=>s + (x.quantita||1), 0);
    const daAvviare = c.stato==='produzione' && r.inizioData && giorniTra(new Date(), r.inizioData) <= 0;
    const statoTxt = c.stato==='avviata' ? '<span class="pchip resina">Avviata</span>'
      : `<span class="pchip ${daAvviare?'fdm':'grey'}">${daAvviare ? 'Da avviare oggi' : 'In coda · avvio ' + fmtData(r.inizioData)}</span>`;
    return `<div class="prod-coda-item">
      <div class="prod-coda-move">
        <button type="button" aria-label="Più in alto" ${i===0?'disabled':''} onclick="Prod.sposta('${c.id}',-1)"><i class="ti ti-chevron-up"></i></button>
        <button type="button" aria-label="Più in basso" ${i===comm.length-1?'disabled':''} onclick="Prod.sposta('${c.id}',1)"><i class="ti ti-chevron-down"></i></button>
      </div>
      <button type="button" class="prod-coda-tx" onclick="Prod.apriCommessaId('${c.id}')">
        <b><span class="prod-dot" style="background:${c.colore}"></span> ${i+1}. ${e(c.nome)}</b>
        <span>${e(c.cliente || 'Cliente non indicato')} · ${nStatue} ${nStatue===1?'statua':'statue'}</span>
        <span>Promessa ${fmtData(c.promessa)} · prevista <b>${fmtData(prevista)}</b></span>
        <span style="margin-top:4px;display:flex;flex-wrap:wrap;gap:6px">${statoTxt}${badge}</span>
      </button>
      ${c.stato==='produzione' ? `<button class="btn sm ${daAvviare?'primary':''}" onclick="Prod.avviaProduzione('${c.id}')"><i class="ti ti-player-play"></i> Avvia</button>` : ''}
    </div>`;
  }).join('');

  // gantt
  const DW = 110, LW = 190;
  const n = piano.giorni.length;
  const testa = piano.giorni.map((g,d)=>{
    const fest = g.settimana>=6, oggi = d===0;
    return `<div class="g-day ${fest?'fest':''} ${oggi?'oggi':''}" style="left:${LW + d*DW}px;width:${DW}px">${fmtGiorno(g.data)}</div>`;
  }).join('');
  const sfondo = piano.giorni.map((g,d)=>g.settimana>=6 ? `<div class="g-we" style="left:${LW + d*DW}px;width:${DW}px"></div>` : '').join('');
  const gruppi = [['macchina','Stampa'],['esterno',''],['persona','Persone'],['imballaggio','']];
  let corpo = '';
  gruppi.forEach(([tipo, titolo])=>{
    const ls = piano.lane.filter(l=>l.tipo===tipo);
    if(!ls.length) return;
    if(titolo) corpo += `<div class="g-group" style="width:${LW + n*DW}px"><span>${titolo}</span></div>`;
    ls.forEach(l=>{
      const blocchi = l.blocchi.map(b=>{
        const left = LW + b.da*DW, w = Math.max(4, (b.a - b.da)*DW - 2);
        const tip = [b.testo, ...(b.dettagli || [b.dettaglio])].filter(Boolean).join('\n') + '\n' + fmtData(piano.giorni[Math.min(n-1, Math.floor(b.da))]?.data) + ' → ' + fmtData(piano.giorni[Math.min(n-1, Math.max(0, Math.ceil(b.a)-1))]?.data);
        const cls = l.tipo==='esterno' ? 'g-b est' : l.tipo==='imballaggio' ? 'g-b imb' : 'g-b';
        const stile = l.tipo==='esterno' ? `left:${left}px;width:${w}px;border-color:${colore[b.commessa]};color:${colore[b.commessa]}` : `left:${left}px;width:${w}px;background:${colore[b.commessa]}`;
        return `<div class="${cls}" style="${stile}" title="${e(tip)}">${w >= 56 ? e(b.testo) : ''}</div>`;
      }).join('');
      corpo += `<div class="g-row" style="width:${LW + n*DW}px"><div class="g-label" style="width:${LW}px" title="${e(l.nome)}">${e(l.nome)}</div>${blocchi}</div>`;
    });
  });

  const ultima = comm.map(c=>piano.commesse[c.id]?.fineData).filter(Boolean).sort((a,b)=>b-a)[0];
  const avvisi = piano.avvisi.map(a=>`<div class="prod-banner err"><i class="ti ti-alert-triangle"></i><span>${e(a)}</span></div>`).join('');
  box.innerHTML = testata('Programmazione', `${comm.length} ${comm.length===1?'commessa':'commesse'} in produzione · ultima consegna prevista ${fmtData(ultima)}${inRitardo ? ' · <b style="color:var(--red)">' + inRitardo + ' in ritardo</b>' : ''}`,
      `<a class="btn" href="tablet.html" target="_blank" rel="noopener"><i class="ti ti-device-tablet"></i> Apri la pagina dei tablet</a>`) +
    avvisi +
    `<div class="prod-banner" style="background:var(--bg3);border-color:var(--border);color:var(--text2);font-weight:400"><i class="ti ti-info-circle"></i><span>Le commesse avviate sono calcolate da quello che i tablet hanno già registrato; quelle in coda dall'inizio. Macchine dal lunedì al venerdì; festività non considerate.</span></div>
    <div class="prod-split">
      <div class="card prod-list prod-coda"><div class="card-hdr"><h2>Coda</h2><span class="sub">Usa le frecce per la priorità</span></div>${righeCoda}</div>
      <div class="card prod-edit" style="padding:0;overflow:hidden">
        <div class="card-hdr" style="padding:14px 18px"><h2>Carico per macchina e persona</h2><span class="sub">Passa sopra un blocco per i dettagli</span></div>
        <div class="g-wrap"><div class="g-inner" style="width:${LW + n*DW}px">
          <div class="g-head" style="width:${LW + n*DW}px"><div class="g-label g-corner" style="width:${LW}px"></div>${testa}</div>
          <div class="g-body">${sfondo}<div class="g-today" style="left:${LW + ((new Date().getHours()+new Date().getMinutes()/60)/24)*DW}px"></div>${corpo}</div>
        </div></div>
        <div class="g-leg">${comm.map(c=>`<span><span class="prod-dot" style="background:${c.colore}"></span>${e(c.nome)}</span>`).join('')}<span><span class="g-leg-est"></span>Stampatore esterno</span></div>
      </div>
    </div>` + cardAttesa;
}
async function sposta(id, dir){
  const coda = codaProduzione().map(x=>x.commessa_id);
  const i = coda.indexOf(id), j = i + dir;
  if(i<0 || j<0 || j>=coda.length) return;
  [coda[i], coda[j]] = [coda[j], coda[i]];
  const ris = await Promise.all(coda.map((cid, k)=>sb.from('commesse_produzione').update({priorita:k}).eq('commessa_id', cid)));
  const err = ris.find(r=>r.error)?.error;
  if(err){ showToast(/priorita/.test(err.message) ? 'Manca la colonna della priorità: esegui supabase/04_priorita.sql su Supabase' : 'Non riuscito: ' + err.message, 'error'); return; }
  await ricarica(); render();
}

/* ═════════════ LAVORI (creati all'avvio della produzione) ═════════════ */
const nuovoId = ()=> (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c=>{ const r = Math.random()*16|0; return (c==='x' ? r : (r&0x3|0x8)).toString(16); }));
const lavoriDi = (cid)=>st.lavori.filter(l=>l.commessa_id===cid);
function consegnaIso(nome){
  const s = (datiCommessa(nome)?.statue||[]).filter(x=>x.consegna && !x.consegnato).map(x=>x.consegna).sort();
  return s[0] || null;
}

// Trasforma statue, pezzi e file della commessa in lavori concreti per i tablet
async function generaLavori(cid){
  const esistenti = lavoriDi(cid);
  if(esistenti.some(l=>l.stato!=='da_fare')) return {tenuti:true};   // il lavoro è già iniziato: si tengono
  if(esistenti.length){
    // nessun lavoro iniziato: si rifanno da capo, restituendo al magazzino i pezzi presi
    const presi = {};
    esistenti.filter(l=>l.tipo==='carteggiatura' || l.tipo==='decorazione').forEach(l=>{ if(l.contenuto==='dal magazzino' && l.pezzo_id && !(l.tipo==='decorazione' && esistenti.some(x=>x.tipo==='carteggiatura' && x.pezzo_id===l.pezzo_id && x.statua===l.statua))) presi[l.pezzo_id] = (presi[l.pezzo_id]||0) + 1; });
    for(const [pid, n] of Object.entries(presi)){ const r = await sb.rpc('magazzino_aggiungi', {p_pezzo:pid, p_n:n}); if(r.error) throw r.error; }
    const r = await sb.from('lavori').delete().eq('commessa_id', cid); if(r.error) throw r.error;
  }
  const nome = nomeCommessaDaId(cid) || '';
  const scorta = new Map(st.magazzino.map(m=>[m.pezzo_id, m.quantita]));
  const consumo = new Map();
  const out = []; let ordine = 0, nStatua = 0;
  const statue = [], istanze = [];
  righeDi(cid).forEach(riga=>{
    const m = st.modelli.find(x=>x.id===riga.modello_id); if(!m) return;
    const gia = Math.max(0, riga.gia_stampate||0);
    for(let k=1; k<=riga.quantita; k++){
      nStatua++;
      const s = {n:nStatua, nome:(riga.descrizione || m.nome) + (riga.quantita>1 ? ' ' + k + '/' + riga.quantita : ''), m, stampata: k<=gia};
      statue.push(s);
      st.pezzi.filter(p=>p.modello_id===m.id).forEach(p=>{ for(let q=0; q<p.quantita; q++) istanze.push({s, p, fonte: s.stampata ? 'già stampato' : '', dip:null}); });
    }
  });
  // prima i pezzi del magazzino
  istanze.forEach(i=>{
    if(i.fonte) return;
    const n = scorta.get(i.p.id) || 0;
    if(n>0){ scorta.set(i.p.id, n-1); consumo.set(i.p.id, (consumo.get(i.p.id)||0) + 1); i.fonte = 'dal magazzino'; }
  });
  // poi i lanci dei file
  const perFile = new Map();
  istanze.filter(i=>!i.fonte).forEach(i=>{
    const f = fileDelPezzo(i.p.id); if(!f) return;
    if(!perFile.has(f.file.id)) perFile.set(f.file.id, new Map());
    const t = perFile.get(f.file.id);
    if(!t.has(i.p.id)) t.set(i.p.id, []);
    t.get(i.p.id).push(i);
  });
  perFile.forEach((tipi, fid)=>{
    const f = st.files.find(x=>x.id===fid);
    const resa = new Map(st.contenuto.filter(c=>c.file_id===fid).map(c=>[c.pezzo_id, c.quantita]));
    const lanci = Math.max(...[...tipi.entries()].map(([pid, l])=>Math.ceil(l.length / (resa.get(pid)||1))));
    for(let n=0; n<lanci; n++){
      const id = nuovoId(), extra = {}, righeTesto = [];
      resa.forEach((q, pid)=>{
        const mie = (tipi.get(pid)||[]).slice(n*q, (n+1)*q);
        mie.forEach(i=>{ i.dip = id; });
        const avanzo = q - mie.length;
        if(avanzo>0) extra[pid] = avanzo;
        const p = modelloDi(pid);
        righeTesto.push(q + ' ' + (p?.nome||'pezzo') + (st.modelli.find(m=>m.id===p?.modello_id)?.commessa_id ? '' : '') + (avanzo>0 ? ' (' + (avanzo===q ? 'tutti' : avanzo) + ' a magazzino)' : ''));
      });
      out.push({id, commessa_id:cid, commessa_nome:nome, tipo:'stampa', ordine:ordine++, statua_nome:'Lancio ' + (n+1) + ' di ' + lanci,
        file_id:fid, file_nome:f?.nome||'', macchina_id:f?.macchina_id||null, contenuto:righeTesto.join(', '), extra, minuti_previsti:f?.minuti_durata||0});
    }
  });
  // carteggiatura e decorazione per pezzo
  istanze.forEach(i=>{
    const base = {commessa_id:cid, commessa_nome:nome, statua:i.s.n, statua_nome:i.s.nome, pezzo_id:i.p.id, pezzo_nome:i.p.nome, accessorio:i.p.tipo==='accessorio', tecnologia:i.p.tecnologia, contenuto:i.fonte};
    let prec = i.dip;
    if(i.p.minuti_carteggiatura>0){ const id = nuovoId(); out.push({...base, id, tipo:'carteggiatura', ordine:ordine++, dipende_da:prec, minuti_previsti:i.p.minuti_carteggiatura}); prec = id; }
    if(i.p.minuti_decorazione>0){ out.push({...base, id:nuovoId(), tipo:'decorazione', ordine:ordine++, dipende_da:prec, minuti_previsti:i.p.minuti_decorazione, contenuto: i.p.minuti_carteggiatura>0 ? '' : i.fonte}); }
  });
  // montaggio e imballaggio per statua
  statue.forEach(s=>{
    const base = {commessa_id:cid, commessa_nome:nome, statua:s.n, statua_nome:s.nome};
    if(s.m.minuti_montaggio>0) out.push({...base, id:nuovoId(), tipo:'montaggio', ordine:ordine++, minuti_previsti:s.m.minuti_montaggio});
    if(s.m.minuti_imballaggio>0) out.push({...base, id:nuovoId(), tipo:'imballaggio', ordine:ordine++, minuti_previsti:s.m.minuti_imballaggio});
  });
  for(let i=0; i<out.length; i+=400){ const r = await sb.from('lavori').insert(out.slice(i, i+400)); if(r.error) throw r.error; }
  for(const [pid, n] of consumo){ const r = await sb.rpc('magazzino_aggiungi', {p_pezzo:pid, p_n:-n}); if(r.error) throw r.error; }
  return {creati: out.length, dalMagazzino: [...consumo.values()].reduce((a,b)=>a+b, 0)};
}

/* ═════════════ MAGAZZINO ═════════════ */
function renderMagazzino(box){
  const righe = st.magazzino.map(m=>({m, p:modelloDi(m.pezzo_id)})).filter(x=>x.p)
    .sort((a,b)=>nomeModello(a.p.modello_id).localeCompare(nomeModello(b.p.modello_id),'it') || a.p.nome.localeCompare(b.p.nome,'it'));
  const tot = righe.reduce((s,x)=>s + x.m.quantita, 0);
  const corpo = righe.map(({m,p})=>`<tr ${m.quantita? '' : 'style="opacity:.5"'}>
      <td>${e(nomeModello(p.modello_id))}</td>
      <td><b>${e(p.nome)}</b>${p.tipo==='accessorio' ? ' <span class="pchip acc">accessorio</span>' : ''}</td>
      <td>${tecChip(p.tecnologia)}</td>
      <td class="muted">${e(fileDelPezzo(p.id)?.file.nome || '—')}</td>
      <td style="white-space:nowrap;text-align:right">
        <button class="btn sm" aria-label="Togli uno" onclick="Prod.magazzino('${p.id}',-1)">−</button>
        <b style="display:inline-block;min-width:36px;text-align:center;font-family:var(--head);font-size:17px">${m.quantita}</b>
        <button class="btn sm" aria-label="Aggiungi uno" onclick="Prod.magazzino('${p.id}',1)">+</button>
      </td></tr>`).join('') || `<tr><td colspan="5"><div class="prod-empty">Il magazzino è vuoto. Si riempie da solo quando una stampa riuscita produce più pezzi di quelli che servono.</div></td></tr>`;
  box.innerHTML = testata('Magazzino pezzi', 'Pezzi stampati in più. Quando avvii una commessa, i pezzi presenti qui vengono usati prima di lanciare nuove stampe.') +
    `<div class="kpi-row"><div class="kpi card" style="padding:16px 18px"><div class="kpi-label">Pezzi in magazzino</div><div class="kpi-val">${tot}</div><div class="kpi-sub">${righe.filter(x=>x.m.quantita).length} tipi diversi</div></div></div>
    <div class="card"><div class="card-hdr"><h2>Disponibili</h2><span class="sub">Con + e − correggi i numeri se non tornano con lo scaffale</span></div>
      <div class="prod-tbl-wrap"><table class="prod-tbl"><thead><tr><th>Modello</th><th>Pezzo</th><th>Tecnologia</th><th>File</th><th style="text-align:right">Quantità</th></tr></thead><tbody>${corpo}</tbody></table></div></div>`;
}
async function magazzinoCorreggi(pid, n){
  const r = await sb.rpc('magazzino_aggiungi', {p_pezzo:pid, p_n:n});
  if(r.error){ showToast('Non riuscito: ' + r.error.message, 'error'); return; }
  await ricarica(); render();
}

/* Promemoria: carica i dati di produzione appena il database è collegato, poi li tiene aggiornati */
let _tentativi = 0;
setInterval(()=>{
  if(st.caricato || st.inCarica || _tentativi > 20) return;
  if(!(typeof sbPronto==='function' && sbPronto())) return;
  _tentativi++;
  assicuraDati().then(()=>{ ascolta(); aggiornaPromemoria(); }).catch(()=>{});
}, 4000);
setInterval(()=>{ if(st.caricato) aggiornaPromemoria(); }, 15*60*1000);

/* ═════════════ API pubblica (usata dai pulsanti) ═════════════ */
window.Prod = {
  mostra,
  puoiLasciare: (verso)=> !st.pagina || verso===st.pagina || puoiLasciare(),
  esci(){ if(st.sporco){ st.sporco = false; st.bozzaModello = null; st.bozzaFile = null; } st.pagina = null; },
  riprova(){ st.errore = null; st.caricato = false; mostra(st.pagina); },
  chiudiModale,
  // catalogo
  cercaModelli(v){ st.cercaModelli = v; const box = contenitore('prod-catalogo'); const pos = v.length; renderCatalogo(box); const i = document.getElementById('prod-cerca-mod'); if(i){ i.focus(); i.setSelectionRange(pos,pos); } },
  scegliModello(id){ if(id===st.selModello || !puoiLasciare()) return; st.selModello = id; st.bozzaModello = bozzaDa(st.modelli.find(m=>m.id===id)); st.sporco = false; render(); },
  nuovoModello(){ if(!puoiLasciare()) return; st.selModello = null; st.bozzaModello = bozzaDa(null); st.sporco = false; render(); document.getElementById('pm-nome')?.focus(); },
  duplicaModello(){
    if(!puoiLasciare()) return;
    const b = JSON.parse(JSON.stringify(st.bozzaModello));
    b.id = null; b.nome = b.nome + ' (copia)'; b.pezzi.forEach(p=>p.id = null);
    st.selModello = null; st.bozzaModello = b; st.sporco = true; render();
    showToast('Copia pronta: cambia nome o altezza e salva. I file di stampa vanno assegnati di nuovo.');
  },
  mod(k,v){ st.bozzaModello[k] = v; segnaSporco(); },
  modTempo(k,el){ const m = leggiTempo(el.value); if(isNaN(m)){ el.classList.add('t-err'); showToast('Tempo non valido: scrivi ore:minuti, es. 1:30','error'); return; } el.classList.remove('t-err'); st.bozzaModello[k] = m; el.value = hm(m); segnaSporco(); aggiornaTotali(); },
  pz(i,k,v){ st.bozzaModello.pezzi[i][k] = v; segnaSporco(); if(k==='quantita') aggiornaTotali(); },
  pzTempo(i,k,el){ const m = leggiTempo(el.value); if(isNaN(m)){ el.classList.add('t-err'); showToast('Tempo non valido: scrivi ore:minuti, es. 1:30','error'); return; } el.classList.remove('t-err'); st.bozzaModello.pezzi[i][k] = m; el.value = hm(m); segnaSporco(); aggiornaTotali(); },
  aggiungiPezzo(tipo){ st.bozzaModello.pezzi.push({id:null, nome:'', tipo, tecnologia: tipo==='accessorio' ? 'resina' : 'fdm', quantita:1, cart:0, deco:0}); segnaSporco(); riediModello();
    const ins = document.querySelectorAll('#prod-editor-modello tbody tr'); ins[ins.length-1]?.querySelector('input')?.focus(); },
  togliPezzo(i){
    const p = st.bozzaModello.pezzi[i];
    const f = p.id ? fileDelPezzo(p.id) : null;
    if(f && !confirm(`"${p.nome}" esce dal file ${f.file.nome}: salvando verrà tolto anche da lì. Continuare?`)) return;
    st.bozzaModello.pezzi.splice(i,1); segnaSporco(); riediModello();
  },
  salvaModello, eliminaModello,
  // file
  filtraMacchina(id){ st.filtroMacchina = id; render(); },
  scegliFile(id){ if(id===st.selFile || !puoiLasciare()) return; st.fileCommessa = null; st.selFile = id; st.bozzaFile = bozzaFileDa(st.files.find(f=>f.id===id)); st.sporco = false; render(); },
  nuovoFile(cid){ if(!puoiLasciare()) return; st.fileCommessa = typeof cid==='string' ? cid : null; st.selFile = null; st.bozzaFile = bozzaFileDa(null); st.sporco = false; if(st.pagina!=='prod-file') showPage('prod-file'); else render(); document.getElementById('pf-nome')?.focus(); },
  vistaFile(v){ st.vistaFile = v; render(); },
  apriFile(id){ if(!puoiLasciare()) return; st.selFile = id; st.bozzaFile = bozzaFileDa(st.files.find(f=>f.id===id)); st.sporco = false; st.vistaFile = 'commessa'; showPage('prod-file'); },
  fileCampo(k,v){ st.bozzaFile[k] = v; segnaSporco(); },
  fileTempo(el){ const m = leggiTempo(el.value); if(isNaN(m)){ el.classList.add('t-err'); showToast('Durata non valida: scrivi ore:minuti, es. 6:30','error'); return; } el.classList.remove('t-err'); st.bozzaFile.durata = m; el.value = hm(m); segnaSporco(); },
  rigaFile(i,k,v){ st.bozzaFile.righe[i][k] = v; segnaSporco(); if(k==='pezzo_id') riediFile(); else { const tr = document.querySelectorAll('#prod-editor-file tbody tr')[i]; const p = modelloDi(st.bozzaFile.righe[i].pezzo_id); if(tr && p){ const n = Math.floor((Number(v)||0)/p.quantita); tr.children[3].textContent = n + (n===1?' statua':' statue'); } } },
  aggiungiRigaFile(){ st.bozzaFile.righe.push({pezzo_id:'', quantita:1}); segnaSporco(); riediFile(); },
  togliRigaFile(i){ st.bozzaFile.righe.splice(i,1); segnaSporco(); riediFile(); },
  salvaFile, eliminaFile,
  // personale e macchine
  apriPersona, salvaPersona, eliminaPersona, apriMacchina, salvaMacchina, eliminaMacchina,
  toggleEsterno(v){ document.getElementById('pk-ore-box').style.display = v ? 'none' : ''; document.getElementById('pk-gg-box').style.display = v ? '' : 'none'; },
  // produzione della commessa
  apriCommessa, aggiornaRiquadro, avviaProduzione, riportaInCoda, rigaCampo, rigaModello, aggiungiRiga, togliRiga, mandaInProduzione, riportaInPreparazione, modificaModelloRiga,
  confermaCopia(rigaId){ const mid = document.getElementById('pc-mod')?.value; chiudiModale(); const riga = st.righe.find(x=>x.id===rigaId); if(riga && mid) creaPersonalizzata(riga, mid); },
  ridisegna(){ render(); },
  tornaACommessa(){ const cid = st.bozzaModello?.commessa_id; if(!cid || !puoiLasciare()) return; st.sporco = false; st.commessaId = cid; st.commessaNome = nomeCommessaDaId(cid); showPage('prod-commessa'); },
  vaiAllaCommessa(){ const n = st.commessaNome; if(n && typeof apriCommessa==='function') window.apriCommessa(n); },
  sposta, magazzino: magazzinoCorreggi,
  apriCommessaId(id){ st.commessaId = id; st.commessaNome = nomeCommessaDaId(id); showPage('prod-commessa'); },
  // per i test
  _st: st, _leggiTempo: leggiTempo, _hm: hm
};
})();
