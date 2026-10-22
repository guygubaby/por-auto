import { useId, type Ref } from 'react';
import { FormField } from './common';
import { SelectControl } from './select-control';
import { Checkbox } from './ui/checkbox';
import { Input } from './ui/input';
import {
  scheduleIntervals,
  weekdays,
  type ScheduleTiming,
} from '@/lib/schedule';

export function ScheduleTimingFields({
  value,
  onChange,
  onBlur,
  ref,
}: {
  value: ScheduleTiming;
  onChange: (value: ScheduleTiming) => void;
  onBlur: () => void;
  ref?: Ref<HTMLInputElement>;
}) {
  const scope = useId();
  const options = [
    { value: 'daily', label: '每天' },
    { value: 'weekdays', label: '周一至周五' },
    { value: 'weekly', label: '每周' },
    { value: 'monthly', label: '每月' },
    { value: 'interval', label: '按间隔' },
    ...(value.repeat === 'custom'
      ? [{ value: 'custom', label: '原有规则' }]
      : []),
  ];
  function changeRepeat(repeat: string) {
    const time = 'time' in value ? value.time : '09:00';
    switch (repeat) {
      case 'daily':
      case 'weekdays':
        onChange({ repeat, time });
        break;
      case 'weekly':
        onChange({ repeat, time, days: [1] });
        break;
      case 'monthly':
        onChange({ repeat, time, day: 1 });
        break;
      case 'interval':
        onChange({ repeat, minutes: 60 });
        break;
    }
  }
  return (
    <div className="space-y-4" onBlur={onBlur}>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">重复周期</legend>
        <div className="flex flex-wrap gap-2">
          {options.map((option, index) => (
            <label key={option.value} className="cursor-pointer">
              <input
                ref={index === 0 ? ref : undefined}
                className="peer sr-only"
                type="radio"
                name={`${scope}-repeat`}
                value={option.value}
                checked={value.repeat === option.value}
                onChange={() => changeRepeat(option.value)}
              />
              <span className="border-border text-muted-foreground peer-checked:border-primary peer-checked:bg-primary/10 peer-checked:text-primary peer-focus-visible:ring-ring inline-flex min-h-10 items-center rounded-lg border px-3 text-sm peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2">
                {option.label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {value.repeat === 'weekly' && (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">选择星期</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {[1, 2, 3, 4, 5, 6, 0].map((day) => (
              <label
                key={day}
                className="flex min-h-10 items-center gap-2 text-sm"
              >
                <Checkbox
                  name={`${scope}-days`}
                  checked={value.days.includes(day)}
                  onCheckedChange={(checked) =>
                    onChange({
                      ...value,
                      days: checked
                        ? [...value.days, day]
                        : value.days.filter((d) => d !== day),
                    })
                  }
                />
                {weekdays[day]}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {value.repeat === 'monthly' && (
        <FormField
          label="每月几号"
          hint={
            value.day > 28
              ? '没有这一天的月份会跳过，不会提前或补跑。'
              : undefined
          }
        >
          <SelectControl
            label="每月几号"
            name={`${scope}-day`}
            value={String(value.day)}
            onValueChange={(day) => onChange({ ...value, day: Number(day) })}
            options={Array.from({ length: 31 }, (_, i) => ({
              value: String(i + 1),
              label: `${i + 1} 日`,
            }))}
          />
        </FormField>
      )}
      {'time' in value && (
        <FormField label="执行时间">
          <Input
            type="time"
            name={`${scope}-time`}
            required
            step={60}
            value={value.time}
            onChange={(event) =>
              onChange({ ...value, time: event.target.value })
            }
          />
        </FormField>
      )}
      {value.repeat === 'interval' && (
        <FormField
          label="运行间隔"
          hint="按固定钟点执行，例如每 2 小时在 00:00、02:00、04:00 等时刻运行。"
        >
          <SelectControl
            label="运行间隔"
            name={`${scope}-interval`}
            value={String(value.minutes)}
            onValueChange={(minutes) =>
              onChange({ ...value, minutes: Number(minutes) })
            }
            options={scheduleIntervals.map((minutes) => ({
              value: String(minutes),
              label:
                minutes < 60 ? `每 ${minutes} 分钟` : `每 ${minutes / 60} 小时`,
            }))}
          />
        </FormField>
      )}
      {value.repeat === 'custom' && (
        <p className="text-muted-foreground text-xs leading-5">
          此任务使用已有的特殊时间规则，保存时会原样保留。选择其他重复周期可重新设置时间。
        </p>
      )}
    </div>
  );
}
