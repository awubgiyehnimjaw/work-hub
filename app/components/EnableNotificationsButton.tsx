"use client";

import { useEffect, useState } from "react";
import { urlBase64ToUint8Array } from "@/lib/push/client";

type ButtonState = "idle" | "requesting" | "enabled" | "denied" | "unsupported" | "error";

/**
 * Requests Notification permission, subscribes via the browser's Push API
 * using the service worker registered in app/layout.tsx, and posts the
 * resulting subscription to `POST /api/push/subscribe` (Task 7) in the
 * exact `{ endpoint, keys: { p256dh, auth } }` shape that route expects —
 * the same shape `PushSubscription.toJSON()` produces.
 */
export default function EnableNotificationsButton() {
  const [state, setState] = useState<ButtonState>("idle");

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("Notification" in window) ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
    } else if (Notification.permission === "granted") {
      setState("enabled");
    }
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

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error("Subscription missing endpoint or keys");
      }

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        }),
      });
      if (!res.ok) {
        throw new Error("Failed to store push subscription");
      }

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
