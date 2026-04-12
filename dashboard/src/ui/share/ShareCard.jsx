import React, { forwardRef } from "react";
import { BroadsheetCard } from "./variants/BroadsheetCard.jsx";
import { SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT } from "./share-card-constants";

export { SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT };

export const ShareCard = forwardRef(function ShareCard({ data }, ref) {
  return (
    <div
      ref={ref}
      data-share-card="true"
      style={{
        width: SHARE_CARD_WIDTH,
        height: SHARE_CARD_HEIGHT,
        position: "relative",
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      <BroadsheetCard data={data} />
    </div>
  );
});
