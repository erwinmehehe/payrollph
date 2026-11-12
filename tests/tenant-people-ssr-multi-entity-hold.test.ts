import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { multiEntityHcmDeferred } from "../src/lib/multi-entity-hcm-hold";

const PEOPLE_PAGES = [
  "src/app/app/engagement/page.tsx",
  "src/app/app/goals-reviews/page.tsx",
] as const;

test("People SSR hold follows the exact-true multi-entity release flag", () => {
  assert.equal(multiEntityHcmDeferred({ MULTI_ENTITY_ENABLED: "true" }), true);
  for (const value of [undefined, "", "false", "TRUE", "True", "1", " true "]) {
    assert.equal(
      multiEntityHcmDeferred({ MULTI_ENTITY_ENABLED: value }),
      false,
      "Only the exact enabled value should trigger the existing HCM embargo",
    );
  }
});

for (const file of PEOPLE_PAGES) {
  test(`${file} enforces the HCM multi-entity embargo before private reads`, () => {
    const source = readFileSync(file, "utf8");
    assert.match(
      source,
      /import \{ multiEntityHcmDeferred \} from "@\/lib\/multi-entity-hcm-hold";/,
      "The page must use the existing centrally defined HCM hold",
    );

    const entry = source.indexOf("export default async function Page(");
    const hold = source.indexOf("if (multiEntityHcmDeferred()) notFound();", entry);
    const firstSessionRead = source.indexOf("await getSessionUser()", entry);
    const existingEntityCheck = source.indexOf("await singleLegalEntityForTenant(", entry);
    assert.ok(entry >= 0 && hold > entry, "The hold must execute in the SSR entrypoint");
    assert.ok(firstSessionRead > hold, "Refuse before reading the account session");
    assert.ok(existingEntityCheck > hold, "Refuse before legal-employer metadata reads");
    assert.ok(source.includes("canonicalPeoplePageOrganizationId(raw)"),
      "Keep the pre-existing canonical employer selector");
  });
}
