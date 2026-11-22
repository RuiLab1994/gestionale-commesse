/* ═══════════════════════════════════════════════════
   PIANIFICAZIONE RuiLab — calcolo del Gantt a capacità finita
   Funzione pura: riceve i dati di produzione e restituisce, per ogni
   macchina e persona, i blocchi di lavoro e la data di fine di ogni commessa.

   Unità di tempo: "giorni" decimali da oggi (0 = oggi). 2.5 = a metà della
   giornata lavorativa di dopodomani, misurata sulle ore di quella risorsa.

   Regole (versione 1):
   - le commesse si lavorano nell'ordine della coda; ogni risorsa fa una cosa
     alla volta e non torna indietro a riempire i buchi
   - stampa: ogni lancio di file occupa la sua macchina per la durata del file;
     le macchine lavorano dal lunedì al venerdì per le ore indicate
   - stampatore esterno: i pezzi arrivano dopo i giorni promessi, senza limiti
   - carteggiatura e decorazione per ogni pezzo, montaggio e imballaggio per
     ogni statua: tra le persone con quel ruolo, la prima che finisce
   - le persone lavorano nei loro giorni, ore settimanali divise per i giorni
   - nessun lavoro è ancora segnato come fatto: tutto parte da oggi
═══════════════════════════════════════════════════ */
(function(radice){
'use strict';

const MAX_GIORNI = 400;
const EPS = 1e-9;

function pianifica(inp){
  const oggi = new Date(inp.oggi); oggi.setHours(0,0,0,0);
  const giornoSett = (d)=>{ const x = new Date(oggi); x.setDate(x.getDate() + d); const g = x.getDay(); return g===0 ? 7 : g; };
  const avvisi = [];
  const avvisa = (t)=>{ if(!avvisi.includes(t)) avvisi.push(t); };

  // ── risorse ──
  const risorse = {};
  const lane = [];
  (inp.macchine||[]).filter(m=>m.attiva!==false).forEach(m=>{
    const r = {id:m.id, nome:m.nome, tipo: m.esterno ? 'esterno' : 'macchina', p:0, blocchi:[],
      cap: m.esterno ? null : (d)=>{ const g = giornoSett(d); return g<=5 ? Number(m.ore_giorno||0)*60 : 0; },
      giorniConsegna: Number(m.giorni_consegna||7)};
    risorse[m.id] = r; lane.push(r);
  });
  const persone = (inp.personale||[]).filter(p=>p.attivo!==false && Number(p.ore_settimanali)>0 && (p.giorni||[]).length);
  persone.forEach(p=>{
    const giorni = (p.giorni||[]).map(Number);
    const alGiorno = Number(p.ore_settimanali)*60 / giorni.length;
    const r = {id:p.id, nome:p.nome, tipo:'persona', ruoli:p.ruoli||[], p:0, blocchi:[], cap:(d)=>giorni.includes(giornoSett(d)) ? alGiorno : 0};
    risorse[p.id] = r; lane.push(r);
  });
  const laneImballaggio = {id:'__imballaggio', nome:'Imballaggio (chi è libero)', tipo:'imballaggio', blocchi:[]};

  // Occupa una risorsa per "durata" minuti a partire da "dalle" (giorni decimali)
  function alloca(r, dalle, durata, prova){
    let t = Math.max(r.p, dalle);
    let d = Math.floor(t + EPS), f = Math.max(0, t - d);
    while(d < MAX_GIORNI && (r.cap(d) <= 0 || f >= 1 - EPS)){ d++; f = 0; }
    const da = d + f;
    let resto = durata;
    while(resto > EPS && d < MAX_GIORNI){
      const c = r.cap(d);
      if(c > 0){
        const libero = (1 - f) * c;
        if(resto <= libero + EPS){ f += resto / c; resto = 0; break; }
        resto -= libero;
      }
      d++; f = 0;
    }
    const a = d + f;
    if(!prova) r.p = a;
    return {da, a};
  }
  function conRuolo(ruolo){ return lane.filter(r=>r.tipo==='persona' && r.ruoli.includes(ruolo)); }
  function allocaRuolo(ruolo, dalle, durata){
    const cand = conRuolo(ruolo);
    if(!cand.length) return null;
    let meglio = null;
    cand.forEach(r=>{ const x = alloca(r, dalle, durata, true); if(!meglio || x.a < meglio.x.a - EPS) meglio = {r, x}; });
    return {r: meglio.r, ...alloca(meglio.r, dalle, durata, false)};
  }
  const nomiRuolo = {post_produzione:'Post-produzione', decorazione:'Decorazione', montaggio:'Montaggio', imballaggio:'Imballaggio'};

  // ── indici ──
  const modelli = new Map((inp.modelli||[]).map(m=>[m.id, m]));
  const pezziDi = new Map();
  (inp.pezzi||[]).forEach(p=>{ if(!pezziDi.has(p.modello_id)) pezziDi.set(p.modello_id, []); pezziDi.get(p.modello_id).push(p); });
  const files = new Map((inp.files||[]).map(f=>[f.id, f]));
  const fileDi = new Map((inp.contenuto||[]).map(c=>[c.pezzo_id, c]));

  const esito = {};
  const adesso = inp.adesso ? new Date(inp.adesso) : new Date();
  (inp.commesse||[]).forEach(c=>{
    const problemi = [];
    const blocco = (r, da, a, fase, testo, dettaglio)=>{
      const b = {commessa:c.id, nome:c.nome, fase, testo, dettaglio, da, a};
      (r.tipo==='imballaggio' ? laneImballaggio : r).blocchi.push(b);
      return b;
    };

    // ── commessa avviata: si parte dai lavori reali (fatti, in corso, da fare) ──
    if(c.lavori && c.lavori.length){
      const fine = new Map();
      const minutiFatti = (l)=>Number(l.minuti_lavorati||0) + (l.stato==='in_corso' && l.ripreso_il ? (adesso - new Date(l.ripreso_il))/60000 : 0);
      const resto = (l)=>Math.max(10, Number(l.minuti_previsti||0) - minutiFatti(l));   // se ha già sforato, si stimano almeno 10 minuti
      c.lavori.filter(l=>l.tipo==='stampa').forEach(l=>{
        if(l.stato==='fatto'){ fine.set(l.id, 0); return; }
        const r = risorse[l.macchina_id];
        let x;
        if(!r){ problemi.push(l.file_nome + ': macchina non disponibile'); x = {da:0, a:0}; }
        else if(r.tipo==='esterno'){
          const passati = Math.max(0, (adesso - new Date(l.creato_il || adesso)) / 86400000);
          x = {da:0, a:Math.max(0.3, r.giorniConsegna - passati)};
          blocco(r, x.da, x.a, 'stampa', c.nome + ' · ' + l.file_nome, 'Stampatore esterno · in attesa di consegna');
        } else {
          const dur = l.stato==='in_corso' && l.iniziato_il ? Math.max(5, Number(l.minuti_previsti||0) - (adesso - new Date(l.iniziato_il))/60000) : Number(l.minuti_previsti||0);
          x = alloca(r, 0, dur);
          blocco(r, x.da, x.a, 'stampa', c.nome + ' · ' + l.file_nome, (l.stato==='in_corso' ? 'In stampa · ' : '') + l.statua_nome);
        }
        fine.set(l.id, x.a);
      });
      const ruoloDi = {carteggiatura:'post_produzione', decorazione:'decorazione', montaggio:'montaggio', imballaggio:'imballaggio'};
      const esegui = (l, dalle)=>{
        if(l.stato==='fatto'){ fine.set(l.id, 0); return; }
        const dur = resto(l);
        const mia = (l.stato==='in_corso' || l.stato==='in_pausa') && l.persona_id && risorse[l.persona_id];
        let x;
        if(mia){ x = {r:mia, ...alloca(mia, dalle, dur)}; }
        else{
          x = allocaRuolo(ruoloDi[l.tipo], dalle, dur);
          if(!x){ avvisa('Nessuna persona attiva con il ruolo ' + nomiRuolo[ruoloDi[l.tipo]] + ': aggiungila in Personale e macchine.'); fine.set(l.id, dalle); return; }
        }
        const testo = c.nome + ' · ' + (l.pezzo_nome || l.tipo);
        const dett = l.statua_nome + (l.stato==='in_corso' ? ' · in lavorazione' : l.stato==='in_pausa' ? ' · in pausa' : '');
        if(l.tipo==='imballaggio') blocco(laneImballaggio, x.da, x.a, 'imballaggio', c.nome + ' · imballaggio', dett + ' · tempo riservato a ' + x.r.nome);
        else blocco(x.r, x.da, x.a, l.tipo, l.tipo==='montaggio' ? c.nome + ' · montaggio' : testo, dett);
        fine.set(l.id, x.a);
      };
      ['carteggiatura','decorazione'].forEach(tipo=>{
        c.lavori.filter(l=>l.tipo===tipo)
          .map(l=>({l, dalle: l.dipende_da ? (fine.get(l.dipende_da) ?? 0) : 0}))
          .sort((a,b)=>a.dalle - b.dalle)
          .forEach(({l, dalle})=>esegui(l, dalle));
      });
      const statue = [...new Set(c.lavori.filter(l=>l.statua).map(l=>l.statua))];
      let fineCommessa = 0;
      statue.forEach(n=>{
        const pezzi = c.lavori.filter(l=>l.statua===n && (l.tipo==='carteggiatura' || l.tipo==='decorazione'));
        let t = Math.max(0, ...pezzi.map(l=>fine.get(l.id) || 0));
        const mont = c.lavori.find(l=>l.statua===n && l.tipo==='montaggio');
        if(mont){ esegui(mont, t); t = Math.max(t, fine.get(mont.id) || 0); }
        const imb = c.lavori.find(l=>l.statua===n && l.tipo==='imballaggio');
        if(imb){ esegui(imb, t); t = Math.max(t, fine.get(imb.id) || 0); }
        fineCommessa = Math.max(fineCommessa, t);
      });
      fineCommessa = Math.max(fineCommessa, ...[...fine.values()]);
      const mieiBlocchi = lane.concat([laneImballaggio]).flatMap(r=>r.blocchi.filter(b=>b.commessa===c.id));
      esito[c.id] = {fine: fineCommessa, inizio: mieiBlocchi.length ? Math.min(...mieiBlocchi.map(b=>b.da)) : null, problemi,
        completata: c.lavori.every(l=>l.stato==='fatto')};
      return;
    }

    // statue e pezzi da produrre
    const statue = [];
    (c.righe||[]).forEach(riga=>{
      const m = modelli.get(riga.modello_id);
      if(!m){ problemi.push('una statua senza modello'); return; }
      const gia = Math.max(0, riga.gia_stampate|0);
      for(let k=1; k<=Math.max(1, riga.quantita|0); k++) statue.push({m, stampata: k <= gia, etichetta: (riga.descrizione || m.nome) + (riga.quantita>1 ? ' ' + k + '/' + riga.quantita : ''), pezzi:[]});
    });
    const istanze = [];
    statue.forEach(s=>{
      (pezziDi.get(s.m.id)||[]).forEach(p=>{
        for(let q=0; q<Math.max(1, p.quantita|0); q++){ const i = {statua:s, p, pronto:null, fine:null}; s.pezzi.push(i); istanze.push(i); }
      });
    });

    // stampa: lanci per file
    const perFile = new Map();
    istanze.forEach(i=>{
      if(i.statua.stampata){ i.pronto = 0; return; }     // già stampata: niente stampa
      const c2 = fileDi.get(i.p.id);
      if(!c2 || !files.has(c2.file_id)){ problemi.push(i.p.nome + ': nessun file'); i.pronto = 0; return; }
      if(!perFile.has(c2.file_id)) perFile.set(c2.file_id, new Map());
      const tipi = perFile.get(c2.file_id);
      if(!tipi.has(i.p.id)) tipi.set(i.p.id, {resa: Math.max(1, c2.quantita|0), istanze:[]});
      tipi.get(i.p.id).istanze.push(i);
    });
    perFile.forEach((tipi, fid)=>{
      const f = files.get(fid);
      const r = risorse[f.macchina_id];
      const lanci = Math.max(...[...tipi.values()].map(t=>Math.ceil(t.istanze.length / t.resa)));
      for(let n=0; n<lanci; n++){
        let x;
        if(!r){ problemi.push(f.nome + ': macchina non disponibile'); x = {da:0, a:0}; }
        else if(r.tipo==='esterno'){ x = {da:0, a:r.giorniConsegna}; blocco(r, x.da, x.a, 'stampa', c.nome + ' · ' + f.nome, 'Stampatore esterno · consegna promessa dopo ' + r.giorniConsegna + ' giorni'); }
        else{ x = alloca(r, 0, Number(f.minuti_durata||0)); blocco(r, x.da, x.a, 'stampa', c.nome + ' · ' + f.nome, 'Lancio ' + (n+1) + ' di ' + lanci); }
        tipi.forEach(t=>t.istanze.slice(n*t.resa, (n+1)*t.resa).forEach(i=>{ i.pronto = x.a; }));
      }
    });

    // carteggiatura e decorazione per pezzo, nell'ordine in cui i pezzi sono pronti
    const fase = (ruolo, minuti, campoDa, campoA, nomeFase)=>{
      istanze.slice().sort((a,b)=>a[campoDa]-b[campoDa]).forEach(i=>{
        const dur = Number(minuti(i.p)||0);
        if(dur<=0){ i[campoA] = i[campoDa]; return; }
        const x = allocaRuolo(ruolo, i[campoDa], dur);
        if(!x){ avvisa('Nessuna persona attiva con il ruolo ' + nomiRuolo[ruolo] + ': aggiungila in Personale e macchine.'); i[campoA] = i[campoDa]; return; }
        blocco(x.r, x.da, x.a, nomeFase, c.nome + ' · ' + i.p.nome, i.statua.etichetta);
        i[campoA] = x.a;
      });
    };
    fase('post_produzione', p=>p.minuti_carteggiatura, 'pronto', 'carteggiato', 'carteggiatura');
    fase('decorazione', p=>p.minuti_decorazione, 'carteggiato', 'fine', 'decorazione');

    // montaggio e imballaggio per statua
    let fineCommessa = 0;
    statue.forEach(s=>{
      let t = Math.max(0, ...s.pezzi.map(i=>i.fine||0));
      const mont = Number(s.m.minuti_montaggio||0);
      if(mont>0){
        const x = allocaRuolo('montaggio', t, mont);
        if(!x) avvisa('Nessuna persona attiva con il ruolo Montaggio: aggiungila in Personale e macchine.');
        else{ blocco(x.r, x.da, x.a, 'montaggio', c.nome + ' · montaggio', s.etichetta); t = x.a; }
      }
      const imb = Number(s.m.minuti_imballaggio||0);
      if(imb>0){
        const x = allocaRuolo('imballaggio', t, imb);
        if(!x) avvisa('Nessuna persona attiva con il ruolo Imballaggio: aggiungila in Personale e macchine.');
        else{ blocco(laneImballaggio, x.da, x.a, 'imballaggio', c.nome + ' · imballaggio', s.etichetta + ' · tempo riservato a ' + x.r.nome); t = x.a; }
      }
      fineCommessa = Math.max(fineCommessa, t);
    });
    const mieiBlocchi = lane.concat([laneImballaggio]).flatMap(r=>r.blocchi.filter(b=>b.commessa===c.id));
    esito[c.id] = {fine: fineCommessa, inizio: mieiBlocchi.length ? Math.min(...mieiBlocchi.map(b=>b.da)) : null, problemi};
  });

  // unisce i blocchi consecutivi della stessa commessa e fase sulla stessa riga
  const tutte = lane.concat(laneImballaggio.blocchi.length ? [laneImballaggio] : []);
  tutte.forEach(r=>{
    r.blocchi.sort((a,b)=>a.da-b.da);
    const out = [];
    r.blocchi.forEach(b=>{
      const u = out[out.length-1];
      if(u && r.tipo!=='esterno' && u.commessa===b.commessa && u.fase===b.fase && b.da - u.a < 0.02){
        u.a = Math.max(u.a, b.a); u.n = (u.n||1) + 1;
        if(!u.base) u.base = u.testo;
        u.testo = u.fase==='stampa' ? u.base + ' ×' + u.n : u.nome + ' · ' + u.fase + ' (' + u.n + ')';
        if(!u.dettagli) u.dettagli = [u.testo + ' — ' + u.dettaglio];
        u.dettagli.push(b.testo + ' — ' + b.dettaglio);
      } else out.push({...b});
    });
    r.blocchi = out;
  });

  const fineMax = Math.max(0, ...Object.values(esito).map(x=>x.fine), ...tutte.flatMap(r=>r.blocchi.map(b=>b.a)));
  const nGiorni = Math.min(120, Math.max(10, Math.ceil(fineMax) + 2));
  const giorni = [];
  for(let d=0; d<nGiorni; d++){ const x = new Date(oggi); x.setDate(x.getDate() + d); giorni.push({data:x, settimana: giornoSett(d)}); }
  const dataDi = (t)=>{ const x = new Date(oggi); x.setDate(x.getDate() + Math.max(0, Math.ceil(t - EPS) - 1)); return x; };
  Object.values(esito).forEach(x=>{
    x.fineData = x.fine > 0 ? dataDi(x.fine) : (x.completata ? new Date(oggi) : null);
    if(x.inizio!=null){ const d = new Date(oggi); d.setDate(d.getDate() + Math.floor(x.inizio + EPS)); x.inizioData = d; }
  });

  return {
    giorni,
    lane: tutte.map(r=>({id:r.id, nome:r.nome, tipo:r.tipo, blocchi:r.blocchi})),
    commesse: esito,
    avvisi
  };
}

radice.ProdPianifica = pianifica;
if(typeof module!=='undefined') module.exports = pianifica;
})(typeof window!=='undefined' ? window : globalThis);
