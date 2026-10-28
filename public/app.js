// L'écran du cockpit. Sans framework, sans dépendance.
// Tout le texte affiché arrive par textContent : ce que dit un modèle n'est jamais interprété comme du HTML.
'use strict';

const STATUTS = {
  pret: 'Prêt',
  en_cours: 'En cours',
  reussi: 'Réussi',
  echec: 'Échec',
  bloque_budget: 'Bloqué',
  invalide: 'Illisible',
};
const TYPES_ALERTE = { echec: 'Échec', budget: 'Budget', retard: 'Retard', config: 'Réglage' };
const NB_SEGMENTS = 40;
const MAX_LIGNES = 220;

const $ = (id) => document.getElementById(id);

function el(balise, classe, texte) {
  const noeud = document.createElement(balise);
  if (classe) noeud.className = classe;
  if (texte !== undefined) noeud.textContent = texte;
  return noeud;
}

function fixer(noeud, texte) {
  if (noeud.textContent !== texte) noeud.textContent = texte;
}

// Espace insécable avant « € » : un montant ne se coupe jamais entre le chiffre et le symbole.
const typo = (texte) => texte.replace(/(\d) €/g, '$1\u00a0€');
const eur = (x, decimales = 2) => (x === null || x === undefined ? 'inconnu' : `${x.toFixed(decimales).replace('.', ',')}\u00a0€`);
// Le mot qui suit un nombre : zéro et un restent au singulier, le pluriel commence à deux (« 1 agent », « 5 agents »).
// Même calcul que plurielSi dans src/utilitaires.js : test/ui.test.js vérifie qu'ils s'accordent.
function plurielSi(n, singulier, pluriel = `${singulier}s`) {
  const connu = typeof n === 'number' || (typeof n === 'string' && n.trim() !== '');
  const nombre = connu ? Number(n) : Number.NaN;
  return Number.isFinite(nombre) && Math.abs(nombre) < 2 ? singulier : pluriel;
}
function compte(n, singulier, pluriel) {
  return `${n} ${plurielSi(n, singulier, pluriel)}`;
}
function resumeAgents(total, enCours) {
  return `${compte(total, 'agent')}${enCours > 0 ? ` · ${enCours} en cours` : ''}`;
}
const hhmm = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const hhmmss = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function ecartJours(iso) {
  const d = new Date(iso);
  const aujourdhui = new Date();
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const b = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), aujourdhui.getDate());
  return Math.round((a - b) / 86400000);
}

function libelleJour(iso) {
  const ecart = ecartJours(iso);
  if (ecart === 0) return 'aujourd\'hui';
  if (ecart === -1) return 'hier';
  if (ecart === 1) return 'demain';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

// « il y a 4 min », « il y a 2 h », « hier » : la colonne Dernier vit au lieu de répéter « aujourd'hui »
function ilYa(iso) {
  const ecart = ecartJours(iso);
  if (ecart !== 0) return libelleJour(iso);
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 60000));
  if (minutes < 1) return 'à l\'instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  return `il y a ${Math.floor(minutes / 60)} h`;
}

