/* ============================================================
   Landing Couvreur Biganos — interactions légères
   ============================================================ */
(function () {
  'use strict';

  /* ---------- 1. En-tête : ombre + fond au défilement ---------- */
  var entete = document.getElementById('entete');
  var enAttente = false;
  var majEntete = function () {
    entete.classList.toggle('defile', window.scrollY > 20);
    enAttente = false;
  };
  var auDefilement = function () {
    if (!enAttente) { window.requestAnimationFrame(majEntete); enAttente = true; }
  };
  window.addEventListener('scroll', auDefilement, { passive: true });
  window.requestAnimationFrame(majEntete); // état initial hors du chemin critique

  /* ---------- 2. Menu mobile ---------- */
  var bascule = document.getElementById('basculeMenu');
  var navigation = document.getElementById('navigation');
  bascule.addEventListener('click', function () {
    var ouvert = navigation.classList.toggle('ouvert');
    bascule.setAttribute('aria-expanded', ouvert ? 'true' : 'false');
    bascule.setAttribute('aria-label', ouvert ? 'Fermer le menu' : 'Ouvrir le menu');
  });
  // Ferme le menu après clic sur un lien
  navigation.addEventListener('click', function (e) {
    if (e.target.tagName === 'A' && navigation.classList.contains('ouvert')) {
      navigation.classList.remove('ouvert');
      bascule.setAttribute('aria-expanded', 'false');
    }
  });

  /* ---------- 3. Apparition au défilement (IntersectionObserver) ---------- */
  var elements = document.querySelectorAll('.apparition');
  if ('IntersectionObserver' in window) {
    var observateur = new IntersectionObserver(function (entrees) {
      entrees.forEach(function (entree) {
        if (entree.isIntersecting) {
          entree.target.classList.add('visible');
          observateur.unobserve(entree.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    elements.forEach(function (el) { observateur.observe(el); });
  } else {
    elements.forEach(function (el) { el.classList.add('visible'); });
  }

  /* ---------- 4. FAQ : une seule réponse ouverte à la fois ---------- */
  var questions = document.querySelectorAll('.faq-question');
  questions.forEach(function (question) {
    question.addEventListener('toggle', function () {
      if (question.open) {
        questions.forEach(function (autre) {
          if (autre !== question) autre.open = false;
        });
      }
    });
  });

  /* ---------- 5. (Retiré) Carrousel d'avis remplacé par grille statique ---------- */

  /* ---------- 6. Validation + envoi Supabase ----------
   * Cible : table leads_couvreur, colonnes :
   *   name, email, phone, postal, dep_code, city, message, site_name, site_url, submitted_at
   * Config injectée via window.SUPA_CONFIG et window.SITE_META (cf. bloc <script> avant script.js).
   */
  var SUPA = window.SUPA_CONFIG || {};
  var META = window.SITE_META || {};

  // Regex numéro français : accepte 0X XX XX XX XX, +33 X XX XX XX XX, avec ou sans espaces/points/tirets.
  // Débute par 01/02/03/04/05/06/07/09 (le 08 = numéros surtaxés, exclu). Pas de 10 XX XX...
  var REGEX_TEL_FR = /^(?:\+33|0033|0)([1-79])(?:[\s.-]?\d{2}){4}$/;

  var initFormulaire = function (idFormulaire, idSucces, idErreur) {
    var formulaire = document.getElementById(idFormulaire);
    if (!formulaire) return;
    var succes = idSucces ? document.getElementById(idSucces) : null;
    var erreurGlobale = idErreur ? document.getElementById(idErreur) : null;
    var bouton = formulaire.querySelector('button[type="submit"]');

    var definirErreur = function (nom, message) {
      var champ = formulaire.querySelector('[name="' + nom + '"]');
      var span = formulaire.querySelector('.erreur[data-for="' + nom + '"]');
      if (champ) champ.classList.toggle('invalide', !!message);
      if (span) span.textContent = message || '';
    };

    var verifierTexte = function (nom, libelle, minLen) {
      if (!formulaire.querySelector('[name="' + nom + '"]')) return true;
      var valeur = (new FormData(formulaire).get(nom) || '').trim();
      var mini = minLen || 2;
      if (!valeur.length) {
        definirErreur(nom, 'Merci de renseigner ' + libelle + '.');
        return false;
      }
      // Champ commencé mais trop court : on dit combien il manque, plutôt que
      // de répéter « merci de renseigner » alors que l'utilisateur a déjà écrit.
      if (valeur.length < mini) {
        var manque = mini - valeur.length;
        definirErreur(nom, 'Encore ' + manque + ' caractère' + (manque > 1 ? 's' : '') +
                           ' — ' + mini + ' au minimum.');
        return false;
      }
      definirErreur(nom, '');
      return true;
    };

    // Compteur vivant sous le champ message : l'aide passe en rouge tant que le
    // minimum n'est pas atteint, et disparaît une fois le seuil franchi.
    var champMessage = formulaire.querySelector('[name="message"]');
    var aideMessage  = formulaire.querySelector('.champ-aide[data-min]');
    if (champMessage && aideMessage) {
      var mini = parseInt(aideMessage.getAttribute('data-min'), 10) || 10;
      var texteInitial = aideMessage.textContent;
      champMessage.addEventListener('input', function () {
        var n = champMessage.value.trim().length;
        if (n === 0) {
          aideMessage.textContent = texteInitial;
          aideMessage.classList.remove('trop-court');
        } else if (n < mini) {
          aideMessage.textContent = 'Encore ' + (mini - n) + ' caractère' + ((mini - n) > 1 ? 's' : '');
          aideMessage.classList.add('trop-court');
        } else {
          aideMessage.textContent = texteInitial;
          aideMessage.classList.remove('trop-court');
        }
      });
    }

    // Normalise un numéro FR : "+33 6 12 34 56 78" → "0612345678"
    var normaliserTel = function (raw) {
      var brut = String(raw || '').replace(/[\s.\-()]/g, '');
      if (brut.slice(0, 4) === '0033') return '0' + brut.slice(4);
      if (brut.slice(0, 3) === '+33')  return '0' + brut.slice(3);
      return brut;
    };

    formulaire.addEventListener('submit', function (e) {
      e.preventDefault();
      if (erreurGlobale) erreurGlobale.hidden = true;

      var donnees = new FormData(formulaire);

      // Honeypot : si rempli → bot, on abandonne silencieusement (200 OK simulé)
      if ((donnees.get('field_hp') || '').trim() !== '') {
        if (succes) succes.hidden = false;
        formulaire.reset();
        return;
      }

      var valide = true;

      // Champs texte obligatoires
      if (formulaire.querySelector('[name="prenom"]')) {
        if (!verifierTexte('prenom', 'votre prénom')) valide = false;
      }
      if (formulaire.querySelector('[name="nom"]')) {
        if (!verifierTexte('nom', 'votre nom')) valide = false;
      }
      if (!verifierTexte('ville', 'votre ville')) valide = false;
      if (!verifierTexte('message', 'votre message', 10)) valide = false;

      // Téléphone
      var telRaw = (donnees.get('tel') || '').trim();
      var telNorm = normaliserTel(telRaw);
      if (!REGEX_TEL_FR.test(telRaw)) {
        definirErreur('tel', 'Numéro français invalide (ex : 06 12 34 56 78).');
        valide = false;
      } else {
        definirErreur('tel', '');
      }

      // Email
      var email = (donnees.get('email') || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
        definirErreur('email', 'Adresse email invalide.');
        valide = false;
      } else {
        definirErreur('email', '');
      }

      // Code postal
      var cp = (donnees.get('cp') || '').trim();
      if (!/^[0-9]{5}$/.test(cp)) {
        definirErreur('cp', 'Code postal à 5 chiffres.');
        valide = false;
      } else {
        definirErreur('cp', '');
      }

      if (!valide) {
        if (succes) succes.hidden = true;
        var premierInvalide = formulaire.querySelector('.invalide');
        if (premierInvalide) premierInvalide.focus();
        return;
      }

      // Construit le nom complet (banniere = prenom + nom, devis = champ nom seul)
      var prenom = (donnees.get('prenom') || '').trim();
      var nom    = (donnees.get('nom') || '').trim();
      var nameFinal = prenom ? (prenom + ' ' + nom).trim() : nom;

      // Date FR : "DD/MM/YYYY à HH:MM"
      var d = new Date();
      var pad = function (n) { return String(n).padStart(2, '0'); };
      var submittedAt = pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear()
                      + ' à ' + pad(d.getHours()) + ':' + pad(d.getMinutes());

      var projet  = (donnees.get('projet') || '').trim();
      var msg     = (donnees.get('message') || '').trim();
      // Si un projet est sélectionné, on le préfixe au message (utile pour le formulaire devis)
      var msgFinal = projet ? ('[' + projet + '] ' + msg) : msg;

      var payload = {
        name:         nameFinal,
        email:        email,
        phone:        telNorm,
        postal:       cp,
        dep_code:     cp.slice(0, 2),
        city:         (donnees.get('ville') || '').trim(),
        message:      msgFinal,
        site_name:    META.name || '',
        site_url:     META.url  || '',
        submitted_at: submittedAt,
        site_ville:   false,
      };

      var table = SUPA.table || 'leads_couvreur';
      if (!SUPA.url || !SUPA.anon) {
        if (erreurGlobale) {
          erreurGlobale.textContent = 'Configuration serveur manquante. Contactez-nous par téléphone.';
          erreurGlobale.hidden = false;
        }
        return;
      }

      if (bouton) { bouton.disabled = true; bouton.dataset.oldText = bouton.textContent; bouton.textContent = 'Envoi en cours…'; }

      fetch(SUPA.url + '/rest/v1/' + table, {
        method: 'POST',
        headers: {
          'apikey': SUPA.anon,
          'Authorization': 'Bearer ' + SUPA.anon,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify(payload),
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        if (succes) succes.hidden = false;
        formulaire.reset();
        // Scroll vers le message de succès
        if (succes) succes.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }).catch(function (err) {
        console.error('Envoi Supabase :', err);
        if (erreurGlobale) {
          erreurGlobale.textContent = 'L\'envoi a échoué. Réessayez ou contactez-nous par téléphone.';
          erreurGlobale.hidden = false;
        }
      }).finally(function () {
        if (bouton) { bouton.disabled = false; bouton.textContent = bouton.dataset.oldText || 'Envoyer'; }
      });
    });
  };

  initFormulaire('formulaireBanniere', 'succesBanniere', 'erreurBanniere');
  initFormulaire('formulaireDevis',    'succesFormulaire','erreurFormulaire');
})();
