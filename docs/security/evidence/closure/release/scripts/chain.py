"""Parse revision/down_revision from every migration file and check the chain is linear with one head."""
import ast
import pathlib
import sys

vdir = pathlib.Path(sys.argv[1])
revs = {}
for f in sorted(vdir.glob("*.py")):
    tree = ast.parse(f.read_text(encoding="utf-8"))
    vals = {}
    for node in tree.body:
        targets = []
        if isinstance(node, ast.Assign):
            targets = [t.id for t in node.targets if isinstance(t, ast.Name)]
            value = node.value
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            targets = [node.target.id]
            value = node.value
        for t in targets:
            if t in ("revision", "down_revision"):
                vals[t] = ast.literal_eval(value)
    if "revision" not in vals:
        print("NO REVISION IN", f.name)
        continue
    revs[vals["revision"]] = (vals.get("down_revision"), f.name)

print("migration files:", len(list(vdir.glob("*.py"))), "revisions:", len(revs))
children = {}
roots = []
for r, (d, _) in revs.items():
    downs = d if isinstance(d, (tuple, list)) else ([d] if d else [])
    if not downs:
        roots.append(r)
    for x in downs:
        if x not in revs:
            print("MISSING PARENT", x, "for", r)
        children.setdefault(x, []).append(r)
merges = [r for r, (d, _) in revs.items() if isinstance(d, (tuple, list)) and len(d) > 1]
branches = {k: v for k, v in children.items() if len(v) > 1}
heads = [r for r in revs if r not in children]
print("roots:", roots)
print("heads:", heads)
print("merge revisions:", merges)
print("branch points:", branches)
# walk from root
order = []
cur = roots[0] if len(roots) == 1 else None
while cur:
    order.append(cur)
    nxt = children.get(cur, [])
    cur = nxt[0] if len(nxt) == 1 else None
print("linear walk length:", len(order), "of", len(revs))
for i, r in enumerate(order, 1):
    print(f"{i:3d} {r} {revs[r][1]}")
ok = len(roots) == 1 and len(heads) == 1 and not merges and not branches and len(order) == len(revs)
print("LINEAR_SINGLE_HEAD:", ok, "HEAD:", heads[0] if len(heads) == 1 else heads)
