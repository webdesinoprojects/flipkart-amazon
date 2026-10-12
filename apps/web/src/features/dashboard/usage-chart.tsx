"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DailyUsage } from "./contracts";
import styles from "./dashboard.module.css";

export function UsageChart({ data }: { readonly data: DailyUsage[] }) {
  const chartData = data.map((entry) => ({
    ...entry,
    label: new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      timeZone: "Asia/Kolkata",
    }).format(new Date(`${entry.date}T12:00:00+05:30`)),
  }));
  return (
    <div className={styles.chartFrame}>
      <ComposedChart
        accessibilityLayer
        data={chartData}
        margin={{ top: 12, right: 10, bottom: 2, left: -22 }}
        responsive
        style={{ width: "100%", height: "100%" }}
      >
        <CartesianGrid stroke="var(--dashboard-line)" vertical={false} />
        <XAxis
          axisLine={false}
          dataKey="label"
          interval="preserveStartEnd"
          tick={{ fill: "var(--dashboard-muted)", fontSize: 9 }}
          tickLine={false}
        />
        <YAxis
          allowDecimals={false}
          axisLine={false}
          tick={{ fill: "var(--dashboard-muted)", fontSize: 9 }}
          tickLine={false}
          width={42}
        />
        <Tooltip
          contentStyle={{
            background: "var(--dashboard-text)",
            border: 0,
            borderRadius: 8,
            color: "var(--dashboard-bg)",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
          }}
          cursor={{ fill: "var(--dashboard-card-soft)" }}
          formatter={(value, name) => [
            Number(value).toLocaleString("en-IN"),
            name === "labels" ? "Labels" : "Batches",
          ]}
        />
        <Bar
          dataKey="labels"
          fill="var(--dashboard-accent)"
          maxBarSize={28}
          radius={[5, 5, 0, 0]}
        />
        <Line
          dataKey="batches"
          dot={false}
          stroke="var(--dashboard-text)"
          strokeWidth={2}
          type="monotone"
        />
      </ComposedChart>
    </div>
  );
}
