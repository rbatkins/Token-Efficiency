import React, { useEffect, useState } from "react";
import { Card } from "../../components";
import { copy } from "../../../lib/copy";
import { getQualityPerDollar } from "../../../lib/api";

// Quality per dollar = accepted outcomes / effective $ (see QUALITY-PER-DOLLAR.md).
// The numerator is an accepted OUTCOME, never lines of code. Outcomes are
// optional; with none, this card invites a backfill rather than showing a number.
export function QualityPerDollarCard() {
  const [state, setState] = useState({ status: "loading", data: null });

  useEffect(() => {
    let alive = true;
    getQualityPerDollar()
      .then((data) => {
        if (alive) setState({ status: "ok", data });
      })
      .catch(() => {
        if (alive) setState({ status: "error", data: null });
      });
    return () => {
      alive = false;
    };
  }, []);

  const title = copy("quality.card.title");
  const subtitle = copy("quality.card.subtitle");

  if (state.status === "loading") {
    return (
      <Card title={title} subtitle={subtitle}>
        <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("quality.card.loading")}</p>
      </Card>
    );
  }

  if (state.status === "error") {
    return (
      <Card title={title} subtitle={subtitle}>
        <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("quality.card.error")}</p>
      </Card>
    );
  }

  const d = state.data || {};
  const accepted = d.numerator?.accepted_outcomes || 0;
  const dpo = d.quality_per_dollar?.dollars_per_accepted_outcome;
  const days = d.window?.days || 0;
  const basisKey = d.denominator?.basis === "subscription" ? "quality.card.basis_sub" : "quality.card.basis_list";

  if (!accepted || dpo == null) {
    return (
      <Card title={title} subtitle={subtitle}>
        <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("quality.card.empty")}</p>
      </Card>
    );
  }

  return (
    <Card title={title} subtitle={subtitle}>
      <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
        <div>
          <div className="font-mono text-3xl font-semibold tabular-nums text-oai-gray-900 dark:text-oai-gray-50">
            {dpo.toFixed(2)}
          </div>
          <div className="mt-1 text-xs uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
            {copy("quality.card.dollars_per_outcome")}
          </div>
        </div>
        <div>
          <div className="font-mono text-3xl font-semibold tabular-nums text-oai-gray-900 dark:text-oai-gray-50">
            {accepted}
          </div>
          <div className="mt-1 text-xs uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
            {copy("quality.card.accepted")}
          </div>
        </div>
      </div>
      <p className="mt-4 text-xs text-oai-gray-400 dark:text-oai-gray-500">
        {copy("quality.card.footnote", { days, basis: copy(basisKey) })}
      </p>
    </Card>
  );
}
