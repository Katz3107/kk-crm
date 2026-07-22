#!/usr/bin/env python3
"""
Rechnung PDF generieren - wird vom Express-Server via child_process aufgerufen.
Erwartet JSON-Parameter als erstes CLI-Argument oder via stdin.
"""
import os
import sys
import json
import qrcode
from io import BytesIO
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader, simpleSplit

# Teal-Design (loest das alte Blau-Design ab)
TEAL_HEAD = HexColor('#163A3F')   # gedaempftes Teal — Titel, Header, Footer-Linie, Positionsheader
TEAL_ACCENT = HexColor('#0A5F6A') # dunkles Teal — QR-Labels, Akzente
DARK = HexColor('#33393A')        # Fliesstext-Farbe (offizielles Fliesstext-Teal)
GREY = HexColor('#666666')        # Meta-Text (Rg-Nr, Datum, Absenderzeile)
LIGHT_GREY = HexColor('#CCCCCC')  # Trennlinien
WHITE = HexColor('#FFFFFF')

# Logo-Pfad relativ zum Script
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOGO_PFAD = os.path.join(SCRIPT_DIR, '..', 'logo-teal.png')

FIRMA = {
    'name': 'Katzenmayer Coaching & Training',
    'inhaber': 'Kirsten Katzenmayer',
    'strasse': 'Birkenweg 4',
    'plz_ort': '61273 Wehrheim',
    'tel': '+49 6081 9859480',
    'email': 'info@katzenmayer-coaching.com',
    'ust_id': 'DE271117684',
    'bank': 'Frankfurter Volksbank Rhein-Main',
    'iban': 'DE50 5019 0000 6001 3754 56',
    'iban_raw': 'DE50501900006001375456',
    'bic': 'FFVBDEFFXXX',
    'paypal': 'https://paypal.me/KatzenmayerCoaching/',
}


def format_betrag(betrag):
    return f"{betrag:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def generate_qr(data, size=150):
    qr = qrcode.QRCode(version=1, box_size=10, border=1)
    qr.add_data(data)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = BytesIO()
    img.save(buf, format='PNG')
    buf.seek(0)
    return ImageReader(buf)


def generate_girocode(betrag, rg_nr):
    data = (
        f"BCD\n002\n1\nSCT\n{FIRMA['bic']}\n{FIRMA['inhaber']}\n"
        f"{FIRMA['iban_raw']}\nEUR{betrag:.2f}\n\n\n{rg_nr}\n"
    )
    return generate_qr(data)


def generate_paypal_qr(betrag):
    url = f"{FIRMA['paypal']}{int(betrag)}eur"
    return generate_qr(url)


