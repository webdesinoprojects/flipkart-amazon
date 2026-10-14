/** Published allowances; only early access is active until checkout launches. */
export const plans = [
  {
    name: "Early access",
    monthlyPriceInr: 0,
    dailyCredits: 100,
    description: "Free while early access is open.",
    available: true,
  },
  {
    name: "Starter",
    monthlyPriceInr: 99,
    dailyCredits: 300,
    description: "For a regular stream of small batches.",
    available: false,
  },
  {
    name: "Growth",
    monthlyPriceInr: 199,
    dailyCredits: 700,
    description: "For sellers shipping throughout the day.",
    available: false,
  },
  {
    name: "Scale",
    monthlyPriceInr: 299,
    dailyCredits: 1200,
    description: "For larger daily dispatch operations.",
    available: false,
  },
] as const;
