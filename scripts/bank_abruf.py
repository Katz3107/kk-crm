"""
Automatischer Umsatzabruf von der Frankfurter Volksbank Rhein/Main via FinTS.
Erzeugt CSV-Dateien im gleichen Format wie der manuelle Online-Banking-Export.

Aufruf: python bank_abruf.py [--von DATUM] [--bis DATUM] [--konto IBAN]
        python bank_abruf.py --pin MEINE_PIN --von 01.01.2026 --bis 31.03.2026

Ohne --von/--bis werden die letzten 30 Tage abgerufen.
Ohne --konto werden alle verfuegbaren Konten abgerufen.
Die PIN kann auch interaktiv eingegeben werden.
"""

import sys
import os
import argparse
import getpass
import csv
from datetime import datetime, timedelta, date

from fints.client import FinTS3PinTanClient
from fints.utils import minimal_interactive_cli_bootstrap


# === Konfiguration ===
BLZ = "50190000"
FINTS_URL = "https://fints1.atruvia.de/cgi-bin/hbciservlet"
PRODUCT_ID = "9FA6681DEC0CF3046BFC2F8A6"  # Registrierte FinTS-Produkt-ID
OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))

# Kontobezeichnungen (IBAN -> Name)
KONTO_NAMEN = {
    "DE57501900000201394287": "FVB KontoDirekt Plus",
    "DE50501900006001375456": "Frankfurter Volksbank",
}
BANKNAME = "Frankfurter Volksbank Rhein/Main"
BIC = "FFVBDEFFXXX"


def parse_args():
    parser = argparse.ArgumentParser(description="FinTS Umsatzabruf")
    parser.add_argument("--benutzer", help="Online-Banking Benutzername/Kontonummer")
    parser.add_argument("--pin", help="Online-Banking PIN (wird sonst interaktiv abgefragt)")
    parser.add_argument("--von", help="Startdatum (TT.MM.JJJJ), Standard: vor 30 Tagen")
    parser.add_argument("--bis", help="Enddatum (TT.MM.JJJJ), Standard: heute")
    parser.add_argument("--konto", help="Nur dieses Konto abrufen (IBAN)")
    return parser.parse_args()


def format_betrag(amount):
    """Formatiert den Betrag im deutschen Format mit Vorzeichen: -27,33 oder 2000,00"""
    value = float(amount)
    # Deutsches Zahlenformat: Komma als Dezimaltrennzeichen
    formatted = f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    # Vorzeichen beibehalten (negative Werte haben bereits ein Minus)
    return formatted


def get_transactions(benutzer, pin, von_datum, bis_datum, nur_konto=None):
    """Ruft Umsaetze per FinTS ab und gibt sie als Liste von Dicts zurueck."""

    print(f"Verbinde mit Frankfurter Volksbank Rhein/Main...")
    print(f"Zeitraum: {von_datum.strftime('%d.%m.%Y')} bis {bis_datum.strftime('%d.%m.%Y')}")

    client = FinTS3PinTanClient(
        BLZ,
        benutzer,
        pin,
        FINTS_URL,
        product_id=PRODUCT_ID,
    )

    all_transactions = {}

    with client:
        # TAN-Callback fuer den Fall, dass doch eine TAN noetig ist
        if client.init_tan_response:
            print("ACHTUNG: Eine TAN wird benoetigt.")
            print(client.init_tan_response.challenge)
            tan = input("TAN eingeben: ")
            client.send_tan(client.init_tan_response, tan)

        # Konten abrufen
        konten = client.get_sepa_accounts()
        print(f"\n{len(konten)} Konto(en) gefunden:")
        for konto in konten:
            print(f"  - {konto.iban} ({konto.accountnumber})")

        for konto in konten:
            if nur_konto and konto.iban != nur_konto:
                continue

            print(f"\nRufe Umsaetze ab fuer {konto.iban}...")

            try:
                buchungen = client.get_transactions(
                    konto,
                    von_datum,
                    bis_datum,
                )
            except Exception as e:
                print(f"  FEHLER beim Abruf: {e}")
                continue

            print(f"  {len(buchungen)} Buchung(en) abgerufen.")

            konto_name = KONTO_NAMEN.get(konto.iban, f"Konto {konto.accountnumber}")
            rows = []

            for t in buchungen:
                data = t.data

                # Betrag mit Vorzeichen
                betrag_raw = data.get("amount")
                if betrag_raw:
                    betrag_wert = float(betrag_raw.amount)
                    betrag_str = format_betrag(betrag_wert)
                    waehrung = betrag_raw.currency or "EUR"
                else:
                    betrag_str = ""
                    waehrung = "EUR"

                # Saldo (falls verfuegbar)
                saldo_raw = data.get("closing_balance") or data.get("final_closing_balance")
                if saldo_raw:
                    saldo_str = format_betrag(float(saldo_raw.amount))
                else:
                    saldo_str = ""

                # Buchungsdatum und Valuta
                buchungstag = data.get("date")
                valuta = data.get("entry_date") or buchungstag

                buchungstag_str = buchungstag.strftime("%d.%m.%Y") if buchungstag else ""
                valuta_str = valuta.strftime("%d.%m.%Y") if valuta else ""

                # Name des Zahlungsbeteiligten
                name = data.get("applicant_name", "") or ""

                # IBAN und BIC des Zahlungsbeteiligten
                iban_partner = data.get("applicant_iban", "") or ""
                bic_partner = data.get("applicant_bin", "") or data.get("applicant_bic", "") or ""

                # Buchungstext
                buchungstext = data.get("posting_text", "") or ""

                # Verwendungszweck
                zweck = data.get("purpose", "") or ""

                # Glaeubiger-ID und Mandatsreferenz (SEPA)
                glaeubiger_id = data.get("end_to_end_reference", "") or ""
                mandatsref = data.get("mandate_id", "") or ""

                # Versuche Glaeubiger-ID und Mandatsref aus dem Verwendungszweck zu extrahieren
                if not glaeubiger_id and "CRED:" in zweck:
                    try:
                        idx = zweck.index("CRED:") + 5
                        rest = zweck[idx:].strip()
                        glaeubiger_id = rest.split()[0] if rest else ""
                    except (ValueError, IndexError):
                        pass

                if not mandatsref and "MREF:" in zweck:
                    try:
                        idx = zweck.index("MREF:") + 5
                        rest = zweck[idx:].strip()
                        mandatsref = rest.split()[0] if rest else ""
                    except (ValueError, IndexError):
                        pass

                row = {
                    "Bezeichnung Auftragskonto": konto_name,
                    "IBAN Auftragskonto": konto.iban,
                    "BIC Auftragskonto": BIC,
                    "Bankname Auftragskonto": BANKNAME,
                    "Buchungstag": buchungstag_str,
                    "Valutadatum": valuta_str,
                    "Name Zahlungsbeteiligter": name,
                    "IBAN Zahlungsbeteiligter": iban_partner,
                    "BIC (SWIFT-Code) Zahlungsbeteiligter": bic_partner,
                    "Buchungstext": buchungstext,
                    "Verwendungszweck": zweck,
                    "Betrag": betrag_str,
                    "Waehrung": waehrung,
                    "Saldo nach Buchung": saldo_str,
                    "Bemerkung": "",
                    "Gekennzeichneter Umsatz": "",
                    "Glaeubiger ID": glaeubiger_id,
                    "Mandatsreferenz": mandatsref,
                }
                rows.append(row)

            all_transactions[konto.iban] = rows

    return all_transactions


