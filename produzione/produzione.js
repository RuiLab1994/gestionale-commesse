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
const TABELLE = ['modelli','modelli_pezzi','file_stampa','file_stampa_contenuto','personale','macchine'];

const st = {
  pagina: null, caricato: false, errore: null, inCarica: null,
  modelli: [], pezzi: [], files: [], contenuto: [], personale: [], macchine: [],
  selModello: null, bozzaModello: null,
  selFile: null, bozzaFile: null, filtroMacchina: '',
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
  [st.modelli, st.pezzi, st.files, st.contenuto, st.personale, st.macchine] = ris.map(r=>r.data||[]);
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
    try{ await ricarica(); if(st.pagina) render(); }catch(err){}
  }, 800);
}

const modelloDi   = (pid)=>st.pezzi.find(p=>p.id===pid);
const nomeModello = (mid)=>{ const m = st.modelli.find(x=>x.id===mid); return m ? m.nome + (m.altezza_cm ? ' ' + String(m.altezza_cm).replace(/\.0$/,'') + ' cm' : '') : '—'; };
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
      ? 'Le tabelle della produzione non ci sono ancora nel database: esegui <b>supabase/02_produzione.sql</b> nello SQL Editor di Supabase, poi ricarica la pagina.'
      : 'Dati di produzione non raggiungibili: ' + e(st.errore)}</span><button class="btn sm" onclick="Prod.riprova()">Riprova</button></div>`;
    return;
  }
  if(id==='prod-catalogo') renderCatalogo(box);
  else if(id==='prod-file') renderFile(box);
  else if(id==='prod-personale') renderPersonale(box);
  else if(id==='prod-magazzino') renderMagazzino(box);
  else renderProgrammazione(box);
}

/* ═════════════ CATALOGO MODELLI ═════════════ */
function bozzaDa(m){
  if(!m) return {id:null, nome:'', altezza:'', montaggio:0, imballaggio:0, note:'', pezzi:[{id:null, nome:'', tipo:'pezzo', tecnologia:'fdm', quantita:1, cart:0, deco:0}]};
  return {
    id:m.id, nome:m.nome, altezza:m.altezza_cm ?? '', montaggio:m.minuti_montaggio, imballaggio:m.minuti_imballaggio, note:m.note||'',
    pezzi: st.pezzi.filter(p=>p.modello_id===m.id).map(p=>({id:p.id, nome:p.nome, tipo:p.tipo, tecnologia:p.tecnologia, quantita:p.quantita, cart:p.minuti_carteggiatura, deco:p.minuti_decorazione}))
  };
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

  return `<div class="card">
    <div class="prod-form">
      <div class="field grow"><label for="pm-nome">Nome del modello</label><input id="pm-nome" type="text" value="${e(b.nome)}" placeholder="es. Madonna di Lourdes" oninput="Prod.mod('nome',this.value)"></div>
      <div class="field small"><label for="pm-alt">Altezza (cm)</label><input id="pm-alt" type="number" min="0" step="0.5" value="${e(b.altezza)}" oninput="Prod.mod('altezza',this.value)"></div>
      <div class="prod-actions">
        ${b.id ? `<button class="btn" onclick="Prod.duplicaModello()"><i class="ti ti-copy"></i> Duplica</button>
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
  await ricarica(); showToast('Modello eliminato'); render();
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
  const pills = `<button class="prod-pill ${!st.filtroMacchina?'on':''}" onclick="Prod.filtraMacchina('')">Tutti</button>` +
    st.macchine.filter(m=>st.files.some(f=>f.macchina_id===m.id)).map(m=>`<button class="prod-pill ${st.filtroMacchina===m.id?'on':''}" onclick="Prod.filtraMacchina('${m.id}')">${e(m.nome)}</button>`).join('');
  const items = lista.map(f=>{
    const cont = st.contenuto.filter(c=>c.file_id===f.id);
    const nPezzi = cont.reduce((s,c)=>s + c.quantita, 0);
    const nMod = new Set(cont.map(c=>modelloDi(c.pezzo_id)?.modello_id)).size;
    return `<button type="button" class="prod-item ${f.id===st.selFile?'sel':''}" onclick="Prod.scegliFile('${f.id}')">
      <span class="tx"><b>${e(f.nome)}</b><span>${e(nomeMacchina(f.macchina_id))} · ${hm(f.minuti_durata)} · ${nPezzi} ${nPezzi===1?'pezzo':'pezzi'}${nMod>1 ? ', ' + nMod + ' modelli' : ''}</span></span></button>`;
  }).join('') || `<div class="prod-empty">${st.files.length ? 'Nessun file per questa macchina' : 'Nessun file ancora: creane uno'}</div>`;

  box.innerHTML = testata('File di stampa', 'Un file per macchina, con tutto quello che esce da un lancio. Può mescolare pezzi di modelli diversi; ogni pezzo esce da un solo file.',
      `<button class="btn-primary" onclick="Prod.nuovoFile()"><i class="ti ti-plus"></i> Nuovo file</button>`) + banner +
    `<div class="prod-split">
      <div class="card prod-list"><div class="prod-list-tools"><div class="prod-pills">${pills}</div></div>${items}</div>
      <div class="prod-edit" id="prod-editor-file">${editorFile()}</div>
    </div>`;
}
function opzioniPezzi(sceltoId){
  const b = st.bozzaFile;
  const altrove = new Set(st.contenuto.filter(c=>c.file_id!==b.id).map(c=>c.pezzo_id));
  const inQuesto = new Set(b.righe.map(r=>r.pezzo_id).filter(x=>x && x!==sceltoId));
  const gruppi = st.modelli.slice().sort(perNome).map(m=>{
    const pz = st.pezzi.filter(p=>p.modello_id===m.id && (p.id===sceltoId || (!altrove.has(p.id) && !inQuesto.has(p.id))));
    if(!pz.length) return '';
    return `<optgroup label="${e(nomeModello(m.id))}">${pz.map(p=>`<option value="${p.id}" ${p.id===sceltoId?'selected':''}>${e(p.nome)}${p.tipo==='accessorio'?' (accessorio)':''} · ${p.tecnologia==='resina'?'resina':'FDM'}</option>`).join('')}</optgroup>`;
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

/* ═════════════ PROGRAMMAZIONE E MAGAZZINO (prossimi passi) ═════════════ */
function renderProgrammazione(box){
  const cat = modelliCatalogo();
  const conPersone = st.personale.filter(p=>p.attivo && (p.ruoli||[]).length).length;
  const macchine = st.macchine.filter(m=>m.attiva).length;
  const senza = pezziSenzaFile().length;
  const check = (ok, tit, sub, pag)=>`<div class="prod-check"><i class="ti ${ok?'ti-circle-check ok':'ti-circle-dashed no'}"></i><div class="tx"><b>${tit}</b><span>${sub}</span></div><button class="btn sm" onclick="showPage('${pag}')">Apri</button></div>`;
  box.innerHTML = testata('Programmazione', 'Il Gantt delle commesse sulle ore di macchine e persone, e la simulazione del nuovo ordine.') +
    `<div class="prod-banner" style="background:var(--blue-bg);border-color:transparent;color:var(--blue-ink)"><i class="ti ti-info-circle"></i><span>Il Gantt arriva nel prossimo passo. Per calcolarlo servono i dati qui sotto: puoi iniziare a inserirli.</span></div>
    <div class="card"><div class="card-hdr"><h2>Cosa serve alla programmazione</h2></div><div class="prod-checks">
      ${check(macchine>0, 'Macchine', macchine + ' attive, con le ore di stampa al giorno', 'prod-personale')}
      ${check(conPersone>0, 'Personale con ruoli e ore', conPersone + ' persone attive', 'prod-personale')}
      ${check(cat.length>0, 'Catalogo modelli', cat.length + ' modelli con pezzi e tempi', 'prod-catalogo')}
      ${check(st.files.length>0 && senza===0, 'File di stampa', st.files.length + ' file' + (senza ? ' · ' + senza + (senza===1?' pezzo ancora senza file':' pezzi ancora senza file') : (st.files.length ? ' · tutti i pezzi coperti' : '')), 'prod-file')}
    </div></div>`;
}
function renderMagazzino(box){
  box.innerHTML = testata('Magazzino pezzi', 'I pezzi stampati in più, usati dalle commesse successive prima di lanciare una nuova stampa.') +
    `<div class="card"><div class="empty"><i class="ti ti-building-warehouse"></i><p>Il magazzino si riempie da solo quando una stampa produce più pezzi del necessario.<br>Arriva insieme ai tablet della stampa, nel prossimo passo.</p></div></div>`;
}

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
  scegliFile(id){ if(id===st.selFile || !puoiLasciare()) return; st.selFile = id; st.bozzaFile = bozzaFileDa(st.files.find(f=>f.id===id)); st.sporco = false; render(); },
  nuovoFile(){ if(!puoiLasciare()) return; st.selFile = null; st.bozzaFile = bozzaFileDa(null); st.sporco = false; render(); document.getElementById('pf-nome')?.focus(); },
  fileCampo(k,v){ st.bozzaFile[k] = v; segnaSporco(); },
  fileTempo(el){ const m = leggiTempo(el.value); if(isNaN(m)){ el.classList.add('t-err'); showToast('Durata non valida: scrivi ore:minuti, es. 6:30','error'); return; } el.classList.remove('t-err'); st.bozzaFile.durata = m; el.value = hm(m); segnaSporco(); },
  rigaFile(i,k,v){ st.bozzaFile.righe[i][k] = v; segnaSporco(); if(k==='pezzo_id') riediFile(); else { const tr = document.querySelectorAll('#prod-editor-file tbody tr')[i]; const p = modelloDi(st.bozzaFile.righe[i].pezzo_id); if(tr && p){ const n = Math.floor((Number(v)||0)/p.quantita); tr.children[3].textContent = n + (n===1?' statua':' statue'); } } },
  aggiungiRigaFile(){ st.bozzaFile.righe.push({pezzo_id:'', quantita:1}); segnaSporco(); riediFile(); },
  togliRigaFile(i){ st.bozzaFile.righe.splice(i,1); segnaSporco(); riediFile(); },
  salvaFile, eliminaFile,
  // personale e macchine
  apriPersona, salvaPersona, eliminaPersona, apriMacchina, salvaMacchina, eliminaMacchina,
  toggleEsterno(v){ document.getElementById('pk-ore-box').style.display = v ? 'none' : ''; document.getElementById('pk-gg-box').style.display = v ? '' : 'none'; },
  // per i test
  _st: st, _leggiTempo: leggiTempo, _hm: hm
};
})();
