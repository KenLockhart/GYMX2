export type FormCoachOfferTitleCopy = Readonly<{
  monthlyPlan: string;
  annualPlan: string;
  assessmentPack: (count: number) => string;
  oneTimePurchase: string;
}>;

export function getFormCoachOfferTitle(
  offer: Readonly<{ interval: "month" | "year" | null; creditsPerPack: number | null }>,
  copy: FormCoachOfferTitleCopy,
): string {
  if (offer.interval === "month") return copy.monthlyPlan;
  if (offer.interval === "year") return copy.annualPlan;
  if (offer.creditsPerPack !== null) return copy.assessmentPack(offer.creditsPerPack);
  return copy.oneTimePurchase;
}
