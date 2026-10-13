"use client";

import { useEffect, useState } from "react";
import {
  decidePushReconcileAction,
  toSubscriptionPayload,
  urlBase64ToUint8Array,
  type PushSubscriptionPayload,
} from "@/lib/push/client";

type ButtonState = "idle" | "requesting" | "enabled" | "denied" | "unsupported" | "error";

function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

async function postSubscription(payload: PushSubscriptionPayload): Promise<void> {
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error("Failed to store push subscription");
  }
}

/** Subscribes via the Push API and stores the result — shared by the manual
 * button click and the automatic on-mount re-subscribe (Critical 2). */
async function subscribeAndStore(vapidPublicKey: string): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });

  const payload = toSubscriptionPayload(subscription);
  if (!payload) {
    throw new Error("Subscription missing endpoint or keys");
  }
  await postSubscription(payload);
}

/**
 * Requests Notification permission, subscribes via the browser's Push API
 * using the service worker registered in app/layout.tsx, and posts the
 * resulting subscription to `POST /api/push/subscribe` (Task 7) in the
 * exact `{ endpoint, keys: { p256dh, auth } }` shape that route expects —
 * the same shape `PushSubscription.toJSON()` produces.
 *
 * On mount, when permission is already `"granted"`, this also reconciles
 * with whatever the Push API itself reports (Critical 2's fix) rather than
 * trusting the OS permission flag alone: a dead/missing subscription is
 * re-created automatically, and a still-live local subscription is re-POSTed
 * (cheap and idempotent) in case the server-side row was cleaned up by
 * `lib/push/send.ts` without the browser ever finding out. Without this, a
 * subscription that goes stale once leaves the UI claiming "Notifications
 * enabled" forever with no real subscription behind it.
 */
export default function EnableNotificationsButton() {
  const [state, setState] = useState<ButtonState>("idle");

  useEffect(() => {
    if (!isPushSupported()) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    if (Notification.permission !== "granted") {
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const existingSubscription = await registration.pushManager.getSubscription();
        const action = decidePushReconcileAction("granted", existingSubscription);

        if (action.kind === "post-existing") {
          try {
            await postSubscription(action.payload);
          } catch (error) {
            // Best-effort: the subscription is still valid locally either
            // way, so a transient failure to re-sync the server-side row
            // shouldn't flip the UI to an error state the user didn't
            // trigger. The next mount (or the next dead-subscription cycle)
            // gets another chance.
            console.error(
              "EnableNotificationsButton: failed to re-sync existing subscription with the server",
              error,
            );
          }
          if (!cancelled) {
            setState("enabled");
          }
          return;
        }

        // action.kind === "resubscribe" — permission is granted but there is
        // no live subscription (e.g. the OS/browser silently invalidated
        // it) — re-subscribe automatically instead of leaving Callum stuck
        // on a UI that claims "enabled" with nothing behind it.
        const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
        if (!vapidPublicKey) {
          console.error(
            "EnableNotificationsButton: NEXT_PUBLIC_VAPID_PUBLIC_KEY is not configured",
          );
          if (!cancelled) {
            setState("error");
          }
          return;
        }

        await subscribeAndStore(vapidPublicKey);
        if (!cancelled) {
          setState("enabled");
        }
      } catch (error) {
        console.error(
          "EnableNotificationsButton: failed to reconcile push subscription on mount",
          error,
        );
        if (!cancelled) {
          setState("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function enableNotifications() {
    setState("requesting");

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "idle");
        return;
      }

      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) {
        console.error("EnableNotificationsButton: NEXT_PUBLIC_VAPID_PUBLIC_KEY is not configured");
        setState("error");
        return;
      }

      await subscribeAndStore(vapidPublicKey);
      setState("enabled");
    } catch (error) {
      console.error("EnableNotificationsButton: failed to enable notifications", error);
      setState("error");
    }
  }

  if (state === "unsupported") {
    return null;
  }

  if (state === "enabled") {
    return (
      <p style={{ fontSize: 13, color: "#6b7280", margin: 0 }}>Notifications enabled</p>
    );
  }

  if (state === "denied") {
    return (
      <p style={{ fontSize: 13, color: "#6b7280", margin: 0 }}>
        Notifications blocked — enable them for this site in your browser settings.
      </p>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={enableNotifications}
        disabled={state === "requesting"}
        style={{
          backgroundColor: "#111827",
          color: "#ffffff",
          border: "none",
          borderRadius: 8,
          padding: "10px 14px",
          fontSize: 14,
          fontWeight: 600,
          opacity: state === "requesting" ? 0.6 : 1,
        }}
      >
        {state === "requesting" ? "Enabling…" : "Enable notifications"}
      </button>
      {state === "error" ? (
        <p role="alert" style={{ color: "#b42318", fontSize: 13, margin: "8px 0 0" }}>
          Couldn&apos;t enable notifications — try again.
        </p>
      ) : null}
    </div>
  );
}
