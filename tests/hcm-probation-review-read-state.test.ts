import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  isProbationReviewReadEnvelope,
  probationReviewReadActions,
  type ProbationReviewReadEnvelope,
} from "../src/lib/hcm-probation-review-read-state";

const empty: ProbationReviewReadEnvelope = {
  review: null, canManage: true, mutable: true,
};
const draft: ProbationReviewReadEnvelope = {
  review: { status: "draft" }, canManage: true, mutable: true,
};
const submitted: ProbationReviewReadEnvelope = {
  review: { status: "submitted" }, canManage: true, mutable: false,
};

test("unverified/failed probation review reads never authorize opening or editing", () => {
  for (const phase of ["loading", "unavailable"] as const) {
    for (const payload of [null, empty, draft, submitted]) {
      const controls = probationReviewReadActions(phase, payload);
      assert.equal(controls.canOpen, false);
      assert.equal(controls.canEdit, false);
      assert.equal(controls.showReadOnlyDraft, false);
      assert.equal(controls.showSubmitted, false);
    }
  }
  assert.equal(probationReviewReadActions("loading", null).loading, true);
  assert.equal(probationReviewReadActions("unavailable", null).unavailable, true);
  assert.equal(probationReviewReadActions("ready", null).canOpen, false);
});

test("verified empty/draft/submitted reads expose only the appropriate controls", () => {
  assert.deepEqual(probationReviewReadActions("ready", empty), {
    loading: false, unavailable: false, canOpen: true, canEdit: false,
    showReadOnlyDraft: false, showSubmitted: false, showUnavailablePermission: false,
  });
  assert.equal(probationReviewReadActions("ready", draft).canEdit, true);
  assert.equal(probationReviewReadActions("ready", draft).canOpen, false);
  assert.equal(probationReviewReadActions("ready", submitted).showSubmitted, true);
  assert.equal(probationReviewReadActions("ready", submitted).canEdit, false);
  assert.equal(probationReviewReadActions("ready", submitted).canOpen, false);
});

test("authorization downgrade or immutable source cannot expose mutation actions", () => {
  for (const review of [null, { status: "draft" as const }, { status: "submitted" as const }]) {
    for (const [canManage, mutable] of [[false, true], [true, false], [false, false]]) {
      const controls = probationReviewReadActions("ready", { review, canManage, mutable });
      assert.equal(controls.canOpen, false);
      assert.equal(controls.canEdit, false);
    }
  }
  assert.equal(probationReviewReadActions("ready", {
    review: { status: "draft" }, canManage: false, mutable: false,
  }).showReadOnlyDraft, true);
  assert.equal(probationReviewReadActions("ready", {
    review: null, canManage: false, mutable: false,
  }).showUnavailablePermission, true);
});

test("malformed success bodies do not become a verified empty review", () => {
  for (const bad of [
    undefined, null, [], "", {}, { review: undefined, canManage: true, mutable: true },
    { canManage: true, mutable: true },
    { review: [], canManage: true, mutable: true },
    { review: { status: "deleted" }, canManage: true, mutable: true },
    { review: null, canManage: "yes", mutable: true },
    { review: null, canManage: true, mutable: null },
  ]) {
    assert.equal(isProbationReviewReadEnvelope(bad), false);
  }
  for (const good of [empty, draft, submitted]) {
    assert.equal(isProbationReviewReadEnvelope(good), true);
  }
});

test("probation review panel binds buttons and read states to verified source", () => {
  const source = readFileSync("src/components/hcm-probation-review-panel.tsx", "utf8");
  assert.match(source, /isProbationReviewReadEnvelope\(data\)/);
  assert.match(source, /probationReviewReadActions\(readPhase, payload\)/);
  assert.match(source, /\{controls\.canOpen && \(/);
  assert.match(source, /\{controls\.canEdit && \(/);
  assert.match(source, /\{controls\.showSubmitted && review && \(/);
  assert.match(source, /readPhase === "loading"/);
  assert.match(source, /readPhase === "unavailable"/);
  assert.match(source, /signal\?\.aborted/);
  assert.doesNotMatch(source, /\{!review && \(/);
});
