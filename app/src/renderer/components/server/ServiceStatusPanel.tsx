import type { ServiceStatusData } from "../../types";
import { ServiceRow } from "./ServiceRow";
import "../../styles/services.css";

const services = [
  { key: "MQTT Broker", label: "MQTT" },
  { key: "LM Studio", label: "AI" },
  { key: "Wrapper Server", label: "Host" },
];

interface ServiceStatusPanelProps {
  statuses: Map<string, ServiceStatusData>;
}

export function ServiceStatusPanel({ statuses }: ServiceStatusPanelProps) {
  return (
    <section className="services">
      <h2>Services</h2>
      <div className="service-list">
        {services.map((s) => {
          const data = statuses.get(s.key);
          return (
            <ServiceRow
              key={s.key}
              name={s.label}
              status={data?.status || "stopped"}
              detail={data?.detail || data?.status || "stopped"}
            />
          );
        })}
      </div>
    </section>
  );
}
