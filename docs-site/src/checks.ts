// maxpylang's checks for code the reader edits.
//
// When the reader runs edited code, it is compiled in the browser by web's Python worker
// (web/src/compiler/pyodide-worker.ts), which returns only the patch. maxpylang's warnings
// would be lost there. So the code is wrapped before it is sent, without changing the
// worker:
//
//   - it runs exactly as written (errors still point at the reader's own lines, in a file
//     named "<your code>"),
//   - every UnknownObjectWarning and ConnectionWarning it raises is recorded,
//   - then the patch it saved gets the checks save() would run (cords, and the shape of
//     the patch: GraphWarning), which the worker skips because it captures save(),
//   - and the warnings ride back on the patch JSON, under WARNINGS_KEY.
//
// The patch still plays: Max keeps a cord like that and only warns, and so does this page.

export const WARNINGS_KEY = '__reference_warnings';

const CHECKED = ['UnknownObjectWarning', 'ConnectionWarning', 'GraphWarning'];

/** Python that runs `source` and attaches maxpylang's warnings to the patch it saves. */
export function wrapForChecks(source: string): string {
  // JSON string escapes are valid Python string escapes, so this is a safe literal.
  const literal = JSON.stringify(source);
  return `import warnings as _rw, io as _rio, contextlib as _rcl, maxpylang as _rmp
_r_saved = []
_r_get_json = _rmp.MaxPatch.get_json
def _r_capture(self, *a, **k):
    d = _r_get_json(self, *a, **k)
    _r_saved.append((self, d))
    return d
_rmp.MaxPatch.get_json = _r_capture
try:
    with _rw.catch_warnings(record=True) as _r_log:
        _rw.simplefilter("always")
        exec(compile(${literal}, "<your code>", "exec"), globals())
        for _r_patch, _r_dict in _r_saved[:1]:
            with _rcl.redirect_stdout(_rio.StringIO()):
                _r_patch.check()
    _r_found = []
    for _r_w in _r_log:
        _r_line = f"{_r_w.category.__name__}: {str(_r_w.message).splitlines()[0]}"
        if _r_w.category.__name__ in ${JSON.stringify(CHECKED)} and _r_line not in _r_found:
            _r_found.append(_r_line)
    for _r_patch, _r_dict in _r_saved:
        _r_dict[${JSON.stringify(WARNINGS_KEY)}] = _r_found
finally:
    _rmp.MaxPatch.get_json = _r_get_json
`;
}

/** The warnings a wrapped run attached to its patch, removed from the patch. */
export function takeWarnings(patch: unknown): string[] {
  const p = patch as Record<string, unknown> | null;
  const found = p && Array.isArray(p[WARNINGS_KEY]) ? (p[WARNINGS_KEY] as string[]) : [];
  if (p) delete p[WARNINGS_KEY];
  return found;
}
