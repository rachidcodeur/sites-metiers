// supabase/functions/send-couvreur-email/index.ts
// Edge function Couvreur — déclenchée par webhook Supabase sur INSERT dans la table de leads.
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";

// Échappement HTML (sécurité + intégrité du template)
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );

// --- Détection de spam : renvoie un score + les raisons ---
function detectSpam(data: any, depCode: string) {
  const reasons: string[] = [];
  let score = 0;

  // Numéro type carte bancaire dans un champ texte (16 chiffres groupés)
  const textBlob = String((data.rue ?? "") + " " + (data.adresse ?? "") + " " + (data.message ?? "")).replace(/\s/g, "");
  if (/\b\d{16}\b/.test(textBlob)) {
    score += 3;
    reasons.push("Numéro à 16 chiffres détecté (CB ?)");
  }

  // Téléphone non français (indicatif US/intl. évident)
  const tel = String(data.phone ?? "").replace(/[\s.\-]/g, "");
  if (/^\+?1\d{10}$/.test(tel) || /^\+?252/.test(tel)) {
    score += 2;
    reasons.push("Téléphone hors France");
  }

  // CP incohérent avec le département du domaine
  const cp = String(data.postal ?? "");
  if (cp && depCode !== "??" && !cp.startsWith(depCode)) {
    score += 1;
    reasons.push(`CP ${cp} ≠ dépt ${depCode}`);
  }

  // CP non valide (France métropolitaine : 01–98)
  if (cp && !/^(0[1-9]|[1-8]\d|9[0-8])\d{3}$/.test(cp)) {
    score += 2;
    reasons.push(`CP ${cp} invalide`);
  }

  // Domaines email jetables / suspects
  const email = String(data.email ?? "").toLowerCase();
  const disposable = ["yatdew.com", "mailinator.com", "tempmail", "guerrillamail", "10minutemail"];
  if (disposable.some((d) => email.includes(d))) {
    score += 3;
    reasons.push("Email jetable");
  }

  return { score, reasons, isSpam: score >= 3 };
}

