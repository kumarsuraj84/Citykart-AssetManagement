"""Security IF-01 / IF-01-WIN: which file a URL may name under the built frontend's folder.

Production is ONE uvicorn process on WINDOWS that serves the built frontend itself (app.main). On Windows a
path can reach outside the folder in ways a Linux test never sees: `\\\\host\\share\\x` (UNC) or `C:\\x` /
`C:x` (drive) paths, `x.js::$DATA` (alternate data streams), `CON` / `nul.txt` (devices), names ending in a
dot or space (silently trimmed), `PROGRA~1` (8.3 short names). Merely asking Windows whether a UNC path
exists (stat / resolve) makes the server open an SMB connection to that host, so the URL text is checked
PURELY LEXICALLY first; only a name that passes is joined, resolved and looked at on disk.

Every refusal is the same `None` (the routes answer the same plain 404 as for a file that is not there), so
an attacker learns nothing about what exists."""
from __future__ import annotations

import os
import re
from pathlib import Path, PurePosixPath, PureWindowsPath

MAX_ASSET_PATH_LENGTH = 200
# One path segment: the characters Vite's hashed file names use (name-HASH.js, HASH is base64url).
_SEGMENT = re.compile(r"[A-Za-z0-9._~-]+")
# Windows device names, with or without an extension, any case (CON, nul.txt, AUX.js, COM1, LPT9.log ...).
_RESERVED = re.compile(r"(?i)^(con|prn|aux|nul|com[0-9]|lpt[0-9]|conin\$|conout\$)(\..*)?$")
# An 8.3 short name (PROGRA~1): on Windows it is an alias of a longer name.
_SHORT_NAME = re.compile(r"~[0-9]")


def is_safe_relative_name(file_path: object) -> bool:
    """True only for a plain relative name such as `index-AbC_123-x.js` or `fonts/inter-x.woff2`. Never touches
    the filesystem."""
    if not isinstance(file_path, str) or not file_path or len(file_path) > MAX_ASSET_PATH_LENGTH:
        return False
    # backslash (Windows separator, UNC), NUL, colon (drive letters, alternate data streams)
    if "\\" in file_path or "\x00" in file_path or ":" in file_path:
        return False
    if file_path.startswith("/") or PurePosixPath(file_path).is_absolute():
        return False
    win = PureWindowsPath(file_path)
    if win.drive or win.root or win.anchor or ".." in win.parts:
        return False
    for segment in file_path.split("/"):
        if segment in ("", ".", ".."):
            return False
        if not _SEGMENT.fullmatch(segment):
            return False
        if segment.startswith(".") or segment.endswith((".", " ")):
            return False
        if _RESERVED.match(segment) or _SHORT_NAME.search(segment):
            return False
    return True


def _inside(path: Path, root: Path) -> bool:
    return path == root or path.is_relative_to(root)


def safe_asset_path(base_dir: Path, file_path: str) -> Path | None:
    """The file under `base_dir` that `file_path` names, or None (refused, or not a file). The lexical check runs
    before ANY filesystem call; then the joined path is resolved (following links) and must still sit inside
    `base_dir`, no component on the way may be a link or junction that leads outside it, and it must be a file."""
    if not is_safe_relative_name(file_path):
        return None
    try:
        root = Path(os.path.realpath(base_dir))
        joined = root.joinpath(*file_path.split("/"))
        candidate = joined.resolve(strict=False)
        if not _inside(candidate, root) or not _inside(Path(os.path.realpath(candidate)), root):
            return None
        # A symlink / junction anywhere on the way must itself point inside the folder.
        step = root
        for segment in file_path.split("/"):
            step = step / segment
            is_link = step.is_symlink() or (hasattr(step, "is_junction") and step.is_junction())
            if is_link and not _inside(Path(os.path.realpath(step)), root):
                return None
        if not candidate.is_file():
            return None
    except (OSError, ValueError, RuntimeError):
        return None
    return candidate
