export type AdminEventType = "dashboard_changed";

export type AdminEvent = {
  type: AdminEventType;
  reason: string;
  timestamp: string;
};

type AdminEventListener = (event: AdminEvent) => void;

const listeners = new Set<AdminEventListener>();

export function publishAdminEvent(reason: string) {
  const event: AdminEvent = {
    type: "dashboard_changed",
    reason,
    timestamp: new Date().toISOString()
  };

  for (const listener of listeners) {
    listener(event);
  }
}

export function subscribeAdminEvents(listener: AdminEventListener) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}
