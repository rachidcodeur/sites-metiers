/* ==========================================================================
   main.js — Vanilla, sans dépendance, chargé en defer.
   1. Header sticky (ombre au défilement)
   2. Tiroir mobile (menu hamburger)
   3. Scrollspy (soulignement de la nav active)
   4. Accordéon FAQ (une seule question ouverte)
   4 bis. Explorateur de services (liste d'ancres promue en onglets)
   4 ter. Avis clients (colonnes clonées pour le défilement continu)
   5. Barre d'appel mobile (apparition après le hero)
   6. Validation du formulaire de devis
   7. Révélations au défilement
   Réf. : Manifeste design §§ 11, 13, 16.
   ========================================================================== */
(function () {
  'use strict';

  var prefersReducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)'
  ).matches;

  /* ======================================================================
     1 — HEADER STICKY : ombre au-delà de 8 px de défilement
     ====================================================================== */
  var header = document.getElementById('header');
  function onScrollHeader() {
    if (!header) return;
    header.classList.toggle('is-stuck', window.scrollY > 8);
  }
  /* L'appel initial lisait window.scrollY alors que les styles venaient d'être
     invalidés par le script : le navigateur devait recalculer la mise en page
     sur-le-champ (~32 ms de « forced reflow » relevés par Lighthouse).
     requestAnimationFrame reporte la lecture après le premier calcul de style,
     la valeur obtenue est la même sans forcer quoi que ce soit. */
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(onScrollHeader);
  else onScrollHeader();
  window.addEventListener('scroll', onScrollHeader, { passive: true });

  /* ======================================================================
     2 — TIROIR MOBILE
     ====================================================================== */
  var toggle = document.querySelector('.header__toggle');
  var drawer = document.getElementById('drawer');
  var body = document.body;

  function openDrawer() {
    if (!drawer || !toggle) return;
    drawer.classList.add('is-open');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Fermer le menu');
    body.classList.add('is-locked');
  }
  function closeDrawer() {
    if (!drawer || !toggle) return;
    drawer.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Ouvrir le menu');
    body.classList.remove('is-locked');
  }
  if (toggle && drawer) {
    toggle.addEventListener('click', function () {
      var isOpen = toggle.getAttribute('aria-expanded') === 'true';
      isOpen ? closeDrawer() : openDrawer();
    });
    // Fermeture au clic sur un lien
    drawer.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', closeDrawer);
    });
    // Fermeture par Échap
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeDrawer();
    });
    // Fermeture au passage au-dessus de 1024 px
    window.matchMedia('(min-width: 1024px)').addEventListener('change', function (e) {
      if (e.matches) closeDrawer();
    });
  }

  /* ======================================================================
     3 — SCROLLSPY : marque le lien de nav correspondant à la section vue
     ====================================================================== */
  var navLinks = Array.prototype.slice.call(document.querySelectorAll('.nav__link'));
  var spyTargets = navLinks
    .map(function (link) {
      var id = link.getAttribute('href');
      if (!id || id.charAt(0) !== '#') return null;
      var section = document.querySelector(id);
      return section ? { link: link, section: section } : null;
    })
    .filter(Boolean);

  if (spyTargets.length && 'IntersectionObserver' in window) {
    var spyObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          spyTargets.forEach(function (t) {
            var active = t.section === entry.target;
            if (active) {
              t.link.setAttribute('aria-current', 'true');
            } else {
              t.link.removeAttribute('aria-current');
            }
          });
        });
      },
      { rootMargin: '-45% 0px -50% 0px', threshold: 0 }
    );
    spyTargets.forEach(function (t) {
      spyObserver.observe(t.section);
    });
  }

  /* ======================================================================
     4 — ACCORDÉON FAQ : une seule question ouverte à la fois
     ====================================================================== */
  var accordion = document.getElementById('accordion');
  if (accordion) {
    var items = Array.prototype.slice.call(
      accordion.querySelectorAll('.accordion__item')
    );
    items.forEach(function (item) {
      var trigger = item.querySelector('.accordion__trigger');
      if (!trigger) return;
      trigger.addEventListener('click', function () {
        var isOpen = item.classList.contains('is-open');
        // Ferme tout
        items.forEach(function (other) {
          other.classList.remove('is-open');
          var t = other.querySelector('.accordion__trigger');
          if (t) t.setAttribute('aria-expanded', 'false');
        });
        // Ouvre l'item cliqué s'il était fermé
        if (!isOpen) {
          item.classList.add('is-open');
          trigger.setAttribute('aria-expanded', 'true');
        }
      });
    });
  }
  /* L'explorateur de services a été remplacé par une grille 2x2 statique :
     plus d'onglet, donc plus de script à piloter. */

  /* ======================================================================
     4 ter — AVIS EN DÉFILEMENT CONTINU

     Le HTML ne contient qu'une liste de 10 avis, écrits une seule fois. Ce
     bloc en construit la mise en scène, qui n'a pas la même structure selon
     la largeur :
       - au-dessus de 900 px, DEUX pistes verticales, chacune indépendante et
         tournant en sens inverse de l'autre ;
       - en dessous, UNE piste horizontale reprenant les dix avis.
     Dans les deux cas la piste est dupliquée pour que la boucle se referme
     sans saut, et le double est marqué aria-hidden : le texte n'est écrit
     qu'une fois dans la source, ni les moteurs ni les lecteurs d'écran ne le
     voient deux fois.
     Sans JS, la liste reste empilée, entière et lisible.
     ====================================================================== */
  var reviewsRoot = document.querySelector('[data-reviews]');
  if (reviewsRoot) {
    var reviewsSource = reviewsRoot.querySelector('.reviews__group');
    var reviewItems = Array.prototype.slice.call(reviewsSource.children);
    var reviewsWide = window.matchMedia('(min-width: 900px)');

    function reviewsGroup(list, isClone) {
      var ul = document.createElement('ul');
      ul.className = 'reviews__group';
      if (isClone) ul.setAttribute('aria-hidden', 'true');
      list.forEach(function (item) {
        var node = isClone ? item.cloneNode(true) : item;
        if (isClone) {
          // Le double sort de l'ordre de tabulation : sinon le clavier
          // traverse deux fois la même liste de liens.
          Array.prototype.forEach.call(
            node.querySelectorAll('a, button'),
            function (el) {
              el.setAttribute('tabindex', '-1');
            }
          );
        }
        ul.appendChild(node);
      });
      return ul;
    }

    function reviewsMarquee(list) {
      var box = document.createElement('div');
      box.className = 'reviews__marquee';
      var track = document.createElement('div');
      track.className = 'reviews__track';
      track.appendChild(reviewsGroup(list, false));
      track.appendChild(reviewsGroup(list, true));
      box.appendChild(track);
      return box;
    }

    function buildReviews() {
      // Les originaux sont retenus par reviewItems : les détacher ici ne les
      // perd pas, ils sont réinsérés dans la structure qui suit.
      reviewsRoot.textContent = '';
      reviewsRoot.classList.remove('is-cols', 'is-rail');

      if (reviewsWide.matches) {
        var half = Math.ceil(reviewItems.length / 2);
        reviewsRoot.classList.add('is-cols');
        reviewsRoot.appendChild(reviewsMarquee(reviewItems.slice(0, half)));
        reviewsRoot.appendChild(reviewsMarquee(reviewItems.slice(half)));
      } else {
        reviewsRoot.classList.add('is-rail');
        reviewsRoot.appendChild(reviewsMarquee(reviewItems));
      }
    }

    buildReviews();
    // Le passage d'une disposition à l'autre reconstruit la structure : une
    // piste horizontale ne peut pas devenir deux pistes verticales par le
    // seul CSS.
    reviewsWide.addEventListener('change', buildReviews);
  }

  /* ======================================================================
     5 — BARRE D'APPEL MOBILE : apparaît quand le hero sort du viewport
     ====================================================================== */
  var callbar = document.getElementById('callbar');
  var hero = document.querySelector('.hero');
  if (callbar && hero && 'IntersectionObserver' in window) {
    var heroObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          callbar.classList.toggle('is-visible', !entry.isIntersecting);
        });
      },
      { threshold: 0 }
    );
    heroObserver.observe(hero);
  }

  /* ======================================================================
     6 — VALIDATION DU FORMULAIRE DE DEVIS
     ====================================================================== */
  /* Un même jeu de validateurs et un même envoi pour TOUS les formulaires de
     devis de la page — celui de la bannière et celui du bas. Les repères sont
     relatifs au formulaire : deux formulaires sur une page ne peuvent pas
     partager des id fixes. */
  function initFormulaireDevis(form) {
    var feedback = form.querySelector('[data-feedback]') || document.getElementById('form-feedback');
    var submitBtn = form.querySelector('[type="submit"]');

    var validators = {
      nom: function (v) {
        return v.trim().length >= 2
          ? ''
          : 'Indiquez votre nom (2 caractères minimum).';
      },
      prenom: function (v) {
        return v.trim().length >= 2
          ? ''
          : 'Indiquez votre prénom (2 caractères minimum).';
      },
      telephone: function (v) {
        var digits = v.replace(/[\s.\-]/g, '');
        return /^(?:\+33|0)\d{9}$/.test(digits)
          ? ''
          : 'Indiquez un numéro à 10 chiffres.';
      },
      email: function (v) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())
          ? ''
          : 'Indiquez une adresse e-mail valide.';
      },
      codePostal: function (v) {
        return /^\d{5}$/.test(v.trim())
          ? ''
          : 'Indiquez un code postal à 5 chiffres.';
      },
      ville: function (v) {
        return v.trim().length >= 2 ? '' : 'Indiquez votre ville.';
      },
      besoin: function (v) {
        return v.trim().length >= 10
          ? ''
          : 'Décrivez votre besoin en quelques mots (10 caractères minimum).';
      }
    };

    function fieldWrapper(control) {
      return control.closest('.field');
    }

    function validateField(control) {
      var name = control.name;
      var fn = validators[name];
      if (!fn) return true;
      var message = fn(control.value, control);
      var wrapper = fieldWrapper(control);
      var errorEl = document.getElementById(control.id + '-err');
      if (message) {
        if (wrapper) wrapper.classList.add('has-error');
        control.setAttribute('aria-invalid', 'true');
        if (errorEl) errorEl.textContent = message;
        return false;
      }
      if (wrapper) wrapper.classList.remove('has-error');
      control.removeAttribute('aria-invalid');
      if (errorEl) errorEl.textContent = '';
      return true;
    }

    var controls = Array.prototype.slice.call(
      form.querySelectorAll('input, textarea')
    );

    controls.forEach(function (control) {
      // Validation au blur
      control.addEventListener('blur', function () {
        validateField(control);
      });
      // Puis à chaque frappe une fois le champ passé en erreur
      var eventName = control.type === 'checkbox' ? 'change' : 'input';
      control.addEventListener(eventName, function () {
        var wrapper = fieldWrapper(control);
        if (wrapper && wrapper.classList.contains('has-error')) {
          validateField(control);
        }
      });
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var firstInvalid = null;
      controls.forEach(function (control) {
        var ok = validateField(control);
        if (!ok && !firstInvalid) firstInvalid = control;
      });

      if (firstInvalid) {
        if (feedback) feedback.classList.remove('is-visible');
        firstInvalid.focus();
        return;
      }

      /* ------------------------------------------------------------------
         Envoi vers Supabase (table leads_peinture).

         `relative: true` => POST vers /rest/v1/ sur le domaine du site, ce qui
         suppose un bloc Nginx `location /rest/v1/` pour CE domaine. Sinon POST
         direct vers Supabase, dont le CORS est ouvert. Le générateur écrit ce
         choix dans #supabase-config-json d'après SUPABASE_USE_RELATIVE_API.

         `site_departement: true` distingue ces sites à domaine dédié des sites
         villes en sous-domaine. La colonne doit exister : voir
         migrations/2026-07-30-add-site-departement.sql. Si elle manque,
         PostgREST rejette TOUT l'enregistrement (PGRST204).
         ------------------------------------------------------------------ */
      var cfg = null;
      try {
        var cfgEl = document.getElementById('supabase-config-json');
        cfg = cfgEl ? JSON.parse(cfgEl.textContent.trim()) : null;
      } catch (err) {
        cfg = null;
      }

      function showError(msg) {
        submitBtn.classList.remove('is-loading');
        submitBtn.removeAttribute('aria-disabled');
        if (feedback) {
          feedback.className = 'form__feedback form__feedback--error is-visible';
          feedback.textContent = msg;
        }
      }

      if (!cfg || !cfg.anon) {
        showError(
          "Envoi indisponible : configuration manquante. Régénérez les pages avec SUPABASE_ANON_KEY renseigné dans le .env."
        );
        return;
      }

      var base = cfg.relative
        ? String(window.location.origin || '').replace(/\/$/, '')
        : String(cfg.url || cfg.directUrl || '').replace(/\/$/, '');
      var endpoint = base + '/rest/v1/' + encodeURIComponent(cfg.table || 'leads_peinture');

      function val(name) {
        var el = form.querySelector('[name="' + name + '"]');
        return el ? el.value.trim() : '';
      }

      var now = new Date();
      var pad = function (n) { return n < 10 ? '0' + n : String(n); };
      var codePostal = val('codePostal');

      var payload = {
        name: (val('prenom') + ' ' + val('nom')).trim(),
        email: val('email'),
        phone: val('telephone'),
        postal: codePostal,
        dep_code: codePostal.slice(0, 2),
        city: val('ville'),
        message: val('besoin'),
        site_name: (document.querySelector('h1') || {}).textContent
          ? document.querySelector('h1').textContent.replace(/\s+/g, ' ').trim()
          : 'Peintre en bâtiment',
        site_url: window.location.hostname || '',
        submitted_at:
          pad(now.getDate()) + '/' + pad(now.getMonth() + 1) + '/' + now.getFullYear() +
          ' à ' + pad(now.getHours()) + ':' + pad(now.getMinutes()),
        site_departement: true
      };

      submitBtn.classList.add('is-loading');
      submitBtn.setAttribute('aria-disabled', 'true');

      fetch(endpoint, {
        method: 'POST',
        credentials: 'omit',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Accept: 'application/json',
          apikey: cfg.anon,
          Authorization: 'Bearer ' + cfg.anon,
          Prefer: 'return=minimal'
        },
        body: JSON.stringify(payload)
      })
        .then(function (res) {
          if (!res.ok) {
            return res.text().then(function (t) {
              throw { status: res.status, body: t };
            });
          }
          submitBtn.classList.remove('is-loading');
          submitBtn.removeAttribute('aria-disabled');
          form.reset();
          if (feedback) {
            feedback.className = 'form__feedback form__feedback--success is-visible';
            feedback.textContent =
              'Merci ! Votre demande a bien été envoyée. Un peintre vous recontacte rapidement.';
          }
        })
        .catch(function (err) {
          var status = err && err.status;
          var body = (err && err.body) || '';
          if (window.console && console.warn) console.warn('[devis]', status, body);

          var msg = 'Envoi impossible pour le moment. Réessayez plus tard ou contactez-nous par téléphone.';
          if (/site_departement/.test(body)) {
            msg = "Envoi refusé : la colonne site_departement est absente de la base. Exécutez la migration migrations/2026-07-30-add-site-departement.sql.";
          } else if (status === 404) {
            msg = "API introuvable (404). En mode relatif, le bloc Nginx location /rest/v1/ doit exister pour ce domaine.";
          } else if (status === 401 || status === 403) {
            msg = 'Accès refusé par Supabase (clé ou politique RLS). Vérifiez SUPABASE_ANON_KEY et les règles de la table.';
          } else if (/row-level security|permission denied/i.test(body)) {
            msg = 'Insertion refusée par la politique RLS de la table leads_peinture.';
          }
          showError(msg);
        });
    });
    }

  Array.prototype.slice
    .call(document.querySelectorAll('form[data-devis]'))
    .forEach(initFormulaireDevis);


  /* ======================================================================
     7 — RÉVÉLATIONS AU DÉFILEMENT (cascade plafonnée à 5 crans)
     ====================================================================== */
  var reveals = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
  if (prefersReducedMotion || !('IntersectionObserver' in window)) {
    reveals.forEach(function (el) {
      el.classList.add('is-visible');
    });
  } else {
    var revealObserver = new IntersectionObserver(
      function (entries, observer) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var el = entry.target;
          // Cascade selon la position dans la fratrie, plafonnée à 5 crans (80 ms)
          var siblings = Array.prototype.slice.call(el.parentNode.children);
          var index = siblings.indexOf(el);
          var step = Math.min(index, 5);
          el.style.setProperty('--reveal-delay', step * 80 + 'ms');
          el.classList.add('is-visible');
          observer.unobserve(el);
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -10% 0px' }
    );
    reveals.forEach(function (el) {
      revealObserver.observe(el);
    });
  }
})();