def write_csv(iban, rows, datum_str):
    """Schreibt die Umsaetze als CSV im Bank-Export-Format."""

    dateiname = f"Umsaetze_{iban}_{datum_str}.csv"
    dateipfad = os.path.join(OUTPUT_DIR, dateiname)

    fieldnames = [
        "Bezeichnung Auftragskonto",
        "IBAN Auftragskonto",
        "BIC Auftragskonto",
        "Bankname Auftragskonto",
        "Buchungstag",
        "Valutadatum",
        "Name Zahlungsbeteiligter",
        "IBAN Zahlungsbeteiligter",
        "BIC (SWIFT-Code) Zahlungsbeteiligter",
        "Buchungstext",
        "Verwendungszweck",
        "Betrag",
        "Waehrung",
        "Saldo nach Buchung",
        "Bemerkung",
        "Gekennzeichneter Umsatz",
        "Glaeubiger ID",
        "Mandatsreferenz",
    ]

    with open(dateipfad, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, delimiter=";", quoting=csv.QUOTE_MINIMAL)
        writer.writeheader()
        writer.writerows(rows)

    print(f"CSV gespeichert: {dateipfad} ({len(rows)} Zeilen)")
    return dateipfad


def main():
    args = parse_args()

    # Benutzer
    benutzer = args.benutzer
    if not benutzer:
        benutzer = input("Online-Banking Benutzername/Kontonummer: ")

    # PIN
    pin = args.pin
    if not pin:
        pin = getpass.getpass("Online-Banking PIN: ")

    # Zeitraum - mehrere Datumsformate unterstuetzen
    def parse_datum(text):
        """Versucht verschiedene Datumsformate zu parsen."""
        text = text.strip()
        if not text:
            return None
        for fmt in ("%d.%m.%Y", "%Y-%m-%d", "%d/%m/%Y", "%Y.%m.%d", "%d.%m.%y"):
            try:
                return datetime.strptime(text, fmt).date()
            except ValueError:
                continue
        raise ValueError(f"Datumsformat nicht erkannt: '{text}' (erwartet: TT.MM.JJJJ)")

    if args.von and args.von.strip():
        von_datum = parse_datum(args.von)
    else:
        von_datum = date.today() - timedelta(days=30)

    if args.bis and args.bis.strip():
        bis_datum = parse_datum(args.bis)
    else:
        bis_datum = date.today()

    datum_str = bis_datum.strftime("%Y.%m.%d")

    # Abruf
    try:
        ergebnis = get_transactions(benutzer, pin, von_datum, bis_datum, args.konto)
    except Exception as e:
        print(f"\nFEHLER: {e}", file=sys.stderr)
        sys.exit(1)

    if not ergebnis:
        print("Keine Umsaetze gefunden.")
        sys.exit(0)

    # CSV schreiben
    dateien = []
    for iban, rows in ergebnis.items():
        if rows:
            pfad = write_csv(iban, rows, datum_str)
            dateien.append(pfad)

    # Erfolgsmeldung (wird von VBA ausgelesen)
    print(f"\nERFOLG:{len(dateien)} Datei(en) erstellt")
    for d in dateien:
        print(f"DATEI:{d}")


if __name__ == "__main__":
    main()
