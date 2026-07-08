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

BLUE = HexColor('#325f7b')
DARK = HexColor('#333333')
GREY = HexColor('#666666')
LIGHT_GREY = HexColor('#CCCCCC')
WHITE = HexColor('#FFFFFF')

# Logo-Pfad relativ zum Script
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOGO_PFAD = os.path.join(SCRIPT_DIR, '..', 'Neues Logo pixelfrei petrol.png')

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
    # Wenn bereits bezahlt: "Faellig innerhalb..."-Zeile ausblenden
    bereits_bezahlt = bool(params.get('bereits_bezahlt', False))

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

    # Empfaenger
    y -= 5 * mm
    c.setFont("Helvetica", 10)
    c.setFillColor(DARK)
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

    # Titel
    y -= 24 * mm
    c.setFont("Helvetica-Bold", 18)
    c.setFillColor(BLUE)
    c.drawString(left, y, titel)

    # Einleitungstext
    y -= 8 * mm
    c.setFont("Helvetica", 9)
    c.setFillColor(DARK)
    for line in simpleSplit(einleitungstext, "Helvetica", 9, content_width):
        c.drawString(left, y, line)
        y -= 4 * mm

    # Positionstabelle
    y -= 14 * mm
    c.setFillColor(BLUE)
    c.rect(left, y - 1 * mm, content_width, 6 * mm, fill=True, stroke=False)
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(left + 2 * mm, y + 0.5 * mm, "Bezeichnung")
    c.drawString(right - 60 * mm, y + 0.5 * mm, "Einheit")
    c.drawRightString(right - 2 * mm, y + 0.5 * mm, "Gesamt \u20ac")

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
    c.drawRightString(right - 2 * mm, y, format_betrag(betrag_brutto))
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
        # Defensive: Fallbacks, falls einzelne Felder fehlen (z.B. bei Folgeraten)
        _erste = raten_info.get('erste_rate')
        _folge = raten_info.get('folge_rate')
        _gesamt = raten_info.get('gesamt')
        # Wenn folge_rate fehlt, erste_rate als Fallback (bei gleichmaessigen Raten)
        if _folge is None:
            _folge = _erste
        if _erste is None:
            _erste = _folge
        raten_text = (
            f"Zahlungsplan in {raten_info['anzahl']} Raten:\n"
            f"Gesamtbetrag: {format_betrag(float(_gesamt))} \u20ac. "
            f"Die 1. Rate ({format_betrag(float(_erste))} \u20ac) ist innerhalb von "
            f"{faellig_tage} Tagen f\u00e4llig, "
            f"die restlichen {raten_info['anzahl'] - 1} Raten "
            f"({format_betrag(float(_folge))} \u20ac) "
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

    # Gesamtbetrag
    y -= 8 * mm
    netto = betrag_brutto / (1 + mwst_satz / 100)
    mwst_betrag = betrag_brutto - netto
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

    # Faelligkeit \u2014 nur wenn nicht bereits bezahlt
    if not bereits_bezahlt:
        y -= 12 * mm
        c.setFont("Helvetica", 9)
        c.setFillColor(DARK)
        c.drawString(left + 2 * mm, y, f"F\u00e4llig innerhalb von {faellig_tage} Tagen ab Rechnungsdatum.")

    # Dankestext
    y -= 12 * mm
    c.setFont("Helvetica", 9)
    c.setFillColor(DARK)
    c.drawString(left + 2 * mm, y, danke_text)

    # QR-Codes nur drucken, wenn nicht bereits bezahlt \u2014 ansonsten waere die
    # Aufforderung zur Zahlung verwirrend.
    if not bereits_bezahlt:
        # QR-Codes (ans untere Seitenende pinnen, oberhalb des Footers)
        qr_size = 28 * mm
        # Footer-Linie liegt bei 27mm, QR-Captions brauchen 8mm Platz darunter,
        # QR-Codes sind 28mm hoch, Labels ueber den QRs brauchen 4mm
        # -> QR-Label-y = 27mm + 8mm + 28mm + 4mm = 67mm
        y = 67 * mm

        paypal_qr = generate_paypal_qr(betrag_brutto)
        c.setFont("Helvetica-Bold", 8)
        c.setFillColor(BLUE)
        c.drawString(left, y + 2 * mm, "Bezahlen per PayPal")
        c.drawImage(paypal_qr, left, y - qr_size, width=qr_size, height=qr_size)
        c.setFont("Helvetica", 7)
        c.setFillColor(GREY)
        c.drawString(left, y - qr_size - 4 * mm, "Ganz bequem Code scannen")
        c.drawString(left, y - qr_size - 8 * mm, "oder Link verwenden.")

        giro_qr = generate_girocode(betrag_brutto, rg_nr)
        giro_x = left + 85 * mm
        c.setFont("Helvetica-Bold", 8)
        c.setFillColor(BLUE)
        c.drawString(giro_x, y + 2 * mm, "\u00dcberweisen per Code")
        c.drawImage(giro_qr, giro_x, y - qr_size, width=qr_size, height=qr_size)
        c.setFont("Helvetica", 7)
        c.setFillColor(GREY)
        c.drawString(giro_x, y - qr_size - 4 * mm, "Ganz bequem Code mit der")
        c.drawString(giro_x, y - qr_size - 8 * mm, "Banking-App scannen.")

    # Footer
    footer_y = 22 * mm
    c.setStrokeColor(BLUE)
    c.setLineWidth(0.8)
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
