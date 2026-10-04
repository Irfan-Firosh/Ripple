"""Conservative interest-only input and output filters shared by every call path."""
import re

# Whole words prevent accidental matches such as 'class' or 'background'.
SENSITIVE = re.compile(
    r"\b(?:race|racial|ethnic(?:ity)?|asian|latino|latina|hispanic|indigenous|african[- ]american|"
    r"religio\w*|christian\w*|muslim\w*|jewish|hindu\w*|buddhist\w*|atheist\w*|"
    r"politic\w*|democrat\w*|republican\w*|liberal|conservative|election\w*|partisan|"
    r"medical|health\w*|disease\w*|disabil\w*|mental\s+health|diagnos\w*|cancer|diabet\w*|autis\w*|"
    r"pregnan\w*|depression|anxiety|adhd|medication|"
    r"sexual\w*|gay|lesbian|bisexual|transgender|lgbt\w*|"
    r"income|wealth\w*|rich|poor|poverty|salary|salaries|millionaire\w*|billionaire\w*|"
    r"minor\w*|child\w*|teen\w*|age|aged|elderly|millennial\w*|boomer\w*|demographic\w*)\b|"
    r"\b(?:black|white)\s+(?:people|users|developers|men|women|voters|audiences?)\b|\b\d+[- ]year[- ]old\b", re.I)
IDENTIFIER = re.compile(r"(?:https?://\S+|at://\S+|did:[\w:.-]+|@[\w.-]+|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b)", re.I)


def clean_text(value: str, *, banned=(), limit=1000) -> str:
    """Drop sensitive phrases; redact handles, URLs, evidence IDs and unsupported claims."""
    text = str(value).strip()
    if SENSITIVE.search(text):
        return ""
    text = IDENTIFIER.sub("", text)
    for phrase in banned:
        if phrase:
            text = re.sub(re.escape(phrase), "", text, flags=re.I)
    return " ".join(text.split())[:limit].strip(" ,;:-")


def clean_list(values, **kwargs):
    return list(dict.fromkeys(text for value in values if (text := clean_text(value, **kwargs))))


def validate_instruction(text: str) -> str:
    text = text.strip()
    if not text or len(text) > 300:
        raise ValueError("edit instruction must contain 1–300 characters")
    if SENSITIVE.search(text) or IDENTIFIER.search(text):
        raise ValueError("use interest and visual instructions without sensitive traits or personal identifiers")
    return text
