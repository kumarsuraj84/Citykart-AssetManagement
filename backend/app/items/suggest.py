"""The ONE way CKAM guesses which existing Item an ERP name means -- for the ERP PO review (draft lines), the
head-office ERP inbox, the ERP Articles screen and "Link existing assets to Items".

S7 (P1-3) replaced "the share of the Item name's words found in the text" (AI BOX was a "100% match" for any
ERP name with BOX in it). The S7 re-test (N1) still found about 1 wrong suggestion in 5 at "Similar name (95%)":
an Item whose name kept ONE distinctive word after the generic words were dropped (CAMERA BOX PVC -> camera,
CABLE MANAGER -> manager) matched any text with that word, a barcode printer got BARCODE_PRINTER_STAND, the
longer-name tie-break beat the right Item, and an ERP group holding a table AND an office chair was "Same name"
because one of its codes was. The rules now (fix round 2):

* Texts are cleaned of ERP code prefixes first (FA_CE_HOPBOX -> HOPBOX, "FIXED ASSETS-IT EQUIPMENST-FA_IT_LAPTOP"
  -> LAPTOP, "01-MOUSE[IT-01]" -> 01-MOUSE) and compared on their normalised form too: lower case, every space /
  hyphen / dot / underscore taken out, so HOPBOX = HOP BOX = Hop-Box.
* 1.0 ("same name") ONLY when a PRODUCT NAME is the Item name after that. An ERP group's (Article's) name or
  department is never "same name", and neither is a group whose codes carry several product names.
* Otherwise BOTH names' words are compared (Jaccard-style), each word weighed by how rare it is among the Item
  names. Three kinds of word:
    - filler (with, for, sizes and units such as mm / inch / kva / tr, ERP prefixes, plain numbers like 4x4):
      count for nothing;
    - weak (box, cable, stand, set, small, big, pvc, steel, colours ...): never enough on their own, but an Item
      word all the same -- CAMERA BOX PVC is a box, not a camera;
    - distinctive: everything else.
  item_cover = the weight of the Item's words found in the text / the weight of all the Item's words (an Item
  that ADDS words the text lacks scores lower: CAMERA BOX PVC for INDOOR CAMERA covers 1 word of 3);
  text_cover = the weight of the text's distinctive words that some Item uses AND this Item covers / the weight
  of all such words (an Item that MISSES words the text has, words that point at another Item, scores lower:
  CAMERA BOX PVC misses INDOOR). Brand and model words no Item uses (HIKVISION, GK420T) do not count against.
  score = 0.85 x item_cover x sqrt(text_cover); at least one distinctive word must match.
* Every non-exact suggestion is capped at 0.85 ("similar name"); a fit found only in the ERP group's name or
  department counts x 0.9; below 0.6 there is no suggestion.
* What a product IS is usually its last word: a text whose last real word is a thing-word (BOX, STAND, CABLE,
  COVER, MOUNT ...) that the Item's name lacks does not suggest that Item (LAPTOP STAND is a stand).
* When the best two Items are within 0.1 of each other (UPS SMALL / UPS BIG for "UPS 1000VA"), there is NO
  suggestion -- better none than a coin flip.
* An ERP GROUP with several product names (TABLE 4*2 and OFFICE CHAIR) is judged jointly: an Item must fit the
  names on average (each distinct name scored on its own), or the group's own name / department; x 0.9, never
  "same name". So one click cannot map a table to Office Chair.
* An Item whose name is ONLY generic words (e.g. "Cable") can still be suggested when its whole name is in a
  text, but only when no other Item matched at all, at 0.6.

Pure functions, no database access: the caller passes the active Items (once per screen)."""
from __future__ import annotations

import math
import re
from dataclasses import dataclass

SUGGESTION_THRESHOLD = 0.6
SAME_NAME, SIMILAR_NAME = "SAME_NAME", "SIMILAR_NAME"
REASON_WORDS = {SAME_NAME: "same name", SIMILAR_NAME: "similar name"}

SCORE_SAME = 1.0
SCORE_CAP = 0.85                # the most any non-exact suggestion can score
SCORE_CONTAINED = SCORE_CAP     # kept for older imports: "the whole Item name inside the text" is now <= the cap
SCORE_GENERIC_ONLY = 0.6
GROUP_FACTOR = 0.9              # an ERP group of several product names: judged jointly, a little less sure
CONTEXT_FACTOR = 0.9            # one product known only by its ERP group's name / department: a little less sure
TIE_MARGIN = 0.1                # the best two closer than this: no suggestion
TEXT_COVER_POWER = 0.5          # missing a text word counts less than adding an Item word
MAX_RUN = 6                     # longest run of consecutive words joined when looking for a written-apart name

