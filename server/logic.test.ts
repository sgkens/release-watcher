import { describe, expect, test } from "bun:test";
import { compare, normalise } from "./version";
import { parse } from "./resolve";

describe("normalise", () => {
  test.each([
    ["v1.2.3", null, "1.2.3"],
    ["1.2.3", null, "1.2.3"],
    ["release-1.4.0", null, "1.4.0"],
    ["v2.0.0-rc.1", null, "2.0.0-rc.1"],
    ["@scope/pkg@1.2.3", "@scope/pkg@", "1.2.3"],
    ["core-v0.9.1", "core-v", "0.9.1"],
    ["other@1.0.0", "core@", null],
  ])("%s (prefix %s) -> %s", (raw, prefix, out) => {
    expect(normalise(raw, prefix)).toBe(out);
  });
});

test("compare orders prerelease below release", () => {
  expect(["1.0.0", "1.0.0-rc.1", "0.9.9", "1.10.0"].sort(compare)).toEqual(["0.9.9", "1.0.0-rc.1", "1.0.0", "1.10.0"]);
});

describe("manifest parse", () => {
  test("package.json public + workspaces", () => {
    const r = parse("package.json", JSON.stringify({ name: "foo", workspaces: ["packages/*"] }));
    expect(r.candidates[0]).toMatchObject({ registry: "npm", name: "foo" });
    expect(r.members).toEqual(["packages/*"]);
  });
  test("private package.json is skipped", () => {
    expect(parse("package.json", JSON.stringify({ name: "root", private: true })).candidates).toEqual([]);
  });
  test("deno.jsonc with comments -> jsr", () => {
    const r = parse("deno.jsonc", `{ // c\n "name": "@me/lib", "version": "1.0.0", }`);
    expect(r.candidates[0]).toMatchObject({ registry: "jsr", name: "@me/lib" });
  });
  test("Cargo.toml package + workspace", () => {
    const r = parse("Cargo.toml", `[package]\nname = "mycrate"\n[workspace]\nmembers = ["crates/*"]\n`);
    expect(r.candidates[0]).toMatchObject({ registry: "crates", name: "mycrate" });
    expect(r.members).toEqual(["crates/*"]);
  });
  test("Cargo.toml publish = false skipped", () => {
    expect(parse("Cargo.toml", `[package]\nname = "x"\npublish = false\n`).candidates).toEqual([]);
  });
  test("pyproject PEP 621", () => {
    expect(parse("pyproject.toml", `[project]\nname = "pkg"\n`).candidates[0]).toMatchObject({ registry: "pypi", name: "pkg" });
  });
});
