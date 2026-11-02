import { createRootRoute } from '@tanstack/react-router';
import { Layout } from '@/components/layout';
import { ErrorMessage } from '@/components/common';
export const Route = createRootRoute({
  component: Layout,
  errorComponent: ({ error }) => (
    <div className="p-8">
      <ErrorMessage error={error} />
    </div>
  ),
});