function duree(ms) {
  if (ms === null || ms === undefined) return 'inconnue';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

let etat = null;
let ficheId = null; // l'agent dont la fiche est ouverte

/* ------------------------------------------------------------------ horloge */

function rendreHorloge() {
  const maintenant = new Date();
  const jour = maintenant.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  fixer($('horloge'), `${jour}, ${maintenant.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`);
}

/* ------------------------------------------------------------------ bandeau : totalisateur, plafond, voyants */

let premierRendu = true;

// Une palette affiche un caractère ; quand il change, la moitié haute de l'ancien tombe, puis la moitié basse du nouveau,
// comme sur un panneau d'aéroport. Les volets sont décoratifs : le caractère lu est toujours celui de .car.
function basculer(palette, ancien, nouveau, retard = 0) {
  palette.querySelectorAll('.volet, .ancien-bas').forEach((n) => n.remove());
  // tant que sa bascule n'a pas commencé, la palette montre encore l'ancien caractère (volet haut immobile, ancien bas)
  const ancienBas = el('span', 'ancien-bas', ancien);
  const voletHaut = el('span', 'volet volet-haut', ancien);
  const voletBas = el('span', 'volet volet-bas', nouveau);
  for (const n of [ancienBas, voletHaut, voletBas]) {
    n.setAttribute('aria-hidden', 'true');
    n.style.setProperty('--retard', `${retard}ms`);
  }
  palette.append(ancienBas, voletHaut, voletBas);
  setTimeout(() => [ancienBas, voletHaut, voletBas].forEach((n) => n.remove()), retard + 760);
}

function rendrePalettes(valeur) {
  const texte = `${valeur.toFixed(2).replace('.', ',')}€`;
  const conteneur = $('palettes');
  if (conteneur.children.length !== texte.length) {
    conteneur.replaceChildren(...[...texte].map((c) => {
      const classe = c === ',' ? 'palette separateur' : c === '€' ? 'palette devise' : 'palette';
      const palette = el('span', classe);
      palette.append(el('span', 'car', ''));
      return palette;
    }));
  }
  let rang = 0;
  [...texte].forEach((caractere, i) => {
    const palette = conteneur.children[i];
    const car = palette.querySelector('.car');
    const ancien = car.textContent;
    if (ancien === caractere) return;
    car.textContent = caractere;
    // en cascade, de la gauche vers la droite : chaque palette part 90 ms après la précédente
    if (!premierRendu && ancien !== '' && !palette.classList.contains('separateur')) basculer(palette, ancien, caractere, rang++ * 90);
  });
  conteneur.setAttribute('aria-label', `Coût du jour : ${eur(valeur)}`);
}

function rendreJauge(cout, plafond) {
  const jauge = $('jauge');
  if (jauge.children.length !== NB_SEGMENTS) {
    jauge.replaceChildren(...Array.from({ length: NB_SEGMENTS }, () => document.createElement('i')));
  }
  const part = plafond > 0 ? cout / plafond : 0;
  let pleins = Math.min(NB_SEGMENTS, Math.round(part * NB_SEGMENTS));
  if (cout > 0 && pleins === 0) pleins = 1;
  [...jauge.children].forEach((segment, i) => segment.classList.toggle('plein', i < pleins));
  jauge.classList.toggle('attention', part >= 0.7 && part <= 1);
  jauge.classList.toggle('depasse', part > 1);
  jauge.setAttribute('aria-label', `${Math.round(part * 100)} % du plafond du jour dépensé`);
}

// Sous le coût du jour, ce qu'il a payé : le nombre de passages réussis du jour, accordé (« pour 1 tâche », « pour 8 tâches »).
function rendreRapport(n) {
  const p = $('rapport-jour');
  const cle = String(n);
  if (p.dataset.n === cle) return;
  p.dataset.n = cle;
  if (!(n > 0)) {
    p.replaceChildren(document.createTextNode('aucune tâche faite aujourd\'hui'));
    return;
  }
  p.replaceChildren(
    document.createTextNode('pour '),
    el('strong', undefined, `${compte(n, 'tâche')} ${plurielSi(n, 'faite')}`),
    document.createTextNode(' aujourd\'hui'),
  );
}

function rendreBandeau(e) {
  rendrePalettes(e.cout.jour_eur);
  rendreRapport(e.cout.taches_jour ?? 0);
  fixer($('plafond'), eur(e.cout.plafond_eur));
  const reste = $('reste');
  const part = e.cout.plafond_eur > 0 ? (e.cout.jour_eur + (e.cout.estime_eur ?? 0)) / e.cout.plafond_eur : 0;
  if (e.cout.reste_eur < 0) {
    fixer(reste, `-${eur(Math.abs(e.cout.reste_eur))}`);
    fixer($('t-reste'), 'Dépassé de');
  } else {
    fixer(reste, eur(e.cout.reste_eur));
    fixer($('t-reste'), 'Reste');
  }
  reste.classList.toggle('depasse', e.cout.reste_eur < 0);
  reste.classList.toggle('attention', e.cout.reste_eur >= 0 && part >= 0.7);
  rendreJauge(e.cout.jour_eur + (e.cout.estime_eur ?? 0), e.cout.plafond_eur);
  const note = $('estime');
  note.hidden = !(e.cout.estime_eur > 0);
  if (!note.hidden) {
    const n = e.cout.passages_inconnus;
    fixer(note, `+ ${eur(e.cout.estime_eur)} estimés pour ${compte(n, 'passage')} au coût inconnu, comptés dans le reste`);
  }
  $('pastille-api').classList.toggle('visible', e.cout.equivalent_api === true);

  for (const type of ['echec', 'budget', 'retard']) {
    const n = e.alertes.filter((a) => a.type === type).length;
    const voyant = $(`voyant-${type}`);
    const etaitAllume = voyant.classList.contains('allume');
    voyant.classList.toggle('allume', n > 0);
    // un voyant qui s'allume flashe trois fois, puis reste allumé
    if (n > 0 && !etaitAllume && !premierRendu) {
      voyant.classList.remove('flash');
      void voyant.offsetWidth;
      voyant.classList.add('flash');
    }
    fixer(voyant.querySelector('.compte'), String(n));
  }
}

/* ------------------------------------------------------------------ agents : les strips */

const strips = new Map();

function creerStrip(agent) {
  const li = el('li', 'strip');
  li.dataset.id = agent.id;
  const nom = el('div', 'strip-nom');
  nom.append(el('strong'), el('span'));
  const statut = el('div', 'strip-statut');
  const mot = el('div', 'mot-statut');
  mot.append(el('span', 'led'), el('span', 'mot'));
  statut.append(mot, el('small', 'detail-statut'));
  const dernier = el('div', 'strip-dernier');
  dernier.append(el('span', 'heure'), el('small'));
  const prochain = el('div', 'strip-prochain');
  prochain.append(el('span', 'heure'), el('small'));
  const cout = el('div', 'strip-cout');
  const ligne = el('div', 'cout-ligne');
  ligne.append(el('span', 'cout-valeur'), el('span', 'cout-budget'));
  const mini = el('span', 'mini-jauge');
  mini.append(document.createElement('i'));
  cout.append(ligne, mini);
  const bouton = el('button', 'lancer', 'Lancer');
  bouton.type = 'button';
  bouton.addEventListener('click', () => lancer(li.dataset.id, bouton));
  // un clic sur la ligne ouvre la fiche de l'agent ; jamais un clic sur « Lancer »
  li.addEventListener('click', (evenement) => {
    if (evenement.target.closest('.lancer')) return;
    ouvrirFiche(li.dataset.id);
  });
  nom.tabIndex = 0;
  nom.setAttribute('role', 'button');
  nom.addEventListener('keydown', (evenement) => {
    if (evenement.key !== 'Enter' && evenement.key !== ' ') return;
    evenement.preventDefault();
    ouvrirFiche(li.dataset.id);
  });
  li.append(el('span', 'rail'), nom, statut, dernier, prochain, cout, bouton);
  return li;
}

// Ce que fait l'agent en ce moment, tiré de sa dernière ligne d'action dans le journal (« Lit inbox.jsonl »).
const derniereAction = new Map();
function court(texte) {
  return texte.replace(/(?:[\w.À-ſ-]+\/)+([\w.À-ſ-]+)/g, '$1').replace(/\s*\(\d[^)]*\)\s*$/, '');
}

