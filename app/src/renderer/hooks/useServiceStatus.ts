import { useState, useEffect, useRef } from "react";
import type { ServiceStatusData } from "../types";

export function useServiceStatus() {
  const [statuses, setStatuses] = useState<Map<string, ServiceStatusData>>(new Map());
  const subscribed = useRef(false);

  useEffect(() => {
    window.api.getStatuses().then((list) => {
      const map = new Map<string, ServiceStatusData>();
      for (const s of list) map.set(s.service, s);
      setStatuses(map);
    }).catch(() => {});

    if (!subscribed.current) {
      subscribed.current = true;
      window.api.onServiceStatus((data) => {
        setStatuses((prev) => {
          const next = new Map(prev);
          next.set(data.service, data);
          return next;
        });
      });
    }
  }, []);

  return statuses;
}
