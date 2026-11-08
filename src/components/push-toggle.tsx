"use client";

import { useEffect, useState, useTransition } from "react";
import {
  removePushSubscription,
  savePushSubscription,
  sendTestPush,
} from "@/app/(app)/profile/push-actions";

type Status =
  "checking" | "unsupported" | "install-first" | "blocked" | "off" | "on";

function keyBytes(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function describeDevice() {
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : "Browser";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "";
  return browser ? `${device} · ${browser}` : device;
}

function isIos() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

function isInstalled() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

export function PushToggle({ publicKey }: { publicKey: string | null }) {
  const [status, setStatus] = useState<Status>("checking");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let next: Status;
      if (!publicKey) next = "unsupported";
      else if (isIos() && !isInstalled()) next = "install-first";
      else if (
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      )
        next = "unsupported";
      else if (Notification.permission === "denied") next = "blocked";
      else {
        const registration = await navigator.serviceWorker.getRegistration("/");
        const subscription = await registration?.pushManager.getSubscription();
        next = subscription ? "on" : "off";
      }
      if (!cancelled) setStatus(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  function turnOn() {
    setMessage(null);
    start(async () => {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "blocked" : "off");
        return;
      }
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });
        await navigator.serviceWorker.ready;
        const subscription =
          (await registration.pushManager.getSubscription()) ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: keyBytes(publicKey!),
          }));
        const json = subscription.toJSON();
        const result = await savePushSubscription({
          endpoint: json.endpoint,
          keys: json.keys,
          device: describeDevice(),
        });
        if (result.error) return setMessage(result.error);
        setStatus("on");
        setMessage("Notifications are on for this device.");
      } catch {
        setMessage(
          "This browser wouldn't turn on notifications. Please try again.",
        );
      }
    });
  }

  function turnOff() {
    setMessage(null);
    start(async () => {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await removePushSubscription(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setStatus("off");
    });
  }

  function test() {
    setMessage(null);
    start(async () => {
      const result = await sendTestPush();
      setMessage(result.error ?? "Sent. It should appear in a few seconds.");
    });
  }

  return (
    <div className="space-y-3">
      {status === "checking" && (
        <p className="text-sm text-muted">Checking this device...</p>
      )}
      {status === "unsupported" && (
        <p className="text-sm text-muted">
          This browser can&apos;t get notifications. Try Chrome, Edge, Firefox
          or Safari.
        </p>
      )}
      {status === "install-first" && (
        <div className="space-y-1 text-sm">
          <p className="font-medium">
            On iPhone and iPad, add GYMX2 to your Home Screen first.
          </p>
          <p className="text-muted">
            In Safari, tap the Share button, then{" "}
            <strong>Add to Home Screen</strong>. Open GYMX2 from the new icon
            and come back here to turn notifications on.
          </p>
        </div>
      )}
      {status === "blocked" && (
        <p className="text-sm text-muted">
          Notifications are blocked for GYMX2 in this browser&apos;s settings.
          Allow them there, then reload this page.
        </p>
      )}
      {status === "off" && (
        <button
          type="button"
          onClick={turnOn}
          disabled={pending}
          className="btn-primary"
        >
          {pending ? "Turning on..." : "Turn on notifications"}
        </button>
      )}
      {status === "on" && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={test}
            disabled={pending}
            className="btn-secondary"
          >
            Send a test
          </button>
          <button
            type="button"
            onClick={turnOff}
            disabled={pending}
            className="btn-secondary"
          >
            Turn off on this device
          </button>
        </div>
      )}
      {message && (
        <p role="status" className="text-sm text-muted">
          {message}
        </p>
      )}
    </div>
  );
}