// Sous le nom : ce que fait l'agent en ce moment ; sinon ce qu'il a fait aujourd'hui (sa ligne de bilan, écrite par lui) ;
// sinon sa description.
function majDescription(li, agent) {
  const span = li.querySelector('.strip-nom span');
  const action = agent.statut === 'en_cours' ? derniereAction.get(agent.id) : null;
  const fait = !action && agent.statut !== 'en_cours' && agent.fait ? agent.fait : null;
  span.classList.toggle('action-en-cours', Boolean(action));
  span.classList.toggle('fait', Boolean(fait));
  fixer(span, action ? `${action}…` : fait ?? agent.description);
  span.title = agent.description;
  if (fait) span.title = `Aujourd'hui : ${fait}`;
}

function majStrip(li, agent) {
  li.dataset.statut = agent.statut;
  fixer(li.querySelector('.strip-nom strong'), agent.nom);
  if (agent.statut !== 'en_cours' || li.dataset.depuis !== (agent.en_cours_depuis ?? '')) derniereAction.delete(agent.id);
  li.dataset.depuis = agent.en_cours_depuis ?? '';
  majDescription(li, agent);
  fixer(li.querySelector('.mot'), STATUTS[agent.statut] ?? agent.statut);

  const detail = li.querySelector('.detail-statut');
  detail.dataset.depuis = agent.en_cours_depuis ?? '';
  if (agent.statut === 'en_cours') detail.textContent = `depuis ${Math.max(0, Math.round((Date.now() - new Date(agent.en_cours_depuis)) / 1000))} s`;
  else if (agent.statut === 'bloque_budget') detail.textContent = 'budget du jour';
  else if (agent.statut === 'invalide') detail.textContent = 'voir l\'alerte';
  else if (agent.dernier_duree_ms !== null && agent.dernier_duree_ms !== undefined && agent.dernier_passage) detail.textContent = `${duree(agent.dernier_duree_ms)}`;
  else detail.textContent = '';

  const [heureDernier, jourDernier] = li.querySelector('.strip-dernier').children;
  if (agent.dernier_passage) {
    fixer(heureDernier, hhmm(agent.dernier_passage));
    jourDernier.dataset.quand = agent.dernier_passage;
    fixer(jourDernier, ilYa(agent.dernier_passage));
  } else {
    delete jourDernier.dataset.quand;
    fixer(heureDernier, '');
    fixer(jourDernier, 'jamais lancé');
  }

  const [heureProchain, jourProchain] = li.querySelector('.strip-prochain').children;
  jourProchain.classList.toggle('retard', agent.en_retard === true);
  if (agent.planning) {
    fixer(heureProchain, agent.en_retard ? agent.planning : hhmm(agent.prochain_passage));
    fixer(jourProchain, agent.en_retard ? 'en retard' : `auto · ${libelleJour(agent.prochain_passage)}`);
  } else {
    fixer(heureProchain, '');
    fixer(jourProchain, 'manuel');
  }

  fixer(li.querySelector('.cout-valeur'), eur(agent.cout_jour_eur));
  fixer(li.querySelector('.cout-budget'), agent.invalide ? '' : `/ ${eur(agent.budget_jour_eur)}`);
  const compte = agent.cout_jour_eur + (agent.cout_estime_eur ?? 0);
  const part = agent.budget_jour_eur > 0 ? compte / agent.budget_jour_eur : 0;
  li.querySelector('.strip-cout').title = agent.cout_estime_eur > 0 ? `${eur(agent.cout_estime_eur)} estimés pour un passage au coût inconnu, comptés dans le budget` : '';
  const mini = li.querySelector('.mini-jauge');
  mini.firstChild.style.width = `${Math.min(100, Math.round(part * 100))}%`;
  mini.classList.toggle('attention', part >= 0.7 && part <= 1);
  mini.classList.toggle('depasse', part > 1);

  const bouton = li.querySelector('.lancer');
  bouton.disabled = agent.statut === 'en_cours';
  bouton.textContent = agent.statut === 'en_cours' ? 'En cours' : 'Lancer';
  bouton.setAttribute('aria-label', `Lancer l'agent ${agent.nom}`);
  li.querySelector('.strip-nom').setAttribute('aria-label', `Ouvrir la fiche de ${agent.nom}`);
  li.classList.toggle('choisie', agent.id === ficheId);
}

