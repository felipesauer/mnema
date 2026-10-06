from decimal import Decimal


def parse_amount(text):
    if not text:
        raise ValueError("empty amount")
    return Decimal(text.replace(",", "."))
