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
import { useQueryClient } from '@tanstack/react-query'
import {
  Loader2,
  RefreshCw,
  Trash2,
  Power,
  PowerOff,
  Plus,
  Key,
  Play,
  CheckCircle2,
  AlertCircle,
  X,
} from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { CopyButton } from '@/components/copy-button'
import { StaticDataTable } from '@/components/data-table'
import { Dialog } from '@/components/dialog'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { toIntlLocale } from '@/i18n/languages'
import {
  ADMIN_PERMISSION_ACTIONS,
  ADMIN_PERMISSION_RESOURCES,
  hasPermission,
} from '@/lib/admin-permissions'
import { handleServerError } from '@/lib/handle-server-error'
import {
  getServerMessage,
  translateServerText,
} from '@/lib/server-error-message'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import {
  getMultiKeyStatus,
  enableMultiKey,
  disableMultiKey,
  deleteMultiKey,
  enableAllMultiKeys,
  disableAllMultiKeys,
  deleteDisabledMultiKeys,
  addMultiKeys,
  testChannel,
} from '../../api'
import {
  CHANNEL_TYPE_TASK_PLUGIN,
  MULTI_KEY_FILTER_OPTIONS,
} from '../../constants'
import {
  channelsQueryKeys,
  formatTimestamp,
  getMultiKeyStatusConfig,
  getMultiKeyConfirmMessage,
  isDestructiveAction,
} from '../../lib'
import { formatChannelBalanceSummary } from '../../lib/channel-balance'
import type { KeyStatus, MultiKeyConfirmAction } from '../../types'
import { ChannelBalanceDetails } from '../channel-balance-details'
import { useChannels } from '../channels-provider'
import { StatisticsCard } from './multi-key-statistics-card'
import { MultiKeyTableRowActions } from './multi-key-table-row-actions'

type MultiKeyManageDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MultiKeyManageDialog({
  open,
  onOpenChange,
}: MultiKeyManageDialogProps) {
  const { t, i18n } = useTranslation()
  const { currentRow } = useChannels()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  // A plugin channel queries the balance of each key.
  const keyBalances =
    currentRow?.type === CHANNEL_TYPE_TASK_PLUGIN
      ? currentRow.balance_detail?.keys
      : undefined
  const queryClient = useQueryClient()
  const currentUser = useAuthStore((s) => s.auth.user)
  const canEditSensitive = hasPermission(
    currentUser,
    ADMIN_PERMISSION_RESOURCES.CHANNEL,
    ADMIN_PERMISSION_ACTIONS.SENSITIVE_WRITE
  )

  // Data state
  const [isLoading, setIsLoading] = useState(false)
  const [keys, setKeys] = useState<KeyStatus[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [enabledCount, setEnabledCount] = useState(0)
  const [manualDisabledCount, setManualDisabledCount] = useState(0)
  const [autoDisabledCount, setAutoDisabledCount] = useState(0)

  // Add Keys state
  const [showAddKeys, setShowAddKeys] = useState(false)
  const [newKeysText, setNewKeysText] = useState('')
  const [isAddingKeys, setIsAddingKeys] = useState(false)

  // Testing & Toggling state per key
  const [testingKeyIndices, setTestingKeyIndices] = useState<
    Record<number, boolean>
  >({})
  const [keyTestResults, setKeyTestResults] = useState<
    Record<
      number,
      {
        success: boolean
        time?: number
        message?: string
      }
    >
  >({})
  const [togglingKeyIndices, setTogglingKeyIndices] = useState<
    Record<number, boolean>
  >({})

  // UI state
  const [statusFilter, setStatusFilter] = useState<number | null>(null)
  const [confirmAction, setConfirmAction] =
    useState<MultiKeyConfirmAction | null>(null)
  const [isPerformingAction, setIsPerformingAction] = useState(false)
  const confirmOpenerRef = useRef<HTMLElement | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  const openConfirm = (action: MultiKeyConfirmAction) => {
    const opener = document.activeElement
    confirmOpenerRef.current = opener instanceof HTMLElement ? opener : null
    setConfirmAction(action)
  }

  const getConfirmFinalFocus = () => {
    const opener = confirmOpenerRef.current
    return opener && bodyRef.current?.contains(opener)
      ? opener
      : bodyRef.current
  }

  // Reset and load data when dialog opens
  useEffect(() => {
    if (open && currentRow) {
      setCurrentPage(1)
      setStatusFilter(null)
      setShowAddKeys(false)
      setNewKeysText('')
      setKeyTestResults({})
      loadKeyStatus(1, pageSize, null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentRow?.id])

  const loadKeyStatus = async (
    page: number = currentPage,
    size: number = pageSize,
    status: number | null = statusFilter
  ) => {
    if (!currentRow) return

    setIsLoading(true)
    try {
      const response = await getMultiKeyStatus(
        currentRow.id,
        page,
        size,
        status === null ? undefined : status
      )

      if (response.success && response.data) {
        setKeys(response.data.keys || [])
        setTotal(response.data.total || 0)
        setCurrentPage(response.data.page || 1)
        setPageSize(response.data.page_size || 10)
        setTotalPages(response.data.total_pages || 0)
        setEnabledCount(response.data.enabled_count || 0)
        setManualDisabledCount(response.data.manual_disabled_count || 0)
        setAutoDisabledCount(response.data.auto_disabled_count || 0)
      } else {
        handleServerError(response, t('Failed to load key status'))
      }
    } catch (error: unknown) {
      handleServerError(error, t('Failed to load key status'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleStatusFilterChange = (value: string) => {
    const newFilter = value === 'all' ? null : Number.parseInt(value)
    setStatusFilter(newFilter)
    setCurrentPage(1)
    loadKeyStatus(1, pageSize, newFilter)
  }

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage)
    loadKeyStatus(newPage, pageSize)
  }

  const handleAddKeys = async () => {
    if (!currentRow || !newKeysText.trim()) return
    setIsAddingKeys(true)
    try {
      const response = await addMultiKeys(currentRow.id, newKeysText)
      if (response?.success) {
        toast.success(
          getServerMessage(response) || t('Keys added successfully')
        )
        setNewKeysText('')
        setShowAddKeys(false)
        queryClient.invalidateQueries({ queryKey: channelsQueryKeys.lists() })
        queryClient.invalidateQueries({
          queryKey: channelsQueryKeys.pluginCredentials(currentRow.id),
        })
        loadKeyStatus(1, pageSize)
      } else {
        handleServerError(response, t('Failed to add keys'))
      }
    } catch (error: unknown) {
      handleServerError(error, t('Failed to add keys'))
    } finally {
      setIsAddingKeys(false)
    }
  }

  const handleTestKey = async (keyIndex: number) => {
    if (!currentRow) return
    setTestingKeyIndices((prev) => ({ ...prev, [keyIndex]: true }))
    try {
      const res = await testChannel(currentRow.id, { key_index: keyIndex })
      const timeMs =
        typeof res.time === 'number' ? Math.round(res.time * 1000) : undefined
      setKeyTestResults((prev) => ({
        ...prev,
        [keyIndex]: {
          success: res.success,
          time: timeMs,
          message: res.message,
        },
      }))
      if (res.success) {
        toast.success(
          timeMs !== undefined
            ? t('Key test successful ({{time}}ms)', { time: timeMs })
            : t('Test Passed')
        )
      } else {
        toast.error(res.message || t('Key test failed'))
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : t('Key test failed')
      setKeyTestResults((prev) => ({
        ...prev,
        [keyIndex]: {
          success: false,
          message: msg,
        },
      }))
      handleServerError(error, t('Key test failed'))
    } finally {
      setTestingKeyIndices((prev) => ({ ...prev, [keyIndex]: false }))
    }
  }

  const handleToggleKey = async (keyIndex: number, currentStatus: number) => {
    if (!currentRow) return
    const isEnabled = currentStatus === 1
    setTogglingKeyIndices((prev) => ({ ...prev, [keyIndex]: true }))
    try {
      const response = isEnabled
        ? await disableMultiKey(currentRow.id, keyIndex)
        : await enableMultiKey(currentRow.id, keyIndex)
      if (response?.success) {
        toast.success(
          getServerMessage(response) ||
            (isEnabled ? t('Key disabled') : t('Key enabled'))
        )
        setKeys((prev) =>
          prev.map((k) =>
            k.index === keyIndex
              ? {
                  ...k,
                  status: isEnabled ? 2 : 1,
                  reason: isEnabled ? t('Manual Disabled') : undefined,
                  disabled_time: isEnabled
                    ? Math.floor(Date.now() / 1000)
                    : undefined,
                }
              : k
          )
        )
        if (isEnabled) {
          setEnabledCount((c) => Math.max(0, c - 1))
          setManualDisabledCount((c) => c + 1)
        } else {
          if (currentStatus === 2) {
            setManualDisabledCount((c) => Math.max(0, c - 1))
          } else if (currentStatus === 3) {
            setAutoDisabledCount((c) => Math.max(0, c - 1))
          }
          setEnabledCount((c) => c + 1)
        }
        queryClient.invalidateQueries({ queryKey: channelsQueryKeys.lists() })
      } else {
        handleServerError(
          response,
          isEnabled ? t('Failed to disable key') : t('Failed to enable key')
        )
      }
    } catch (error: unknown) {
      handleServerError(
        error,
        isEnabled ? t('Failed to disable key') : t('Failed to enable key')
      )
    } finally {
      setTogglingKeyIndices((prev) => ({ ...prev, [keyIndex]: false }))
    }
  }

  const performAction = async () => {
    if (!confirmAction || !currentRow) return
    if (
      !canEditSensitive &&
      (confirmAction.type === 'delete' ||
        confirmAction.type === 'delete-disabled')
    ) {
      setConfirmAction(null)
      return
    }

    setIsPerformingAction(true)
    try {
      const { type, keyIndex } = confirmAction
      let response

      // Execute the appropriate action
      if (type === 'enable' && keyIndex !== undefined) {
        response = await enableMultiKey(currentRow.id, keyIndex)
      } else if (type === 'disable' && keyIndex !== undefined) {
        response = await disableMultiKey(currentRow.id, keyIndex)
      } else if (type === 'delete' && keyIndex !== undefined) {
        response = await deleteMultiKey(currentRow.id, keyIndex)
      } else if (type === 'enable-all') {
        response = await enableAllMultiKeys(currentRow.id)
      } else if (type === 'disable-all') {
        response = await disableAllMultiKeys(currentRow.id)
      } else if (type === 'delete-disabled') {
        response = await deleteDisabledMultiKeys(currentRow.id)
      }

      if (response?.success) {
        toast.success(getServerMessage(response) || t('Operation successful'))
        queryClient.invalidateQueries({ queryKey: channelsQueryKeys.lists() })
        queryClient.invalidateQueries({
          queryKey: channelsQueryKeys.pluginCredentials(currentRow.id),
        })

        // Reload data - reset to page 1 for bulk actions
        const isBulkAction = type.includes('all') || type === 'delete-disabled'
        if (isBulkAction) {
          setCurrentPage(1)
          loadKeyStatus(1, pageSize)
        } else {
          loadKeyStatus(currentPage, pageSize)
        }
      } else {
        handleServerError(response, t('Operation failed'))
      }
    } catch (error: unknown) {
      handleServerError(error, t('Operation failed'))
    } finally {
      setIsPerformingAction(false)
      setConfirmAction(null)
    }
  }

  const renderStatusBadge = (status: number) => {
    const config = getMultiKeyStatusConfig(status)
    return (
      <StatusBadge
        label={t(config.label)}
        variant={config.variant}
        showDot
        copyable={false}
      />
    )
  }

  const formatKeyTimestamp = (timestamp?: number) => {
    if (!timestamp) return '-'
    return formatTimestamp(timestamp)
  }

  if (!currentRow) return null

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={
          <>
            {t('Multi-Key Management')}
            <StatusBadge
              label={currentRow.name}
              variant='neutral'
              copyable={false}
            />
            {currentRow.channel_info?.multi_key_mode && (
              <StatusBadge
                label={
                  currentRow.channel_info.multi_key_mode === 'random'
                    ? t('Random')
                    : t('Polling')
                }
                variant='neutral'
                copyable={false}
              />
            )}
          </>
        }
        description={t(
          'Manage multi-key status and configuration for this channel'
        )}
        contentClassName={cn(
          'flex max-h-[min(90dvh,var(--dialog-available-height))] max-w-5xl flex-col',
          keyBalances && 'sm:max-w-6xl'
        )}
        titleClassName='flex items-center gap-2'
        contentHeight='min(76vh, 760px)'
        bodyClassName='space-y-4'
      >
        <div
          ref={bodyRef}
          className='flex min-h-0 flex-1 flex-col space-y-4 overflow-hidden'
        >
          {/* Statistics */}
          <div className='grid shrink-0 grid-cols-3 gap-3'>
            <StatisticsCard
              label={t('Enabled')}
              count={enabledCount}
              total={total}
            />
            <StatisticsCard
              label={t('Manual Disabled')}
              count={manualDisabledCount}
              total={total}
            />
            <StatisticsCard
              label={t('Auto Disabled')}
              count={autoDisabledCount}
              total={total}
            />
          </div>

          <Separator className='shrink-0' />

          {/* Toolbar */}
          <div className='flex shrink-0 flex-wrap items-center justify-between gap-2'>
            <div className='flex items-center gap-2'>
              <Select
                items={MULTI_KEY_FILTER_OPTIONS.map((option) => ({
                  value: option.value,
                  label: t(option.label),
                }))}
                value={statusFilter === null ? 'all' : statusFilter.toString()}
                onValueChange={(v) => v !== null && handleStatusFilterChange(v)}
              >
                <SelectTrigger className='w-36 sm:w-40'>
                  <SelectValue placeholder={t('All Status')} />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {MULTI_KEY_FILTER_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {t(option.label)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>

              <Button
                variant={showAddKeys ? 'secondary' : 'default'}
                size='sm'
                onClick={() => setShowAddKeys((prev) => !prev)}
                disabled={!canEditSensitive}
                title={
                  canEditSensitive
                    ? undefined
                    : t('No permission to perform this action')
                }
              >
                <Plus className='mr-1.5 h-4 w-4' />
                {t('Add Keys')}
              </Button>
            </div>

            <div className='flex items-center gap-2'>
              <Button
                variant='outline'
                size='sm'
                onClick={() => loadKeyStatus()}
                disabled={isLoading}
              >
                <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
              </Button>

              {manualDisabledCount + autoDisabledCount > 0 && (
                <Button
                  variant='default'
                  size='sm'
                  onClick={() => openConfirm({ type: 'enable-all' })}
                >
                  <Power className='mr-1.5 h-4 w-4' />
                  {t('Enable All')}
                </Button>
              )}

              {enabledCount > 0 && (
                <Button
                  variant='destructive'
                  size='sm'
                  onClick={() => openConfirm({ type: 'disable-all' })}
                >
                  <PowerOff className='mr-1.5 h-4 w-4' />
                  {t('Disable All')}
                </Button>
              )}

              {autoDisabledCount > 0 && (
                <Button
                  variant='destructive'
                  size='sm'
                  onClick={() => {
                    if (!canEditSensitive) return
                    openConfirm({ type: 'delete-disabled' })
                  }}
                  disabled={!canEditSensitive}
                  title={
                    canEditSensitive
                      ? undefined
                      : t('No permission to perform this action')
                  }
                >
                  <Trash2 className='mr-1.5 h-4 w-4' />
                  {t('Delete Auto-Disabled')}
                </Button>
              )}
            </div>
          </div>

          {/* Inline Add Keys Panel */}
          {showAddKeys && (
            <div className='bg-muted/40 shrink-0 space-y-3 rounded-lg border p-3.5'>
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <Key className='text-primary h-4 w-4' />
                  <span className='text-sm font-medium'>{t('Add API Keys')}</span>
                </div>
                <Button
                  variant='ghost'
                  size='sm'
                  className='h-7 w-7 p-0'
                  onClick={() => setShowAddKeys(false)}
                >
                  <X className='h-4 w-4' />
                </Button>
              </div>
              <Textarea
                value={newKeysText}
                onChange={(e) => setNewKeysText(e.target.value)}
                placeholder={t(
                  'Enter one key per line, e.g.\nsk-...\nsk-...'
                )}
                rows={3}
                className='min-h-[72px] resize-y font-mono text-xs'
              />
              <div className='flex items-center justify-between'>
                <span className='text-muted-foreground text-xs'>
                  {t('Duplicate keys will be automatically filtered')}
                </span>
                <div className='flex items-center gap-2'>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => {
                      setNewKeysText('')
                      setShowAddKeys(false)
                    }}
                    disabled={isAddingKeys}
                  >
                    {t('Cancel')}
                  </Button>
                  <Button
                    variant='default'
                    size='sm'
                    onClick={handleAddKeys}
                    disabled={!newKeysText.trim() || isAddingKeys}
                  >
                    {isAddingKeys && (
                      <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
                    )}
                    {t('Add Keys')}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {!canEditSensitive && (
            <p className='text-muted-foreground text-xs'>
              {t('No permission to perform this action')}
            </p>
          )}

          {/* Table */}
          <div className='min-h-0 flex-1 overflow-auto rounded-md border'>
            {isLoading && (
              <div className='flex items-center justify-center py-12'>
                <Loader2 className='text-muted-foreground h-8 w-8 animate-spin' />
              </div>
            )}
            {!isLoading && keys.length === 0 && (
              <div className='text-muted-foreground py-12 text-center'>
                {t('No keys found')}
              </div>
            )}
            {!isLoading && !(keys.length === 0) && (
              <StaticDataTable
                className='rounded-none border-0'
                tableClassName='min-w-[840px]'
                data={keys}
                getRowKey={(key) => key.index}
                columns={[
                  {
                    id: 'index',
                    header: t('Index'),
                    className: 'w-16',
                    cellClassName: 'font-mono text-sm text-muted-foreground',
                    cell: (key) => `#${key.index + 1}`,
                  },
                  {
                    id: 'key',
                    header: t('Key'),
                    className: 'w-48',
                    cell: (key) => (
                      <div className='flex max-w-[200px] items-center gap-1.5'>
                        <code className='bg-muted/80 text-foreground truncate rounded px-1.5 py-0.5 font-mono text-xs select-all'>
                          {key.key_preview || '-'}
                        </code>
                        {key.key_preview && (
                          <CopyButton
                            value={key.key_preview}
                            className='h-6 w-6 shrink-0'
                            iconClassName='h-3 w-3'
                          />
                        )}
                      </div>
                    ),
                  },
                  {
                    id: 'status',
                    header: t('Status'),
                    className: 'w-48',
                    cell: (key) => {
                      const isKeyToggling = !!togglingKeyIndices[key.index]
                      return (
                        <div className='flex items-center gap-2.5'>
                          <Switch
                            size='sm'
                            checked={key.status === 1}
                            disabled={isKeyToggling}
                            onCheckedChange={() =>
                              handleToggleKey(key.index, key.status)
                            }
                            aria-label={t('Toggle Key')}
                          />
                          {isKeyToggling && (
                            <Loader2 className='text-muted-foreground h-3.5 w-3.5 animate-spin' />
                          )}
                          {renderStatusBadge(key.status)}
                        </div>
                      )
                    },
                  },
                  {
                    id: 'test',
                    header: t('Verification'),
                    className: 'w-44',
                    cell: (key) => {
                      const isTesting = !!testingKeyIndices[key.index]
                      const testResult = keyTestResults[key.index]
                      return (
                        <div className='flex items-center gap-2'>
                          <Button
                            variant='outline'
                            size='sm'
                            className='h-7 px-2.5 text-xs'
                            onClick={() => handleTestKey(key.index)}
                            disabled={isTesting}
                          >
                            {isTesting ? (
                              <Loader2 className='mr-1 h-3 w-3 animate-spin' />
                            ) : (
                              <Play className='mr-1 h-3 w-3 fill-current' />
                            )}
                            {t('Test')}
                          </Button>
                          {testResult &&
                            (testResult.success ? (
                              <span
                                className='bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-xs'
                                title={t('Test Passed')}
                              >
                                <CheckCircle2 className='h-3 w-3' />
                                {testResult.time !== undefined
                                  ? `${testResult.time}ms`
                                  : t('Pass')}
                              </span>
                            ) : (
                              <TooltipProvider delay={100}>
                                <Tooltip>
                                  <TooltipTrigger
                                    render={
                                      <span className='bg-destructive/10 text-destructive border-destructive/20 inline-flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-xs'>
                                        <AlertCircle className='h-3 w-3' />
                                        {t('Failed')}
                                      </span>
                                    }
                                  />
                                  <TooltipContent
                                    side='top'
                                    className='max-w-xs break-all'
                                  >
                                    {testResult.message || t('Key test failed')}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ))}
                        </div>
                      )
                    },
                  },
                  ...(keyBalances
                    ? [
                        {
                          id: 'balance',
                          header: t('Balance'),
                          className: 'w-48',
                          cellClassName: 'text-sm',
                          cell: (key: KeyStatus) => {
                            const result = keyBalances[String(key.index)]
                            if (!result) return '-'
                            return (
                              <div className='max-w-56 space-y-0.5 whitespace-normal'>
                                <div className='font-medium'>
                                  {formatChannelBalanceSummary(
                                    result,
                                    Number.NaN,
                                    { locale }
                                  )}
                                </div>
                                <ChannelBalanceDetails
                                  result={result}
                                  className='text-muted-foreground'
                                />
                              </div>
                            )
                          },
                        },
                      ]
                    : []),
                  {
                    id: 'reason',
                    header: t('Disabled Reason'),
                    className: 'min-w-[160px]',
                    cellClassName: 'max-w-xs truncate text-sm',
                    cell: (key) =>
                      key.reason ? translateServerText(t, key.reason) : '-',
                  },
                  {
                    id: 'disabled-time',
                    header: t('Disabled Time'),
                    className: 'w-40',
                    cellClassName: 'text-muted-foreground text-sm',
                    cell: (key) => formatKeyTimestamp(key.disabled_time),
                  },
                  {
                    id: 'actions',
                    header: t('Actions'),
                    className: 'w-24 text-right',
                    cell: (key) => (
                      <MultiKeyTableRowActions
                        keyIndex={key.index}
                        status={key.status}
                        canDelete={canEditSensitive}
                        onAction={openConfirm}
                      />
                    ),
                  },
                ]}
              />
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className='flex shrink-0 items-center justify-between'>
              <div className='text-muted-foreground text-sm'>
                {t('Page {{current}} of {{total}}', {
                  current: currentPage,
                  total: totalPages,
                })}
              </div>
              <div className='flex gap-2'>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1 || isLoading}
                >
                  {t('Previous')}
                </Button>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage >= totalPages || isLoading}
                >
                  {t('Next')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Dialog>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        open={confirmAction !== null}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title={t('Confirm Action')}
        desc={t(getMultiKeyConfirmMessage(confirmAction))}
        destructive={isDestructiveAction(confirmAction)}
        isLoading={isPerformingAction}
        handleConfirm={performAction}
        finalFocus={getConfirmFinalFocus}
      />
    </>
  )
}