def erstelle_rechnung_pdf(params):
    """Erstellt eine Rechnung als PDF. params ist ein dict mit allen Feldern."""
    ausgabe_pfad = params['ausgabe_pfad']
    rg_nr = params['rg_nr']
    datum = params['datum']
    faellig_tage = params.get('faellig_tage', 5)
    kunde_name = params['kunde_name']
    kunde_strasse = params.get('kunde_strasse', '')
    kunde_plz_ort = params.get('kunde_plz_ort', '')
    kunde_land = params.get('kunde_land', '')
    # Abweichende Rechnungsadresse (z.B. wenn Arbeitgeber/Traeger zahlt statt Coachee).
    # Mehrzeiliger Text — jede Zeile eine Zeile im Empfaengerblock. Der Coachee-Bezug
    # steht in der Positionstabellen-Beschreibung (dort tippt Kirsten "Teilnehmerin:
    # [Name]" rein), also keine separate Betreff-Zeile noetig.
    abweichende_rechnungsadresse = (params.get('abweichende_rechnungsadresse') or '').strip()
    titel = params.get('titel', 'Rechnung')
    einleitungstext = params.get('einleitungstext',
        'F\u00fcr die Durchf\u00fchrung eines Coachings zur beruflichen Weiterentwicklung '
        'stelle ich die folgende Leistung in Rechnung.')
    bezeichnung = params['bezeichnung']
    beschreibung = params.get('beschreibung', '')
    betrag_brutto = float(params['betrag_brutto'])
    mwst_satz = params.get('mwst_satz', 19)
    einheit = params.get('einheit', 'Gesamt')
    raten_info = params.get('raten_info', None)
    danke_text = params.get('danke_text', 'Vielen Dank f\u00fcr die gute Zusammenarbeit.')

    w, h = A4
    c = canvas.Canvas(ausgabe_pfad, pagesize=A4)
    c.setTitle(f"Rechnung {rg_nr}")

    left = 25 * mm
    right = w - 20 * mm
    top = h - 20 * mm
    content_width = right - left

    # Logo
    logo = LOGO_PFAD
    if params.get('logo_pfad'):
        logo = params['logo_pfad']
    if os.path.exists(logo):
        c.drawImage(logo, left, top - 18 * mm, width=90 * mm, height=17.8 * mm,
                     preserveAspectRatio=True, anchor='sw', mask='auto')

    # Absenderzeile
    y = top - 32 * mm
    c.setFont("Helvetica", 7)
    c.setFillColor(GREY)
    c.drawString(left, y, f"{FIRMA['name']}, {FIRMA['strasse']}, {FIRMA['plz_ort']}")

    # Empfaenger — entweder abweichende Rechnungsadresse (Arbeitgeber/Bistum/...)
    # oder normale Kunden-Adresse.
    y -= 5 * mm
    c.setFont("Helvetica", 10)
    c.setFillColor(DARK)
    if abweichende_rechnungsadresse:
        for line in abweichende_rechnungsadresse.split('\n'):
            line = line.strip()
            if line:
                c.drawString(left, y, line)
                y -= 4.5 * mm
    else:
        for line in [kunde_name, kunde_strasse, kunde_plz_ort]:
            if line:
                c.drawString(left, y, line)
                y -= 4.5 * mm
        if kunde_land and kunde_land.upper() not in ('DE', 'DEUTSCHLAND', ''):
            c.drawString(left, y, kunde_land)
            y -= 4.5 * mm

    # Rechnungsnr + Datum rechts
    info_y = top - 37 * mm
    c.setFont("Helvetica", 9)
    c.setFillColor(GREY)
    c.drawRightString(right, info_y, f"Rechnungsnr.: {rg_nr}")
    c.drawRightString(right, info_y - 4.5 * mm, f"Datum: {datum}")

    # Titel — 14pt Helvetica normal (nicht fett): dezenter als 18pt Bold, wirkt
    # ruhiger im Verhaeltnis zum Fliesstext.
    y -= 24 * mm
    c.setFont("Helvetica", 13)
    c.setFillColor(TEAL_HEAD)
    c.drawString(left, y, titel)

    # Einleitungstext
    y -= 8 * mm
    c.setFont("Helvetica", 9)
    c.setFillColor(DARK)
    for line in simpleSplit(einleitungstext, "Helvetica", 9, content_width):
        c.drawString(left, y, line)
        y -= 4 * mm

    # Positionstabelle \u2014 dezente Haarlinien statt gefuellter Balken
    y -= 10 * mm
    header_y = y + 0.5 * mm
    c.setStrokeColor(TEAL_HEAD)
    c.setLineWidth(0.6)
    c.line(left, y + 5 * mm, right, y + 5 * mm)  # obere Haarlinie
    c.line(left, y - 1 * mm, right, y - 1 * mm)  # untere Haarlinie
    c.setFillColor(TEAL_HEAD)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(left + 2 * mm, header_y, "Bezeichnung")
    c.drawString(right - 60 * mm, header_y, "Einheit")
    c.drawRightString(right - 2 * mm, header_y, "Gesamt \u20ac")

    # Netto-Wert und USt-Betrag vorausberechnen — wird gleich mehrfach gebraucht.
    netto = betrag_brutto / (1 + mwst_satz / 100)
    mwst_betrag = betrag_brutto - netto
    # Firmen-Modus (abweichende Adresse gesetzt = Rechnung geht an Traeger/Firma):
    # In der Positionstabelle steht NETTO. Am Ende folgen Zwischensumme/USt/Gesamt
    # aufgeschluesselt. Selbstzahler-Modus: BRUTTO in Position, USt als Fussnote.
    firmen_modus = bool(abweichende_rechnungsadresse)
    positions_betrag = netto if firmen_modus else betrag_brutto

    # Tabellenzeile
    y -= 7 * mm
    c.setFillColor(DARK)
    c.setFont("Helvetica", 9)
    bez_lines = simpleSplit(bezeichnung, "Helvetica", 9, right - 60 * mm - left - 4 * mm)
    bez_y = y
    for line in bez_lines:
        c.drawString(left + 2 * mm, bez_y, line)
        bez_y -= 4 * mm
    c.drawString(right - 60 * mm, y, einheit)
    c.drawRightString(right - 2 * mm, y, format_betrag(positions_betrag))
    y = bez_y - 2 * mm

    # Beschreibung
    if beschreibung:
        c.setFont("Helvetica", 8)
        c.setFillColor(GREY)
        for line in simpleSplit(beschreibung, "Helvetica", 8, content_width - 4 * mm):
            c.drawString(left + 2 * mm, y, line)
            y -= 3.5 * mm

    # Raten-Info
    if raten_info:
        y -= 2 * mm
        c.setFont("Helvetica", 8)
        c.setFillColor(DARK)
        raten_text = (
            f"Zahlungsplan in {raten_info['anzahl']} Raten:\n"
            f"Gesamtbetrag: {format_betrag(float(raten_info['gesamt']))} \u20ac. "
            f"Die 1. Rate ({format_betrag(float(raten_info['erste_rate']))} \u20ac) ist innerhalb von "
            f"{faellig_tage} Tagen f\u00e4llig, "
            f"die restlichen {raten_info['anzahl'] - 1} Raten "
            f"({format_betrag(float(raten_info['folge_rate']))} \u20ac) "
            f"erfolgen im monatlichem Abstand."
        )
        for part in raten_text.split('\n'):
            for line in simpleSplit(part, "Helvetica", 8, content_width - 4 * mm):
                c.drawString(left + 2 * mm, y, line)
                y -= 3.5 * mm

    # Trennlinie
    y -= 5 * mm
    c.setStrokeColor(LIGHT_GREY)
    c.setLineWidth(0.5)
    c.line(left, y, right, y)

    if firmen_modus:
        # Firmen-Modus: Zwischensumme (netto), USt, Gesamtbetrag aufgeschluesselt
        y -= 8 * mm
        c.setFont("Helvetica", 9)
        c.setFillColor(DARK)
        c.drawString(left + 2 * mm, y, "Zwischensumme (netto)")
        c.drawRightString(right - 2 * mm, y, format_betrag(netto))
        y -= 5 * mm
        c.drawString(left + 2 * mm, y, f"Umsatzsteuer {mwst_satz} %")
        c.drawRightString(right - 2 * mm, y, format_betrag(mwst_betrag))
        y -= 5 * mm
        c.setStrokeColor(LIGHT_GREY)
        c.setLineWidth(0.5)
        c.line(left, y, right, y)
        y -= 6 * mm
        c.setFont("Helvetica-Bold", 10)
        c.drawString(left + 2 * mm, y, "Gesamtbetrag")
        c.drawRightString(right - 2 * mm, y, format_betrag(betrag_brutto))
    else:
        # Selbstzahler-Modus: Gesamtbetrag (brutto) prominent + kleine USt-Fussnote
        y -= 8 * mm
        c.setFont("Helvetica-Bold", 10)
        c.setFillColor(DARK)
        c.drawString(left + 2 * mm, y, "Gesamtbetrag*")
        c.drawRightString(right - 2 * mm, y, format_betrag(betrag_brutto))

        y -= 6 * mm
        c.setFont("Helvetica", 7.5)
        c.setFillColor(GREY)
        c.drawString(left + 2 * mm, y,
            f"* Im Gesamtbetrag von {format_betrag(betrag_brutto)} \u20ac "
            f"(Netto: {format_betrag(netto)} \u20ac) sind USt {mwst_satz} % "
            f"({format_betrag(mwst_betrag)} \u20ac) enthalten.")

    # Faelligkeit \u2014 linksbuendig wie der Einleitungstext (nicht in der Positions-
    # tabellen-Einrueckung, denn die ist weiter oben zu Ende).
    y -= 10 * mm
    c.setFont("Helvetica", 9)
    c.setFillColor(DARK)
    c.drawString(left, y, f"F\u00e4llig innerhalb von {faellig_tage} Tagen ab Rechnungsdatum.")

    # Dankestext \u2014 direkt unter der Faelligkeit, kompakter Abstand
    y -= 6 * mm
    c.setFont("Helvetica", 9)
    c.drawString(left, y, danke_text)

    # QR-Codes (ans untere Seitenende pinnen, oberhalb des Footers)
    qr_size = 28 * mm
    # Footer-Linie liegt bei 27mm, QR-Captions brauchen 8mm Platz darunter,
    # QR-Codes sind 28mm hoch, Labels ueber den QRs brauchen 4mm
    # -> QR-Label-y = 27mm + 8mm + 28mm + 4mm = 67mm
    y = 67 * mm

    paypal_qr = generate_paypal_qr(betrag_brutto)
    c.setFont("Helvetica-Bold", 8)
    c.setFillColor(TEAL_ACCENT)
    c.drawString(left, y + 2 * mm, "Bezahlen per PayPal")
    c.drawImage(paypal_qr, left, y - qr_size, width=qr_size, height=qr_size)
    c.setFont("Helvetica", 7)
    c.setFillColor(GREY)
    c.drawString(left, y - qr_size - 4 * mm, "Ganz bequem Code scannen")
    c.drawString(left, y - qr_size - 8 * mm, "oder Link verwenden.")

    giro_qr = generate_girocode(betrag_brutto, rg_nr)
    giro_x = left + 85 * mm
    c.setFont("Helvetica-Bold", 8)
    c.setFillColor(TEAL_ACCENT)
    c.drawString(giro_x, y + 2 * mm, "\u00dcberweisen per Code")
    c.drawImage(giro_qr, giro_x, y - qr_size, width=qr_size, height=qr_size)
    c.setFont("Helvetica", 7)
    c.setFillColor(GREY)
    c.drawString(giro_x, y - qr_size - 4 * mm, "Ganz bequem Code mit der")
    c.drawString(giro_x, y - qr_size - 8 * mm, "Banking-App scannen.")

    # Footer
    footer_y = 22 * mm
    c.setStrokeColor(TEAL_HEAD)
    c.setLineWidth(0.6)
    c.line(left, footer_y + 5 * mm, right, footer_y + 5 * mm)
    c.setFont("Helvetica", 6.5)
    c.setFillColor(GREY)
    footer1 = (f"{FIRMA['name']} | {FIRMA['strasse']} | {FIRMA['plz_ort']} | "
               f"Tel.: {FIRMA['tel']} | {FIRMA['email']} | USt-IdNr.: {FIRMA['ust_id']}")
    footer2 = (f"{FIRMA['inhaber']} | {FIRMA['bank']} | "
               f"IBAN: {FIRMA['iban']} | BIC: {FIRMA['bic']}")
    c.drawCentredString(w / 2, footer_y, footer1)
    c.drawCentredString(w / 2, footer_y - 3.5 * mm, footer2)

    c.save()
    return ausgabe_pfad


if __name__ == '__main__':
    if len(sys.argv) > 1:
        params = json.loads(sys.argv[1])
    else:
        params = json.load(sys.stdin)

    pfad = erstelle_rechnung_pdf(params)
    print(json.dumps({'success': True, 'pfad': pfad}))