# Words that say nothing about WHAT a thing is: fillers, units and sizes, ERP prefixes.
FILLER_WORDS = frozenset({
    "with", "for", "and", "the", "of", "a", "an", "in", "on", "to", "by", "x", "mm", "cm", "inch", "inches", "ft",
    "feet", "mtr", "meter", "metre", "kg", "gm", "ltr", "litre", "liter", "watt", "w", "v", "volt", "amp", "pcs", "pc",
    "nos", "no", "new", "old", "ton", "tons", "tr", "kva", "va", "gb", "tb", "mb", "mp", "ghz", "mhz", "hz",
    "fa", "ce", "ef", "ff", "oe", "pm", "non",
})
# Generic nouns, sizes, materials, colours: never enough to suggest an Item, but a word of the Item's name.
WEAK_WORDS = frozenset({
    "box", "boxes", "cable", "cables", "stand", "stands", "set", "sets", "pro", "small", "big", "large", "medium",
    "mini", "size", "pvc", "cat", "wire", "wires", "unit", "units", "type", "model", "other", "others", "misc", "item",
    "items", "general", "accessories", "accessory", "part", "parts", "heavy", "duty", "plastic", "steel", "metal",
    "colour", "color", "black", "white", "grey", "gray", "single", "double", "plus", "standard", "std", "premium",
})
GENERIC_WORDS = FILLER_WORDS | WEAK_WORDS          # older name, still exported
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
_NUMERIC_LIKE = re.compile(r"^\d+([x*]\d+)*[a-z]{0,3}$")      # 4, 48, 4x4, 6u, 12mm, 1x2m, 16gb
_ERP_PREFIX = re.compile(r"(?:^|[\s\-])[a-z]{2}_[a-z]{2}_", re.IGNORECASE)    # FA_CE_ / -FA_IT_ / FF_OE_
_BRACKETED = re.compile(r"\[[^\]]*\]")                          # [IT-01]


def tokens(text: str | None) -> list[str]:
    return re.findall(r"[a-z0-9]+", (text or "").lower())


def compact(text: str | None) -> str:
    """HOPBOX, HOP BOX, Hop-Box -> 'hopbox'."""
    return "".join(tokens(text))


def clean_erp_text(text: str | None) -> str:
    """An ERP name without its code prefix: 'FA_CE_HOPBOX' -> 'HOPBOX', 'FIXED ASSETS-IT EQUIPMENST-FA_IT_LAPTOP'
    -> 'LAPTOP', '01-MOUSE[IT-01]' -> '01-MOUSE '. Item names are never cleaned."""
    t = _BRACKETED.sub(" ", text or "")
    last = None
    for last in _ERP_PREFIX.finditer(t):
        pass
    return t[last.end():] if last is not None else t


def word_kind(word: str) -> str:
    """'filler', 'weak' or 'strong' (distinctive)."""
    if len(word) < 2 or word in FILLER_WORDS or _NUMERIC_LIKE.match(word):
        return "filler"
    return "weak" if word in WEAK_WORDS else "strong"


def is_generic(word: str) -> bool:
    return word_kind(word) != "strong"


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
    toks = tokens(clean_erp_text(text))
    if not toks:
        return None
    runs: dict[str, tuple[int, int]] = {}
    for i in range(len(toks)):
        joined = ""
        for j in range(i, min(i + MAX_RUN, len(toks))):
            joined += toks[j]
            runs.setdefault(joined, (i, j))
    return _Text(toks, "".join(toks), runs)


def _parse(texts) -> list[_Text]:
    return [t for t in map(_text, texts or []) if t is not None]


