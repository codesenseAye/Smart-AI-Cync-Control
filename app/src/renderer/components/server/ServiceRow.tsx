import { StatusDot } from "../StatusDot";

interface ServiceRowProps {
  name: string;
  status: string;
  detail: string;
}

export function ServiceRow({ name, status, detail }: ServiceRowProps) {
  return (
    <div className="service-row">
      <StatusDot status={status} />
      <span className="service-name">{name}</span>
      <span className="service-detail">{detail}</span>
    </div>
  );
}
