// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageToggle } from "./LanguageToggle";

const mockToggleLocale = vi.hoisted(() => vi.fn());
const mockLocale = vi.hoisted(() => ({ value: "en" as "en" | "zh-TW" }));

vi.mock("../context/LanguageContext", () => ({
  useLanguage: () => ({
    locale: mockLocale.value,
    toggleLocale: mockToggleLocale,
  }),
}));

// The toggle's aria-label always points at the *other* language — the label
// the user will land on after clicking. We mock t() with a lookup table that
// mirrors the i18n key catalog, so the tests don't depend on the bundle
// having loaded the real locale files.
const I18N_STRINGS: Record<string, string> = {
  "languageToggle.switchToChinese": "Switch to 繁體中文",
  "languageToggle.switchToEnglish": "切換到 English",
  "languageToggle.toggleDescription": "Toggle the interface language.",
};

vi.mock("../i18n", () => ({
  useTranslation: () => ({
    t: (key: string) => I18N_STRINGS[key] ?? key,
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("LanguageToggle", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockLocale.value = "en";
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("renders an icon button by default with the Traditional-Chinese-targeting label when current locale is English", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<LanguageToggle />);
    });
    await flushReact();

    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    expect(button?.getAttribute("aria-label")).toBe("Switch to 繁體中文");
    expect(button?.getAttribute("title")).toBe("Switch to 繁體中文");

    await act(async () => {
      button?.click();
    });
    expect(mockToggleLocale).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
  });

  it("renders a menu-action row when variant='menu-action' and includes the description text", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<LanguageToggle variant="menu-action" />);
    });
    await flushReact();

    expect(container.textContent).toContain("Switch to 繁體中文");
    expect(container.textContent).toContain("Toggle the interface language.");

    await act(async () => root.unmount());
  });

  it("calls onAfterToggle after toggling (used by SidebarAccountMenu to close the popover)", async () => {
    const onAfterToggle = vi.fn();
    const root = createRoot(container);
    await act(async () => {
      root.render(<LanguageToggle variant="menu-action" onAfterToggle={onAfterToggle} />);
    });
    await flushReact();

    const button = container.querySelector("button");
    await act(async () => {
      button?.click();
    });

    expect(mockToggleLocale).toHaveBeenCalledTimes(1);
    expect(onAfterToggle).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
  });

  it("flips the label to the English-targeting copy when current locale is zh-TW", async () => {
    mockLocale.value = "zh-TW";
    const root = createRoot(container);
    await act(async () => {
      root.render(<LanguageToggle variant="menu-action" />);
    });
    await flushReact();

    expect(container.textContent).toContain("切換到 English");
    expect(container.textContent).toContain("Toggle the interface language.");

    await act(async () => root.unmount());
  });
});
