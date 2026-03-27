export type Candle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type SetupType = "Momentum" | "Exhaustion" | "Mirror" | "None";

export type StrategyResult = {
  signal: "UP" | "DOWN" | "NONE";
  setup: SetupType;
  reason: string;
};
