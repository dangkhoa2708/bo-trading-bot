import { describe, expect, it } from "vitest";
import {
  formatDurationParts,
  formatPancakeCountdownSignalSnippetHtml,
  isPancakeRoundBettableAt,
  phaseFromRoundWallClock,
} from "../src/pancakeswap/predictionCountdown.js";

describe("pancakeswap predictionCountdown", () => {
  it("formatDurationParts", () => {
    expect(formatDurationParts(0)).toBe("0s");
    expect(formatDurationParts(45)).toBe("45s");
    expect(formatDurationParts(90)).toBe("1m 30s");
  });

  it("phaseFromRoundWallClock: zero start → ended", () => {
    const r = phaseFromRoundWallClock(1000, 0, 1100, 1200);
    expect(r.phase).toBe("ended");
    expect(r.secondsRemaining).toBe(0);
  });

  it("isPancakeRoundBettableAt matches strict contract bounds", () => {
    expect(isPancakeRoundBettableAt(1000, 1000, 1100)).toBe(false);
    expect(isPancakeRoundBettableAt(1001, 1000, 1100)).toBe(true);
    expect(isPancakeRoundBettableAt(1100, 1000, 1100)).toBe(false);
  });

  it("phaseFromRoundWallClock: pending at round start boundary", () => {
    const r = phaseFromRoundWallClock(1000, 1000, 1100, 1200);
    expect(r.phase).toBe("pending");
    expect(r.secondsRemaining).toBe(1);
  });

  it("phaseFromRoundWallClock: betting before lock", () => {
    const r = phaseFromRoundWallClock(1005, 1000, 1100, 1200);
    expect(r.phase).toBe("betting");
    expect(r.secondsRemaining).toBe(95);
  });

  it("phaseFromRoundWallClock: lock window", () => {
    const r = phaseFromRoundWallClock(1150, 1000, 1100, 1200);
    expect(r.phase).toBe("lock");
    expect(r.secondsRemaining).toBe(50);
  });

  it("phaseFromRoundWallClock: after close", () => {
    const r = phaseFromRoundWallClock(1300, 1000, 1100, 1200);
    expect(r.phase).toBe("ended");
    expect(r.secondsRemaining).toBe(0);
  });

  it("formatPancakeCountdownSignalSnippetHtml: betting", () => {
    const html = formatPancakeCountdownSignalSnippetHtml({
      ok: true,
      epoch: 99n,
      phase: "betting",
      secondsRemaining: 125,
      headline: "x",
      startTimestamp: 0,
      lockTimestamp: 0,
      closeTimestamp: 0,
      fetchedAtSec: 0,
    });
    expect(html).toContain("99");
    expect(html).toContain("betting");
    expect(html).toContain("2m 5s");
    expect(html).toContain("lock");
  });

  it("formatPancakeCountdownSignalSnippetHtml: error", () => {
    const html = formatPancakeCountdownSignalSnippetHtml({
      ok: false,
      message: "rpc down",
    });
    expect(html).toContain("unavailable");
    expect(html).toContain("rpc down");
  });
});
