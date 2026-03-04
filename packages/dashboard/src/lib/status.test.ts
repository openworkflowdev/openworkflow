import {
  getRunStatusConfig,
  getStatusBadgeClass,
  getStatusColor,
  getStatusStatCardClass,
  getStatusStatIconClass,
} from "./status";
import { describe, expect, it } from "vitest";

describe("status ui config", () => {
  it("uses warning styles for pending across text, badge, and stats card", () => {
    expect(getStatusColor("pending")).toBe("text-warning");
    expect(getStatusBadgeClass("pending")).toBe(
      "bg-warning/10 border-warning/20 text-warning",
    );
    expect(getStatusStatCardClass("pending")).toBe(
      "bg-warning/10 ring-warning/20",
    );
    expect(getStatusStatIconClass("pending")).toBe("text-warning/80");
  });

  it("keeps deprecated succeeded visually aligned with completed", () => {
    const completedConfig = getRunStatusConfig("completed");
    const succeededConfig = getRunStatusConfig("succeeded");

    expect(succeededConfig.color).toBe(completedConfig.color);
    expect(succeededConfig.badgeClass).toBe(completedConfig.badgeClass);
    expect(succeededConfig.statCardClass).toBe(completedConfig.statCardClass);
    expect(succeededConfig.label).toBe(completedConfig.label);
  });

  it("falls back to pending styles for unknown statuses", () => {
    const unknownConfig = getRunStatusConfig("unknown-status");

    expect(unknownConfig.label).toBe("Pending");
    expect(getStatusColor("unknown-status")).toBe("text-warning");
    expect(getStatusBadgeClass("unknown-status")).toBe(
      "bg-warning/10 border-warning/20 text-warning",
    );
    expect(getStatusStatCardClass("unknown-status")).toBe(
      "bg-warning/10 ring-warning/20",
    );
  });
});
