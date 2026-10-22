import type { ReactNode, Ref } from 'react';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

export function SelectControl({
  value,
  onValueChange,
  options,
  label,
  placeholder = '请选择',
  disabled,
  id,
  name,
  onBlur,
  ref,
  size = 'default',
  icon,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly { value: string; label: string; disabled?: boolean }[];
  label: string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  onBlur?: () => void;
  ref?: Ref<HTMLButtonElement>;
  size?: 'default' | 'sm';
  icon?: ReactNode;
}) {
  return (
    <Select
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      name={name}
    >
      <SelectTrigger
        ref={ref}
        id={id}
        aria-label={label}
        size={size}
        onBlur={onBlur}
        className={cn(
          'bg-card relative w-full text-left',
          size === 'sm' && 'rounded-lg text-xs',
          icon && 'pl-9',
        )}
      >
        {icon && (
          <span
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute left-3 grid size-4 place-items-center"
          >
            {icon}
          </span>
        )}
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper" align="start" sideOffset={4}>
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