function rendreAgents(e) {
  const liste = $('agents');
  const presents = new Set(e.agents.map((a) => a.id));
  for (const [id, li] of strips) {
    if (!presents.has(id)) {
      li.remove();
      strips.delete(id);
    }
  }
  e.agents.forEach((agent, i) => {
    let li = strips.get(agent.id);
    if (!li) {
      li = creerStrip(agent);
      strips.set(agent.id, li);
    }
    majStrip(li, agent);
    if (liste.children[i] !== li) liste.insertBefore(li, liste.children[i] ?? null);
  });
  const enCours = e.agents.filter((a) => a.statut === 'en_cours');
  fixer($('detail-agents'), resumeAgents(e.agents.length, enCours.length));
}

/* ------------------------------------------------------------------ alertes */

function rendreAlertes(e) {
  const liste = $('alertes');
  fixer($('detail-alertes'), e.alertes.length === 0 ? '' : `${e.alertes.length} à regarder`);
  if (e.alertes.length === 0) {
    const vide = el('li', 'vide');
    vide.append(el('span', 'led'), el('span', undefined, 'Aucune alerte : les agents sont à l\'heure, dans leur budget, sans échec.'));
    liste.replaceChildren(vide);
    return;
  }
  liste.replaceChildren(...e.alertes.map((a) => {
    const li = el('li', `alerte ${a.type}`);
    li.append(el('span', 'type', TYPES_ALERTE[a.type] ?? a.type), el('p', undefined, typo(a.message)));
    return li;
  }));
}

/* ------------------------------------------------------------------ historique */

function rendreHistorique(e) {
  const corps = $('historique');
  if (e.historique.length === 0) {
    const tr = el('tr');
    const td = el('td', 'faible', 'Aucun passage pour l\'instant. Lance un agent.');
    td.colSpan = 6;
    tr.append(td);
    corps.replaceChildren(tr);
    return;
  }
  corps.replaceChildren(...e.historique.map((h) => {
    const tr = el('tr');
    const jour = ecartJours(h.debut) === 0 ? '' : `${new Date(h.debut).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} `;
    const refus = h.statut === 'bloque_budget';
    const mot = el('span', `statut-mot ${h.statut}`, refus ? 'Refusé' : STATUTS[h.statut] ?? h.statut);
    if (h.erreur) mot.title = h.erreur;
    const cellStatut = el('td');
    cellStatut.append(mot);
    const cellResultat = el('td');
    const cellCout = el('td', refus || h.cout_eur !== null ? 'num' : 'num cout-inconnu', refus ? '' : h.cout_eur === null ? 'coût inconnu' : eur(h.cout_eur, 3));
    if (!refus && h.cout_eur === null) cellCout.title = 'Claude Code n\'a pas renvoyé son résultat : le budget du jour compte une estimation prudente.';
    if (h.resultat) {
      const lien = el('a', undefined, 'Ouvrir');
      lien.href = `/${h.resultat.split('/').map(encodeURIComponent).join('/')}`;
      lien.target = '_blank';
      lien.rel = 'noopener';
      lien.title = h.resultat;
      // un clic simple ouvre le résultat mis en forme dans le cockpit ; Cmd ou Ctrl + clic l'ouvre brut dans un onglet
      lien.addEventListener('click', (evenement) => {
        if (evenement.metaKey || evenement.ctrlKey || evenement.shiftKey) return;
        evenement.preventDefault();
        ouvrirResultat(lien, h);
      });
      cellResultat.append(lien);
    } else if (refus) {
      // la raison du refus, là où les autres passages ont leur résultat : le statut tient sur une ligne
      cellResultat.append(el('span', 'faible', 'budget du jour'));
    }
    tr.append(
      el('td', undefined, `${jour}${hhmm(h.debut)}`),
      el('td', undefined, h.agent_nom),
      el('td', 'num', refus ? '' : duree(h.duree_ms)),
      cellCout,
      cellStatut,
      cellResultat,
    );
    return tr;
  }));
}

/* ------------------------------------------------------------------ journal en direct */

const journal = $('journal');

function messageVideJournal() {
  const vide = el('div', 'vide', 'Aucun passage en cours. Clique sur « Lancer » : les étapes de l\'agent s\'affichent ici, ligne par ligne.');
  vide.id = 'journal-vide';
  return vide;
}

function construireLigne(l) {
  const classes = ['ligne', l.niveau === 'texte' ? 'texte-claude' : l.niveau];
  const div = el('div', classes.join(' '));
  const puce = el('span', 'puce', (l.agent_nom ?? l.agent).split(' ')[0]);
  puce.title = l.agent_nom ?? l.agent;
  div.append(el('time', undefined, hhmmss(l.ts)), puce, el('span', 'texte', typo(l.texte)));
  return div;
}