class ItemMatcher:
    """Built once per screen from the active Items. `best(names, context)` gives the one safe suggestion for one
    product (or None); `best_for_group(names, context)` for an ERP group of codes."""

    def __init__(self, items: list):
        self.items = list(items)
        self._tokens = {i.id: tokens(i.name) for i in self.items}
        self._compact = {i.id: "".join(self._tokens[i.id]) for i in self.items}
        self._words = {i.id: {t for t in self._tokens[i.id] if word_kind(t) != "filler"} for i in self.items}
        self._strong = {i.id: {t for t in self._words[i.id] if word_kind(t) == "strong"} for i in self.items}
        df: dict[str, int] = {}
        for words in self._words.values():
            for w in words:
                df[w] = df.get(w, 0) + 1
        n = len(self.items)
        self._idf = {w: 1.0 + math.log((n + 1) / (c + 1)) for w, c in df.items()}
        self._vocab = {w for w in df if word_kind(w) == "strong"}       # distinctive words some Item uses

    # ------------------------------------------------------------------ one Item against one text
    def _describes_only(self, item_id: int, text: _Text, last_matched: int) -> bool:
        """The text's last real word (sizes, counts and colours after it skipped) is a thing-word (BOX, STAND,
        SLEEVE ...) after everything the Item matched, and the Item's name does not have that word: the Item
        says what the thing is for, not what it is."""
        head = len(text.toks) - 1
        while head > 0 and (text.toks[head] in TRAILING_FILLER or _NUMERIC_LIKE.match(text.toks[head])):
            head -= 1
        return last_matched < head and text.toks[head] in HEAD_NOUNS and text.toks[head] not in self._tokens[item_id]

    def _w(self, word: str) -> float:
        return self._idf.get(word, 1.0)

    def _fit(self, item, text: _Text) -> float:
        """0..1: how well the Item's name and this text agree (1 = all words of both, 0 = no distinctive word
        in common, or the text is a different thing). Exactness is judged by the caller."""
        words, strong = self._words[item.id], self._strong[item.id]
        if not strong:
            return 0.0                     # only generic words: see the last resort in _ranked
        name = self._compact[item.id]
        covered: set[int] = set()
        if name in text.runs:              # the whole Item name, written together or apart
            first, last = text.runs[name]
            matched = set(words)
            covered.update(range(first, last + 1))
        else:
            matched, last = set(), -1
            for w in words:
                if w in text.runs:         # a word, or one written as two
                    first, end = text.runs[w]
                    matched.add(w)
                    covered.update(range(first, end + 1))
                    last = max(last, end)
        if not matched & strong or self._describes_only(item.id, text, last):
            return 0.0
        item_cover = sum(self._w(w) for w in matched) / sum(self._w(w) for w in words)
        telling = [k for k, tok in enumerate(text.toks) if tok in self._vocab]   # text words some Item uses
        total = sum(self._w(text.toks[k]) for k in telling)
        text_cover = (sum(self._w(text.toks[k]) for k in telling if k in covered) / total) if total else 1.0
        return item_cover * text_cover ** TEXT_COVER_POWER

    # ------------------------------------------------------------------ one Item against a product / a group
    def score(self, item, texts: list[str | None], context: list[str | None] | None = None,
              _parsed: tuple[list[_Text], list[_Text]] | None = None) -> Suggestion | None:
        """One product: `texts` are its names (an exact one is "same name"), `context` the ERP group's name and
        department (never "same name")."""
        names, ctx = _parsed if _parsed is not None else (_parse(texts), _parse(context))
        name = self._compact.get(item.id) or ""
        if not name:
            return None
        if any(t.whole == name for t in names):
            return Suggestion(item, SCORE_SAME, SAME_NAME)
        fit = max([self._fit(item, t) for t in names] + [CONTEXT_FACTOR * self._fit(item, t) for t in ctx], default=0.0)
        return Suggestion(item, round(SCORE_CAP * fit, 4), SIMILAR_NAME) if fit > 0 else None

    def _score_group(self, item, names: list[_Text], ctx: list[_Text]) -> Suggestion | None:
        """Several product names: the mean fit over the names (each distinct name on its own), or the group's
        own name / department, x GROUP_FACTOR; never "same name"."""
        if not self._compact.get(item.id):
            return None
        joint = sum(self._fit(item, t) for t in names) / len(names) if names else 0.0
        fit = max([joint] + [self._fit(item, t) for t in ctx])
        return Suggestion(item, round(SCORE_CAP * GROUP_FACTOR * fit, 4), SIMILAR_NAME) if fit > 0 else None

    # ------------------------------------------------------------------ ranking
    def _ranked(self, scored: list[Suggestion], pool: list, parsed: list[_Text], allow_generic: bool) -> list[Suggestion]:
        found = [s for s in scored if s is not None and s.score > 0]
        if not found and allow_generic:
            # Nothing distinctive matched: an Item named only with generic words may still be meant when its
            # whole name is in a text ("Cable" for "HDMI CABLE 2M").
            for item in pool:
                name = self._compact.get(item.id)
                if self._strong.get(item.id) or not name:
                    continue
                if any(name in t.runs and not self._describes_only(item.id, t, t.runs[name][1]) for t in parsed):
                    found.append(Suggestion(item, SCORE_GENERIC_ONLY, SIMILAR_NAME))
        return sorted(found, key=lambda s: (-s.score, (s.item.name or "").lower(), s.item.id))

    def candidates(self, texts: list[str | None], items: list | None = None,
                   threshold: float = SUGGESTION_THRESHOLD, context: list[str | None] | None = None) -> list[Suggestion]:
        """Every Item (of `items`, default all) at or above the threshold, best first (no tie rule: for screens
        that list several suggestions)."""
        names, ctx = _parse(texts), _parse(context)
        pool = self.items if items is None else items
        ranked = self._ranked([self.score(i, texts, context, (names, ctx)) for i in pool], pool, names + ctx,
                              SCORE_GENERIC_ONLY >= threshold)
        return [s for s in ranked if s.score >= threshold]

    @staticmethod
    def _safe(ranked: list[Suggestion]) -> Suggestion | None:
        """The best one when it clears the threshold and no other Item comes within TIE_MARGIN of it."""
        if not ranked or ranked[0].score < SUGGESTION_THRESHOLD:
            return None
        if len(ranked) > 1 and ranked[0].score - ranked[1].score < TIE_MARGIN:
            return None
        return ranked[0]

    def best(self, texts: list[str | None], items: list | None = None,
             context: list[str | None] | None = None) -> Suggestion | None:
        """The one safe suggestion for ONE product: its names (`texts`) and its ERP group's name / department
        (`context`)."""
        names, ctx = _parse(texts), _parse(context)
        pool = self.items if items is None else items
        return self._safe(self._ranked([self.score(i, texts, context, (names, ctx)) for i in pool], pool,
                                       names + ctx, True))

    def best_for_group(self, names: list[str | None], context: list[str | None] | None = None,
                       items: list | None = None) -> Suggestion | None:
        """The one safe suggestion for an ERP GROUP (an Article, or codes without one): `names` = the product
        names of its codes, `context` = the group's name and department. One distinct product name = that
        product (`best`); several = judged jointly and never "same name"."""
        distinct: dict[str, str] = {}
        for n in names or []:
            key = compact(clean_erp_text(n))
            if key:
                distinct.setdefault(key, n or "")
        if len(distinct) <= 1:
            return self.best(list(distinct.values()), items, context)
        parsed, ctx = _parse(distinct.values()), _parse(context)
        pool = self.items if items is None else items
        return self._safe(self._ranked([self._score_group(i, parsed, ctx) for i in pool], pool, parsed + ctx, False))

    def for_erp(self, own_names: list[str | None], group_names, context: list[str | None],
                reach: str | None, product_reach: str = "NAME") -> tuple[Suggestion | None, str | None]:
        """S7 fix 2 (N1 / N2): the ONE ERP suggestion, used by the PO review (one line = one code) and the ERP
        inbox (a group of codes) alike, so the same code gets the same answer on both screens. Returns the
        suggestion and the reach it was judged for:

        * reach ARTICLE (a coherent ERP group, see readiness.suggested_scope): the Item must fit every product
          name of the group (`own_names` + `group_names`, the names bought in that Article) -> "ARTICLE";
        * otherwise, or when no Item fits the whole group, the product itself (`own_names`, one distinct
          name) -> `product_reach` ("NAME", or "CODE" when the code has no ERP product name of its own);
        * several product names of the inbox group (`own_names`) without a group-wide answer: judged jointly
          -> "NAME" (each code's product name).
        `context` = the ERP group's name and department."""
        own = [n for n in own_names if compact(clean_erp_text(n))]
        if reach == "ARTICLE":
            found = self.best_for_group(own + [n for n in group_names or [] if n], context)
            if found is not None:
                return found, "ARTICLE"
        distinct = {compact(clean_erp_text(n)) for n in own}
        if len(distinct) <= 1:
            found = self.best(own[:1], context=context)
            return (found, product_reach) if found is not None else (None, None)
        found = self.best_for_group(own, context)
        return (found, "NAME") if found is not None else (None, None)
