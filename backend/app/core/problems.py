"""S5: one shape for "checked everything, refused, nothing written" answers (the S4 Receive convention):

    422 {"detail": "<one sentence, or 'Nothing was ...: N problems need fixing. <first>'>",
         "errors": ["<sentence>", ...],
         "problems": [{"message": "...", <where: unit_index | entry_index | line_index | set_index>, ...}]}

`detail` is always a string; a problem that concerns one unit / entry / line / set gets "Unit 3: " etc. in
front of its sentence in `errors` and `detail`, while `problems` keeps the plain message and the position."""
from fastapi import status
from fastapi.responses import JSONResponse

MAX_PROBLEMS = 200

# position key -> the word put in front of the sentence
POSITION_WORDS = (("unit_index", "Unit"), ("entry_index", "Entry"), ("line_index", "Line"), ("set_index", "Set"))


def sentence_of(problem: dict) -> str:
    for key, word in POSITION_WORDS:
        if problem.get(key) is not None:
            return f"{word} {problem[key]}: {problem['message']}"
    return problem["message"]


class Refused(Exception):
    """Raised after a whole request was checked and refused; nothing has been written."""

    def __init__(self, problems: list[dict], nothing: str = "Nothing was saved"):
        problems = problems or [{"message": "Nothing was saved."}]
        super().__init__(sentence_of(problems[0]))
        self.problems = problems[:MAX_PROBLEMS]
        self.more = max(0, len(problems) - MAX_PROBLEMS)
        self.nothing = nothing

    @property
    def sentences(self) -> list[str]:
        out = [sentence_of(p) for p in self.problems]
        if self.more:
            out.append(f"... and {self.more} more.")
        return out

    def body(self) -> dict:
        sentences = self.sentences
        total = len(self.problems) + self.more
        detail = sentences[0] if total == 1 else f"{self.nothing}: {total} problems need fixing. {sentences[0]}"
        return {"detail": detail, "errors": sentences, "problems": self.problems}

    def response(self) -> JSONResponse:
        return JSONResponse(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, content=self.body())


def collapse_units(per_unit: list[list[str]], **where) -> list[dict]:
    """Problems of a run of units: a message every unit has is reported once (with `where`, e.g. no position
    at all); the others once per unit (unit_index = the unit's 1-based position)."""
    out: list[dict] = []
    if not per_unit:
        return out
    seen: list[str] = []
    for messages in per_unit:
        for m in messages:
            if m not in seen:
                seen.append(m)
    for message in seen:
        holders = [i for i, messages in enumerate(per_unit, start=1) if message in messages]
        if len(holders) == len(per_unit):
            out.append({**where, "message": message})
        else:
            out.extend({**where, "unit_index": i, "message": message} for i in holders)
    return out


def plural(n: int, one: str, many: str) -> str:
    return one if n == 1 else many