// Au repos (aucune ligne en direct à l'écran), le journal remontre, atténuées, les étapes du dernier passage terminé,
// sous un titre qui dit lequel (hors de la zone qui défile). La première ligne en direct les remplace.
function cacherRepos() {
  $('journal-repos')?.remove();
  $('repos-titre').hidden = true;
  delete journal.dataset.repos;
}

function rendreRepos(e) {
  if (journal.querySelector(':scope > .ligne')) return;
  const d = e.dernier_passage;
  const cle = d ? `${d.agent}|${d.debut}|${d.etapes.length}` : '';
  if ((journal.dataset.repos ?? '') === cle && (cle !== '' || $('journal-vide'))) return;
  if (!d || d.etapes.length === 0) {
    cacherRepos();
    journal.replaceChildren(messageVideJournal());
    return;
  }
  journal.dataset.repos = cle;
  const titre = $('repos-titre');
  const quand = ecartJours(d.debut) === 0 ? hhmm(d.debut) : `${libelleJour(d.debut)}, ${hhmm(d.debut)}`;
  titre.replaceChildren(document.createTextNode('Dernier passage : '), el('strong', undefined, d.agent_nom), document.createTextNode(`, ${quand}`));
  titre.hidden = false;
  const bloc = el('div', 'repos');
  bloc.id = 'journal-repos';
  bloc.append(...d.etapes.map((l) => construireLigne({ ...l, agent: d.agent, agent_nom: d.agent_nom })));
  journal.replaceChildren(bloc);
  journal.scrollTop = journal.scrollHeight;
}

function ajouterLigne(l) {
  $('journal-vide')?.remove();
  cacherRepos();
  const colle = journal.scrollHeight - journal.scrollTop - journal.clientHeight < 48;
  journal.append(construireLigne(l));
  while (journal.children.length > MAX_LIGNES) journal.firstChild.remove();
  if (colle) journal.scrollTop = journal.scrollHeight;
  // la ligne de l'agent montre ce qu'il fait en ce moment
  if (l.niveau === 'action' && l.agent) {
    const li = strips.get(l.agent);
    const agent = etat?.agents.find((a) => a.id === l.agent);
    // seules les actions du passage en cours comptent (les lignes rejouées après un rechargement sont ignorées)
    if (li && agent && agent.statut === 'en_cours' && new Date(l.ts) >= new Date(agent.en_cours_depuis)) {
      derniereAction.set(l.agent, court(l.texte));
      majDescription(li, agent);
    }
  }
}

/* ------------------------------------------------------------------ lecteur de résultat (Markdown mis en forme) */

// Le Markdown d'un résultat est découpé en blocs et en morceaux de texte, puis construit élément par élément :
// rien de ce qu'écrit un agent n'est jamais interprété comme du HTML. Liens acceptés : http, https ou relatifs.
function morceauxEnLigne(texte) {
  const morceaux = [];
  const motif = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^\s()]+)\)/g;
  let dernier = 0;
  for (const m of texte.matchAll(motif)) {
    if (m.index > dernier) morceaux.push({ type: 'texte', texte: texte.slice(dernier, m.index) });
    if (m[1] !== undefined) morceaux.push({ type: 'code', texte: m[1] });
    else if (m[2] !== undefined) morceaux.push({ type: 'gras', texte: m[2] });
    else {
      const sur = /^(https?:\/\/|\/|\.{1,2}\/)/.test(m[4]) || /^[\w.-]+$/.test(m[4]);
      morceaux.push(sur ? { type: 'lien', texte: m[3], url: m[4] } : { type: 'texte', texte: m[3] });
    }
    dernier = m.index + m[0].length;
  }
  if (dernier < texte.length) morceaux.push({ type: 'texte', texte: texte.slice(dernier) });
  return morceaux;
}

