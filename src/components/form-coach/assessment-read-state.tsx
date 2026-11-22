export function AssessmentReadState({
  kind,
}: {
  kind: "not_found" | "not_authorized" | "unavailable";
}) {
  const unavailable = kind === "unavailable";
  return (
    <section
      role={unavailable ? "alert" : "status"}
      className={`rounded-xl border bg-surface p-5 ${unavailable ? "border-danger/50" : "border-border"}`}
    >
      <h2 className="text-2xl">
        {unavailable ? "Assessment data unavailable" : "Assessment not available"}
      </h2>
      <p className="mt-2 text-sm text-muted">
        {unavailable
          ? "We couldn’t load this Form Coach information. Please try again later."
          : "This assessment could not be found or isn’t available to this account."}
      </p>
    </section>
  );
}
