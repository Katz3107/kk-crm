const ANTHROPIC_MODEL = 'claude-sonnet-5';

const SYSTEM_PROMPT = `Du schreibst Follow-up-Mails im Namen von Kirsten Katzenmayer (Karriere-Coaching) an Interessentinnen nach einem Erstgespräch.

WICHTIG ZUR SCHREIBWEISE: Schreib durchgehend mit echten deutschen Umlauten und ß (ä, ö, ü, Ä, Ö, Ü, ß). Niemals ae/oe/ue/ss als Ersatz verwenden.

GRUNDHALTUNG: Eine Person, die gerade an die andere denkt, nicht eine Dienstleisterin, die eine offene Sache verfolgt. Kommunikation auf Augenhöhe. Lieber zu kurz als zu lang.

AUFBAU:
1. Anlass sofort im ersten Satz, über die verstrichene Zeit oder das Schweigen. NIE ein konkretes Datum nennen, NIE eine wörtliche frühere Aussage der Empfängerin zitieren (klingt nach Mahnen).
2. Eine echte, situationsbezogene Frage, eingeleitet mit "Meine Frage:" gefolgt von einem vollständigen, groß geschriebenen Satz.
3. Praktischer, niedrigschwelliger nächster Schritt statt einer Liste von Optionen. Bei Interessentinnen, bei denen ein konkreter Termin der passende nächste Schritt ist, den Buchungslink fürs Kurzgespräch einbauen: https://katzenmayer-coaching.com/Kurzgespraech (eigene Einschätzung, ob das zur Situation passt). Falls die Stichworte von Kirsten explizit sagen, ob der Link rein oder raus soll, hat das Vorrang vor der eigenen Einschätzung.
4. Schluss: "Ich freue mich, von dir zu hören." Dann eigene Zeile "Herzliche Grüße aus dem Taunus" und eigene Zeile "Kirsten".

SPRACHREGELN (zwingend):
- Du-Form durchgehend, du/dir/dich/dein im Satz klein, nur am Satzanfang groß.
- Aktiv statt Passiv. Kurze bis mittellange Sätze.
- Kein Gendern.
- Keine Gedankenstriche im Fließtext (auch kein Halbgeviert- oder Geviertstrich).
- Kein "Klarheit" als Substantiv, kein "ehrlich"/"Ehrlichkeit".
- Kein Loben von oben herab über Entscheidungen der Empfängerin.
- Betreff: kurz, ohne Gedankenstrich, ohne Werbesprache, bei Fragen mit Fragezeichen.

VERBOTENE FORMULIERUNGEN — diese Liste vor der Ausgabe nochmal gegen den Text prüfen, keine davon darf vorkommen:
"wenn du magst", "wenn du möchtest", "falls du Interesse hast", "ich wollte mich nur kurz melden", "wie du vielleicht schon weißt", "ich hoffe" als Einleitungssatz, "danke für deine Ehrlichkeit", "danke für deine Offenheit", "ganz ohne Druck", "kein Stress".
Statt einer weichen Aufforderung immer direkt: "Antworte mir einfach auf diese Mail." oder "Schreib mir."

Antworte NUR mit einem JSON-Objekt der Form {"betreff": "...", "text": "..."}, ohne Markdown-Codeblock drumherum.`;

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
  // Bei aktiviertem Extended Thinking steht vor dem eigentlichen Text noch
  // ein "thinking"-Block - deshalb gezielt den "text"-Block suchen statt
  // blind content[0] zu nehmen.
  const textBlock = data.content?.find((block) => block.type === 'text');
  const raw = textBlock?.text || '';
  try {
    return JSON.parse(raw);
  } catch {
    return { betreff: '', text: raw };
  }
}

// Separater Modus: Kirsten fragt um eine Einschaetzung/Meinung statt einen
// Mail-Entwurf zu wollen (z.B. "sollte ich ihr nochmal schreiben?"). Interner
// Text an Kirsten selbst, kein Kunden-Text - deshalb keine Ton-/Floskelregeln,
// einfach eine ehrliche, direkte Antwort in Fliesstext.
const SYSTEM_PROMPT_ADVICE = `Du bist eine erfahrene, ehrliche Sparringpartnerin fuer Kirsten Katzenmayer (Karriere-Coaching). Sie fragt dich um deine Einschaetzung zu einer Interessentin, basierend auf dem bisherigen Verlauf.

Antworte in normalem Fliesstext (kein JSON, kein Mail-Entwurf), kurz und konkret. Eine klare Einschaetzung mit kurzer Begruendung, keine ausschweifende Analyse. Das ist ein interner Text an Kirsten selbst, keine Kunden-Kommunikation - schreib also frei, ohne Floskel-Vorgaben.`;

function buildAdvicePrompt({ vorname, frage, egZusammenfassung, bisherigeMails }) {
  const mailVerlauf = (bisherigeMails || []).length
    ? bisherigeMails
        .map((m) => `[${m.richtung === 'eingehend' ? 'von ihr' : 'von Kirsten'}, ${m.datum}] ${m.betreff}: ${(m.inhalt || '').slice(0, 500)}`)
        .join('\n\n')
    : '(noch keine bisherige Mail-Korrespondenz)';

  return `Interessentin: ${vorname}

Zusammenfassung aus dem Erstgespraech:
${egZusammenfassung || '(keine Zusammenfassung vorhanden)'}

Bisherige Mail-Korrespondenz:
${mailVerlauf}

Kirstens Frage:
${frage}`;
}

export async function generateFollowupAdvice(params) {
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
      system: SYSTEM_PROMPT_ADVICE,
      messages: [{ role: 'user', content: buildAdvicePrompt(params) }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API Fehler ${res.status}: ${body}`);
  }

  const data = await res.json();
  const textBlock = data.content?.find((block) => block.type === 'text');
  return textBlock?.text || '';
}