function markdownVersBlocs(source) {
  const lignes = source.replace(/\r\n?/g, '\n').split('\n');
  const blocs = [];
  const estTableau = (l) => /^\s*\|.*\|\s*$/.test(l);
  const estListe = (l) => /^\s*([-*+]|\d+[.)])\s+/.test(l);
  const cellules = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => morceauxEnLigne(c.trim()));
  let i = 0;
  while (i < lignes.length) {
    const ligne = lignes[i];
    const titre = /^(#{1,6})\s+(.*)$/.exec(ligne);
    if (/^\s*$/.test(ligne)) {
      i += 1;
    } else if (titre) {
      blocs.push({ type: 'titre', niveau: Math.min(titre[1].length + 1, 6), morceaux: morceauxEnLigne(titre[2]) });
      i += 1;
    } else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(ligne)) {
      blocs.push({ type: 'regle' });
      i += 1;
    } else if (estTableau(ligne) && i + 1 < lignes.length && /^\s*\|?\s*:?-{2,}/.test(lignes[i + 1])) {
      const tete = cellules(ligne);
      const corps = [];
      i += 2;
      while (i < lignes.length && estTableau(lignes[i])) { corps.push(cellules(lignes[i])); i += 1; }
      blocs.push({ type: 'tableau', tete, corps });
    } else if (/^>\s?/.test(ligne)) {
      const contenu = [];
      while (i < lignes.length && /^>\s?/.test(lignes[i])) { contenu.push(morceauxEnLigne(lignes[i].replace(/^>\s?/, ''))); i += 1; }
      blocs.push({ type: 'citation', lignes: contenu });
    } else if (estListe(ligne)) {
      const ordonnee = /^\s*\d+[.)]\s+/.test(ligne);
      const elements = [];
      while (i < lignes.length && estListe(lignes[i])) { elements.push(morceauxEnLigne(lignes[i].replace(/^\s*([-*+]|\d+[.)])\s+/, ''))); i += 1; }
      blocs.push({ type: 'liste', ordonnee, elements });
    } else {
      const contenu = [];
      while (i < lignes.length && !/^\s*$/.test(lignes[i]) && !/^#{1,6}\s/.test(lignes[i]) && !estTableau(lignes[i]) && !estListe(lignes[i]) && !/^>/.test(lignes[i])) {
        contenu.push(morceauxEnLigne(lignes[i]));
        i += 1;
      }
      blocs.push({ type: 'paragraphe', lignes: contenu });
    }
  }
  return blocs;
}

function poserMorceaux(parent, morceaux) {
  for (const m of morceaux) {
    if (m.type === 'gras') parent.append(el('strong', undefined, m.texte));
    else if (m.type === 'code') parent.append(el('code', undefined, m.texte));
    else if (m.type === 'lien') {
      const a = el('a', undefined, m.texte);
      a.href = m.url;
      a.target = '_blank';
      a.rel = 'noopener';
      parent.append(a);
    } else parent.append(document.createTextNode(m.texte));
  }
}

function construireMarkdown(blocs) {
  const fragment = document.createDocumentFragment();
  const lignesAvecSauts = (parent, lignes) => lignes.forEach((morceaux, i) => {
    if (i > 0) parent.append(el('br'));
    poserMorceaux(parent, morceaux);
  });
  for (const b of blocs) {
    if (b.type === 'titre') { const h = el(`h${b.niveau}`); poserMorceaux(h, b.morceaux); fragment.append(h); }
    else if (b.type === 'regle') fragment.append(el('hr'));
    else if (b.type === 'paragraphe') { const p = el('p'); lignesAvecSauts(p, b.lignes); fragment.append(p); }
    else if (b.type === 'citation') { const q = el('blockquote'); lignesAvecSauts(q, b.lignes); fragment.append(q); }
    else if (b.type === 'liste') {
      const liste = el(b.ordonnee ? 'ol' : 'ul');
      for (const morceaux of b.elements) { const li = el('li'); poserMorceaux(li, morceaux); liste.append(li); }
      fragment.append(liste);
    } else if (b.type === 'tableau') {
      const cadre = el('div', 'md-table');
      const table = el('table');
      const tete = el('thead');
      const ligneTete = el('tr');
      for (const c of b.tete) { const th = el('th'); poserMorceaux(th, c); ligneTete.append(th); }
      tete.append(ligneTete);
      const corps = el('tbody');
      for (const r of b.corps) {
        const tr = el('tr');
        for (const c of r) { const td = el('td'); poserMorceaux(td, c); tr.append(td); }
        corps.append(tr);
      }
      table.append(tete, corps);
      cadre.append(table);
      fragment.append(cadre);
    }
  }
  return fragment;
}

let lienOrigine = null;
async function ouvrirResultat(lien, h) {
  lienOrigine = lien;
  fixer($('lecteur-agent'), h.agent_nom);
  fixer($('lecteur-titre'), h.resultat.split('/').pop());
  fixer($('lecteur-meta'), `${libelleJour(h.debut)}, ${hhmm(h.debut)} · ${duree(h.duree_ms)} · ${h.cout_eur === null ? 'coût inconnu' : eur(h.cout_eur, 3)}`);
  const corps = $('lecteur-corps');
  corps.textContent = 'Chargement…';
  $('voile').hidden = false;
  $('lecteur').hidden = false;
  document.body.classList.add('lecture');
  $('lecteur-fermer').focus();
  try {
    const reponse = await fetch(lien.getAttribute('href'));
    if (!reponse.ok) throw new Error(String(reponse.status));
    corps.replaceChildren(construireMarkdown(markdownVersBlocs(await reponse.text())));
    corps.scrollTop = 0;
  } catch {
    corps.textContent = 'Ce résultat ne s\'ouvre pas : le fichier a peut-être été déplacé ou supprimé.';
  }
}
function fermerResultat() {
  $('lecteur').hidden = true;
  $('voile').hidden = true;
  document.body.classList.remove('lecture');
  lienOrigine?.focus();
}
$('lecteur-fermer').addEventListener('click', fermerResultat);
$('voile').addEventListener('click', fermerResultat);
document.addEventListener('keydown', (evenement) => {
  if (evenement.key !== 'Escape') return;
  if (!$('lecteur').hidden) fermerResultat();
  else if (ficheId !== null) fermerFiche();
});

/* ------------------------------------------------------------------ fiche d'un agent */

