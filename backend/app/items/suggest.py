"""S7 (P1-3): the ONE way CKAM guesses which existing Item a name means -- for the ERP PO review (draft lines),
the head-office ERP inbox, the ERP Articles screen and "Link existing assets to Items".

Before S7 the guess was "the share of the Item name's words found in the text", so "AI BOX" (whose only word
of 3+ letters is BOX) was a "100% match" for any ERP name with BOX in it -- GANG BOX PVC 4X4, R-51 HOP BOX --
while the Item HOPBOX was never found because "HOP BOX" was two words. One click then saved a wrong
group-wide rule. Now each text (Article name, department, product name, description) is compared on its own:

* Names are compared on their normalised form too: lower case, every space / hyphen / dot / underscore taken
  out, so HOPBOX = HOP BOX = Hop-Box. 1.0 ("same name") ONLY when a text and the Item name are the same
  after that; nothing else is ever 100%.
* The whole Item name inside the text, as consecutive words (R-51 HOP BOX contains HOPBOX): 0.95
  ("similar name").
* Otherwise the words are weighed by how rare they are among the Item names (a word only one Item has says
  much more than one many Items share), and GENERIC words (box, cable, stand, set, pro, with, for, small, big,
  size, pvc, cat, wire, mm, inch, sizes and plain numbers like 4x4 ...) count for nothing. At least one
  distinctive word must match; every distinctive word of the Item found (any order): 0.95 too (of two such
  Items the one with the longer name wins: "Dell Desktop" before "Desktop"); some of them: 0.9 x their
  weight share.
* What a product IS is usually its last word: when a text ends in a word like BOX, STAND, CABLE, COVER, MOUNT
  that is not part of the Item's name, the Item only says what the thing is FOR (CAMERA PVC BOX is a box,
  LAPTOP STAND is a stand), so that text does not suggest it.
* An Item whose name is ONLY generic words (e.g. "Cable") can still be suggested when its whole name is in a
  text, but only when no other Item matched at all ("unless nothing else matches"), at 0.6.
* Below SUGGESTION_THRESHOLD (0.6) there is no suggestion at all -- better none than a wrong one.

Pure functions, no database access: the caller passes the active Items (once per screen)."""
from __future__ import annotations

import math
import re
from dataclasses import dataclass

SUGGESTION_THRESHOLD = 0.6
SAME_NAME, SIMILAR_NAME = "SAME_NAME", "SIMILAR_NAME"
REASON_WORDS = {SAME_NAME: "same name", SIMILAR_NAME: "similar name"}

SCORE_SAME = 1.0
SCORE_CONTAINED = 0.95
SCORE_ALL_WORDS = 0.95          # every distinctive word, in any order (the longer name wins a tie)
SCORE_PART = 0.9                # x the weight share of the distinctive words found
SCORE_GENERIC_ONLY = 0.6
MAX_RUN = 6                     # longest run of consecutive words joined when looking for a written-apart name

# Words that say little about WHAT a thing is (sizes, materials, fillers, ERP prefixes).
GENERIC_WORDS = frozenset({
    "box", "boxes", "cable", "cables", "stand", "stands", "set", "sets", "pro", "with", "for", "and", "the", "of",
    "small", "big", "large", "medium", "mini", "size", "pvc", "cat", "wire", "wires", "mm", "cm", "inch", "inches",
    "ft", "feet", "mtr", "meter", "metre", "kg", "gm", "ltr", "litre", "liter", "watt", "w", "v", "volt", "amp",
    "pcs", "pc", "nos", "no", "unit", "units", "type", "model", "new", "old", "other", "others", "misc", "item",
    "items", "general", "accessories", "accessory", "part", "parts", "heavy", "duty", "plastic", "steel", "metal",
    "colour", "color", "black", "white", "grey", "gray", "single", "double", "plus", "standard", "std", "premium",
    "fa", "ce", "ef", "it", "non", "x", "a", "an", "in", "on", "to", "by",
})
# Last words that name the thing itself; an Item that does not include it only describes what it is for.
HEAD_NOUNS = frozenset({
    "box", "boxes", "stand", "stands", "cable", "cables", "cover", "covers", "case", "cases", "bag", "bags", "mount",
    "mounts", "bracket", "brackets", "holder", "holders", "tray", "trays", "adapter", "adaptor", "charger", "clip",
    "clips", "frame", "frames", "wire", "wires", "kit", "pouch", "sleeve", "strap", "pipe", "sticker", "stickers",
})
# Words that may follow the thing-word at the end of a name (a size, a count, a colour).
TRAILING_FILLER = frozenset({
    "inch", "inches", "mm", "cm", "ft", "feet", "mtr", "meter", "metre", "kg", "gm", "ltr", "litre", "liter", "watt",
    "w", "v", "volt", "amp", "pcs", "pc", "nos", "no", "small", "big", "large", "medium", "mini", "black", "white",
    "grey", "gray", "colour", "color", "new", "old", "x",
})
_NUMERIC_LIKE = re.compile(r"^\d+([x*]\d+)*[a-z]{0,3}$")      # 4, 48, 4x4, 6u, 12mm, 1x2m


