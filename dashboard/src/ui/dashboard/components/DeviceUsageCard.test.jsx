import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DeviceUsageCard } from "./DeviceUsageCard";

const devices = [
  { id: "d1", device_name: "MacBook Pro", platform: "darwin", total_tokens: 600 },
  { id: "d2", device_name: "Mac mini", platform: "darwin", total_tokens: 400 },
];

describe("DeviceUsageCard", () => {
  it("shows each device with its share of total tokens", () => {
    render(<DeviceUsageCard devices={devices} selectedDeviceId="" onSelectDevice={() => {}} />);
    expect(screen.getByText("MacBook Pro")).toBeTruthy();
    expect(screen.getByText("60.0%")).toBeTruthy();
    expect(screen.getByText("40.0%")).toBeTruthy();
  });

  it("selects a device on click and clears it when re-clicked", async () => {
    const onSelectDevice = vi.fn();
    const { rerender } = render(
      <DeviceUsageCard devices={devices} selectedDeviceId="" onSelectDevice={onSelectDevice} />,
    );
    await userEvent.click(screen.getByText("MacBook Pro"));
    expect(onSelectDevice).toHaveBeenCalledWith("d1");

    rerender(<DeviceUsageCard devices={devices} selectedDeviceId="d1" onSelectDevice={onSelectDevice} />);
    await userEvent.click(screen.getByText("MacBook Pro"));
    expect(onSelectDevice).toHaveBeenLastCalledWith("");
  });
});
