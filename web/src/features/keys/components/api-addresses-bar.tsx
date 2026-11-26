/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
} from '@/components/ui/item'
import { useApiInfo } from '@/features/dashboard/hooks/use-status-data'
import { useStatus } from '@/hooks/use-status'
import { cn } from '@/lib/utils'

export function ApiAddressesBar() {
  const { t } = useTranslation()
  const { status, loading } = useStatus()
  const { items } = useApiInfo()
  const serverAddress =
    (typeof status?.server_address === 'string' &&
      status.server_address.trim()) ||
    ''
  const addresses = items.length
    ? items
    : [
        {
          url: serverAddress || window.location.origin,
          route: serverAddress ? t('Default API address') : t('Current domain'),
          description: '',
        },
      ]

  return (
    <section
      aria-label={t('API Addresses')}
      className='bg-card border-border/70 shrink-0 rounded-xl border px-3 py-2.5 shadow-2xs sm:px-4'
    >
      <div className='mb-2 flex items-center gap-1.5'>
        <Globe className='text-primary size-3.5 shrink-0' aria-hidden='true' />
        <h3 className='text-muted-foreground text-xs font-medium'>
          {t('API Addresses')}
        </h3>
      </div>

      {loading ? (
        <LoadingState inline size='sm' message={t('Loading...')} />
      ) : (
        <ItemGroup
          className={cn(
            'max-h-40 overflow-y-auto',
            addresses.length > 1
              ? 'grid gap-2 sm:grid-cols-2 lg:grid-cols-3'
              : 'gap-2'
          )}
        >
          {addresses.map((address) => (
            <Item
              key={address.url}
              role='listitem'
              variant='muted'
              size='xs'
              className='flex-nowrap items-center justify-between gap-2.5'
            >
              <ItemContent className='min-w-0 gap-1'>
                <div className='flex flex-wrap items-center gap-1.5'>
                  <Badge
                    variant='secondary'
                    className='h-5 px-1.5 text-[11px] font-medium'
                  >
                    {address.route}
                  </Badge>
                  {address.description && (
                    <ItemDescription className='line-clamp-none text-xs break-words'>
                      {address.description}
                    </ItemDescription>
                  )}
                </div>
                <code className='text-foreground font-mono text-xs font-medium break-all select-all sm:text-[13px]'>
                  {address.url}
                </code>
              </ItemContent>
              <ItemActions className='shrink-0'>
                <CopyButton
                  value={address.url}
                  variant='outline'
                  size='sm'
                  tooltip={t('Copy API URL')}
                  aria-label={`${t('Copy API URL')}: ${address.url}`}
                />
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}
    </section>
  )
}