// Le texte de la fiche, tiré tel quel de l'état : aucun chiffre n'est calculé ici, seulement mis en forme.
// `f` donne les mises en forme (montant, durée, heure, statut), pour que la fonction se teste seule.
function contenuFiche(agent, f) {
  let resultat = 'Rien aujourd\'hui pour l\'instant.';
  if (agent.fait) resultat = agent.fait;
  else if (agent.dernier_statut === 'echec') resultat = 'Le dernier passage a échoué : l\'alerte dit pourquoi.';
  return {
    nom: agent.nom,
    description: agent.description,
    declenchement: agent.planning ? `Automatique à ${agent.planning}` : 'Manuel',
    budget: `${f.eur(agent.cout_jour_eur)} dépensés aujourd'hui, sur ${f.eur(agent.budget_jour_eur)}`,
    dernier: agent.dernier_passage
      ? [f.quand(agent.dernier_passage), f.duree(agent.dernier_duree_ms), f.cout(agent.dernier_cout_eur), f.statut(agent.dernier_statut)].join(' · ')
      : 'jamais lancé',
    resultat,
    peutOuvrir: Boolean(agent.dernier_resultat),
  };
}

const FORMES_FICHE = {
  eur: (x) => eur(x),
  duree,
  quand: (iso) => `${libelleJour(iso)}, ${hhmm(iso)}`,
  cout: (x) => (x === null || x === undefined ? 'coût inconnu' : eur(x, 3)),
  statut: (s) => STATUTS[s] ?? s,
};

function rendreFiche() {
  if (ficheId === null || !etat) return;
  const agent = etat.agents.find((a) => a.id === ficheId);
  if (!agent) {
    fermerFiche();
    return;
  }
  const c = contenuFiche(agent, FORMES_FICHE);
  fixer($('fiche-nom'), c.nom);
  fixer($('fiche-description'), c.description);
  fixer($('fiche-declenchement'), c.declenchement);
  $('fiche-declenchement').classList.toggle('auto', Boolean(agent.planning));
  fixer($('fiche-budget'), typo(c.budget));
  fixer($('fiche-dernier'), typo(c.dernier));
  fixer($('fiche-resultat'), typo(c.resultat));
  $('fiche-resultat').classList.toggle('fait', Boolean(agent.fait));
  const ouvrir = $('fiche-ouvrir');
  ouvrir.hidden = !c.peutOuvrir;
  if (c.peutOuvrir) ouvrir.setAttribute('href', `/${agent.dernier_resultat.split('/').map(encodeURIComponent).join('/')}`);
  const bouton = $('fiche-lancer');
  bouton.disabled = agent.statut === 'en_cours' || agent.invalide;
  fixer(bouton, agent.statut === 'en_cours' ? 'En cours' : 'Lancer');
  bouton.setAttribute('aria-label', `Lancer l'agent ${agent.nom}`);
}

function ouvrirFiche(id) {
  ficheId = id;
  rendreFiche();
  $('fiche').hidden = false;
  for (const [cle, li] of strips) li.classList.toggle('choisie', cle === id);
  $('fiche-fermer').focus();
}

function fermerFiche() {
  if (ficheId === null) return;
  const li = strips.get(ficheId);
  ficheId = null;
  $('fiche').hidden = true;
  for (const ligne of strips.values()) ligne.classList.remove('choisie');
  li?.querySelector('.strip-nom')?.focus({ preventScroll: true });
}

$('fiche-fermer').addEventListener('click', fermerFiche);
// « Lancer » dans la fiche : la fiche se ferme d'abord, pour que le journal, l'alerte et le message restent visibles
// (un refus pour budget compris), puis l'agent part exactement comme depuis sa ligne.
$('fiche-lancer').addEventListener('click', () => {
  if (ficheId === null) return;
  const id = ficheId;
  fermerFiche();
  lancer(id, strips.get(id).querySelector('.lancer'));
});
$('fiche-ouvrir').addEventListener('click', (evenement) => {
  const agent = etat?.agents.find((a) => a.id === ficheId);
  if (!agent || !agent.dernier_resultat || evenement.metaKey || evenement.ctrlKey || evenement.shiftKey) return;
  evenement.preventDefault();
  ouvrirResultat($('fiche-ouvrir'), {
    agent_nom: agent.nom,
    resultat: agent.dernier_resultat,
    debut: agent.dernier_debut ?? agent.dernier_passage,
    duree_ms: agent.dernier_duree_ms,
    cout_eur: agent.dernier_cout_eur,
  });
});

/* ------------------------------------------------------------------ pied de page */

function rendrePied(e) {
  fixer($('pied-claude'), e.claude ? (e.claude.ok ? `Claude Code ${e.claude.version}` : 'Claude Code introuvable') : 'Claude Code');
  fixer($('pied-reglages'), `modèle ${e.reglages.modele} · configuration ${e.reglages.configuration_isolee ? 'isolée' : 'complète'}`);
  const enCours = e.agents.filter((a) => a.statut === 'en_cours');
  $('voyant-enreg').classList.toggle('actif', enCours.length > 0);
  fixer($('texte-enreg'), enCours.length > 0 ? `en cours : ${enCours.map((a) => a.nom).join(', ')}` : 'en attente');
  document.title = e.alertes.length > 0 ? `(${e.alertes.length}) Cockpit d'agents` : 'Cockpit d\'agents';
}

