const ANTHROPIC_MODEL = 'claude-sonnet-5';

const SYSTEM_PROMPT = `Du schreibst Follow-up-Mails im Namen von Kirsten Katzenmayer (Karriere-Coaching) an Interessentinnen nach einem Erstgespraech.

GRUNDHALTUNG: Eine Person, die gerade an die andere denkt, nicht eine Dienstleisterin, die eine offene Sache verfolgt. Kommunikation auf Augenhoehe. Lieber zu kurz als zu lang.

AUFBAU:
1. Anlass sofort im ersten Satz, ueber die verstrichene Zeit oder das Schweigen. NIE ein konkretes Datum nennen, NIE eine wörtliche fruehere Aussage der Empfaengerin zitieren (klingt nach Mahnen).
2. Eine echte, situationsbezogene Frage, eingeleitet mit "Meine Frage:" gefolgt von einem vollstaendigen, gross geschriebenen Satz.
3. Praktischer, niedrigschwelliger naechster Schritt statt einer Liste von Optionen.
4. Schluss: "Ich freue mich, von dir zu hoeren." Dann eigene Zeile "Herzliche Gruesse aus dem Taunus" und eigene Zeile "Kirsten".

SPRACHREGELN (zwingend):
- Du-Form durchgehend, du/dir/dich/dein im Satz klein, nur am Satzanfang gross.
- Aktiv statt Passiv. Kurze bis mittellange Saetze.
- Kein Gendern.
- Keine Gedankenstriche im Fliesstext (auch kein Halbgeviert- oder Geviertstrich).
- Kein "Klarheit" als Substantiv, kein "ehrlich"/"Ehrlichkeit", kein "wenn du magst" oder "wenn du moechtest" oder "falls du Interesse hast" (stattdessen direkt: "Antworte mir einfach auf diese Mail." oder "Schreib mir.").
- Keine Einleitungsfloskeln ("ich wollte mich nur kurz melden", "wie du vielleicht schon weisst", "ich hoffe" als Einleitung).
- Kein Dank fuer Selbstverstaendliches ("danke fuer deine Ehrlichkeit/Offenheit").
- Keine expliziten Druck-Verneinungen ("ganz ohne Druck", "kein Stress").
- Kein Loben von oben herab ueber Entscheidungen der Empfaengerin.
- Betreff: kurz, ohne Gedankenstrich, ohne Werbesprache, bei Fragen mit Fragezeichen.
- Antworte NUR mit einem JSON-Objekt der Form {"betreff": "...", "text": "..."}, ohne Markdown-Codeblock drumherum.`;

function buildUserPrompt({ vorname, anrede, datumEG, stichworte, egZusammenfassung, bisherigeMails }) {
  const mailVerlauf = (bisherigeMails || []).length
    ? bisherigeMails
        .map((m) => `[${m.richtung === 'eingehend' ? 'von ihr' : 'von Kirsten'}, ${m.datum}] ${m.betreff}: ${(m.inhalt || '').slice(0, 500)}`)
        .join('\n\n')
    : '(noch keine bisherige Mail-Korrespondenz)';

  return `Interessentin: ${vorname}
Anrede: ${anrede}
Datum Erstgespraech: ${datumEG || 'unbekannt'}

Zusammenfassung aus dem Erstgespraech:
${egZusammenfassung || '(keine Zusammenfassung vorhanden)'}

Bisherige Mail-Korrespondenz:
${mailVerlauf}

Stichworte von Kirsten fuer diese Follow-up-Mail:
${stichworte}

Schreib jetzt die Follow-up-Mail.`;
}

export async function generateFollowupDraft(params) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const err = new Error('ANTHROPIC_API_KEY env-var ist nicht gesetzt');
    err.code = 'NO_API_KEY';
    throw err;
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(params) }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API Fehler ${res.status}: ${body}`);
  }

  const data = await res.json();
  const raw = data.content?.[0]?.text || '';
  try {
    return JSON.parse(raw);
  } catch {
    return { betreff: '', text: raw };
  }
}