def tokens(text: str | None) -> list[str]:
    return re.findall(r"[a-z0-9]+", (text or "").lower())


def compact(text: str | None) -> str:
    """HOPBOX, HOP BOX, Hop-Box -> 'hopbox'."""
    return "".join(tokens(text))


def is_generic(word: str) -> bool:
    return len(word) < 2 or word in GENERIC_WORDS or bool(_NUMERIC_LIKE.match(word))


@dataclass
class Suggestion:
    item: object
    score: float
    reason: str

    @property
    def reason_text(self) -> str:
        return REASON_WORDS[self.reason]


@dataclass
class _Text:
    toks: list[str]
    whole: str
    runs: dict[str, tuple[int, int]]        # joined consecutive words -> (first, last) word index


def _text(text: str | None) -> _Text | None:
    toks = tokens(text)
    if not toks:
        return None
    runs: dict[str, tuple[int, int]] = {}
    for i in range(len(toks)):
        joined = ""
        for j in range(i, min(i + MAX_RUN, len(toks))):
            joined += toks[j]
            runs.setdefault(joined, (i, j))
    return _Text(toks, "".join(toks), runs)


class ItemMatcher:
    """Built once per screen from the active Items; `best(texts)` gives the one safe suggestion or None."""

    def __init__(self, items: list):
        self.items = list(items)
        self._tokens = {i.id: tokens(i.name) for i in self.items}
        self._compact = {i.id: "".join(self._tokens[i.id]) for i in self.items}
        self._distinct = {i.id: {t for t in self._tokens[i.id] if not is_generic(t)} for i in self.items}
        df: dict[str, int] = {}
        for words in self._distinct.values():
            for w in words:
                df[w] = df.get(w, 0) + 1
        n = len(self.items)
        self._idf = {w: 1.0 + math.log((n + 1) / (c + 1)) for w, c in df.items()}

    def _describes_only(self, item_id: int, text: _Text, last_matched: int) -> bool:
        """The text's last real word (sizes, counts and colours after it skipped) is a thing-word (BOX, STAND,
        SLEEVE ...) after everything the Item matched, and the Item's name does not have that word: the Item
        says what the thing is for, not what it is."""
        head = len(text.toks) - 1
        while head > 0 and (text.toks[head] in TRAILING_FILLER or _NUMERIC_LIKE.match(text.toks[head])):
            head -= 1
        return last_matched < head and text.toks[head] in HEAD_NOUNS and text.toks[head] not in self._tokens[item_id]

    def _score_in(self, item, text: _Text) -> float:
        name = self._compact[item.id]
        distinct = self._distinct[item.id]
        if name in text.runs:
            _, end = text.runs[name]
            return 0.0 if self._describes_only(item.id, text, end) else SCORE_CONTAINED
        hits = {w: text.runs[w][1] for w in distinct if w in text.runs}    # a word, or one written as two
        if not hits or self._describes_only(item.id, text, max(hits.values())):
            return 0.0
        if len(hits) == len(distinct):
            return SCORE_ALL_WORDS
        total = sum(self._idf.get(w, 1.0) for w in distinct)
        return round(SCORE_PART * sum(self._idf.get(w, 1.0) for w in hits) / total, 4)

    def score(self, item, texts: list[str | None], _parsed: list[_Text] | None = None) -> Suggestion | None:
        parsed = _parsed if _parsed is not None else [t for t in map(_text, texts) if t is not None]
        name = self._compact.get(item.id) or ""
        if not name:
            return None
        if any(t.whole == name for t in parsed):
            return Suggestion(item, SCORE_SAME, SAME_NAME)
        if not self._distinct.get(item.id):
            return None                    # only generic words: see candidates() ("nothing else matches")
        best = max((self._score_in(item, t) for t in parsed), default=0.0)
        return Suggestion(item, best, SIMILAR_NAME) if best > 0 else None

    def candidates(self, texts: list[str | None], items: list | None = None,
                   threshold: float = SUGGESTION_THRESHOLD) -> list[Suggestion]:
        """Every Item (of `items`, default all) at or above the threshold, best first."""
        parsed = [t for t in map(_text, texts) if t is not None]
        pool = self.items if items is None else items
        found = [s for s in (self.score(i, texts, parsed) for i in pool) if s is not None and s.score >= threshold]
        if not found and SCORE_GENERIC_ONLY >= threshold:
            # Nothing distinctive matched: an Item named only with generic words may still be meant when its
            # whole name is in a text ("Cable" for "HDMI CABLE 2M").
            for item in pool:
                name = self._compact.get(item.id)
                if self._distinct.get(item.id) or not name:
                    continue
                if any(name in t.runs and not self._describes_only(item.id, t, t.runs[name][1]) for t in parsed):
                    found.append(Suggestion(item, SCORE_GENERIC_ONLY, SIMILAR_NAME))
        return sorted(found, key=lambda s: (-s.score, -len(self._compact.get(s.item.id, "")),
                                            (s.item.name or "").lower(), s.item.id))

    def best(self, texts: list[str | None], items: list | None = None) -> Suggestion | None:
        found = self.candidates(texts, items)
        return found[0] if found else None