serve(async (req) => {
  try {
    const payload = await req.json();
    const data = payload.record;

    // Code département : priorité à la colonne dep_code si présente, sinon depuis l'URL, sinon CP
    const depCode =
      String(data.dep_code ?? "").trim() ||
      String(data.site_url ?? "").match(/-(\\d{2,3})\\.fr/)?.[1] ||
      String(data.postal ?? "").substring(0, 2) ||
      "??";

    // Analyse anti-spam
    const spam = detectSpam(data, depCode);

    // Si spam avéré → on ne pollue pas la boîte mail (la ligne reste en base)
    if (spam.isSpam) {
      return new Response(
        JSON.stringify({
          message: "Lead identifié comme spam — email non envoyé",
          score: spam.score,
          reasons: spam.reasons,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const fullName = data.name?.trim() || "Non renseigné";
    const message = data.message?.trim() || data.description?.trim();

    // Adresse
    const adresse = [data.postal, data.city].filter(Boolean).join(", ") || "Non renseignée";

    const dateRecue = new Date(data.created_at).toLocaleString("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "Europe/Paris",
    });

    // Bandeau d'alerte si le lead est douteux (sans atteindre le seuil spam)
    const suspect = spam.score > 0;

    // Flag "Site ville" — vient du template couvreur 2 (colonne site_ville boolean)
    const siteVille = data.site_ville === true;

    // --- Version texte (fallback) ---
    const emailText = `
🏠 [${depCode}] : Nouvelle demande de devis toiture
${siteVille ? "\n🌆 ★ SITE VILLE ★ — lead issu d'un site commune (template couvreur 2)\n" : ""}
Date : ${dateRecue}
Ville ciblée : ${data.city ?? data.site_name ?? "—"}

- Nom : ${fullName}
- Téléphone : ${data.phone ?? "Non renseigné"}
- Email : ${data.email ?? "Non renseigné"}
- Adresse : ${adresse}



- Message :
${message || "(aucun message)"}

- Lien du site : ${data.site_url}
${suspect ? `\n⚠️ Lead à vérifier : ${spam.reasons.join(" · ")}` : ""}
`;

    const row = (label: string, value: string) => `
      <tr>
        <td style="padding:10px 16px;font-size:13px;color:#64748b;font-weight:600;white-space:nowrap;vertical-align:top;border-bottom:1px solid #f1f5f9;">${label}</td>
        <td style="padding:10px 16px;font-size:14px;color:#0f172a;vertical-align:top;border-bottom:1px solid #f1f5f9;">${value}</td>
      </tr>`;

    // --- Version HTML ---
    const emailHtml = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

          <!-- En-tête (couleur projet : #FF8B3D) -->
          <tr>
            <td style="background-color:#FF8B3D;padding:24px 28px;">
              <div style="font-size:13px;color:#ffe0c9;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:4px;">
                🏠 Couvreur · [${esc(depCode)}]
              </div>
              <div style="font-size:20px;color:#ffffff;font-weight:700;">
                Nouvelle demande de devis toiture
              </div>
            </td>
          </tr>

          ${siteVille ? `
          <!-- Bandeau SITE VILLE (couvreur 2) — mis en avant -->
          <tr>
            <td style="padding:14px 28px 0;">
              <div style="background:linear-gradient(120deg,#10b981,#059669);border-radius:8px;padding:12px 16px;font-size:14px;color:#ffffff;font-weight:700;letter-spacing:0.4px;box-shadow:0 2px 8px rgba(16,185,129,0.32);display:flex;align-items:center;gap:8px;">
                <span style="font-size:18px;">🌆</span>
                <span style="text-transform:uppercase;">Site ville</span>
                <span style="font-weight:400;opacity:0.92;font-size:13px;margin-left:6px;">— lead issu d'un site commune (template couvreur 2)</span>
              </div>
            </td>
          </tr>` : ""}

          ${suspect ? `
          <!-- Bandeau alerte -->
          <tr>
            <td style="padding:14px 28px 0;">
              <div style="background-color:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;font-size:13px;color:#92400e;">
                ⚠️ Lead à vérifier : ${esc(spam.reasons.join(" · "))}
              </div>
            </td>
          </tr>` : ""}

          <!-- Date / ville ciblée -->
          <tr>
            <td style="padding:16px 28px 0;font-size:12px;color:#94a3b8;">
              Reçue le ${esc(dateRecue)} · Ville ciblée : ${esc(data.city ?? data.site_name ?? "—")}
            </td>
          </tr>

          <!-- Coordonnées -->
          <tr>
            <td style="padding:16px 28px 4px;font-size:11px;color:#94a3b8;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;">
              Coordonnées
            </td>
          </tr>
          <tr>
            <td style="padding:0 16px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f1f5f9;border-radius:8px;">
                ${row("Nom", esc(fullName))}
                ${row("Téléphone", (data.phone) ? `<a href="tel:${esc(data.phone)}" style="color:#B85410;text-decoration:none;font-weight:600;">${esc(data.phone)}</a>` : "Non renseigné")}
                ${row("Email", data.email ? `<a href="mailto:${esc(data.email)}" style="color:#B85410;text-decoration:none;">${esc(data.email)}</a>` : "Non renseigné")}
                ${row("Adresse", esc(adresse))}
              </table>
            </td>
          </tr>



          ${message ? `
          <!-- Message -->
          <tr>
            <td style="padding:20px 28px 4px;font-size:11px;color:#94a3b8;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;">
              Message
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px;">
              <div style="background-color:#f8fafc;border-left:3px solid #FF8B3D;border-radius:0 8px 8px 0;padding:12px 16px;font-size:14px;color:#334155;line-height:1.5;">
                ${esc(message).replace(/\n/g, "<br>")}
              </div>
            </td>
          </tr>` : ""}

          <!-- Pied -->
          <tr>
            <td style="padding:24px 28px;">
              <a href="${esc(data.site_url)}" style="font-size:13px;color:#B85410;text-decoration:none;">
                ↗ ${esc(data.site_url)}
              </a>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Couvreur <noreply@mariage-parfait.net>",
        to: [
          "rachdevcodeur@gmail.com",
          "olivia.homeservice@gmail.com",
          "info@home-service.io",
          "montes.virgile@gmail.com",
          "nadine@homeservice-pro.fr",
          "olivia@homeservice-pro.fr",
          "contact@homeservice-pro.fr",
        ],
        subject: `${suspect ? "⚠️ " : ""}${siteVille ? "🌆 SITE VILLE " : "🏠 "}Toiture [${depCode}] — ${data.city ?? data.site_name ?? ""}`,
        html: emailHtml,
        text: emailText,
      }),
    });

    const resendData = await resendResponse.json();

    return new Response(
      JSON.stringify({ message: "Mail envoyé avec succès", score: spam.score, resendData }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
