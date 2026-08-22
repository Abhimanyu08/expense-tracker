import * as React from 'react'
import { cn } from '@/web/lib/utils'

function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      className={cn(
        'flex select-none items-center gap-2 text-sm font-medium leading-none',
        className,
      )}
      {...props}
    />
  )
}

export { Label }
