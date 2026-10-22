import { useQuery } from '@tanstack/react-query';
import { activeQuery, environmentQuery } from '@/lib/query';
import { Panel, RunProgress, Status } from './common';

export function ActiveDeviceProgress({
  scheduledOnly = false,
}: {
  scheduledOnly?: boolean;
}) {
  const active = useQuery(activeQuery);
  const environment = useQuery(environmentQuery);
  const devices = Object.entries(active.data ?? {}).filter(
    ([, progress]) => !scheduledOnly || progress.scheduled === true,
  );
  if (devices.length === 0) return null;
  return (
    <Panel title="正在执行的设备步骤">
      <div className="space-y-4">
        {devices.map(([serial, progress]) => {
          const model =
            environment.data?.devices.find((device) => device.serial === serial)
              ?.model ?? serial;
          return (
            <div key={serial}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">{model}</p>
                <Status value="running" />
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
                {progress.message}
              </p>
              <RunProgress run={{ model, status: 'running', progress }} />
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
