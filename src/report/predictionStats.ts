/** Shared row shape for aggregating predictions from JSONL. */
export type StatsPredictionRow = {
  signalId?: string;
  fromOpenTime: number;
  setup?: string;
  expected: string;
  botExpected?: "UP" | "DOWN";
  humanPick?: "UP" | "DOWN" | null;
  actual: string;
};

export type PredBucket = "Momentum" | "Exhaustion" | "Mirror" | "Other";

export type PredCounts = {
  total: number;
  right: number;
  wrong: number;
  winRatePct: number;
};

export type PredCountsBySetup = Record<PredBucket, PredCounts>;

function emptyCounts(): PredCounts {
  return { total: 0, right: 0, wrong: 0, winRatePct: 0 };
}

function emptyBySetup(): PredCountsBySetup {
  return {
    Momentum: emptyCounts(),
    Exhaustion: emptyCounts(),
    Mirror: emptyCounts(),
    Other: emptyCounts(),
  };
}

export function bucketSetup(setup: string): PredBucket {
  if (setup === "Momentum" || setup === "Exhaustion" || setup === "Mirror") {
    return setup;
  }
  return "Other";
}

function botDirection(p: StatsPredictionRow): "UP" | "DOWN" | null {
  if (p.botExpected === "UP" || p.botExpected === "DOWN") return p.botExpected;
  if (p.expected === "UP" || p.expected === "DOWN") return p.expected;
  return null;
}

function normActual(a: string): "UP" | "DOWN" | "FLAT" {
  if (a === "UP" || a === "DOWN" || a === "FLAT") return a;
  return "FLAT";
}

function scoreVsExpected(
  expected: "UP" | "DOWN",
  actual: "UP" | "DOWN" | "FLAT",
): "RIGHT" | "WRONG" {
  if (actual === "FLAT") return "WRONG";
  return actual === expected ? "RIGHT" : "WRONG";
}

export type DualPredictionSection = PredCounts & { bySetup: PredCountsBySetup };

export type DualPredictionStats = {
  bot: DualPredictionSection;
  myPicks: DualPredictionSection;
};

function finalizeSection(
  bySetup: PredCountsBySetup,
  right: number,
  wrong: number,
): DualPredictionSection {
  const total = right + wrong;
  for (const key of Object.keys(bySetup) as PredBucket[]) {
    const b = bySetup[key];
    b.winRatePct = b.total > 0 ? (b.right / b.total) * 100 : 0;
  }
  return {
    total,
    right,
    wrong,
    winRatePct: total > 0 ? (right / total) * 100 : 0,
    bySetup,
  };
}

/** Bot: every row with a bot direction. My picks: only rows with humanPick set. */
export function buildDualPredictionStats(
  predictions: StatsPredictionRow[],
  setupForRow: (p: StatsPredictionRow) => string,
): DualPredictionStats {
  const botBy = emptyBySetup();
  const myBy = emptyBySetup();
  let botRight = 0;
  let botWrong = 0;
  let myRight = 0;
  let myWrong = 0;

  for (const p of predictions) {
    const bucket = bucketSetup(setupForRow(p));
    const act = normActual(p.actual);

    const bdir = botDirection(p);
    if (bdir !== null) {
      const r = scoreVsExpected(bdir, act);
      const bs = botBy[bucket];
      bs.total++;
      if (r === "RIGHT") {
        bs.right++;
        botRight++;
      } else {
        bs.wrong++;
        botWrong++;
      }
    }

    if (p.humanPick === "UP" || p.humanPick === "DOWN") {
      const r = scoreVsExpected(p.humanPick, act);
      const ms = myBy[bucket];
      ms.total++;
      if (r === "RIGHT") {
        ms.right++;
        myRight++;
      } else {
        ms.wrong++;
        myWrong++;
      }
    }
  }

  return {
    bot: finalizeSection(botBy, botRight, botWrong),
    myPicks: finalizeSection(myBy, myRight, myWrong),
  };
}

export function scoreRowVsBot(
  p: StatsPredictionRow,
): "RIGHT" | "WRONG" | null {
  const bdir = botDirection(p);
  if (bdir === null) return null;
  return scoreVsExpected(bdir, normActual(p.actual));
}

export function scoreRowVsMyPick(
  p: StatsPredictionRow,
): "RIGHT" | "WRONG" | null {
  if (p.humanPick !== "UP" && p.humanPick !== "DOWN") return null;
  return scoreVsExpected(p.humanPick, normActual(p.actual));
}