// En fin de passage, le montant dépensé monte de la ligne de l'agent jusqu'au coût du jour.
const coutsPrecedents = new Map();
function envolerCouts(e) {
  for (const agent of e.agents) {
    const avant = coutsPrecedents.get(agent.id);
    coutsPrecedents.set(agent.id, agent.cout_jour_eur);
    if (premierRendu || avant === undefined || !(agent.cout_jour_eur > avant)) continue;
    const depart = strips.get(agent.id)?.querySelector('.cout-valeur')?.getBoundingClientRect();
    const arrivee = $('palettes').getBoundingClientRect();
    if (!depart || !arrivee) continue;
    const pastille = el('div', 'envol', `+${eur(agent.cout_jour_eur - avant)}`);
    pastille.setAttribute('aria-hidden', 'true');
    pastille.style.left = `${depart.left}px`;
    pastille.style.top = `${depart.top}px`;
    pastille.style.setProperty('--dx', `${arrivee.left + arrivee.width / 2 - depart.left - 40}px`);
    pastille.style.setProperty('--dy', `${arrivee.bottom - depart.top - 10}px`);
    document.body.append(pastille);
    setTimeout(() => pastille.remove(), 1400);
  }
}

// La fiche se ferme quand un passage démarre (clic, heure prévue) : le journal en direct reste visible.
let enCoursAvant = new Set();
function fermerSiUnPassageDemarre(e) {
  const enCours = new Set(e.agents.filter((a) => a.statut === 'en_cours').map((a) => a.id));
  const demarre = [...enCours].some((id) => !enCoursAvant.has(id));
  enCoursAvant = enCours;
  if (demarre && !premierRendu) fermerFiche();
}

function rendre(e) {
  envolerCouts(e);
  etat = e;
  fermerSiUnPassageDemarre(e);
  rendreFiche();
  rendreAgents(e);
  rendreBandeau(e);
  rendreAlertes(e);
  rendreHistorique(e);
  rendreRepos(e);
  rendrePied(e);
  premierRendu = false;
}

/* ------------------------------------------------------------------ actions */

let minuterieToast = null;
function toast(message, type = 'ok') {
  const noeud = $('toast');
  noeud.textContent = typo(message);
  noeud.className = `toast visible ${type}`;
  clearTimeout(minuterieToast);
  minuterieToast = setTimeout(() => noeud.classList.remove('visible'), 7000);
}

async function lancer(id, bouton) {
  bouton.disabled = true;
  try {
    const reponse = await fetch(`/api/agents/${encodeURIComponent(id)}/lancer`, { method: 'POST', headers: { 'X-Cockpit': '1' } });
    const corps = await reponse.json().catch(() => ({}));
    if (!reponse.ok) {
      fermerFiche(); // un refus se lit dans l'alerte et le journal, que la fiche couvrirait
      toast(corps.conseil ?? corps.message ?? 'Réessaie dans un instant : le lancement a été refusé.', 'refus');
    }
  } catch {
    toast('Vérifie que « npm start » tourne toujours : le cockpit ne répond pas.', 'refus');
  } finally {
    if (etat) {
      const agent = etat.agents.find((a) => a.id === id);
      if (agent && agent.statut !== 'en_cours') bouton.disabled = false;
    }
  }
}

/* ------------------------------------------------------------------ connexion en direct (Server-Sent Events) */

function connecter() {
  const source = new EventSource('/api/evenements');
  source.addEventListener('open', () => {
    // À chaque (re)connexion, le serveur renvoie l'état puis les dernières lignes : on repart d'un journal propre.
    cacherRepos();
    journal.replaceChildren(messageVideJournal());
    $('connexion').classList.remove('coupee');
    fixer($('texte-connexion'), 'en direct');
  });
  source.addEventListener('etat', (evenement) => rendre(JSON.parse(evenement.data)));
  source.addEventListener('ligne', (evenement) => ajouterLigne(JSON.parse(evenement.data)));
  source.addEventListener('error', () => {
    $('connexion').classList.add('coupee');
    fixer($('texte-connexion'), 'connexion perdue, nouvelle tentative…');
  });
}

// Le temps écoulé d'un agent en cours se met à jour chaque seconde, sans attendre le serveur.
setInterval(() => {
  for (const li of strips.values()) {
    const detail = li.querySelector('.detail-statut');
    if (li.dataset.statut === 'en_cours' && detail.dataset.depuis) {
      fixer(detail, `depuis ${Math.max(0, Math.round((Date.now() - new Date(detail.dataset.depuis)) / 1000))} s`);
    }
    const quand = li.querySelector('.strip-dernier small');
    if (quand?.dataset.quand) fixer(quand, ilYa(quand.dataset.quand));
  }
}, 1000);

rendreHorloge();
setInterval(rendreHorloge, 15000);
journal.replaceChildren(messageVideJournal());
connecter();
