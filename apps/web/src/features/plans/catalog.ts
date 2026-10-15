/** Published allowances. Checkout availability comes from the API. */
export const plans = [
  {
    code: "free",
    name: "Early access",
    monthlyPriceInr: 0,
    dailyCredits: 100,
    description: "Free while early access is open.",
    available: true,
  },
  {
    code: "starter",
    name: "Starter",
    monthlyPriceInr: 99,
    dailyCredits: 300,
    description: "For a regular stream of small batches.",
    available: false,
  },
  {
    code: "growth",
    name: "Growth",
    monthlyPriceInr: 199,
    dailyCredits: 700,
    description: "For sellers shipping throughout the day.",
    available: false,
  },
  {
    code: "scale",
    name: "Scale",
    monthlyPriceInr: 299,
    dailyCredits: 1200,
    description: "For larger daily dispatch operations.",
    available: false,
  },
] as const;
