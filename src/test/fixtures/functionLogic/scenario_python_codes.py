# Static Scenario fixture: parse, validate, deduplicate and prioritize labeled product codes.
import re

_CODE = re.compile(r"(?<!\d)(\d{2})\s*-?\s*(\d{3})(?!\d)")
_LABEL = re.compile(r"C\s*O\s*D\s*E")

def valid_code(digits: str) -> bool:
    if len(digits) != 5 or not digits.isdigit():
        return False
    weights = (1, 2, 3, 4)
    total = sum(int(d) * w for d, w in zip(digits[:4], weights, strict=False))
    total += (int(digits[3]) * 3) // 10
    return (10 - total % 10) % 10 == int(digits[4])

def inspect(text: str) -> list[str]:
    found: list[str] = []
    labeled: list[str] = []
    for line in text.splitlines():
        for match in _CODE.finditer(line):
            digits = "".join(match.groups())
            if not valid_code(digits) or digits in found:
                continue
            found.append(digits)
            if _LABEL.search(line):
                labeled.append(digits)
    return labeled + [d for d in found if d not in labeled]
