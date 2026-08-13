// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { Button } from "./button";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogFooter } from "./alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./dialog";
import { EmptyState } from "../EmptyState";
import { Inbox } from "lucide-react";
import { i18n } from "@/i18n";
import en from "@/i18n/locales/en.json";
import zhTW from "@/i18n/locales/zh-TW.json";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
  flushSync(() => {
    void i18n.changeLanguage("en");
  });
});

function render(node: React.ReactNode) {
  flushSync(() => root.render(node));
}

function setLocale(locale: string) {
  flushSync(() => {
    void i18n.changeLanguage(locale);
  });
}

// Radix renders dialog content through a portal, so it lands on document.body
// rather than inside our container.
function portalText(slot: string) {
  return document.body.querySelector(`[data-slot="${slot}"]`)?.textContent;
}

it("Button renders pre-translated children unchanged", () => {
  render(<Button>Ship it</Button>);
  expect(container.querySelector("button")!.textContent).toBe("Ship it");
});

it("Button resolves translationKey and follows locale changes", () => {
  render(<Button translationKey="common.save" />);
  expect(container.querySelector("button")!.textContent).toBe(en.common.save);

  setLocale("zh-TW");
  expect(container.querySelector("button")!.textContent).toBe(zhTW.common.save);
});

it("Button children win over translationKey", () => {
  render(<Button translationKey="common.save">Publish</Button>);
  expect(container.querySelector("button")!.textContent).toBe("Publish");
});

// asChild forwards props onto a caller-owned element, so a string label would
// break Slot's single-child contract. The key must be ignored, not rendered.
it("Button ignores translationKey when asChild is set", () => {
  render(
    <Button asChild translationKey="common.save">
      <a href="/x">Link text</a>
    </Button>,
  );
  const anchor = container.querySelector("a")!;
  expect(anchor.textContent).toBe("Link text");
});

function renderAlertDialogCancel(children?: React.ReactNode) {
  render(
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogFooter>
          <AlertDialogCancel>{children}</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>,
  );
}

it("AlertDialogCancel defaults to common.cancel with no children", () => {
  renderAlertDialogCancel();
  expect(portalText("alert-dialog-cancel")).toBe(en.common.cancel);

  setLocale("zh-TW");
  expect(portalText("alert-dialog-cancel")).toBe(zhTW.common.cancel);
});

it("AlertDialogCancel still honours explicit children", () => {
  renderAlertDialogCancel("Keep editing");
  expect(portalText("alert-dialog-cancel")).toBe("Keep editing");
});

it("DialogTitle and DialogDescription resolve translationKey", () => {
  render(
    <Dialog open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle translationKey="common.confirm" />
          <DialogDescription translationKey="common.loading" />
        </DialogHeader>
      </DialogContent>
    </Dialog>,
  );
  expect(portalText("dialog-title")).toBe(en.common.confirm);
  expect(portalText("dialog-description")).toBe(en.common.loading);

  setLocale("zh-TW");
  expect(portalText("dialog-title")).toBe(zhTW.common.confirm);
  expect(portalText("dialog-description")).toBe(zhTW.common.loading);
});

// The X button label lives inside the primitive, so every dialog in the app
// gets it translated without the caller doing anything.
it("DialogContent translates its built-in close label", () => {
  render(
    <Dialog open>
      <DialogContent>
        <DialogTitle>Title</DialogTitle>
      </DialogContent>
    </Dialog>,
  );
  expect(document.body.textContent).toContain(en.common.close);

  setLocale("zh-TW");
  expect(document.body.textContent).toContain(zhTW.common.close);
});

it("EmptyState resolves *Key props and keeps plain string props working", () => {
  render(<EmptyState icon={Inbox} message="Nothing here" actionKey="common.create" onAction={() => {}} />);
  expect(container.textContent).toContain("Nothing here");
  expect(container.querySelector("button")!.textContent).toContain(en.common.create);

  setLocale("zh-TW");
  expect(container.querySelector("button")!.textContent).toContain(zhTW.common.create);
});
