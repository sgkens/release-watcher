// Version normalisation so a git tag and a registry version can be matched.
//   v1.2.3            -> 1.2.3
//   pkg@1.2.3         -> 1.2.3   (changesets-style monorepo tag)
//   pkg-v1.2.3        -> 1.2.3   (release-please style)
//   release-1.2.3     -> 1.2.3
//   1.2.3+build.5     -> 1.2.3   (build metadata never takes part in matching)

const SEMVERISH = /(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-.+]?([0-9A-Za-z.\-+]*))?$/;

export function normalise(raw: string, prefix?: string | null): string | null {
  let s = raw.trim();
  if (prefix) {
    if (!s.startsWith(prefix)) return null; // tag belongs to another package
    s = s.slice(prefix.length);
  }
  s = s.replace(/^refs\/tags\//, "").replace(/^[vV]/, "");
  const m = s.match(SEMVERISH);
  if (!m) return null;
  // only accept if the version starts the remaining string (after any name/prefix)
  const idx = s.length - m[0].length;
  if (idx > 0 && !/[@\-_/ vV]$/.test(s.slice(0, idx))) return null;
  return m[0].replace(/^[vV]/, "").replace(/\+.*$/, "");
}

/** Split a *normalised* version into numeric core and pre-release part. */
function parts(v: string): { core: number[]; pre: string } {
  const m = v.replace(/\+.*$/, "").match(/^(\d+(?:\.\d+)*)(.*)$/);
  if (!m) return { core: [], pre: v };
  return { core: m[1].split(".").map(Number), pre: m[2].replace(/^[-.]/, "") };
}

/**
 * True for semver pre-releases (1.0.0-rc.1) and PEP 440 ones (1.0.0rc1, 1.0.dev6, 2.0a1).
 * Must be given a normalised version, never a raw tag: tag names like "release-1.2.3"
 * or "devtools@1.0.0" contain hyphens and "dev" without being pre-releases.
 * PEP 440 post-releases (1.0.0.post1) are not pre-releases.
 */
export function isPrerelease(v: string): boolean {
  const { core, pre } = parts(v);
  if (!core.length) return false;
  return pre !== "" && !/^post\d*$/i.test(pre);
}

function comparePre(a: string, b: string): number {
  const xa = a.split("."), xb = b.split(".");
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    if (xa[i] === undefined) return -1; // shorter set of identifiers sorts first
    if (xb[i] === undefined) return 1;
    const na = /^\d+$/.test(xa[i]), nb = /^\d+$/.test(xb[i]);
    if (na && nb) {
      const d = Number(xa[i]) - Number(xb[i]);
      if (d) return d;
    } else if (na !== nb) return na ? -1 : 1; // numeric identifiers sort before alphanumeric
    else {
      const d = xa[i].localeCompare(xb[i], "en", { numeric: true });
      if (d) return d;
    }
  }
  return 0;
}

/** Semver-style ordering; any number of core segments; pre-release sorts before release. */
export function compare(a: string, b: string): number {
  const pa = parts(a), pb = parts(b);
  for (let i = 0; i < Math.max(pa.core.length, pb.core.length, 3); i++) {
    const d = (pa.core[i] ?? 0) - (pb.core[i] ?? 0);
    if (d) return d;
  }
  const ra = isPrerelease(a), rb = isPrerelease(b);
  if (ra !== rb) return ra ? -1 : 1;
  return ra ? comparePre(pa.pre, pb.pre) : 0;
}
